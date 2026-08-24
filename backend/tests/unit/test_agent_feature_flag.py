"""Agent 默认关闭与内部 allowlist 的配置契约测试。"""

from __future__ import annotations

import uuid

from app.api.v1.agent import _agent_enabled_for
from app.core.config import settings


def test_agent_is_disabled_by_default(monkeypatch) -> None:
    user_id = uuid.uuid4()
    monkeypatch.setattr(settings, "agent_enabled", False)
    monkeypatch.setattr(settings, "agent_allowlist_user_ids", "")
    assert _agent_enabled_for(user_id) is False


def test_agent_allowlist_enables_only_selected_users(monkeypatch) -> None:
    selected = uuid.uuid4()
    other = uuid.uuid4()
    monkeypatch.setattr(settings, "agent_enabled", False)
    monkeypatch.setattr(settings, "agent_allowlist_user_ids", f" {selected} ")
    assert _agent_enabled_for(selected) is True
    assert _agent_enabled_for(other) is False
