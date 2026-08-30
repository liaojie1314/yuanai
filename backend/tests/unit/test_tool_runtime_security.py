"""Tool Runtime 的安全契约测试。"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tool_runtime import (
    ExecutionNodeStatus,
    ToolExecutionStatus,
)
from app.services.tool_runtime_service import (
    ToolRuntimeError,
    ToolRuntimeService,
    create_artifact_download_token,
    verify_artifact_download_token,
)
from app.services.tools.sandbox import SandboxExecutionError, execute_python
from app.services.tools.web_security import UrlPolicyError, validate_public_url
from app.tools.contracts import SideEffect, ToolContext, ToolRisk, ToolSpec
from app.tools.registry import ToolRegistry


def _secret_registry() -> ToolRegistry:
    """构造包含敏感参数的最小注册表。"""

    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="secret_tool",
            description="测试敏感参数",
            input_schema={
                "type": "object",
                "properties": {
                    "token": {"type": "string"},
                    "value": {"type": "integer"},
                },
                "required": ["token", "value"],
                "additionalProperties": False,
            },
            risk_level=ToolRisk.external_side_effect,
            execution_location="cloud",
            side_effect=SideEffect.external,
        ),
        AsyncMock(return_value={"ok": True}),
    )
    return registry


@pytest.mark.asyncio
async def test_execution_sanitizes_arguments_and_detects_idempotency_conflict(
    db: AsyncSession, test_user
) -> None:
    """审计只保留脱敏参数；同一幂等键不能绑定另一组参数。"""

    service = ToolRuntimeService(_secret_registry())
    arguments = {"token": "super-secret", "value": 1}
    first = await service.create_execution(
        user_id=test_user.id,
        tool_name="secret_tool",
        arguments=arguments,
        execution_location="cloud",
        idempotency_key="same-request",
        db=db,
    )
    duplicate = await service.create_execution(
        user_id=test_user.id,
        tool_name="secret_tool",
        arguments=arguments,
        execution_location="cloud",
        idempotency_key="same-request",
        db=db,
    )

    assert duplicate.id == first.id
    assert first.arguments_preview["token"] == "[redacted]"
    assert first.arguments_hash != "super-secret"
    with pytest.raises(ToolRuntimeError, match="TOOL_IDEMPOTENCY_CONFLICT"):
        await service.create_execution(
            user_id=test_user.id,
            tool_name="secret_tool",
            arguments={"token": "different", "value": 1},
            execution_location="cloud",
            idempotency_key="same-request",
            db=db,
        )


@pytest.mark.asyncio
async def test_execution_persists_the_unified_tool_result_contract(
    db: AsyncSession, test_user
) -> None:
    """成功执行应保存统一结果，而不是把 handler 原始字典直接落库。"""

    service = ToolRuntimeService()
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="calculate",
        arguments={"expression": "2 + 3"},
        execution_location="cloud",
        db=db,
    )

    await service.execute(
        execution,
        arguments={"expression": "2 + 3"},
        db=db,
    )

    assert execution.result_json is not None
    assert execution.result_json["status"] == "succeeded"
    assert execution.result_json["data"] == {"result": 5}
    assert execution.result_json["artifacts"] == []
    assert execution.result_json["citations"] == []
    assert execution.result_json["metrics"]["output_bytes"] > 0
    assert execution.result_json["error"] is None


@pytest.mark.asyncio
async def test_expired_artifact_is_unreadable_and_purgeable(db: AsyncSession, test_user) -> None:
    """过期 Artifact 不得读取，并可由清理任务移除记录和对象。"""

    service = ToolRuntimeService()
    artifact = await service.create_artifact(
        user_id=test_user.id,
        data=b"expired report",
        name="expired-report.txt",
        mime_type="text/plain",
        db=db,
    )
    artifact.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.flush()

    with pytest.raises(ToolRuntimeError, match="ARTIFACT_EXPIRED"):
        await service.read_artifact_content(artifact.id, user_id=test_user.id, db=db)

    assert await service.purge_expired_artifacts(db=db) == 1
    with pytest.raises(ToolRuntimeError, match="ARTIFACT_NOT_FOUND"):
        await service.get_artifact(artifact.id, user_id=test_user.id, db=db)


@pytest.mark.asyncio
async def test_manual_side_effect_waits_without_calling_handler(
    db: AsyncSession, test_user
) -> None:
    """未获批的副作用工具只能进入 waiting，handler 不得被调用。"""

    handler = AsyncMock(return_value={"unexpected": True})
    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="external_write",
            description="测试外部副作用",
            input_schema={"type": "object", "additionalProperties": False},
            risk_level=ToolRisk.external_side_effect,
            execution_location="cloud",
            side_effect=SideEffect.external,
        ),
        handler,
    )
    service = ToolRuntimeService(registry)

    execution = await service.create_manual_execution(
        user_id=test_user.id,
        tool_name="external_write",
        arguments={},
        execution_location="cloud",
        idempotency_key=None,
        run_id=None,
        db=db,
    )

    assert execution.status is ToolExecutionStatus.waiting
    assert execution.error_code == "TOOL_APPROVAL_REQUIRED"
    handler.assert_not_awaited()


@pytest.mark.asyncio
async def test_artifact_and_node_records_are_tenant_scoped(db: AsyncSession, test_user) -> None:
    """另一个用户不能读取 Artifact，撤销节点会取消其等待任务。"""

    from app.core.security import hash_password
    from app.models.user import User

    other_user = User(
        email="other-runtime@example.com",
        username="other-runtime",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(other_user)
    await db.flush()
    service = ToolRuntimeService()
    artifact = await service.create_artifact(
        user_id=test_user.id,
        data=b"report",
        name="../report.txt",
        mime_type="text/plain",
        db=db,
    )
    with pytest.raises(ToolRuntimeError, match="ARTIFACT_NOT_FOUND"):
        await service.get_artifact(artifact.id, user_id=other_user.id, db=db)

    node, _pairing_code = await service.create_pairing(
        user_id=test_user.id,
        name="Test Desktop",
        platform="linux",
        app_version="0.1.0",
        capabilities=["files.read"],
        db=db,
    )
    execution = await service.create_execution(
        user_id=test_user.id,
        tool_name="calculate",
        arguments={"expression": "1 + 1"},
        execution_location="cloud",
        db=db,
    )
    execution.node_id = node.id
    execution.status = ToolExecutionStatus.waiting
    await db.flush()
    await service.revoke_execution_node(node.id, user_id=test_user.id, db=db)

    assert node.status is ExecutionNodeStatus.revoked
    await db.refresh(execution)
    assert execution.status is ToolExecutionStatus.cancelled
    assert execution.error_code == "TOOL_NODE_REVOKED"


@pytest.mark.asyncio
async def test_sandbox_rejects_environment_files_and_network() -> None:
    """沙箱表达式不能读取环境变量、文件或建立网络调用。"""

    for code in (
        "__import__('os')",
        "open('/etc/passwd')",
        "__import__('urllib.request')",
    ):
        with pytest.raises(SandboxExecutionError, match="SANDBOX_EXECUTION_FAILED"):
            await execute_python(code)


@pytest.mark.asyncio
async def test_sandbox_executes_inside_the_available_rootless_boundary() -> None:
    """可用隔离运行时应执行简单表达式并返回结构化结果。"""

    result = await execute_python("2 + 3")

    assert result == {"status": "succeeded", "stdout": "5", "variables": {}}


@pytest.mark.asyncio
async def test_sandbox_fails_closed_when_rootless_runtime_is_unavailable(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """没有 rootless 运行时不能退回宿主 Python。"""

    monkeypatch.setattr("app.services.tools.sandbox.shutil.which", lambda _name: None)

    with pytest.raises(SandboxExecutionError, match="SANDBOX_UNAVAILABLE"):
        await execute_python("2 + 3")


def test_public_url_rejects_local_and_private_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    """公网 URL 校验阻断 localhost 和 DNS 解析到内网的域名。"""

    with pytest.raises(UrlPolicyError):
        validate_public_url("https://localhost/private")

    with monkeypatch.context() as patch:
        patch.setattr(
            "app.services.tools.web_security.socket.getaddrinfo",
            lambda *_args, **_kwargs: [(None, None, None, None, ("127.0.0.1", 443))],
        )
        with pytest.raises(UrlPolicyError, match="private"):
            validate_public_url("https://example.com/private")


def test_tool_context_does_not_expose_unrelated_user_identity() -> None:
    """ToolContext 只携带显式租户标识和当前数据库会话。"""

    user_id = uuid.uuid4()
    context = ToolContext(user_id=user_id)
    assert context.user_id == user_id
    assert context.db is None


def test_artifact_download_token_is_expiring_and_tenant_bound() -> None:
    """Artifact 下载签名必须绑定租户、Artifact 和明确的过期时间。"""

    user_id = uuid.uuid4()
    other_user_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    expires_at = datetime.now(UTC) + timedelta(minutes=5)
    token = create_artifact_download_token(artifact_id, user_id, expires_at=expires_at)
    expires = int(expires_at.timestamp())

    assert verify_artifact_download_token(artifact_id, user_id, expires, token) is True
    assert verify_artifact_download_token(artifact_id, other_user_id, expires, token) is False
    assert verify_artifact_download_token(uuid.uuid4(), user_id, expires, token) is False
    assert (
        verify_artifact_download_token(
            artifact_id, user_id, int((datetime.now(UTC) - timedelta(seconds=1)).timestamp()), token
        )
        is False
    )
