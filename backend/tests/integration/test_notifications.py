"""推送订阅端点 + push_service 集成/单元测试。

- Web 端点：vapid-public-key（公开）、subscribe/unsubscribe（鉴权 + 用户隔离）
- Expo 端点：POST /notifications/expo（幂等）、DELETE /notifications/expo/{token}
- push_service：未配置 VAPID 时 Web 通道 no-op；发送并清理失效订阅/token（mock 网络层）
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.expo_push_token import ExpoPushToken
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.services import push_service

_SUB_BODY = {
    "endpoint": "https://push.example.com/ep/abc123",
    "keys": {"p256dh": "test-p256dh-key", "auth": "test-auth-secret"},
}


class TestVapidPublicKey:
    async def test_returns_configured_key(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "BPublicKeyXYZ")
        resp = await client.get("/api/v1/notifications/vapid-public-key")
        assert resp.status_code == 200
        assert resp.json()["publicKey"] == "BPublicKeyXYZ"

    async def test_empty_when_unconfigured(
        self, client: AsyncClient, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "")
        resp = await client.get("/api/v1/notifications/vapid-public-key")
        assert resp.status_code == 200
        assert resp.json()["publicKey"] == ""


class TestSubscribe:
    async def test_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/notifications/subscribe", json=_SUB_BODY)
        assert resp.status_code == 401

    async def test_creates_subscription(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        test_user: User,
    ) -> None:
        resp = await client.post(
            "/api/v1/notifications/subscribe", json=_SUB_BODY, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        rows = (
            (
                await db.execute(
                    select(PushSubscription).where(
                        PushSubscription.endpoint == _SUB_BODY["endpoint"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].user_id == test_user.id
        assert rows[0].p256dh == "test-p256dh-key"

    async def test_repeat_endpoint_is_idempotent_update(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.post("/api/v1/notifications/subscribe", json=_SUB_BODY, headers=auth_headers)
        # 同 endpoint 再报一次，仅更新，不新建
        updated = {**_SUB_BODY, "keys": {"p256dh": "new-key", "auth": "new-auth"}}
        resp = await client.post(
            "/api/v1/notifications/subscribe", json=updated, headers=auth_headers
        )
        assert resp.status_code == 200

        rows = (
            (
                await db.execute(
                    select(PushSubscription).where(
                        PushSubscription.endpoint == _SUB_BODY["endpoint"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].p256dh == "new-key"


class TestUnsubscribe:
    async def test_removes_own_subscription(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.post("/api/v1/notifications/subscribe", json=_SUB_BODY, headers=auth_headers)
        resp = await client.post(
            "/api/v1/notifications/unsubscribe",
            json={"endpoint": _SUB_BODY["endpoint"]},
            headers=auth_headers,
        )
        assert resp.status_code == 200

        rows = (await db.execute(select(PushSubscription))).scalars().all()
        assert len(rows) == 0

    async def test_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post(
            "/api/v1/notifications/unsubscribe",
            json={"endpoint": _SUB_BODY["endpoint"]},
        )
        assert resp.status_code == 401


class TestPushService:
    async def test_noop_when_unconfigured(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "")
        monkeypatch.setattr(settings, "vapid_private_key", "")
        # 即便有订阅，也应直接返回 0，不调用 webpush
        db.add(PushSubscription(user_id=test_user.id, endpoint="https://p/x", p256dh="k", auth="a"))
        await db.commit()

        called = False

        def fake_webpush(**kwargs: object) -> None:
            nonlocal called
            called = True

        monkeypatch.setattr(push_service, "webpush", fake_webpush)
        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0
        assert called is False

    async def test_sends_to_all_subscriptions(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "pub")
        monkeypatch.setattr(settings, "vapid_private_key", "priv")
        for i in range(2):
            db.add(
                PushSubscription(
                    user_id=test_user.id,
                    endpoint=f"https://p/{i}",
                    p256dh="k",
                    auth="a",
                )
            )
        await db.commit()

        calls: list[str] = []

        def fake_webpush(*, subscription_info: dict, **kwargs: object) -> None:
            calls.append(subscription_info["endpoint"])

        monkeypatch.setattr(push_service, "webpush", fake_webpush)
        sent = await push_service.send_to_user(db, test_user.id, {"title": "hi"})
        assert sent == 2
        assert set(calls) == {"https://p/0", "https://p/1"}

    async def test_prunes_dead_subscription_on_410(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "pub")
        monkeypatch.setattr(settings, "vapid_private_key", "priv")
        db.add(
            PushSubscription(user_id=test_user.id, endpoint="https://gone/1", p256dh="k", auth="a")
        )
        await db.commit()

        class _Resp:
            status_code = 410

        def fake_webpush(**kwargs: object) -> None:
            raise push_service.WebPushException("gone", response=_Resp())

        monkeypatch.setattr(push_service, "webpush", fake_webpush)
        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0

        # 失效订阅应被清理
        rows = (await db.execute(select(PushSubscription))).scalars().all()
        assert len(rows) == 0

    async def test_only_targets_given_user(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(settings, "vapid_public_key", "pub")
        monkeypatch.setattr(settings, "vapid_private_key", "priv")
        other = User(id=uuid.uuid4(), email="other@example.com", username="otheru")
        db.add(other)
        await db.commit()
        db.add(PushSubscription(user_id=other.id, endpoint="https://p/other", p256dh="k", auth="a"))
        await db.commit()

        calls: list[str] = []

        def fake_webpush(*, subscription_info: dict, **kwargs: object) -> None:
            calls.append(subscription_info["endpoint"])

        monkeypatch.setattr(push_service, "webpush", fake_webpush)
        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0  # test_user 没有订阅，不应命中 other 的
        assert calls == []


_EXPO_BODY = {"token": "ExponentPushToken[abc123]", "platform": "android"}


class TestExpoRegister:
    async def test_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.post("/api/v1/notifications/expo", json=_EXPO_BODY)
        assert resp.status_code == 401

    async def test_creates_token(
        self,
        client: AsyncClient,
        db: AsyncSession,
        auth_headers: dict[str, str],
        test_user: User,
    ) -> None:
        resp = await client.post(
            "/api/v1/notifications/expo", json=_EXPO_BODY, headers=auth_headers
        )
        assert resp.status_code == 200
        assert resp.json()["ok"] is True

        rows = (
            (
                await db.execute(
                    select(ExpoPushToken).where(ExpoPushToken.token == _EXPO_BODY["token"])
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].user_id == test_user.id
        assert rows[0].platform == "android"

    async def test_repeat_token_is_idempotent_update(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.post("/api/v1/notifications/expo", json=_EXPO_BODY, headers=auth_headers)
        # 同 token 再报一次（平台变化），仅更新，不新建
        resp = await client.post(
            "/api/v1/notifications/expo",
            json={**_EXPO_BODY, "platform": "ios"},
            headers=auth_headers,
        )
        assert resp.status_code == 200

        rows = (
            (
                await db.execute(
                    select(ExpoPushToken).where(ExpoPushToken.token == _EXPO_BODY["token"])
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].platform == "ios"


class TestExpoUnregister:
    async def test_removes_own_token(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        await client.post("/api/v1/notifications/expo", json=_EXPO_BODY, headers=auth_headers)
        resp = await client.delete(
            f"/api/v1/notifications/expo/{_EXPO_BODY['token']}", headers=auth_headers
        )
        assert resp.status_code == 200

        rows = (await db.execute(select(ExpoPushToken))).scalars().all()
        assert len(rows) == 0

    async def test_cannot_remove_others_token(
        self, client: AsyncClient, db: AsyncSession, auth_headers: dict[str, str]
    ) -> None:
        other = User(id=uuid.uuid4(), email="other2@example.com", username="otheru2")
        db.add(other)
        await db.commit()
        db.add(ExpoPushToken(user_id=other.id, token="ExponentPushToken[other]", platform="ios"))
        await db.commit()

        resp = await client.delete(
            "/api/v1/notifications/expo/ExponentPushToken[other]", headers=auth_headers
        )
        assert resp.status_code == 200  # 幂等语义：不报错，但也不删别人的

        rows = (await db.execute(select(ExpoPushToken))).scalars().all()
        assert len(rows) == 1

    async def test_requires_auth(self, client: AsyncClient) -> None:
        resp = await client.delete(f"/api/v1/notifications/expo/{_EXPO_BODY['token']}")
        assert resp.status_code == 401


class _FakeExpoResponse:
    """模拟 httpx.Response：raise_for_status no-op + 预置 json。"""

    def __init__(self, tickets: list[dict[str, object]]) -> None:
        self._tickets = tickets

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict[str, object]:
        return {"data": self._tickets}


def _fake_expo_client(
    monkeypatch: pytest.MonkeyPatch,
    tickets: list[dict[str, object]],
    sent_bodies: list[list[dict[str, object]]],
) -> None:
    """把 push_service 里的 httpx.AsyncClient 换成返回预置 ticket 的假客户端。"""

    class _FakeClient:
        def __init__(self, **kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "_FakeClient":
            return self

        async def __aexit__(self, *args: object) -> None:
            pass

        async def post(self, url: str, json: list[dict[str, object]]) -> _FakeExpoResponse:
            sent_bodies.append(json)
            return _FakeExpoResponse(tickets)

    monkeypatch.setattr(push_service.httpx, "AsyncClient", _FakeClient)


class TestExpoPushSend:
    """Expo 通道发送：mock httpx，验证消息组装、计数与失效 token 清理。"""

    @pytest.fixture(autouse=True)
    def _no_vapid(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # 关闭 Web 通道，隔离测试 Expo 通道
        monkeypatch.setattr(settings, "vapid_public_key", "")
        monkeypatch.setattr(settings, "vapid_private_key", "")

    async def test_sends_to_all_tokens(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        for i in range(2):
            db.add(
                ExpoPushToken(
                    user_id=test_user.id,
                    token=f"ExponentPushToken[t{i}]",
                    platform="android",
                )
            )
        await db.commit()

        bodies: list[list[dict[str, object]]] = []
        _fake_expo_client(monkeypatch, [{"status": "ok"}, {"status": "ok"}], bodies)

        sent = await push_service.send_to_user(
            db, test_user.id, {"title": "元AI", "body": "done", "convId": "c1"}
        )
        assert sent == 2
        assert len(bodies) == 1
        msg = bodies[0][0]
        assert msg["title"] == "元AI"
        assert msg["body"] == "done"
        assert msg["data"] == {"convId": "c1"}  # title/body 之外的键进 data

    async def test_prunes_device_not_registered(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db.add(
            ExpoPushToken(
                user_id=test_user.id, token="ExponentPushToken[dead]", platform="ios"
            )
        )
        await db.commit()

        _fake_expo_client(
            monkeypatch,
            [{"status": "error", "details": {"error": "DeviceNotRegistered"}}],
            [],
        )

        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0

        rows = (await db.execute(select(ExpoPushToken))).scalars().all()
        assert len(rows) == 0

    async def test_network_error_does_not_raise(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        db.add(
            ExpoPushToken(
                user_id=test_user.id, token="ExponentPushToken[net]", platform="android"
            )
        )
        await db.commit()

        class _BoomClient:
            def __init__(self, **kwargs: object) -> None:
                pass

            async def __aenter__(self) -> "_BoomClient":
                return self

            async def __aexit__(self, *args: object) -> None:
                pass

            async def post(self, url: str, json: object) -> object:
                raise ConnectionError("network down")

        monkeypatch.setattr(push_service.httpx, "AsyncClient", _BoomClient)

        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0  # 异常被吞掉，不冒泡

    async def test_no_tokens_no_request(
        self, db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        bodies: list[list[dict[str, object]]] = []
        _fake_expo_client(monkeypatch, [], bodies)

        sent = await push_service.send_to_user(db, test_user.id, {"title": "x"})
        assert sent == 0
        assert bodies == []  # 无 token 不应发起网络请求
