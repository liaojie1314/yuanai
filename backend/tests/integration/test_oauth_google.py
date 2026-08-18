"""Google OAuth 集成测试。

与 test_oauth.py（GitHub）同构：用 monkeypatch 替换
`_exchange_google_code_for_token` / `_fetch_google_profile`，避免真的调 Google，
聚焦业务流程：state 校验、账号创建/关联、错误回跳、解绑。
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
def _configure_google_oauth(monkeypatch: pytest.MonkeyPatch) -> None:
    """给测试环境注入合法 google client_id / secret，让 _ensure_configured() 通过。"""
    monkeypatch.setattr(settings, "google_client_id", "test-google-client-id")
    monkeypatch.setattr(settings, "google_client_secret", "test-google-client-secret")
    monkeypatch.setattr(settings, "web_app_url", "http://localhost:3000")
    monkeypatch.setattr(
        settings, "google_redirect_uri", "http://localhost:8000/api/v1/auth/google/callback"
    )


@pytest.fixture
def _mock_state(monkeypatch: pytest.MonkeyPatch) -> dict[str, str]:
    """把 oauth_service 用到的 redis_client 换成内存字典，便于测试 state 生命周期。"""
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
    async def test_returns_google_authorize_url(
        self, client: AsyncClient, _mock_state: dict[str, str]
    ) -> None:
        resp = await client.get("/api/v1/auth/google", follow_redirects=False)
        assert resp.status_code == 302
        loc = resp.headers["location"]
        assert loc.startswith("https://accounts.google.com/o/oauth2/v2/auth?")
        # scope 应包含 openid，state 应写进 Redis（google 前缀隔离）
        q = parse_qs(urlparse(loc).query)
        assert "openid" in q["scope"][0]
        assert len(_mock_state) == 1
        assert next(iter(_mock_state.keys())).startswith("oauth:google:state:")

    async def test_missing_credentials_returns_503(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        monkeypatch.setattr(settings, "google_client_id", "")
        resp = await client.get("/api/v1/auth/google", follow_redirects=False)
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
        await client.get("/api/v1/auth/google", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:google:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "google-access-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "provider_id": "g-sub-10086",
                "email": "alice@gmail.com",
                "login": "alice",
                "avatar_url": "https://lh3.google.com/a/avatar.png",
            }

        monkeypatch.setattr(oauth_service, "_exchange_google_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_google_profile", fake_profile)

        resp = await client.get(
            "/api/v1/auth/google/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        parsed = urlparse(resp.headers["location"])
        assert parsed.scheme + "://" + parsed.netloc == "http://localhost:3000"
        assert parsed.path == "/oauth/callback"
        q = parse_qs(parsed.query)
        assert "access_token" in q and q["access_token"][0]
        assert "refresh_token" in q and q["refresh_token"][0]

        user = (
            await db.execute(select(User).where(User.google_id == "g-sub-10086"))
        ).scalar_one_or_none()
        assert user is not None
        assert user.email == "alice@gmail.com"
        assert user.username == "alice"
        assert user.hashed_password is None
        assert user.avatar_url == "https://lh3.google.com/a/avatar.png"

    async def test_existing_email_gets_linked(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_user: User,
        monkeypatch: pytest.MonkeyPatch,
        _mock_state: dict[str, str],
    ) -> None:
        await client.get("/api/v1/auth/google", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:google:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "google-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "provider_id": "g-sub-20001",
                # 用 fixture 的邮箱 → 应该关联，不新建
                "email": test_user.email,
                "login": "someoneelse",
                "avatar_url": "",
            }

        monkeypatch.setattr(oauth_service, "_exchange_google_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_google_profile", fake_profile)

        resp = await client.get(
            "/api/v1/auth/google/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert resp.status_code == 302

        await db.refresh(test_user)
        assert test_user.google_id == "g-sub-20001"

        rows = (await db.execute(select(User))).scalars().all()
        assert len(rows) == 1

    async def test_invalid_state_redirects_with_error(
        self,
        client: AsyncClient,
        _mock_state: dict[str, str],  # noqa: ARG002
    ) -> None:
        resp = await client.get(
            "/api/v1/auth/google/callback",
            params={"code": "abc", "state": "does-not-exist"},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        q = parse_qs(urlparse(resp.headers["location"]).query)
        assert q["error"][0] == "OAUTH_STATE_INVALID"

    async def test_provider_error_forwarded(
        self,
        client: AsyncClient,
        _mock_state: dict[str, str],  # noqa: ARG002
    ) -> None:
        resp = await client.get(
            "/api/v1/auth/google/callback",
            params={"error": "access_denied", "error_description": "用户拒绝授权"},
            follow_redirects=False,
        )
        assert resp.status_code == 302
        q = parse_qs(urlparse(resp.headers["location"]).query)
        assert q["error"][0] == "OAUTH_PROVIDER_ERROR"
        assert "用户拒绝授权" in q["error_description"][0]


class TestUnlink:
    async def test_unlink_google_success(
        self,
        client: AsyncClient,
        db: AsyncSession,
        test_user: User,
        auth_headers: dict[str, str],
    ) -> None:
        test_user.google_id = "g-88888"
        await db.commit()

        resp = await client.delete("/api/v1/auth/me/google", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json()["googleId"] is None

        await db.refresh(test_user)
        assert test_user.google_id is None

    async def test_unlink_rejected_when_no_local_password(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        test_user: User,
    ) -> None:
        test_user.hashed_password = None
        test_user.google_id = "g-77777"
        await db.commit()

        resp = await client.delete("/api/v1/auth/me/google", headers=auth_headers)
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OAUTH_ONLY_ACCOUNT"

        await db.refresh(test_user)
        assert test_user.google_id == "g-77777"


class TestStateLifecycle:
    async def test_state_consumed_after_first_use(
        self,
        client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
        _mock_state: dict[str, str],
    ) -> None:
        await client.get("/api/v1/auth/google", follow_redirects=False)
        state = next(iter(_mock_state.keys())).removeprefix("oauth:google:state:")

        async def fake_exchange(code: str) -> str:  # noqa: ARG001
            return "google-token"

        async def fake_profile(token: str) -> dict[str, str]:  # noqa: ARG001
            return {
                "provider_id": "g-99999",
                "email": "once@gmail.com",
                "login": "onceuser",
                "avatar_url": "",
            }

        monkeypatch.setattr(oauth_service, "_exchange_google_code_for_token", fake_exchange)
        monkeypatch.setattr(oauth_service, "_fetch_google_profile", fake_profile)

        r1 = await client.get(
            "/api/v1/auth/google/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        assert "access_token" in parse_qs(urlparse(r1.headers["location"]).query)

        r2 = await client.get(
            "/api/v1/auth/google/callback",
            params={"code": "abc", "state": state},
            follow_redirects=False,
        )
        q = parse_qs(urlparse(r2.headers["location"]).query)
        assert q["error"][0] == "OAUTH_STATE_INVALID"
