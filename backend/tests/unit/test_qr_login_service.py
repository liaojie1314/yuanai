"""扫码登录挑战状态机的单元测试。"""

import hashlib
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.qr_login_service as qr_login_service
from app.core.config import settings
from app.models.qr_login import QRLoginChallenge, QRLoginEvent
from app.models.user import User
from app.schemas.qr_login import QRLoginCreateRequest, QRLoginExchangeRequest
from app.services.qr_login_service import (
    QRLoginServiceError,
    approve_challenge,
    build_qr_login_payload,
    create_challenge,
    deny_challenge,
    exchange_challenge,
    get_target_status,
)


class MemoryRedis:
    """仅模拟服务限流所需的 Redis 计数语义。"""

    def __init__(self) -> None:
        self.values: dict[str, int] = {}

    async def incr(self, key: str) -> int:
        """增加键计数并返回最新值。"""
        next_value = self.values.get(key, 0) + 1
        self.values[key] = next_value
        return next_value

    async def expire(self, key: str, seconds: int) -> bool:
        """记录过期调用；该测试不需要推进时钟。"""
        del key, seconds
        return True


async def test_create_challenge_persists_only_secret_hashes(db: AsyncSession) -> None:
    """挑战创建不得在数据库或二维码载荷中暴露目标轮询凭据。"""
    created = await create_challenge(
        request=QRLoginCreateRequest(target_platform="desktop", device_name="Ubuntu Desktop"),
        request_key="127.0.0.1",
        db=db,
    )

    stored = (await db.execute(select(QRLoginChallenge))).scalar_one()

    assert stored.challenge_hash == hashlib.sha256(created.challenge.encode()).hexdigest()
    assert stored.poll_secret_hash == hashlib.sha256(created.poll_secret.encode()).hexdigest()
    assert stored.challenge_hash != created.challenge
    assert stored.poll_secret_hash != created.poll_secret
    assert stored.target_platform == "desktop"
    assert stored.device_name == "Ubuntu Desktop"
    assert stored.expires_at == created.expires_at

    payload = build_qr_login_payload(
        challenge=created.challenge,
        api_base_url="http://127.0.0.1:8000/api/v1",
    )
    assert f"challenge={created.challenge}" in payload
    assert created.poll_secret not in payload


async def test_only_approver_can_exchange_a_challenge_once(
    db: AsyncSession, test_user: User
) -> None:
    """错误账号不得接管挑战，成功目标只能消费一次授权码。"""
    other_user = User(
        id=uuid.uuid4(),
        email="other@example.com",
        username="otheruser",
        hashed_password="not-used-in-this-test",
    )
    db.add(other_user)
    await db.commit()

    created = await create_challenge(
        request=QRLoginCreateRequest(target_platform="web", device_name="Firefox on Ubuntu"),
        request_key="127.0.0.1",
        db=db,
    )
    await approve_challenge(challenge=created.challenge, user=test_user, db=db)

    with pytest.raises(QRLoginServiceError, match="QR_LOGIN_FORBIDDEN"):
        await approve_challenge(challenge=created.challenge, user=other_user, db=db)

    status = await get_target_status(
        challenge=created.challenge,
        poll_secret=created.poll_secret,
        db=db,
    )
    assert status.status == "approved"
    assert status.authorization_code is not None

    request = QRLoginExchangeRequest(
        challenge=created.challenge,
        poll_secret=created.poll_secret,
        authorization_code=status.authorization_code,
    )
    response = await exchange_challenge(request=request, db=db)
    assert response.user.id == test_user.id

    with pytest.raises(QRLoginServiceError, match="QR_LOGIN_CONSUMED"):
        await exchange_challenge(request=request, db=db)


async def test_denied_and_expired_challenges_never_issue_authorization_code(
    db: AsyncSession, test_user: User
) -> None:
    """拒绝或过期是终态，目标轮询和交换都不得得到登录凭据。"""
    denied = await create_challenge(
        request=QRLoginCreateRequest(target_platform="web", device_name="Firefox on Ubuntu"),
        request_key="127.0.0.1",
        db=db,
    )
    await deny_challenge(challenge=denied.challenge, user=test_user, db=db)
    denied_status = await get_target_status(
        challenge=denied.challenge,
        poll_secret=denied.poll_secret,
        db=db,
    )
    assert denied_status.status == "denied"
    assert denied_status.authorization_code is None

    expired = await create_challenge(
        request=QRLoginCreateRequest(target_platform="desktop", device_name="Ubuntu Desktop"),
        request_key="127.0.0.1",
        db=db,
    )
    stored = (
        await db.execute(
            select(QRLoginChallenge).where(QRLoginChallenge.device_name == "Ubuntu Desktop")
        )
    ).scalar_one()
    assert stored is not None
    stored.expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()

    expired_status = await get_target_status(
        challenge=expired.challenge,
        poll_secret=expired.poll_secret,
        db=db,
    )
    assert expired_status.status == "expired"
    assert expired_status.authorization_code is None
    actions = (await db.execute(select(QRLoginEvent.action))).scalars().all()
    assert "denied" in actions
    assert "expired" in actions


async def test_create_challenge_rate_limit_prevents_new_database_row(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """同一来源超过创建阈值后不得继续生成可扫码的挑战。"""
    monkeypatch.setattr(settings, "qr_login_create_limit", 1)
    monkeypatch.setattr(qr_login_service, "redis_client", MemoryRedis(), raising=False)
    request = QRLoginCreateRequest(target_platform="web", device_name="Firefox on Ubuntu")

    await create_challenge(request=request, request_key="198.51.100.10", db=db)

    with pytest.raises(QRLoginServiceError, match="QR_LOGIN_RATE_LIMITED"):
        await create_challenge(request=request, request_key="198.51.100.10", db=db)

    assert len((await db.execute(select(QRLoginChallenge))).scalars().all()) == 1


async def test_approval_rate_limit_leaves_next_challenge_pending(
    db: AsyncSession, monkeypatch: pytest.MonkeyPatch, test_user: User
) -> None:
    """同一账号超过审批阈值时，后续挑战不能被写成 approved。"""
    monkeypatch.setattr(settings, "qr_login_attempt_limit", 1)
    monkeypatch.setattr(qr_login_service, "redis_client", MemoryRedis())
    first = await create_challenge(
        request=QRLoginCreateRequest(target_platform="web", device_name="Firefox on Ubuntu"),
        request_key="198.51.100.10",
        db=db,
    )
    second = await create_challenge(
        request=QRLoginCreateRequest(target_platform="desktop", device_name="Ubuntu Desktop"),
        request_key="198.51.100.11",
        db=db,
    )

    await approve_challenge(challenge=first.challenge, user=test_user, db=db)

    with pytest.raises(QRLoginServiceError, match="QR_LOGIN_RATE_LIMITED"):
        await approve_challenge(challenge=second.challenge, user=test_user, db=db)

    second_status = await get_target_status(
        challenge=second.challenge,
        poll_secret=second.poll_secret,
        db=db,
    )
    assert second_status.status == "pending"
