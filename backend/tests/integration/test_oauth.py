"""GitHub OAuth 集成测试。

用 monkeypatch 替换 `_exchange_code_for_token` / `_fetch_github_profile`，
避免真的调 GitHub API，让测试聚焦在业务流程：state 校验、账号创建/关联、
错误回跳。
"""
from urllib.parse import parse_qs, urlparse

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.services import oauth_service


@pytest.fixture(autouse=True)
def _configure_github_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    """给测试环境注入合法 client_id / client_secret，让 _ensure_configured() 通过。"""
    monkeypatch.setattr(settings, "github_client_id", "test-client-id")
    monkeypatch.setattr(settings, "github_client_secret", "test-client-secret")
    monkeypatch.setattr(settings, "web_app_url", "http://localhost:3000")
    monkeypatch.setattr(
        settings, "github_redirect_uri", "http://localhost:8000/api/v1/auth/github/callback"
    )


@pytest.fixture
def _mock_state(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """把 oauth_service 用到的 redis_client 换成一个内存字典，便于测试 state 生命周期。"""
    store: dict[str, str] = {}

    class _FakeRedis:
        async def setex(self, key: str, ttl: int, value: str) -> bool:  # noqa: ARG002
            store[key] = value
            return True

        async def get(self, key: str) -> str | None:
            return store.get(key)

        async def delete(self, key: str) -> int:
            return 1 if store.pop(key, None) is not None else 0

    monkeypatch.setattr(oauth_service, "redis_client", _FakeRedis())
    return store


class TestAuthorize:
    async def test_returns_github_authorize_url(
        self, client: AsyncClient, _mock_state: dict[str, str]
    ) -> None:
        resp = await client.get("/api/v1/auth/github", follow_redirects=False)
        assert resp.status_code == 302
        loc = resp.headers["location"]
        assert loc.startswith("https://github.com/login/oauth/authorize?")
        # state 应该已经写进 Redis
        assert len(_mock_state) == 1
        assert next(iter(_mock_state.keys())).startswith("oauth:github:state:")

    async def test_missing_credentials_returns_503(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "github_client_id", "")
        resp = await client.get("/api/v1/auth/github", follow_redirects=False)
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "OAUTH_NOT_CONFIGURED"


class TestCallback:
    async def test_new_user_created_and_redirects_with_tokens(
        self,
        client: AsyncClient,
        db: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
        _mock_state: dict[str, str],
    ) -> None:
        # 先请求 authorize 拿到一个真实 state
        await client.get("/api/v1/auth/github", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:github:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "gh-access-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "github_id": "10086",
                "email": "octocat@example.com",
                "login": "octocat",
                "avatar_url": "https://gh.example.com/avatar.png",
            }

        monkeypatch.setattr(oauth_service, "_exchange_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_github_profile", fake_profile)

        resp = await client.get(
            "/api/v1/auth/github/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        loc = resp.headers["location"]
        parsed = urlparse(loc)
        assert parsed.scheme + "://" + parsed.netloc == "http://localhost:3000"
        assert parsed.path == "/oauth/callback"
        q = parse_qs(parsed.query)
        assert "access_token" in q and q["access_token"][0]
        assert "refresh_token" in q and q["refresh_token"][0]

        # 用户应该已入库
        user = (
            await db.execute(select(User).where(User.github_id == "10086"))
        ).scalar_one_or_none()
        assert user is not None
        assert user.email == "octocat@example.com"
        assert user.username == "octocat"
        assert user.hashed_password is None
        assert user.avatar_url == "https://gh.example.com/avatar.png"

    async def test_existing_email_gets_linked(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_user: User,
        monkeypatch: pytest.MonkeyPatch,
        _mock_state: dict[str, str],
    ) -> None:
        await client.get("/api/v1/auth/github", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:github:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "gh-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "github_id": "20001",
                # 用 fixture 的邮箱 → 应该关联，不新建
                "email": test_user.email,
                "login": "someoneelse",
                "avatar_url": "",
            }

        monkeypatch.setattr(oauth_service, "_exchange_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_github_profile", fake_profile)

        resp = await client.get(
            "/api/v1/auth/github/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert resp.status_code == 302

        await db.refresh(test_user)
        assert test_user.github_id == "20001"

        # 只有一条记录（没有新建）
        rows = (await db.execute(select(User))).scalars().all()
        assert len(rows) == 1

    async def test_invalid_state_redirects_with_error(
        self,
        client: AsyncClient,
        _mock_state: dict[str, str],  # noqa: ARG002
    ) -> None:
        resp = await client.get(
            "/api/v1/auth/github/callback",
            params={"code": "abc", "state": "does-not-exist"},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        loc = resp.headers["location"]
        q = parse_qs(urlparse(loc).query)
        assert q["error"][0] == "OAUTH_STATE_INVALID"

    async def test_provider_error_forwarded(
        self, client: AsyncClient, _mock_state: dict[str, str]  # noqa: ARG002
    ) -> None:
        resp = await client.get(
            "/api/v1/auth/github/callback",
            params={"error": "access_denied", "error_description": "用户拒绝授权"},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        q = parse_qs(urlparse(resp.headers["location"]).query)
        assert q["error"][0] == "OAUTH_PROVIDER_ERROR"
        assert "用户拒绝授权" in q["error_description"][0]

    async def test_state_consumed_after_first_use(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
        _mock_state: dict[str, str],
    ) -> None:
        await client.get("/api/v1/auth/github", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:github:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "gh-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "github_id": "99999",
                "email": "once@example.com",
                "login": "onceuser",
                "avatar_url": "",
            }

        monkeypatch.setattr(oauth_service, "_exchange_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_github_profile", fake_profile)

        # 首次消费成功
        r1 = await client.get(
            "/api/v1/auth/github/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert "access_token" in parse_qs(urlparse(r1.headers["location"]).query)

        # 同一 state 再用 → 应该被拒
        r2 = await client.get(
            "/api/v1/auth/github/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        q = parse_qs(urlparse(r2.headers["location"]).query)
        assert q["error"][0] == "OAUTH_STATE_INVALID"
