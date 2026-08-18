"""扫码登录 HTTP 契约集成测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.security import create_access_token
from app.models.qr_login import QRLoginChallenge, QRLoginEvent
from app.models.user import User


async def _create_challenge(client: AsyncClient, *, device_name: str) -> dict[str, object]:
    """创建包含本地 API 地址的目标端二维码挑战。"""
    response = await client.post(
        "/api/v1/auth/qr-login/challenges",
        json={
            "targetPlatform": "web",
            "deviceName": device_name,
            "apiBaseUrl": "http://127.0.0.1:8000/api/v1",
        },
    )
    assert response.status_code == 201
    return response.json()


def _poll_headers(challenge: dict[str, object]) -> dict[str, str]:
    """构造只由目标端持有的轮询请求头。"""
    poll_secret = challenge["pollSecret"]
    assert isinstance(poll_secret, str)
    return {"X-QR-Poll-Secret": poll_secret}


async def test_mobile_approval_logs_target_in_once(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """目标端创建挑战后，仅显式手机审批可换取一次常规登录会话。"""
    challenge = await _create_challenge(client, device_name="Firefox on Ubuntu")
    assert challenge["pollSecret"] not in challenge["qrDataUri"]

    inspected = await client.get(
        f"/api/v1/auth/qr-login/challenges/{challenge['challenge']}/inspect",
        headers=auth_headers,
    )
    assert inspected.status_code == 200
    assert inspected.json()["deviceName"] == "Firefox on Ubuntu"
    assert inspected.json()["status"] == "pending"

    approved = await client.post(
        f"/api/v1/auth/qr-login/challenges/{challenge['challenge']}/approve",
        headers=auth_headers,
    )
    assert approved.status_code == 204

    status = await client.get(
        f"/api/v1/auth/qr-login/challenges/{challenge['challenge']}/status",
        headers=_poll_headers(challenge),
    )
    assert status.status_code == 200
    authorization_code = status.json()["authorizationCode"]
    assert isinstance(authorization_code, str)

    exchanged = await client.post(
        "/api/v1/auth/qr-login/exchange",
        json={
            "challenge": challenge["challenge"],
            "pollSecret": challenge["pollSecret"],
            "authorizationCode": authorization_code,
        },
    )
    assert exchanged.status_code == 200
    assert "access_token" in exchanged.json()
    assert "refresh_token" in exchanged.json()

    replay = await client.post(
        "/api/v1/auth/qr-login/exchange",
        json={
            "challenge": challenge["challenge"],
            "pollSecret": challenge["pollSecret"],
            "authorizationCode": authorization_code,
        },
    )
    assert replay.status_code == 409
    assert replay.json()["detail"]["code"] == "QR_LOGIN_CONSUMED"

    actions = (
        (await db.execute(select(QRLoginEvent.action).order_by(QRLoginEvent.created_at)))
        .scalars()
        .all()
    )
    assert actions == ["created", "inspected", "approved", "consumed"]


async def test_mobile_actions_require_auth_and_approver_ownership(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """扫码、审批和拒绝必须认证，批准后不能被另一个账号接管。"""
    challenge = await _create_challenge(client, device_name="Firefox on Ubuntu")
    challenge_id = challenge["challenge"]
    assert isinstance(challenge_id, str)

    for method, suffix in (("get", "inspect"), ("post", "approve"), ("post", "deny")):
        response = await getattr(client, method)(
            f"/api/v1/auth/qr-login/challenges/{challenge_id}/{suffix}"
        )
        assert response.status_code == 401

    wrong_secret = await client.get(
        f"/api/v1/auth/qr-login/challenges/{challenge_id}/status",
        headers={"X-QR-Poll-Secret": "a" * 43},
    )
    assert wrong_secret.status_code == 404

    inspected = await client.get(
        f"/api/v1/auth/qr-login/challenges/{challenge_id}/inspect",
        headers=auth_headers,
    )
    assert inspected.status_code == 200
    assert inspected.json()["status"] == "pending"

    approved = await client.post(
        f"/api/v1/auth/qr-login/challenges/{challenge_id}/approve",
        headers=auth_headers,
    )
    assert approved.status_code == 204

    other_user = User(
        id=uuid.uuid4(),
        email="another@example.com",
        username="anotheruser",
        hashed_password="not-used-in-this-test",
    )
    db.add(other_user)
    await db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(str(other_user.id))}"}

    for method, suffix in (("get", "inspect"), ("post", "approve")):
        response = await getattr(client, method)(
            f"/api/v1/auth/qr-login/challenges/{challenge_id}/{suffix}",
            headers=other_headers,
        )
        assert response.status_code == 403


async def test_denial_and_expiry_cannot_issue_a_target_session(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """拒绝与过期均为终态，不会把会话令牌交给目标设备。"""
    denied = await _create_challenge(client, device_name="Rejected Firefox")
    denied_id = denied["challenge"]
    assert isinstance(denied_id, str)

    response = await client.post(
        f"/api/v1/auth/qr-login/challenges/{denied_id}/deny",
        headers=auth_headers,
    )
    assert response.status_code == 204
    denied_status = await client.get(
        f"/api/v1/auth/qr-login/challenges/{denied_id}/status",
        headers=_poll_headers(denied),
    )
    assert denied_status.status_code == 200
    assert denied_status.json()["status"] == "denied"
    assert denied_status.json()["authorizationCode"] is None

    denied_exchange = await client.post(
        "/api/v1/auth/qr-login/exchange",
        json={
            "challenge": denied_id,
            "pollSecret": denied["pollSecret"],
            "authorizationCode": "a" * 43,
        },
    )
    assert denied_exchange.status_code == 409
    assert denied_exchange.json()["detail"]["code"] == "QR_LOGIN_NOT_APPROVED"

    expired = await _create_challenge(client, device_name="Expired Firefox")
    stored = (
        await db.execute(
            select(QRLoginChallenge).where(QRLoginChallenge.device_name == "Expired Firefox")
        )
    ).scalar_one()
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()

    expired_id = expired["challenge"]
    assert isinstance(expired_id, str)
    expired_approval = await client.post(
        f"/api/v1/auth/qr-login/challenges/{expired_id}/approve",
        headers=auth_headers,
    )
    assert expired_approval.status_code == 410
    expired_status = await client.get(
        f"/api/v1/auth/qr-login/challenges/{expired_id}/status",
        headers=_poll_headers(expired),
    )
    assert expired_status.status_code == 200
    assert expired_status.json()["status"] == "expired"
    assert expired_status.json()["authorizationCode"] is None


async def test_qr_api_url_is_validated_and_qr_actions_are_rate_limited(
    client: AsyncClient,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """目标端仅能编码安全 API 地址，创建与扫码确认均受固定窗口限流。"""
    for api_base_url in (
        "http://example.com/api/v1",
        "https://example.com/api/v1?secret=leak",
        "https://user:password@example.com/api/v1",
        "https://example.com/not-api-v1",
    ):
        invalid = await client.post(
            "/api/v1/auth/qr-login/challenges",
            json={
                "targetPlatform": "web",
                "deviceName": "Unsafe target",
                "apiBaseUrl": api_base_url,
            },
        )
        assert invalid.status_code == 422

    untrusted_server = await client.post(
        "/api/v1/auth/qr-login/challenges",
        json={
            "targetPlatform": "web",
            "deviceName": "Untrusted target",
            "apiBaseUrl": "https://untrusted.example/api/v1",
        },
    )
    assert untrusted_server.status_code == 400
    assert untrusted_server.json()["detail"]["code"] == "QR_LOGIN_INVALID_API_BASE_URL"

    monkeypatch.setattr(settings, "qr_login_create_limit", 1)
    first = await _create_challenge(client, device_name="First Firefox")
    second = await client.post(
        "/api/v1/auth/qr-login/challenges",
        json={
            "targetPlatform": "desktop",
            "deviceName": "Limited desktop",
            "apiBaseUrl": "http://127.0.0.1:8000/api/v1",
        },
    )
    assert second.status_code == 429
    assert second.json()["detail"]["code"] == "QR_LOGIN_RATE_LIMITED"

    monkeypatch.setattr(settings, "qr_login_create_limit", 15)
    monkeypatch.setattr(settings, "qr_login_attempt_limit", 1)
    second_valid = await _create_challenge(client, device_name="Second Firefox")
    first_id = first["challenge"]
    second_id = second_valid["challenge"]
    assert isinstance(first_id, str)
    assert isinstance(second_id, str)
    assert (
        await client.get(
            f"/api/v1/auth/qr-login/challenges/{first_id}/inspect", headers=auth_headers
        )
    ).status_code == 200
    attempt_limited = await client.get(
        f"/api/v1/auth/qr-login/challenges/{second_id}/inspect", headers=auth_headers
    )
    assert attempt_limited.status_code == 429
