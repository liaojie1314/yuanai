"""记忆候选生命周期服务的租户隔离、状态机与向量化分支单元测试。

夹具全部为合成占位内容，不含任何真实或拟真的个人信息。
"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemoryRelation,
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
    MemoryType,
)
from app.models.user import User
from app.schemas.memory import MemoryCreateCandidate, MemoryUpdate
from app.services import memory_service
from app.services.memory_service import (
    MemoryNotFoundError,
    MemoryPolicyError,
    create_candidate,
    delete_memory,
    expire_episodic_memories,
    list_memories,
    update_memory,
)


async def _assistant(db: AsyncSession, user_id: uuid.UUID) -> Assistant:
    """创建一个可供记忆挂靠的助理。"""

    assistant = Assistant(user_id=user_id, name="测试助理", default_model="test-model")
    db.add(assistant)
    await db.flush()
    return assistant


async def _other_user(db: AsyncSession) -> User:
    """创建另一个租户，用于验证跨租户不可见。"""

    user = User(
        id=uuid.uuid4(),
        email=f"memory-service-{uuid.uuid4().hex[:8]}@example.com",
        username=f"memory-service-{uuid.uuid4().hex[:8]}",
        hashed_password="x",
    )
    db.add(user)
    await db.flush()
    return user


def _candidate(assistant_id: uuid.UUID, **overrides: object) -> MemoryCreateCandidate:
    """构造一份默认合法的候选记忆输入。"""

    payload: dict[str, object] = {
        "assistant_id": assistant_id,
        "memory_type": MemoryType.preference,
        "content": "记忆内容A",
        "source_type": "user_input",
        "source_id": "来源1",
        "source_excerpt": "原文摘录A",
        "confidence": 0.5,
    }
    payload.update(overrides)
    return MemoryCreateCandidate(**payload)  # type: ignore[arg-type]


async def _active_memory(db: AsyncSession, user_id: uuid.UUID, **overrides: object) -> Memory:
    """直接落一条 active 记忆，跳过候选确认流程。"""

    assistant = await _assistant(db, user_id)
    fields: dict[str, object] = {
        "user_id": user_id,
        "assistant_id": assistant.id,
        "memory_type": MemoryType.preference,
        "content": "记忆内容A",
        "source_type": "run",
        "status": MemoryStatus.active,
    }
    fields.update(overrides)
    memory = Memory(**fields)
    db.add(memory)
    await db.flush()
    return memory


@pytest.mark.asyncio
async def test_create_candidate_persists_as_candidate(db: AsyncSession, test_user: User) -> None:
    """新建记忆一律落在 candidate，不能绕过用户确认直接生效。"""

    assistant = await _assistant(db, test_user.id)
    memory = await create_candidate(user_id=test_user.id, request=_candidate(assistant.id), db=db)
    assert memory.status is MemoryStatus.candidate
    assert memory.user_id == test_user.id
    assert memory.content == "记忆内容A"
    assert memory.embedding is None


@pytest.mark.asyncio
async def test_create_candidate_rejects_another_tenants_assistant(
    db: AsyncSession, test_user: User
) -> None:
    """助理不属于调用者时必须按「找不到」处理，避免 ID 枚举泄露。"""

    foreign = await _other_user(db)
    foreign_assistant = await _assistant(db, foreign.id)
    with pytest.raises(MemoryNotFoundError):
        await create_candidate(
            user_id=test_user.id, request=_candidate(foreign_assistant.id), db=db
        )


@pytest.mark.asyncio
async def test_create_candidate_rejects_inverted_validity_window(
    db: AsyncSession, test_user: User
) -> None:
    """有效期结束时间不晚于开始时间的候选必须被拒绝。"""

    assistant = await _assistant(db, test_user.id)
    now = datetime.now(UTC)
    request = _candidate(assistant.id, valid_from=now, valid_until=now - timedelta(hours=1))
    with pytest.raises(MemoryPolicyError):
        await create_candidate(user_id=test_user.id, request=request, db=db)


@pytest.mark.asyncio
async def test_update_confirms_candidate_and_requests_an_embedding(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """候选转 active 时按正文生成向量，供后续向量臂召回。"""

    vector = [0.25] * 1536

    async def _fake_embed(text: str) -> list[float]:
        assert text == "记忆内容A"
        return vector

    monkeypatch.setattr(memory_service, "maybe_embed_text", _fake_embed)
    memory = await _active_memory(db, test_user.id, status=MemoryStatus.candidate)
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.active),
        db=db,
    )
    assert updated.status is MemoryStatus.active
    assert updated.embedding is not None
    assert list(updated.embedding) == pytest.approx(vector)


@pytest.mark.asyncio
async def test_update_keeps_embedding_none_when_provider_is_unavailable(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """没有可用 embedding provider 时保持向量为空，只降级到关键词检索。"""

    async def _no_embedding(text: str) -> list[float] | None:
        return None

    monkeypatch.setattr(memory_service, "maybe_embed_text", _no_embedding)
    memory = await _active_memory(db, test_user.id, status=MemoryStatus.candidate)
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.active),
        db=db,
    )
    assert updated.status is MemoryStatus.active
    assert updated.embedding is None


@pytest.mark.asyncio
async def test_update_skips_embedding_for_local_node_memory_without_content(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """local_node 记忆云端没有正文，确认为 active 时不得调用 embedding。"""

    async def _must_not_run(text: str) -> list[float] | None:
        raise AssertionError("没有正文时不应请求向量")

    monkeypatch.setattr(memory_service, "maybe_embed_text", _must_not_run)
    memory = await _active_memory(
        db,
        test_user.id,
        status=MemoryStatus.candidate,
        content=None,
        storage_location=MemoryStorageLocation.local_node,
    )
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.active),
        db=db,
    )
    assert updated.status is MemoryStatus.active
    assert updated.embedding is None


@pytest.mark.asyncio
async def test_update_clears_embedding_when_content_changes_off_active(
    db: AsyncSession, test_user: User
) -> None:
    """非 active 记忆改正文后旧向量必须作废，避免检索命中过期内容。"""

    memory = await _active_memory(
        db,
        test_user.id,
        status=MemoryStatus.candidate,
        embedding=[0.5] * 1536,
    )
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(content="记忆内容B"),
        db=db,
    )
    assert updated.content == "记忆内容B"
    assert updated.embedding is None


@pytest.mark.asyncio
async def test_update_reembeds_when_active_content_changes(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """已生效记忆改正文要重新向量化，而不是沿用旧向量。"""

    async def _fake_embed(text: str) -> list[float]:
        assert text == "记忆内容B"
        return [0.75] * 1536

    monkeypatch.setattr(memory_service, "maybe_embed_text", _fake_embed)
    memory = await _active_memory(db, test_user.id, embedding=[0.1] * 1536)
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(content="记忆内容B"),
        db=db,
    )
    assert updated.embedding is not None
    assert list(updated.embedding) == pytest.approx([0.75] * 1536)


@pytest.mark.asyncio
async def test_update_allows_a_no_op_status(db: AsyncSession, test_user: User) -> None:
    """把状态改成当前值属于允许的空转，不应被状态机拦下。"""

    memory = await _active_memory(db, test_user.id, status=MemoryStatus.candidate)
    updated = await update_memory(
        memory_id=memory.id,
        user_id=test_user.id,
        request=MemoryUpdate(status=MemoryStatus.candidate),
        db=db,
    )
    assert updated.status is MemoryStatus.candidate


@pytest.mark.asyncio
async def test_update_rejects_a_forbidden_transition(db: AsyncSession, test_user: User) -> None:
    """已拒绝的记忆不能被 PATCH 直接复活成 active。"""

    memory = await _active_memory(db, test_user.id, status=MemoryStatus.rejected)
    with pytest.raises(MemoryPolicyError):
        await update_memory(
            memory_id=memory.id,
            user_id=test_user.id,
            request=MemoryUpdate(status=MemoryStatus.active),
            db=db,
        )


@pytest.mark.asyncio
async def test_update_rejects_activating_a_sensitive_memory(
    db: AsyncSession, test_user: User
) -> None:
    """敏感记忆不得在确认的同时进入普通上下文。"""

    memory = await _active_memory(db, test_user.id, status=MemoryStatus.candidate)
    with pytest.raises(MemoryPolicyError):
        await update_memory(
            memory_id=memory.id,
            user_id=test_user.id,
            request=MemoryUpdate(
                status=MemoryStatus.active, sensitivity=MemorySensitivity.sensitive
            ),
            db=db,
        )


@pytest.mark.asyncio
async def test_update_rejects_inverted_validity_window(db: AsyncSession, test_user: User) -> None:
    """更新后的有效期窗口同样必须是正向区间。"""

    now = datetime.now(UTC)
    memory = await _active_memory(db, test_user.id, valid_from=now)
    with pytest.raises(MemoryPolicyError):
        await update_memory(
            memory_id=memory.id,
            user_id=test_user.id,
            request=MemoryUpdate(valid_until=now - timedelta(minutes=1)),
            db=db,
        )


@pytest.mark.asyncio
async def test_update_rejects_another_tenants_memory(db: AsyncSession, test_user: User) -> None:
    """更新他人记忆必须报「找不到」，不得泄露记忆是否存在。"""

    foreign = await _other_user(db)
    memory = await _active_memory(db, foreign.id, status=MemoryStatus.candidate)
    with pytest.raises(MemoryNotFoundError):
        await update_memory(
            memory_id=memory.id,
            user_id=test_user.id,
            request=MemoryUpdate(status=MemoryStatus.active),
            db=db,
        )


@pytest.mark.asyncio
async def test_list_memories_is_tenant_scoped_and_filterable(
    db: AsyncSession, test_user: User
) -> None:
    """列表只返回本租户记忆，并支持按生命周期筛选。"""

    foreign = await _other_user(db)
    await _active_memory(db, foreign.id, content="他人记忆")
    active = await _active_memory(db, test_user.id, content="记忆内容A")
    candidate = await _active_memory(
        db, test_user.id, content="记忆内容B", status=MemoryStatus.candidate
    )

    everything = await list_memories(user_id=test_user.id, db=db)
    assert {memory.id for memory in everything} == {active.id, candidate.id}

    only_active = await list_memories(user_id=test_user.id, db=db, status=MemoryStatus.active)
    assert [memory.id for memory in only_active] == [active.id]


@pytest.mark.asyncio
async def test_delete_memory_removes_derived_relations(db: AsyncSession, test_user: User) -> None:
    """删除记忆必须连同派生关系一起清掉，不留孤儿行。"""

    memory = await _active_memory(db, test_user.id)
    db.add(
        MemoryRelation(
            memory_id=memory.id,
            subject="测试主体1",
            predicate="偏好",
            object_value="偏好B",
        )
    )
    await db.flush()

    await delete_memory(memory_id=memory.id, user_id=test_user.id, db=db)

    assert await db.get(Memory, memory.id) is None
    assert (await list_memories(user_id=test_user.id, db=db)) == []


@pytest.mark.asyncio
async def test_delete_rejects_another_tenants_memory(db: AsyncSession, test_user: User) -> None:
    """删除他人记忆必须报「找不到」。"""

    foreign = await _other_user(db)
    memory = await _active_memory(db, foreign.id)
    with pytest.raises(MemoryNotFoundError):
        await delete_memory(memory_id=memory.id, user_id=test_user.id, db=db)


@pytest.mark.asyncio
async def test_delete_rejects_a_missing_memory(db: AsyncSession, test_user: User) -> None:
    """删除不存在的记忆同样报「找不到」。"""

    with pytest.raises(MemoryNotFoundError):
        await delete_memory(memory_id=uuid.uuid4(), user_id=test_user.id, db=db)


@pytest.mark.asyncio
async def test_expire_episodic_memories_only_touches_overdue_episodic_rows(
    db: AsyncSession, test_user: User
) -> None:
    """只有过期的 active episodic 记忆被标记，其余类型与未到期记忆不受影响。"""

    now = datetime.now(UTC)
    overdue = await _active_memory(
        db,
        test_user.id,
        memory_type=MemoryType.episodic,
        valid_until=now - timedelta(days=1),
    )
    still_valid = await _active_memory(
        db,
        test_user.id,
        memory_type=MemoryType.episodic,
        valid_until=now + timedelta(days=1),
    )
    other_type = await _active_memory(
        db,
        test_user.id,
        memory_type=MemoryType.semantic,
        valid_until=now - timedelta(days=1),
    )

    assert await expire_episodic_memories(now=now, db=db) == 1

    await db.refresh(overdue)
    await db.refresh(still_valid)
    await db.refresh(other_type)
    assert overdue.status is MemoryStatus.expired
    assert still_valid.status is MemoryStatus.active
    assert other_type.status is MemoryStatus.active


@pytest.mark.asyncio
async def test_expire_episodic_memories_reports_zero_when_nothing_is_overdue(
    db: AsyncSession, test_user: User
) -> None:
    """没有过期记忆时返回 0，调用方据此判断无需通知。"""

    now = datetime.now(UTC)
    await _active_memory(db, test_user.id, memory_type=MemoryType.episodic, valid_until=None)
    assert await expire_episodic_memories(now=now, db=db) == 0
