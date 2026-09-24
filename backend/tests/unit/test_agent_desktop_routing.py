"""Agent 桌面工具节点选择逻辑测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.services.tool_runtime_service import run_node_job, select_fresh_node


@pytest.mark.asyncio
async def test_select_fresh_node_prefers_online_node_allowing_tool(
    db: AsyncSession, test_user
) -> None:
    """只选择策略允许该工具的在线节点，忽略离线与未授权节点。"""

    now = datetime.now(UTC)
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
        last_seen_at=now,
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
        last_seen_at=now,
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
        last_seen_at=now,
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
        last_seen_at=now,
    )
    db.add_all([other_user, offline_allowed, online_forbidden, online_allowed, other_user_node])
    await db.flush()

    selected = await select_fresh_node(
        user_id=test_user.id, tool_name="browser_open_url", db=db, now=now
    )
    assert selected is not None
    assert selected.id == online_allowed.id

    none_selected = await select_fresh_node(
        user_id=test_user.id, tool_name="list_granted_directory", db=db, now=now
    )
    assert none_selected is None


@pytest.mark.asyncio
async def test_stale_heartbeat_node_is_not_selected(db, test_user: User) -> None:
    """心跳过期的节点即使 status 仍是 online 也不得被选中。"""

    now = datetime.now(UTC)
    node = ExecutionNode(
        user_id=test_user.id,
        name="陈旧节点",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=["read_granted_file"],
        policy={"allowed_tools": ["read_granted_file"]},
        last_seen_at=now - timedelta(seconds=600),
    )
    db.add(node)
    await db.flush()
    assert (
        await select_fresh_node(user_id=test_user.id, tool_name="read_granted_file", db=db, now=now)
        is None
    )


@pytest.mark.asyncio
async def test_run_node_job_reports_unavailable_without_a_fresh_node(db, test_user: User) -> None:
    """没有可用节点时立即返回 unavailable，不排队也不等超时。"""

    outcome = await run_node_job(
        user_id=test_user.id,
        tool_name="memory.search",
        arguments={"query": "中文"},
        db=db,
        timeout_seconds=5,
    )
    assert outcome.status == "unavailable"
    assert outcome.data is None
