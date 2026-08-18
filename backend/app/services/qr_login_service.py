"""扫码登录挑战状态机的领域服务。"""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta
from io import BytesIO
from urllib.parse import urlencode

import qrcode
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.redis import redis_client
from app.models.qr_login import QRLoginChallenge, QRLoginEvent
from app.models.user import User
from app.schemas.auth import AuthResponse
from app.schemas.qr_login import (
    QRLoginCreateRequest,
    QRLoginCreateResponse,
    QRLoginExchangeRequest,
    QRLoginInspectResponse,
    QRLoginStatus,
    QRLoginStatusResponse,
    QRLoginTargetPlatform,
    validate_qr_login_api_base_url,
)
from app.services.auth_service import build_auth_response


class QRLoginServiceError(ValueError):
    """为 API 路由提供稳定错误码的扫码登录领域错误。"""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


def build_qr_login_payload(*, challenge: str, api_base_url: str) -> str:
    """构造只携带挑战与 API 地址的扫码 URL。"""
    try:
        validated_api_base_url = validate_qr_login_api_base_url(api_base_url)
    except ValueError as error:
        raise QRLoginServiceError("QR_LOGIN_INVALID_API_BASE_URL") from error
    return f"yuanai://qr-login?{urlencode({'challenge': challenge, 'api': validated_api_base_url})}"


async def create_challenge(
    *, request: QRLoginCreateRequest, request_key: str, db: AsyncSession
) -> QRLoginCreateResponse:
    """创建目标设备专用的短时扫码挑战，并只持久化凭据哈希。"""
    configured_api_base_url = _configured_api_base_url()
    if request.api_base_url is not None and request.api_base_url != configured_api_base_url:
        raise QRLoginServiceError("QR_LOGIN_INVALID_API_BASE_URL")
    await _enforce_rate_limit(
        key=f"qr-login:create:{_hash_secret(request_key)}",
        limit=settings.qr_login_create_limit,
    )
    challenge = secrets.token_urlsafe(32)
    poll_secret = secrets.token_urlsafe(32)
    expires_at = datetime.now(UTC) + timedelta(seconds=settings.qr_login_ttl_seconds)
    stored = QRLoginChallenge(
        challenge_hash=_hash_secret(challenge),
        poll_secret_hash=_hash_secret(poll_secret),
        target_platform=request.target_platform,
        device_name=request.device_name,
        expires_at=expires_at,
    )
    db.add(stored)
    await db.flush()
    db.add(QRLoginEvent(challenge_id=stored.id, action="created"))
    await db.commit()

    payload = build_qr_login_payload(challenge=challenge, api_base_url=configured_api_base_url)
    return QRLoginCreateResponse(
        challenge=challenge,
        poll_secret=poll_secret,
        qr_data_uri=_render_qr_data_uri(payload),
        expires_at=expires_at,
        poll_after_ms=settings.qr_login_poll_after_ms,
    )


def _hash_secret(value: str) -> str:
    """计算可索引、不可逆的挑战凭据摘要。"""
    return hashlib.sha256(value.encode()).hexdigest()


def _configured_api_base_url() -> str:
    """验证部署方配置的二维码 API 地址，禁止目标端重定向手机认证请求。"""
    try:
        return validate_qr_login_api_base_url(settings.qr_login_api_base_url)
    except ValueError as error:
        raise QRLoginServiceError("QR_LOGIN_INVALID_API_BASE_URL") from error


async def _enforce_rate_limit(*, key: str, limit: int) -> None:
    """为扫码登录动作增加 Redis 固定窗口限流。"""
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, settings.qr_login_rate_limit_window_seconds)
    if count > limit:
        raise QRLoginServiceError("QR_LOGIN_RATE_LIMITED")


async def _enforce_user_attempt_limit(*, user_id: object) -> None:
    """限制单个登录账号在窗口内发起的扫码审批动作。"""
    await _enforce_rate_limit(
        key=f"qr-login:attempt:{_hash_secret(str(user_id))}",
        limit=settings.qr_login_attempt_limit,
    )


def _render_qr_data_uri(payload: str) -> str:
    """将扫码 URL 渲染为不依赖公网资源的 PNG data URI。"""
    image = qrcode.make(payload)
    output = BytesIO()
    image.save(output, format="PNG")
    encoded = base64.b64encode(output.getvalue()).decode("ascii")
    return f"data:image/png;base64,{encoded}"


async def approve_challenge(*, challenge: str, user: User, db: AsyncSession) -> None:
    """由已登录移动端用户显式批准目标设备登录。"""
    stored = await _get_challenge(challenge=challenge, db=db)
    if await _expire_if_needed(stored=stored, db=db):
        await db.commit()
        raise QRLoginServiceError("QR_LOGIN_EXPIRED")
    if stored.status == "approved":
        if stored.approved_user_id == user.id:
            return
        raise QRLoginServiceError("QR_LOGIN_FORBIDDEN")
    if stored.status == "consumed":
        raise QRLoginServiceError("QR_LOGIN_CONSUMED")
    if stored.status != "pending":
        raise QRLoginServiceError("QR_LOGIN_NOT_PENDING")

    await _enforce_user_attempt_limit(user_id=user.id)
    stored.status = "approved"
    stored.approved_user_id = user.id
    stored.approved_at = datetime.now(UTC)
    db.add(QRLoginEvent(challenge_id=stored.id, actor_user_id=user.id, action="approved"))
    await db.commit()


async def deny_challenge(*, challenge: str, user: User, db: AsyncSession) -> None:
    """由已登录移动端用户显式拒绝目标设备登录。"""
    stored = await _get_challenge(challenge=challenge, db=db)
    if await _expire_if_needed(stored=stored, db=db):
        await db.commit()
        raise QRLoginServiceError("QR_LOGIN_EXPIRED")
    if stored.status == "consumed":
        raise QRLoginServiceError("QR_LOGIN_CONSUMED")
    if stored.status != "pending":
        raise QRLoginServiceError("QR_LOGIN_NOT_PENDING")

    await _enforce_user_attempt_limit(user_id=user.id)
    stored.status = "denied"
    db.add(QRLoginEvent(challenge_id=stored.id, actor_user_id=user.id, action="denied"))
    await db.commit()


async def inspect_challenge(
    *, challenge: str, user: User, db: AsyncSession
) -> QRLoginInspectResponse:
    """让已登录移动端在确认前查看挑战目标的非敏感摘要。"""
    stored = await _get_challenge(challenge=challenge, db=db)
    expired = await _expire_if_needed(stored=stored, db=db)
    if stored.status == "approved" and stored.approved_user_id != user.id:
        await db.commit()
        raise QRLoginServiceError("QR_LOGIN_FORBIDDEN")
    if stored.status == "pending":
        await _enforce_user_attempt_limit(user_id=user.id)
        db.add(QRLoginEvent(challenge_id=stored.id, actor_user_id=user.id, action="inspected"))
    if expired or stored.status == "pending":
        await db.commit()

    return QRLoginInspectResponse(
        target_platform=_to_target_platform(stored.target_platform),
        device_name=stored.device_name,
        expires_at=stored.expires_at,
        status=_to_response_status(stored.status),
    )


async def get_target_status(
    *, challenge: str, poll_secret: str, db: AsyncSession
) -> QRLoginStatusResponse:
    """读取目标设备的挑战状态，并仅在批准后交付可重建的授权码。"""
    stored = await _get_challenge_with_poll_secret(
        challenge=challenge, poll_secret=poll_secret, db=db
    )
    if await _expire_if_needed(stored=stored, db=db):
        await db.commit()

    authorization_code: str | None = None
    if stored.status == "approved":
        authorization_code = _build_authorization_code(challenge=challenge, poll_secret=poll_secret)
        stored.authorization_code_hash = _hash_secret(authorization_code)
        await db.commit()

    return QRLoginStatusResponse(
        status=_to_response_status(stored.status),
        expires_at=stored.expires_at,
        authorization_code=authorization_code,
    )


async def exchange_challenge(*, request: QRLoginExchangeRequest, db: AsyncSession) -> AuthResponse:
    """消费目标端授权码并签发普通 access/refresh 会话。"""
    stored = await _get_challenge_with_poll_secret(
        challenge=request.challenge,
        poll_secret=request.poll_secret,
        db=db,
    )
    if await _expire_if_needed(stored=stored, db=db):
        await db.commit()
        raise QRLoginServiceError("QR_LOGIN_EXPIRED")
    if stored.status == "consumed":
        raise QRLoginServiceError("QR_LOGIN_CONSUMED")
    if stored.status != "approved" or stored.approved_user_id is None:
        raise QRLoginServiceError("QR_LOGIN_NOT_APPROVED")

    expected_code = _build_authorization_code(
        challenge=request.challenge, poll_secret=request.poll_secret
    )
    if not secrets.compare_digest(request.authorization_code, expected_code):
        raise QRLoginServiceError("QR_LOGIN_INVALID_CODE")
    if stored.authorization_code_hash is not None and not secrets.compare_digest(
        stored.authorization_code_hash, _hash_secret(request.authorization_code)
    ):
        raise QRLoginServiceError("QR_LOGIN_INVALID_CODE")

    user = await db.get(User, stored.approved_user_id)
    if user is None:
        raise QRLoginServiceError("QR_LOGIN_APPROVER_NOT_FOUND")

    stored.status = "consumed"
    stored.consumed_at = datetime.now(UTC)
    db.add(QRLoginEvent(challenge_id=stored.id, actor_user_id=user.id, action="consumed"))
    await db.commit()
    return await build_auth_response(user)


async def _get_challenge(*, challenge: str, db: AsyncSession) -> QRLoginChallenge:
    """按二维码 bearer challenge 读取挑战，但不返回哈希差异信息。"""
    result = await db.execute(
        select(QRLoginChallenge).where(QRLoginChallenge.challenge_hash == _hash_secret(challenge))
    )
    stored = result.scalar_one_or_none()
    if stored is None:
        raise QRLoginServiceError("QR_LOGIN_NOT_FOUND")
    return stored


async def _get_challenge_with_poll_secret(
    *, challenge: str, poll_secret: str, db: AsyncSession
) -> QRLoginChallenge:
    """读取同时持有 challenge 与轮询 secret 的目标端挑战。"""
    result = await db.execute(
        select(QRLoginChallenge).where(
            QRLoginChallenge.challenge_hash == _hash_secret(challenge),
            QRLoginChallenge.poll_secret_hash == _hash_secret(poll_secret),
        )
    )
    stored = result.scalar_one_or_none()
    if stored is None:
        raise QRLoginServiceError("QR_LOGIN_NOT_FOUND")
    return stored


async def _expire_if_needed(*, stored: QRLoginChallenge, db: AsyncSession) -> bool:
    """将超时的待批准或已批准挑战转换为不可消费终态。"""
    if stored.status not in {"pending", "approved"} or stored.expires_at > datetime.now(UTC):
        return False
    stored.status = "expired"
    stored.authorization_code_hash = None
    db.add(QRLoginEvent(challenge_id=stored.id, action="expired"))
    await db.flush()
    return True


def _build_authorization_code(*, challenge: str, poll_secret: str) -> str:
    """基于目标端双凭据生成可恢复且不可伪造的一次性交换码。"""
    digest = hmac.new(
        settings.jwt_secret_key.encode(), f"{challenge}:{poll_secret}".encode(), hashlib.sha256
    ).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _to_response_status(value: str) -> QRLoginStatus:
    """将数据库状态收窄为公开 API 支持的状态集合。"""
    match value:
        case "pending":
            return "pending"
        case "approved":
            return "approved"
        case "denied":
            return "denied"
        case "consumed":
            return "consumed"
        case "expired":
            return "expired"
        case _:
            raise QRLoginServiceError("QR_LOGIN_INVALID_STATUS")


def _to_target_platform(value: str) -> QRLoginTargetPlatform:
    """仅把已知目标平台公开给扫码确认页。"""
    match value:
        case "web":
            return "web"
        case "desktop":
            return "desktop"
        case _:
            raise QRLoginServiceError("QR_LOGIN_INVALID_PLATFORM")
