"""原生 Google Sign-In（POST /auth/google/native）集成测试。

与 test_oauth_google.py（Web code 流）不同，本文件覆盖 id_token 流：
测试里自己生成一对 RSA 密钥，用私钥签出 id_token，并把
`oauth_service._fetch_google_jwks` 换成本地公钥 JWKS，
这样**签名校验走的是真实 jose 验签路径**，只省掉对 Google 的网络请求。

所有 claim 都是明显合成的假数据（`g-native-*` / `@example.com`），不含真实凭据。
"""

from __future__ import annotations

import base64
import time
from typing import Any

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from httpx import AsyncClient
from jose import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.user import User
from app.services import oauth_service

# 测试用 Web / Android client id —— 合成值，不是任何真实项目的凭据
WEB_CLIENT_ID = "test-web-client-id.apps.googleusercontent.com"
ANDROID_CLIENT_ID = "test-android-client-id.apps.googleusercontent.com"
OTHER_CLIENT_ID = "someone-elses-client-id.apps.googleusercontent.com"


def _b64u(value: int) -> str:
    """把 RSA 公钥的大整数编成 JWK 要求的 base64url 字符串。"""
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


class _SigningKey:
    """一对测试用 RSA 密钥 + 其对应的单键 JWKS。"""

    def __init__(self, kid: str) -> None:
        self.kid = kid
        self._private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.private_pem = self._private.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        ).decode()
        numbers = self._private.public_key().public_numbers()
        self.jwk = {
            "kty": "RSA",
            "use": "sig",
            "alg": "RS256",
            "kid": kid,
            "n": _b64u(numbers.n),
            "e": _b64u(numbers.e),
        }

    def sign(self, claims: dict[str, Any]) -> str:
        """用私钥签出一个 RS256 id_token。"""
        return str(
            jwt.encode(claims, self.private_pem, algorithm="RS256", headers={"kid": self.kid})
        )


# 整个模块共用一对密钥，避免每个用例都做一次 2048 位 RSA 生成（慢）
_GOOGLE_KEY = _SigningKey("test-google-kid")
_FOREIGN_KEY = _SigningKey("test-attacker-kid")


def _claims(**overrides: Any) -> dict[str, Any]:
    """构造一份默认合法的 Google id_token claims，按需覆盖单个字段。"""
    now = int(time.time())
    base: dict[str, Any] = {
        "iss": "https://accounts.google.com",
        "aud": WEB_CLIENT_ID,
        "sub": "g-native-10001",
        "email": "native.tester@example.com",
        "email_verified": True,
        "picture": "https://lh3.example.com/a/avatar.png",
        "iat": now,
        "exp": now + 3600,
    }
    base.update(overrides)
    return base


@pytest.fixture(autouse=True)
def _configure_native_google(monkeypatch: pytest.MonkeyPatch) -> None:
    """注入允许的 audience 集合（Web + Android 两个 client id）。"""
    monkeypatch.setattr(settings, "google_client_id", WEB_CLIENT_ID)
    monkeypatch.setattr(settings, "google_native_client_ids", ANDROID_CLIENT_ID)


@pytest.fixture(autouse=True)
def _local_jwks(monkeypatch: pytest.MonkeyPatch) -> None:
    """把 Google JWKS 换成本地测试公钥，并清掉模块级缓存避免用例间串味。"""

    async def fake_jwks() -> dict[str, Any]:
        return {"keys": [_GOOGLE_KEY.jwk]}

    monkeypatch.setattr(oauth_service, "_google_jwks_cache", None)
    monkeypatch.setattr(oauth_service, "_fetch_google_jwks", fake_jwks)


async def _post(client: AsyncClient, id_token: str) -> Any:
    """调用原生登录端点。"""
    return await client.post("/api/v1/auth/google/native", json={"idToken": id_token})


class TestNativeLoginSuccess:
    async def test_creates_new_user_and_returns_tokens(
        self, client: AsyncClient, db: AsyncSession
    ) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims()))
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["access_token"] and body["refresh_token"]
        assert body["token_type"] == "bearer"
        assert body["user"]["email"] == "native.tester@example.com"

        user = (
            await db.execute(select(User).where(User.google_id == "g-native-10001"))
        ).scalar_one_or_none()
        assert user is not None
        assert user.hashed_password is None
        assert user.avatar_url == "https://lh3.example.com/a/avatar.png"

    async def test_accepts_android_client_id_as_audience(self, client: AsyncClient) -> None:
        # Android 原生客户端未配 serverClientId 时 aud 是 Android client id
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(aud=ANDROID_CLIENT_ID)))
        assert resp.status_code == 200, resp.text

    async def test_accepts_bare_issuer(self, client: AsyncClient) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(iss="accounts.google.com")))
        assert resp.status_code == 200, resp.text

    async def test_existing_google_id_logs_in_without_creating_user(
        self, client: AsyncClient, db: AsyncSession, test_user: User
    ) -> None:
        test_user.google_id = "g-native-10001"
        await db.commit()

        resp = await _post(client, _GOOGLE_KEY.sign(_claims(email="other@example.com")))
        assert resp.status_code == 200, resp.text
        assert resp.json()["user"]["id"] == str(test_user.id)
        assert len((await db.execute(select(User))).scalars().all()) == 1

    async def test_existing_email_gets_linked(
        self, client: AsyncClient, db: AsyncSession, test_user: User
    ) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(email=test_user.email)))
        assert resp.status_code == 200, resp.text

        await db.refresh(test_user)
        assert test_user.google_id == "g-native-10001"
        assert len((await db.execute(select(User))).scalars().all()) == 1


class TestNativeLoginRejects:
    async def test_foreign_audience_rejected(self, client: AsyncClient) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(aud=OTHER_CLIENT_ID)))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "OAUTH_ID_TOKEN_INVALID"
        assert "aud" in resp.json()["detail"]["message"]

    async def test_wrong_signing_key_rejected(self, client: AsyncClient) -> None:
        # 攻击者自签的 token：claims 全合法，但公钥不在 Google JWKS 里
        resp = await _post(client, _FOREIGN_KEY.sign(_claims()))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "OAUTH_ID_TOKEN_INVALID"

    async def test_expired_token_rejected(self, client: AsyncClient) -> None:
        now = int(time.time())
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(iat=now - 7200, exp=now - 3600)))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "OAUTH_ID_TOKEN_INVALID"

    async def test_wrong_issuer_rejected(self, client: AsyncClient) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(iss="https://evil.example.com")))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "OAUTH_ID_TOKEN_INVALID"

    async def test_missing_exp_rejected(self, client: AsyncClient) -> None:
        claims = _claims()
        del claims["exp"]
        resp = await _post(client, _GOOGLE_KEY.sign(claims))
        assert resp.status_code == 401
        assert resp.json()["detail"]["code"] == "OAUTH_ID_TOKEN_INVALID"

    async def test_unverified_email_rejected(self, client: AsyncClient, db: AsyncSession) -> None:
        resp = await _post(client, _GOOGLE_KEY.sign(_claims(email_verified=False)))
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "OAUTH_EMAIL_UNAVAILABLE"
        assert (await db.execute(select(User))).scalars().all() == []

    async def test_malformed_id_token_rejected_by_schema(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/auth/google/native", json={"idToken": "not-a-jwt"})
        assert resp.status_code == 422

    async def test_missing_configuration_returns_503(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "google_client_id", "")
        monkeypatch.setattr(settings, "google_native_client_ids", "")
        resp = await _post(client, _GOOGLE_KEY.sign(_claims()))
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "OAUTH_NOT_CONFIGURED"

    async def test_jwks_unreachable_returns_503(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def boom() -> dict[str, Any]:
            raise oauth_service.OAuthFlowError("OAUTH_NETWORK_ERROR", "无法获取 Google 验签公钥")

        monkeypatch.setattr(oauth_service, "_fetch_google_jwks", boom)
        resp = await _post(client, _GOOGLE_KEY.sign(_claims()))
        assert resp.status_code == 503
        assert resp.json()["detail"]["code"] == "OAUTH_NETWORK_ERROR"


class TestAudienceConfig:
    def test_multiple_audiences_parsed(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(
            settings, "google_native_client_ids", f" {ANDROID_CLIENT_ID} , ios-client-id ,,"
        )
        monkeypatch.setattr(settings, "google_client_id", WEB_CLIENT_ID)
        assert oauth_service._google_native_audiences() == {
            WEB_CLIENT_ID,
            ANDROID_CLIENT_ID,
            "ios-client-id",
        }

    def test_empty_config_yields_empty_set(self, monkeypatch: pytest.MonkeyPatch) -> None:
        monkeypatch.setattr(settings, "google_native_client_ids", "")
        monkeypatch.setattr(settings, "google_client_id", "")
        assert oauth_service._google_native_audiences() == set()
