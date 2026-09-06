"""SecretStore 租户边界测试。"""

import uuid

import pytest

from app.services.secret_store import (
    EnvironmentSecretStore,
    SecretStoreUnavailableError,
)


async def test_environment_store_resolves_tenant_scoped_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """租户只能解析内嵌自己 UUID 的环境密钥引用。"""

    owner = uuid.uuid4()
    owner_key = owner.hex.upper()
    monkeypatch.setenv(f"YUANAI_MCP_SECRET_{owner_key}_GITHUB_TOKEN", "token-value")
    store = EnvironmentSecretStore()
    ref = f"env://YUANAI_MCP_SECRET_{owner_key}_GITHUB_TOKEN"
    store.assert_ref_allowed(owner, ref)
    assert await store.get(owner, ref) == "token-value"


async def test_environment_store_rejects_other_tenant_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """引用内嵌其他租户 UUID 时必须拒绝，杜绝跨租户读取部署密钥。"""

    owner = uuid.uuid4()
    other = uuid.uuid4()
    monkeypatch.setenv(f"YUANAI_MCP_SECRET_{other.hex.upper()}_DEPLOY_SECRET", "deployment-secret")
    store = EnvironmentSecretStore()
    foreign_ref = f"env://YUANAI_MCP_SECRET_{other.hex.upper()}_DEPLOY_SECRET"
    with pytest.raises(SecretStoreUnavailableError):
        store.assert_ref_allowed(owner, foreign_ref)
    with pytest.raises(SecretStoreUnavailableError):
        await store.get(owner, foreign_ref)


async def test_environment_store_rejects_malformed_references() -> None:
    """不符合命名空间格式或嵌入租户身份的引用一律拒绝。"""

    store = EnvironmentSecretStore()
    owner = uuid.uuid4()
    for bad_ref in (
        "env://PATH",
        "env://YUANAI_MCP_SECRET_ONLYNAME",
        "env://YUANAI_MCP_SECRET_ZZZZ_NAME",
        "env://YUANAI_MCP_SECRET_ABCDEF_ABC",
        "secret://example",
        "env://YUANAI_MCP_SECRET_3F2A1B9C4D5E6F708192A3B4C5D6E7F2_lower",
    ):
        with pytest.raises(SecretStoreUnavailableError):
            store.assert_ref_allowed(owner, bad_ref)
