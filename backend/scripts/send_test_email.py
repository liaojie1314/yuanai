"""向指定邮箱发一封样例验证码邮件，用于验收 SMTP 配置是否生效。

用法：
    cd backend
    .venv/bin/python -m scripts.send_test_email                     # 默认发到 you@example.com
    .venv/bin/python -m scripts.send_test_email you@example.com    # 发到指定地址

期望输出：
    ✅ 邮件已通过 smtp.qq.com:465 发送到 xxx@xxx，请查收
    ❌ 邮件发送失败：<错误原因>

脚本会加载 backend/.env 中的 SMTP 配置。若 SMTP_USER 或 SMTP_PASSWORD 未填，直接报错退出。
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# 允许以 `python scripts/send_test_email.py` 直接调用（把 backend/ 加入 sys.path）
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from app.core.config import settings  # noqa: E402
from app.services.email_service import (  # noqa: E402
    EmailNotConfiguredError,
    EmailSendError,
    render_verify_code_email,
    send_email,
)

DEFAULT_TO = "you@example.com"


async def main(to: str) -> int:
    if not settings.smtp_user or not settings.smtp_password:
        print("❌ SMTP_USER 或 SMTP_PASSWORD 未配置（请检查 backend/.env）")
        return 1

    print(f"→ 使用 {settings.smtp_host}:{settings.smtp_port}  (发件人 {settings.smtp_user})")
    print(f"→ 收件人 {to}")

    # 用真实的验证码邮件模板，方便同时验证外观
    subject, html = render_verify_code_email(code="123456", ttl_minutes=10)
    try:
        await send_email(to=to, subject=subject, html_body=html)
    except EmailNotConfiguredError as e:
        print(f"❌ SMTP 未配置：{e}")
        return 1
    except EmailSendError as e:
        print(f"❌ 邮件发送失败：{e}")
        return 2

    print(f"✅ 邮件已通过 {settings.smtp_host}:{settings.smtp_port} 发送到 {to}，请查收")
    print("   * 若收件箱未见，请检查垃圾邮件文件夹")
    return 0


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TO
    sys.exit(asyncio.run(main(target)))
