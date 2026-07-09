"""Web Push 订阅端点 + push_service 集成/单元测试。

- 端点：vapid-public-key（公开）、subscribe/unsubscribe（鉴权 + 用户隔离）
- push_service：未配置 VAPID 时 no-op；配置后发送并清理失效订阅（mock pywebpush）
"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
