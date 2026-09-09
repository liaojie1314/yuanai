"""Memory 候选生命周期与删除服务。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import Memory, MemoryRelation, MemorySensitivity, MemoryStatus
from app.schemas.memory import MemoryCreateCandidate, MemoryUpdate
from app.services.memory_retrieval import maybe_embed_text


class MemoryNotFoundError(Exception):
    """调用者不拥有目标记忆时使用的稳定错误。"""


class MemoryPolicyError(Exception):
    """记忆生命周期或敏感度不满足政策时使用的稳定错误。"""


async def create_candidate(
    *, user_id: uuid.UUID, request: MemoryCreateCandidate, db: AsyncSession
) -> Memory:
    """创建候选记忆，并验证助理与用户处于同一租户。"""

    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == request.assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        raise MemoryNotFoundError()
    if request.valid_until is not None and request.valid_from is not None:
        if request.valid_until <= request.valid_from:
            raise MemoryPolicyError("有效期结束时间必须晚于开始时间")
    memory = Memory(
        user_id=user_id,
        assistant_id=request.assistant_id,
        workspace_id=request.workspace_id,
        memory_type=request.memory_type,
        content=request.content,
        structured_data=request.structured_data,
        source_type=request.source_type,
        source_id=request.source_id,
        source_excerpt=request.source_excerpt,
        confidence=request.confidence,
        sensitivity=request.sensitivity,
        storage_location=request.storage_location,
        valid_from=request.valid_from,
        valid_until=request.valid_until,
        status=MemoryStatus.candidate,
    )
    db.add(memory)
    await db.flush()
    return memory


async def update_memory(
    *, memory_id: uuid.UUID, user_id: uuid.UUID, request: MemoryUpdate, db: AsyncSession
) -> Memory:
    """更新用户自己的记忆；该调用本身代表用户的显式确认。"""

    memory = await _owned_memory(memory_id=memory_id, user_id=user_id, db=db)
    changes = request.model_dump(exclude_unset=True)
    requested_status = changes.get("status")
    if requested_status is not None and not _is_allowed_transition(memory.status, requested_status):
        raise MemoryPolicyError("不允许的记忆生命周期变更")
    requested_sensitivity = changes.get("sensitivity")
    if (
        requested_sensitivity in {MemorySensitivity.sensitive, MemorySensitivity.restricted}
        and requested_status is MemoryStatus.active
    ):
        raise MemoryPolicyError("敏感记忆不能进入普通上下文")
    valid_from = changes.get("valid_from", memory.valid_from)
    valid_until = changes.get("valid_until", memory.valid_until)
    if valid_from is not None and valid_until is not None and valid_until <= valid_from:
        raise MemoryPolicyError("有效期结束时间必须晚于开始时间")
    content_changed = "content" in changes
    becomes_or_stays_active = requested_status is MemoryStatus.active or (
        memory.status is MemoryStatus.active and content_changed
    )
    if becomes_or_stays_active:
        changes["embedding"] = await maybe_embed_text(changes.get("content", memory.content))
    elif content_changed:
        changes["embedding"] = None
    for field, value in changes.items():
        setattr(memory, field, value)
    await db.flush()
    return memory


async def list_memories(
    *, user_id: uuid.UUID, db: AsyncSession, status: MemoryStatus | None = None
) -> list[Memory]:
    """按生命周期筛选当前用户的记忆，不暴露其他租户的记录。"""

    query = select(Memory).where(Memory.user_id == user_id).order_by(Memory.updated_at.desc())
    if status is not None:
        query = query.where(Memory.status == status)
    return list((await db.scalars(query)).all())


async def delete_memory(*, memory_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> None:
    """在当前事务中删除内容、embedding、搜索记录和派生关系。"""

    memory = await _owned_memory(memory_id=memory_id, user_id=user_id, db=db)
    await db.execute(delete(MemoryRelation).where(MemoryRelation.memory_id == memory.id))
    await db.delete(memory)
    await db.flush()


async def expire_episodic_memories(*, now: datetime, db: AsyncSession) -> int:
    """标记超过有效期的 active episodic 记忆，供受控维护任务调用。"""

    from sqlalchemy import update

    from app.models.memory import MemoryType

    result = await db.execute(
        update(Memory)
        .where(
            Memory.status == MemoryStatus.active,
            Memory.memory_type == MemoryType.episodic,
            Memory.valid_until.is_not(None),
            Memory.valid_until < now.astimezone(UTC),
        )
        .values(status=MemoryStatus.expired)
    )
    return int(getattr(result, "rowcount", 0) or 0)


async def _owned_memory(*, memory_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Memory:
    """读取单个租户自己的记忆，避免 ID 枚举泄露。"""

    memory = await db.scalar(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == user_id)
    )
    if memory is None:
        raise MemoryNotFoundError()
    return memory


def _is_allowed_transition(current: MemoryStatus, requested: MemoryStatus) -> bool:
    """限制候选确认和终态变更，避免任意 PATCH 绕过生命周期策略。"""

    if current is requested:
        return True
    return (current, requested) in {
        (MemoryStatus.candidate, MemoryStatus.active),
        (MemoryStatus.candidate, MemoryStatus.rejected),
        (MemoryStatus.active, MemoryStatus.superseded),
        (MemoryStatus.active, MemoryStatus.expired),
    }
