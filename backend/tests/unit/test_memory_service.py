"""Memory 领域服务与检索边界测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemoryRelation,
    MemorySensitivity,
    MemoryStatus,
    MemoryType,
)
from app.models.user import User
from app.schemas.memory import MemoryCreateCandidate, MemoryUpdate
from app.services.memory_retrieval import search_active_memories, to_context_items
from app.services.memory_service import create_candidate, delete_memory, update_memory


async def _assistant(db, user_id: uuid.UUID) -> Assistant:
    """创建当前租户可拥有记忆的助理。"""

    assistant = Assistant(user_id=user_id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    return assistant


@pytest.mark.asyncio
async def test_sensitive_candidate_requires_explicit_user_activation(db, test_user: User) -> None:
    """敏感内容只能先成为候选，再由用户更新操作显式激活。"""

    assistant = await _assistant(db, test_user.id)
    memory = await create_candidate(
        user_id=test_user.id,
        request=MemoryCreateCandidate(
            assistant_id=assistant.id,
            memory_type=MemoryType.preference,
            content="优先中文输出",
            source_type="user_input",
            sensitivity=MemorySensitivity.sensitive,
        ),
        db=db,
    )
    assert memory.status is MemoryStatus.candidate
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.active),
        db=db,
    )
    assert updated.status is MemoryStatus.active


@pytest.mark.asyncio
async def test_activation_generates_embedding_when_the_approved_provider_is_available(
    db, monkeypatch: pytest.MonkeyPatch, test_user: User
) -> None:
    """确认候选时写入当前内容的 embedding。"""

    assistant = await _assistant(db, test_user.id)
    memory = await create_candidate(
        user_id=test_user.id,
        request=MemoryCreateCandidate(
            assistant_id=assistant.id,
            memory_type=MemoryType.preference,
            content="旅行优先高铁",
            source_type="user_input",
        ),
        db=db,
    )

    async def embed(content: str) -> list[float] | None:
        assert content == "旅行优先高铁"
        return [0.1, 0.2]

    monkeypatch.setattr("app.services.memory_service.maybe_embed_text", embed)
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.active),
        db=db,
    )

    assert updated.embedding == [0.1, 0.2]


@pytest.mark.asyncio
async def test_semantic_retrieval_works_without_keyword_overlap(db, test_user: User) -> None:
    """有查询向量时，同租户过滤后的记忆可通过语义相似度召回。"""

    assistant = await _assistant(db, test_user.id)
    memory = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.preference,
        content="午餐通常选择清淡食物",
        source_type="user_input",
        status=MemoryStatus.active,
        sensitivity=MemorySensitivity.personal,
        embedding=[1.0, 0.0],
    )
    db.add(memory)
    await db.flush()

    results = await search_active_memories(
        user_id=test_user.id,
        assistant_id=assistant.id,
        query="怎么安排吃饭",
        query_embedding=[1.0, 0.0],
        db=db,
    )

    assert [result.id for result in results] == [memory.id]


@pytest.mark.asyncio
async def test_retrieval_filters_tenant_status_lifecycle_and_sensitivity_before_ranking(
    db, test_user: User
) -> None:
    """只有本租户、active、有效且允许进入上下文的记忆可以被排名。"""

    assistant = await _assistant(db, test_user.id)
    other_user = User(
        id=uuid.uuid4(),
        email="memory-other@example.com",
        username="memory-other",
        hashed_password="x",
    )
    db.add(other_user)
    await db.flush()
    other_assistant = await _assistant(db, other_user.id)
    now = datetime.now(UTC)
    db.add_all(
        [
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="旅行优先高铁",
                source_type="user_input",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.personal,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="旅行优先高铁的敏感内容",
                source_type="user_input",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.sensitive,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="旅行优先高铁的候选内容",
                source_type="user_input",
                status=MemoryStatus.candidate,
                sensitivity=MemorySensitivity.personal,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.episodic,
                content="旅行优先高铁的过期内容",
                source_type="run",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.personal,
                valid_until=now - timedelta(seconds=1),
            ),
            Memory(
                user_id=other_user.id,
                assistant_id=other_assistant.id,
                memory_type=MemoryType.preference,
                content="旅行优先高铁的其他用户内容",
                source_type="user_input",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.personal,
            ),
        ]
    )
    await db.flush()

    results = await search_active_memories(
        user_id=test_user.id,
        assistant_id=assistant.id,
        query="旅行优先高铁",
        db=db,
        now=now,
    )

    assert [item.content for item in results] == ["旅行优先高铁"]
    assert to_context_items(results)[0].untrusted is True


@pytest.mark.asyncio
async def test_delete_removes_embedding_search_record_and_relations_in_one_transaction(
    db, test_user: User
) -> None:
    """删除用户记忆时不遗留向量、搜索索引或关系记录。"""

    assistant = await _assistant(db, test_user.id)
    memory = Memory(
        user_id=test_user.id,
        assistant_id=assistant.id,
        memory_type=MemoryType.semantic,
        content="项目在上海",
        source_type="user_input",
        status=MemoryStatus.active,
        sensitivity=MemorySensitivity.personal,
        embedding=[0.1, 0.2],
    )
    db.add(memory)
    await db.flush()
    relation = MemoryRelation(
        memory_id=memory.id, subject="项目", predicate="位于", object_value="上海"
    )
    db.add(relation)
    await db.flush()

    await delete_memory(memory_id=memory.id, user_id=test_user.id, db=db)

    assert await db.scalar(select(Memory).where(Memory.id == memory.id)) is None
    assert await db.scalar(select(MemoryRelation).where(MemoryRelation.id == relation.id)) is None
