"""服务端推送：Web Push（VAPID）+ 移动端 Expo Push 两条通道。

pywebpush 是同步阻塞（底层 requests），故放到线程池执行，避免阻塞事件循环；
Expo 通道用 httpx 异步客户端直接 POST Expo Push API。

未配置 VAPID 密钥时 Web 通道 no-op；Expo 通道无需密钥（Expo 托管 APNs/FCM）。
推送失败（Web 订阅过期 404/410、Expo DeviceNotRegistered）时自动清理该记录。
"""

from __future__ import annotations

import asyncio
import json
import logging

import httpx
from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.expo_push_token import ExpoPushToken
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)

# 订阅已失效的 HTTP 状态：推送服务返回这些码表示端点不再有效，应删除本地记录
_GONE_STATUS = {404, 410}

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


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


async def send_to_user(db: AsyncSession, user_id: object, payload: dict[str, object]) -> int:
    """向指定用户的所有订阅推送 `payload`，返回成功发送条数。

    同时走两条通道：Web Push（浏览器订阅）+ Expo Push（移动端 token）。
    单通道失败不影响另一通道；任何异常都不冒泡给调用方（AI 流已完成）。

    复用调用方的 DB session（SSE 生成器在 db.commit() 之后、响应结束之前调用，
    请求 session 仍可用），避免自建 session 触发连接池跨事件循环问题。
    """
    sent = await _send_web(db, user_id, payload)
    sent += await _send_expo(db, user_id, payload)
    return sent


async def _send_web(db: AsyncSession, user_id: object, payload: dict[str, object]) -> int:
    """Web Push 通道：未配置 VAPID → 直接返回 0（no-op）；404/410 清理订阅。"""
    if not is_configured():
        return 0

    data = json.dumps(payload, ensure_ascii=False)
    sent = 0
    dead_endpoints: list[str] = []

    rows = (
        (await db.execute(select(PushSubscription).where(PushSubscription.user_id == user_id)))
        .scalars()
        .all()
    )

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
            delete(PushSubscription).where(PushSubscription.endpoint.in_(dead_endpoints))
        )
        await db.commit()

    return sent


async def _send_expo(db: AsyncSession, user_id: object, payload: dict[str, object]) -> int:
    """Expo Push 通道：批量 POST Expo Push API；DeviceNotRegistered 清理 token。

    Expo 消息格式 `{to, title, body, data}`——payload 的 title/body 直接映射，
    其余键（url/convId 等）整体作为 data 供客户端点击跳转用。
    """
    rows = (
        (await db.execute(select(ExpoPushToken).where(ExpoPushToken.user_id == user_id)))
        .scalars()
        .all()
    )
    if not rows:
        return 0

    title = payload.get("title")
    body = payload.get("body")
    extra = {k: v for k, v in payload.items() if k not in ("title", "body")}
    messages = [{"to": row.token, "title": title, "body": body, "data": extra} for row in rows]

    sent = 0
    dead_tokens: list[str] = []
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(EXPO_PUSH_URL, json=messages)
            resp.raise_for_status()
            # 响应 data 是与请求同序的 ticket 数组：{status: ok|error, details?: {error}}
            tickets = resp.json().get("data", [])
        # strict=False：Expo 异常时 ticket 数可能少于请求数，多余的行按未发送处理
        for row, ticket in zip(rows, tickets, strict=False):
            if ticket.get("status") == "ok":
                sent += 1
            elif (ticket.get("details") or {}).get("error") == "DeviceNotRegistered":
                dead_tokens.append(row.token)
            else:
                logger.warning("expo push ticket 错误: %s", ticket)
    except Exception as e:  # noqa: BLE001 - 收尾阶段不能让推送异常冒泡打断响应
        logger.warning("expo push 发送异常: %s", e)

    if dead_tokens:
        await db.execute(delete(ExpoPushToken).where(ExpoPushToken.token.in_(dead_tokens)))
        await db.commit()

    return sent
