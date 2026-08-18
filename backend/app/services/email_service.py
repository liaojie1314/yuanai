# ruff: noqa: E501
"""邮件发送服务 — 通过 SMTP (SSL) 发送邮件。

设计要点：
- 用 Python 标准库 ``smtplib`` 而非 ``aiosmtplib``，避免新增依赖；
  ``send_mail`` 是同步阻塞的，外层用 ``asyncio.to_thread`` 包装成异步，
  单封邮件通常 <1s，不会阻塞事件循环处理其他请求。
- ``EmailNotConfiguredError`` 在缺少 ``SMTP_USER`` / ``SMTP_PASSWORD`` 时抛出，
  由调用方转换为 HTTP 500 让前端提示"邮件服务未配置"，避免暴露内部细节。
"""

from __future__ import annotations

import asyncio
import smtplib
from email.header import Header
from email.mime.text import MIMEText
from email.utils import formataddr

from app.core.config import settings


class EmailNotConfiguredError(RuntimeError):
    """SMTP 未配置（缺少 SMTP_USER 或 SMTP_PASSWORD）。"""


class EmailSendError(RuntimeError):
    """SMTP 发送失败（网络异常 / 认证失败 / 拒收等）。"""


def _send_sync(*, to: str, subject: str, html_body: str) -> None:
    """同步发送邮件。由 ``send_email`` 通过 ``asyncio.to_thread`` 调用。"""
    if not settings.smtp_user or not settings.smtp_password:
        raise EmailNotConfiguredError(
            "SMTP_USER / SMTP_PASSWORD 未配置，无法发送邮件；请参考 backend/.env.example 完成配置"
        )

    msg = MIMEText(html_body, "html", "utf-8")
    msg["From"] = formataddr((str(Header(settings.smtp_from_name, "utf-8")), settings.smtp_user))
    msg["To"] = to
    msg["Subject"] = str(Header(subject, "utf-8"))

    try:
        # QQ 邮箱默认 465 端口 SSL；如需 STARTTLS 请改用 smtplib.SMTP(host, 587) + starttls()
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=10) as server:
            server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(settings.smtp_user, [to], msg.as_string())
    except smtplib.SMTPException as e:
        raise EmailSendError(f"SMTP 发送失败: {e}") from e


async def send_email(*, to: str, subject: str, html_body: str) -> None:
    """异步发送邮件。

    Args:
        to: 收件人邮箱
        subject: 主题
        html_body: HTML 正文

    Raises:
        EmailNotConfiguredError: SMTP 未配置
        EmailSendError: SMTP 发送失败
    """
    await asyncio.to_thread(_send_sync, to=to, subject=subject, html_body=html_body)


def render_verify_code_email(*, code: str, ttl_minutes: int) -> tuple[str, str]:
    """渲染验证码邮件的主题和 HTML 正文。

    Args:
        code: 6 位数字验证码
        ttl_minutes: 有效期分钟数

    Returns:
        (subject, html_body)
    """
    subject = f"【元AI】您的注册验证码：{code}"
    html_body = f"""\
<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:32px;background:#F4F8FF;font-family:'PingFang SC','Microsoft YaHei',sans-serif;color:#1A2540;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:16px;padding:36px 28px;box-shadow:0 2px 16px rgba(59,130,246,.08);">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:20px;">
      <div style="width:36px;height:36px;border-radius:10px;background:linear-gradient(135deg,#1D4ED8,#3B82F6);color:#fff;font-weight:700;font-size:16px;display:flex;align-items:center;justify-content:center;">元</div>
      <span style="font-size:18px;font-weight:600;">元AI</span>
    </div>
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">您正在注册元AI账号，验证码为：</p>
    <div style="font-size:34px;font-weight:700;letter-spacing:8px;color:#1D4ED8;text-align:center;padding:16px 0;background:#EFF6FF;border-radius:12px;margin-bottom:20px;font-variant-numeric:tabular-nums;">{code}</div>
    <p style="font-size:13px;line-height:1.7;color:#5A6A8A;margin:0 0 6px;">验证码 <strong>{ttl_minutes} 分钟</strong> 内有效，请勿泄露给他人。</p>
    <p style="font-size:13px;line-height:1.7;color:#5A6A8A;margin:0;">如非本人操作，请忽略此邮件。</p>
    <hr style="border:none;border-top:1px solid #EBF3FF;margin:24px 0;">
    <p style="font-size:12px;color:#9BABC5;margin:0;text-align:center;">此邮件由系统自动发送，请勿直接回复。</p>
  </div>
</body>
</html>"""
    return subject, html_body
