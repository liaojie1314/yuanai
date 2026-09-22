"""记忆归属节点与助理记忆类型开关的持久化单元测试。"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Assistant,
    Memory,
    MemoryStorageLocation,
    MemoryType,
    User,
)
from app.models.tool_runtime import ExecutionNode


async def _assistant(db: AsyncSession, user_id: uuid.UUID) -> Assistant:
    """创建一个可供记忆挂靠的默认助理。"""

    assistant = Assistant(user_id=user_id, name="默认", default_model="test-model", is_default=True)
    db.add(assistant)
    await db.flush()
    return assistant


async def _node(db: AsyncSession, user_id: uuid.UUID) -> ExecutionNode:
    """创建一个桌面执行节点，满足 memories.node_id 的外键约束。"""

    node = ExecutionNode(
        user_id=user_id,
        name="测试节点",
        platform="linux",
        app_version="0.0.1",
        capabilities=[],
    )
    db.add(node)
    await db.flush()
    return node


@pytest.mark.asyncio
async def test_local_node_memory_persists_without_cloud_content(db, test_user: User) -> None:
    """local_node 记忆在云端只留元数据，content 为空并记录归属节点。"""

    assistant = await _assistant(db, test_user.id)
    node_id = (await _node(db, test_user.id)).id
    memory = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.profile,
        content=None,
        source_type="user_input",
        storage_location=MemoryStorageLocation.local_node,
        node_id=node_id,
    )
    db.add(memory)
    await db.flush()
    assert memory.content is None
    assert memory.node_id == node_id


@pytest.mark.asyncio
async def test_assistant_can_disable_a_memory_type(db, test_user: User) -> None:
    """助理上的记忆类型开关可持久化，供自动激活策略读取。"""

    assistant = await _assistant(db, test_user.id)
    assistant_id = assistant.id
    assistant.disabled_memory_types = [MemoryType.episodic.value]
    await db.flush()
    db.expire(assistant)
    stored = await db.scalar(select(Assistant).where(Assistant.id == assistant_id))
    assert stored is not None
    assert stored.disabled_memory_types == ["episodic"]
