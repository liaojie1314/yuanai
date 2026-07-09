"""Web Push 服务端推送。

pywebpush 是同步阻塞（底层 requests），故放到线程池执行，避免阻塞事件循环。

未配置 VAPID 密钥时，`send_to_user` 直接 no-op —— 与 OAuth「未配置即跳过」一致，
避免在没有密钥的环境里抛错。推送失败（订阅过期 404/410）时自动清理该订阅。
"""
from __future__ import annotations

import asyncio
import json
import logging

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)

# 订阅已失效的 HTTP 状态：推送服务返回这些码表示端点不再有效，应删除本地记录
_GONE_STATUS = {404, 410}


def is_configured() -> bool:
    """VAPID 公私钥齐全才认为推送可用。"""
    return bool(settings.vapid_public_key and settings.vapid_private_key)


def _send_one(subscription_info: dict[str, object], payload: str) -> None:
    """同步发送单条 webpush；异常向上抛给调用方分类处理。"""
    webpush(
        subscription_info=subscription_info,
        data=payload,
        vapid_private_key=settings.vapid_private_key,
        vapid_claims={"sub": settings.vapid_subject},
    )


async def send_to_user(
    db: AsyncSession, user_id: object, payload: dict[str, object]
) -> int:
    """向指定用户的所有订阅推送 `payload`，返回成功发送条数。

    - 未配置 VAPID → 直接返回 0（no-op）
    - 单条订阅失效（404/410）→ 删除该订阅
    - 其他异常 → 记录日志但不影响其他订阅，也不影响调用方（AI 流已完成）

    复用调用方的 DB session（SSE 生成器在 db.commit() 之后、响应结束之前调用，
    请求 session 仍可用），避免自建 session 触发连接池跨事件循环问题。
    """
    if not is_configured():
        return 0

    data = json.dumps(payload, ensure_ascii=False)
    sent = 0
    dead_endpoints: list[str] = []

    rows = (
        await db.execute(
            select(PushSubscription).where(PushSubscription.user_id == user_id)
        )
    ).scalars().all()

    for sub in rows:
        subscription_info: dict[str, object] = {
            "endpoint": sub.endpoint,
            "keys": {"p256dh": sub.p256dh, "auth": sub.auth},
        }
        try:
            await asyncio.to_thread(_send_one, subscription_info, data)
            sent += 1
        except WebPushException as e:
            status = getattr(e.response, "status_code", None)
            if status in _GONE_STATUS:
                dead_endpoints.append(sub.endpoint)
            else:
                logger.warning("web push 发送失败 (status=%s): %s", status, e)
        except Exception as e:  # noqa: BLE001 - 收尾阶段不能让推送异常冒泡打断响应
            logger.warning("web push 发送异常: %s", e)

    if dead_endpoints:
        await db.execute(
            delete(PushSubscription).where(
                PushSubscription.endpoint.in_(dead_endpoints)
            )
        )
        await db.commit()

    return sent
