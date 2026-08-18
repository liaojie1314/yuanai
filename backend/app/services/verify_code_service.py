"""邮箱验证码服务 — 生成、存储、校验、节流。

Redis 键设计：
- ``verify:{scene}:code:{email}`` → 6 位数字，TTL = ``VERIFY_CODE_TTL_SECONDS``
- ``verify:{scene}:cd:{email}`` → "1"，TTL = ``VERIFY_CODE_SEND_INTERVAL_SECONDS``（节流）

场景 (scene)：
- ``register``：注册前验证邮箱归属
- ``reset_password``：忘记密码时验证邮箱归属（本轮预留，未接线）
"""

from __future__ import annotations

import secrets
from typing import Literal

from app.core.config import settings
from app.core.redis import redis_client
from app.services.email_service import (
    EmailNotConfiguredError,
    EmailSendError,
    render_verify_code_email,
    send_email,
)

Scene = Literal["register", "reset_password", "change_email"]


class VerifyCodeError(ValueError):
    """验证码相关错误，`code` 字段用于前端做本地化文案。

    Codes:
        - ``VERIFY_CODE_THROTTLED``: 60 秒内已发送过，等待冷却
        - ``VERIFY_CODE_EMAIL_NOT_CONFIGURED``: SMTP 未配置
        - ``VERIFY_CODE_SEND_FAILED``: SMTP 发送失败
        - ``VERIFY_CODE_INVALID``: 验证码错误或已过期
    """

    def __init__(self, code: str, message: str):
        super().__init__(code)
        self.code = code
        self.message = message


def _code_key(scene: Scene, email: str) -> str:
    return f"verify:{scene}:code:{email.lower()}"


def _throttle_key(scene: Scene, email: str) -> str:
    return f"verify:{scene}:cd:{email.lower()}"


def _generate_code() -> str:
    """生成 6 位数字验证码，用 ``secrets`` 保证密码学安全。"""
    return f"{secrets.randbelow(1_000_000):06d}"


async def send_code(email: str, scene: Scene = "register") -> None:
    """生成验证码写入 Redis 并通过邮件发送。

    Raises:
        VerifyCodeError: 节流、未配置 SMTP、发送失败
    """
    # 调试后门：仅写 Redis + 打印日志，不真的发邮件；前端可直接输入 debug_bypass 值通过
    if settings.verify_code_debug_bypass:
        code = settings.verify_code_debug_bypass
    else:
        # 节流检查（debug 模式下不节流，方便测试）
        throttled = await redis_client.get(_throttle_key(scene, email))
        if throttled:
            raise VerifyCodeError(
                "VERIFY_CODE_THROTTLED",
                f"请求过于频繁，请 {settings.verify_code_send_interval_seconds} 秒后再试",
            )
        code = _generate_code()

    # 先写节流锁，防止并发发送
    await redis_client.setex(
        _throttle_key(scene, email),
        settings.verify_code_send_interval_seconds,
        "1",
    )
    # 写验证码
    await redis_client.setex(
        _code_key(scene, email),
        settings.verify_code_ttl_seconds,
        code,
    )

    if settings.verify_code_debug_bypass:
        return  # 调试模式：不发真邮件

    ttl_minutes = max(1, settings.verify_code_ttl_seconds // 60)
    subject, html = render_verify_code_email(code=code, ttl_minutes=ttl_minutes)
    try:
        await send_email(to=email, subject=subject, html_body=html)
    except EmailNotConfiguredError as e:
        # 发送前置检查失败：清理 Redis，避免残留错误状态
        await redis_client.delete(_code_key(scene, email))
        await redis_client.delete(_throttle_key(scene, email))
        raise VerifyCodeError("VERIFY_CODE_EMAIL_NOT_CONFIGURED", str(e)) from e
    except EmailSendError as e:
        await redis_client.delete(_code_key(scene, email))
        await redis_client.delete(_throttle_key(scene, email))
        raise VerifyCodeError("VERIFY_CODE_SEND_FAILED", "验证码发送失败，请稍后再试") from e


async def verify_code(email: str, code: str, scene: Scene = "register") -> None:
    """校验验证码；正确后立即失效（防止重放）。

    Raises:
        VerifyCodeError: 验证码不存在、已过期或不匹配
    """
    # 调试后门：任何等于 debug_bypass 的值都算通过
    if settings.verify_code_debug_bypass and code == settings.verify_code_debug_bypass:
        return

    stored = await redis_client.get(_code_key(scene, email))
    if not stored or stored != code:
        raise VerifyCodeError("VERIFY_CODE_INVALID", "验证码错误或已过期")

    # 一次性使用：校验通过后立即删除，防止被重复用于多次注册
    await redis_client.delete(_code_key(scene, email))
