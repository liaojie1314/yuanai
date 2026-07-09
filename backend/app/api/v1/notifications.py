"""Web Push 订阅端点。

- `GET  /notifications/vapid-public-key` —— 公开，前端拿它作 applicationServerKey
- `POST /notifications/subscribe`        —— 鉴权，保存/更新当前用户的订阅
- `POST /notifications/unsubscribe`      —— 鉴权，按 endpoint 删除订阅

真正的推送发送在 AI 回复结束时由 `chat.py` 调 `push_service.send_to_user` 完成。
"""

from fastapi import APIRouter
from sqlalchemy import delete, select

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.models.push_subscription import PushSubscription
from app.schemas.notifications import (
    PushSubscriptionRequest,
    SubscriptionResultResponse,
    UnsubscribeRequest,
    VapidPublicKeyResponse,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("/vapid-public-key", response_model=VapidPublicKeyResponse)
async def get_vapid_public_key() -> VapidPublicKeyResponse:
    """返回 VAPID 公钥；未配置时为空串，前端据此跳过订阅。"""
    return VapidPublicKeyResponse(public_key=settings.vapid_public_key)


@router.post("/subscribe", response_model=SubscriptionResultResponse)
async def subscribe(
    req: PushSubscriptionRequest, current_user: CurrentUser, db: DB
) -> SubscriptionResultResponse:
    """保存当前用户的 Web Push 订阅；同一 endpoint 重复上报则幂等更新。"""
    existing = (
        await db.execute(select(PushSubscription).where(PushSubscription.endpoint == req.endpoint))
    ).scalar_one_or_none()

    if existing is not None:
        # 端点已存在：更新归属用户与密钥（用户换账号登录同一浏览器时会命中）
        existing.user_id = current_user.id
        existing.p256dh = req.keys.p256dh
        existing.auth = req.keys.auth
    else:
        db.add(
            PushSubscription(
                user_id=current_user.id,
                endpoint=req.endpoint,
                p256dh=req.keys.p256dh,
                auth=req.keys.auth,
            )
        )
    await db.commit()
    return SubscriptionResultResponse(ok=True)


@router.post("/unsubscribe", response_model=SubscriptionResultResponse)
async def unsubscribe(
    req: UnsubscribeRequest, current_user: CurrentUser, db: DB
) -> SubscriptionResultResponse:
    """按 endpoint 删除当前用户的订阅（仅能删自己的）。"""
    await db.execute(
        delete(PushSubscription)
        .where(PushSubscription.endpoint == req.endpoint)
        .where(PushSubscription.user_id == current_user.id)
    )
    await db.commit()
    return SubscriptionResultResponse(ok=True)
