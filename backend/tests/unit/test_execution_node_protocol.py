"""Wave 4 执行节点协议安全与投递语义测试。"""

import base64
import json
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.tool_runtime import ExecutionNode
from app.models.user import User
from app.services.tool_runtime_service import (
    ToolRuntimeError,
    ToolRuntimeService,
    _canonical_json,
    create_node_token,
    decrypt_execution_arguments,
    encode_public_key,
    verify_node_challenge,
)


def _private_key() -> Ed25519PrivateKey:
    """创建测试节点密钥。"""

    return Ed25519PrivateKey.generate()


def _public_key(private_key: Ed25519PrivateKey) -> str:
    """编码测试节点公钥。"""

    return encode_public_key(private_key.public_key())


def _signed_result(
    private_key: Ed25519PrivateKey,
    *,
    execution_id: uuid.UUID,
    result: object,
    message_type: str = "completed",
    error_code: object = None,
    error_message: object = None,
    progress: object = None,
) -> dict[str, object]:
    """按照服务端的规范生成节点终态消息。"""

    payload = {
        "type": message_type,
        "execution_id": str(execution_id),
        "result": result,
        "error_code": error_code,
        "error_message": error_message,
        "progress": progress,
    }
    signature = private_key.sign(_canonical_json(payload))
    return {**payload, "signature": base64.urlsafe_b64encode(signature).decode().rstrip("=")}


async def _registered_node(
    service: ToolRuntimeService,
    db: AsyncSession,
    test_user: User,
    *,
    capabilities: list[str],
) -> tuple[ExecutionNode, Ed25519PrivateKey, str]:
    """创建并完成一个节点配对登记。"""

    private_key = _private_key()
    node, pairing_code = await service.create_pairing(
        user_id=test_user.id,
        name="Test Desktop",
        platform="linux",
        app_version="0.1.0",
        capabilities=capabilities,
        db=db,
    )
    registered, token, _expires_at = await service.register_node(
        pairing_code=pairing_code,
        public_key=_public_key(private_key),
        name=node.name,
        platform=node.platform,
        app_version=node.app_version,
        capabilities=capabilities,
        protocol_version=settings.execution_node_protocol_version,
        db=db,
    )
    return registered, private_key, token


@pytest.mark.asyncio
async def test_pairing_registers_ed25519_node_and_consumes_pairing_code(
    db: AsyncSession, test_user
) -> None:
    """Ed25519 公钥可配对登记，配对码只能成功使用一次。"""

    service = ToolRuntimeService()
    node, pairing_code = await service.create_pairing(
        user_id=test_user.id,
        name="Test Desktop",
        platform="linux",
        app_version="0.1.0",
        capabilities=["browser_open_url"],
        db=db,
    )
    private_key = _private_key()
    registered, _token, _expires_at = await service.register_node(
        pairing_code=pairing_code,
        public_key=_public_key(private_key),
        name=node.name,
        platform=node.platform,
        app_version=node.app_version,
        capabilities=["browser_open_url"],
        protocol_version=settings.execution_node_protocol_version,
        db=db,
    )

    assert registered.public_key == _public_key(private_key)
    assert registered.pairing_code_hash is None
    challenge = "one-time-node-challenge"
    challenge_signature = base64.urlsafe_b64encode(private_key.sign(challenge.encode())).decode()
    assert verify_node_challenge(registered, challenge, challenge_signature) is True
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_PAIRING_INVALID"):
        await service.register_node(
            pairing_code=pairing_code,
            public_key=_public_key(private_key),
            name=node.name,
            platform=node.platform,
            app_version=node.app_version,
            capabilities=["browser_open_url"],
            protocol_version=settings.execution_node_protocol_version,
            db=db,
        )


@pytest.mark.asyncio
async def test_node_token_is_invalid_after_revoke_and_token_version_change(
    db: AsyncSession, test_user
) -> None:
    """撤销和 token version 变化都必须使已签发节点 JWT 失效。"""

    service = ToolRuntimeService()
    node, _private_key_value, token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    assert (await service.authenticate_node(token, db=db)).id == node.id

    node.token_version += 1
    await db.flush()
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_REVOKED"):
        await service.authenticate_node(token, db=db)

    fresh_token = create_node_token(node, expires_at=datetime.now(UTC) + timedelta(minutes=5))
    current_version = node.token_version
    await service.revoke_execution_node(node.id, user_id=test_user.id, db=db)
    assert node.token_version == current_version + 1
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_REVOKED"):
        await service.authenticate_node(fresh_token, db=db)


@pytest.mark.asyncio
async def test_execution_arguments_are_aes_gcm_ciphertext_and_round_trip(
    db: AsyncSession, test_user
) -> None:
    """节点参数密文不暴露明文，并能通过绑定 execution ID 还原。"""

    service = ToolRuntimeService()
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="browser_open_url",
        arguments={"url": "https://example.com"},
        execution_location="desktop",
        node_id=(await _registered_node(service, db, test_user, capabilities=["browser_open_url"]))[
            0
        ].id,
        db=db,
    )
    encrypted = execution.arguments_encrypted
    assert encrypted is not None
    assert "https://example.com" not in encrypted
    assert encrypted != json.dumps({"url": "https://example.com"})
    assert decrypt_execution_arguments(execution.id, encrypted) == {"url": "https://example.com"}


@pytest.mark.asyncio
async def test_desktop_execution_requires_node_and_declared_capability(
    db: AsyncSession, test_user
) -> None:
    """Desktop 工具必须绑定节点，且节点策略和 capability 都必须允许该工具。"""

    service = ToolRuntimeService()
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_REQUIRED"):
        await service.create_execution(
            user_id=test_user.id,
            tool_name="browser_open_url",
            arguments={"url": "https://example.com"},
            execution_location="desktop",
            db=db,
        )

    node, _private_key_value, _token = await _registered_node(
        service, db, test_user, capabilities=["other.desktop.tool"]
    )
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_TOOL_NOT_ALLOWED"):
        await service.create_execution(
            user_id=test_user.id,
            tool_name="browser_open_url",
            arguments={"url": "https://example.com"},
            execution_location="desktop",
            node_id=node.id,
            db=db,
        )


@pytest.mark.asyncio
async def test_node_result_requires_valid_signature_and_respects_size_limit(
    db: AsyncSession, test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """节点结果必须由登记私钥签名，且规范化结果受大小限制。"""

    service = ToolRuntimeService()
    node, private_key, _token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="browser_open_url",
        arguments={"url": "https://example.com"},
        execution_location="desktop",
        node_id=node.id,
        db=db,
    )
    await service.apply_node_message(
        node, {"type": "accepted", "execution_id": str(execution.id)}, db=db
    )
    valid = _signed_result(private_key, execution_id=execution.id, result={"title": "Example"})
    tampered = {**valid, "result": {"title": "Tampered"}}
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_SIGNATURE_INVALID"):
        await service.apply_node_message(node, tampered, db=db)

    monkeypatch.setattr(settings, "execution_node_result_max_bytes", 10)
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_RESULT_TOO_LARGE"):
        await service.apply_node_message(node, valid, db=db)


@pytest.mark.asyncio
async def test_terminal_result_replays_until_ack_then_stops(db: AsyncSession, test_user) -> None:
    """终态结果在 ACK 前要求重连重放，确认后不再发送。"""

    service = ToolRuntimeService()
    node, private_key, _token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="browser_open_url",
        arguments={"url": "https://example.com"},
        execution_location="desktop",
        node_id=node.id,
        db=db,
    )
    await service.apply_node_message(
        node, {"type": "accepted", "execution_id": str(execution.id)}, db=db
    )
    await service.apply_node_message(
        node,
        _signed_result(private_key, execution_id=execution.id, result={"opened": True}),
        db=db,
    )

    assert len(await service.list_node_messages(node, db=db)) == 1
    await service.acknowledge_node_result(execution.id, node_id=node.id, db=db)
    assert await service.list_node_messages(node, db=db) == []


@pytest.mark.asyncio
async def test_node_cannot_complete_before_execution_is_running(
    db: AsyncSession, test_user
) -> None:
    """节点必须先接受任务并进入 running 才能回传终态。"""

    service = ToolRuntimeService()
    node, private_key, _token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="browser_open_url",
        arguments={"url": "https://example.com"},
        execution_location="desktop",
        node_id=node.id,
        db=db,
    )
    with pytest.raises(ToolRuntimeError, match="TOOL_EXECUTION_NOT_STARTABLE"):
        await service.apply_node_message(
            node,
            _signed_result(private_key, execution_id=execution.id, result={"opened": True}),
            db=db,
        )


def _renewal_signature(private_key: Ed25519PrivateKey, node_id: uuid.UUID, token: str) -> str:
    """按服务端规范生成令牌续期签名。"""

    payload = {"type": "token_renewal", "node_id": str(node_id), "token": token}
    signature = private_key.sign(_canonical_json(payload))
    return base64.urlsafe_b64encode(signature).decode().rstrip("=")


@pytest.mark.asyncio
async def test_node_token_renewal_requires_private_key_signature(
    db: AsyncSession, test_user
) -> None:
    """过期令牌可凭登记私钥换新；签名、撤销和版本不匹配都会被拒绝。"""

    service = ToolRuntimeService()
    node, private_key, _token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    expired_token = create_node_token(node, expires_at=datetime.now(UTC) - timedelta(minutes=1))
    signature = _renewal_signature(private_key, node.id, expired_token)
    renewed, fresh_token, expires_at = await service.renew_node_token(
        node_id=node.id, token=expired_token, signature=signature, db=db
    )
    assert renewed.id == node.id
    assert (await service.authenticate_node(fresh_token, db=db)).id == node.id
    assert expires_at > datetime.now(UTC)

    tampered = _renewal_signature(private_key, node.id, fresh_token)
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_SIGNATURE_INVALID"):
        await service.renew_node_token(
            node_id=node.id, token=expired_token, signature=tampered, db=db
        )

    node.token_version += 1
    await db.flush()
    with pytest.raises(ToolRuntimeError, match="EXECUTION_NODE_REVOKED"):
        await service.renew_node_token(
            node_id=node.id, token=expired_token, signature=signature, db=db
        )


@pytest.mark.asyncio
async def test_node_gateway_refreshes_state_committed_by_other_sessions(
    db: AsyncSession, test_user
) -> None:
    """节点网关长会话必须看到其他会话提交的取消状态，不能停留在旧快照。"""

    from sqlalchemy import select

    from app.core.database import AsyncSessionLocal

    service = ToolRuntimeService()
    node, _private_key_value, _token = await _registered_node(
        service, db, test_user, capabilities=["browser_open_url"]
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="browser_open_url",
        arguments={"url": "https://example.com"},
        execution_location="desktop",
        node_id=node.id,
        db=db,
    )
    await db.commit()

    async with AsyncSessionLocal() as gateway_db:
        gateway_node = await gateway_db.scalar(
            select(ExecutionNode).where(ExecutionNode.id == node.id)
        )
        assert gateway_node is not None
        first = await service.list_node_messages(gateway_node, db=gateway_db)
        assert [message["type"] for _execution, message in first] == ["job_offer"]
        await gateway_db.commit()

        await service.cancel_execution(execution.id, user_id=test_user.id, db=db)

        second = await service.list_node_messages(gateway_node, db=gateway_db)
        assert [message["type"] for _execution, message in second] == ["cancel_request"]
        await gateway_db.commit()
