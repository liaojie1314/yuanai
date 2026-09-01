"""数据库 SecretStore 的持久化、加密和租户隔离测试。"""

import uuid

import pytest
from sqlalchemy import select

from app.core.config import settings
from app.models.tool_runtime import SecretRecord
from app.services.secret_store import (
    DatabaseSecretStore,
    SecretStoreUnavailableError,
    TenantSecretStore,
)
from tests.conftest import TestSessionLocal


@pytest.mark.asyncio
async def test_database_store_encrypts_round_trips_and_deletes(
    test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """数据库只保存密文，凭证可跨请求读取并按引用删除。"""

    monkeypatch.setattr(settings, "secret_store_encryption_key", "test-secret-store-key")
    store = DatabaseSecretStore(session_factory=TestSessionLocal)

    secret_ref = await store.put(test_user.id, "mcp-test-secret")
    assert secret_ref.startswith(f"db://{test_user.id.hex.upper()}/")

    async with TestSessionLocal() as session:
        record = await session.scalar(
            select(SecretRecord).where(SecretRecord.owner_id == test_user.id)
        )
    assert record is not None
    assert "mcp-test-secret" not in record.ciphertext
    assert await store.get(test_user.id, secret_ref) == "mcp-test-secret"

    await store.delete(test_user.id, secret_ref)
    assert await store.get(test_user.id, secret_ref) is None
    await store.delete(test_user.id, secret_ref)


@pytest.mark.asyncio
async def test_database_store_rejects_cross_tenant_references(
    test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """数据库引用携带租户身份，其他租户不能校验或读取。"""

    monkeypatch.setattr(settings, "secret_store_encryption_key", "test-secret-store-key")
    store = DatabaseSecretStore(session_factory=TestSessionLocal)
    secret_ref = await store.put(test_user.id, "mcp-test-secret")
    other_owner = uuid.uuid4()

    with pytest.raises(SecretStoreUnavailableError):
        store.assert_ref_allowed(other_owner, secret_ref)
    with pytest.raises(SecretStoreUnavailableError):
        await store.get(other_owner, secret_ref)
    with pytest.raises(SecretStoreUnavailableError):
        await store.delete(other_owner, secret_ref)


@pytest.mark.asyncio
async def test_tenant_store_keeps_environment_compatibility_and_database_writes(
    test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """兼容环境 Secret 只读，同时把新凭证路由到数据库存储。"""

    monkeypatch.setattr(settings, "secret_store_encryption_key", "test-secret-store-key")
    database_store = DatabaseSecretStore(session_factory=TestSessionLocal)
    store = TenantSecretStore(database_store=database_store)
    owner_key = test_user.id.hex.upper()
    env_name = f"YUANAI_MCP_SECRET_{owner_key}_MCP_TOKEN"
    monkeypatch.setenv(env_name, "environment-secret")
    env_ref = f"env://{env_name}"

    assert await store.get(test_user.id, env_ref) == "environment-secret"
    database_ref = await store.put(test_user.id, "database-secret")
    assert await store.get(test_user.id, database_ref) == "database-secret"

    with pytest.raises(SecretStoreUnavailableError):
        await store.delete(test_user.id, env_ref)


@pytest.mark.asyncio
async def test_database_store_fails_closed_without_master_key(
    test_user, monkeypatch: pytest.MonkeyPatch
) -> None:
    """缺少独立主密钥时不回退到 JWT 或其他部署密钥。"""

    monkeypatch.setattr(settings, "secret_store_encryption_key", "")
    store = DatabaseSecretStore(session_factory=TestSessionLocal)

    with pytest.raises(SecretStoreUnavailableError):
        await store.put(test_user.id, "mcp-test-secret")
