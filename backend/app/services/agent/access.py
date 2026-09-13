"""Agent Run 创建入口的功能开关判定。"""

from __future__ import annotations

import uuid

from app.core.config import settings


def is_agent_enabled_for(user_id: uuid.UUID) -> bool:
    """返回当前用户是否允许创建新的 Agent Run。"""

    if settings.agent_enabled:
        return True
    allowed = {
        item.strip() for item in settings.agent_allowlist_user_ids.split(",") if item.strip()
    }
    return str(user_id) in allowed
