"""Agent 桌面工具节点选择逻辑测试。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.services.agent.coordinator import AgentCoordinator


@pytest.mark.asyncio
async def test_select_desktop_node_prefers_online_node_allowing_tool(
    db: AsyncSession, test_user
) -> None:
    """只选择策略允许该工具的在线节点，忽略离线与未授权节点。"""

    other_user = User(
        id=uuid.uuid4(),
        email="routing-other@example.com",
        username="routing-other",
        hashed_password=hash_password("Routing-Other-1!"),
    )
    db.add(other_user)
    await db.flush()
    offline_allowed = ExecutionNode(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="offline-allowed",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.offline,
        capabilities=["browser_open_url"],
        policy={"allowed_tools": ["browser_open_url"], "allowed_resource_ids": []},
    )
    online_forbidden = ExecutionNode(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="online-forbidden",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=[],
        policy={"allowed_tools": [], "allowed_resource_ids": []},
    )
    online_allowed = ExecutionNode(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="online-allowed",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=["browser_open_url"],
        policy={"allowed_tools": ["browser_open_url"], "allowed_resource_ids": []},
    )
    other_user_node = ExecutionNode(
        id=uuid.uuid4(),
        user_id=other_user.id,
        name="other-user",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=["browser_open_url"],
        policy={"allowed_tools": ["browser_open_url"], "allowed_resource_ids": []},
    )
    db.add_all([other_user, offline_allowed, online_forbidden, online_allowed, other_user_node])
    await db.flush()

    selected = await AgentCoordinator._select_desktop_node(test_user.id, "browser_open_url", db)
    assert selected is not None
    assert selected.id == online_allowed.id

    none_selected = await AgentCoordinator._select_desktop_node(
        test_user.id, "list_granted_directory", db
    )
    assert none_selected is None
