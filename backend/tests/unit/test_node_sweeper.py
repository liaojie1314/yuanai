"""执行节点心跳清扫的状态迁移测试。"""

from datetime import UTC, datetime, timedelta

import pytest

from app.models.tool_runtime import ExecutionNode, ExecutionNodeStatus
from app.models.user import User
from app.services.tool_runtime_service import sweep_stale_nodes


@pytest.mark.asyncio
async def test_sweep_marks_only_stale_online_nodes_offline(db, test_user: User) -> None:
    """只有心跳过期的 online 节点被置 offline，revoked 与新鲜节点不受影响。"""

    now = datetime.now(UTC)
    stale = ExecutionNode(
        user_id=test_user.id,
        name="陈旧",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=[],
        policy={},
        last_seen_at=now - timedelta(seconds=600),
    )
    fresh = ExecutionNode(
        user_id=test_user.id,
        name="新鲜",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.online,
        capabilities=[],
        policy={},
        last_seen_at=now - timedelta(seconds=5),
    )
    revoked = ExecutionNode(
        user_id=test_user.id,
        name="已撤销",
        platform="linux",
        app_version="0.1.0",
        status=ExecutionNodeStatus.revoked,
        capabilities=[],
        policy={},
        last_seen_at=now - timedelta(seconds=600),
    )
    db.add_all([stale, fresh, revoked])
    await db.flush()

    assert await sweep_stale_nodes(now=now, db=db) == 1
    assert stale.status is ExecutionNodeStatus.offline
    assert fresh.status is ExecutionNodeStatus.online
    assert revoked.status is ExecutionNodeStatus.revoked


@pytest.mark.asyncio
async def test_sweep_is_idempotent(db, test_user: User) -> None:
    """重复清扫不得反复计数已经 offline 的节点。"""

    now = datetime.now(UTC)
    db.add(
        ExecutionNode(
            user_id=test_user.id,
            name="陈旧",
            platform="linux",
            app_version="0.1.0",
            status=ExecutionNodeStatus.online,
            capabilities=[],
            policy={},
            last_seen_at=now - timedelta(seconds=600),
        )
    )
    await db.flush()
    assert await sweep_stale_nodes(now=now, db=db) == 1
    assert await sweep_stale_nodes(now=now, db=db) == 0
