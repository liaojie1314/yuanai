"""Memory 候选生命周期与删除服务。"""

from __future__ import annotations

import base64
import uuid
from datetime import UTC, datetime

from sqlalchemy import Select, and_, delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import (
    Memory,
    MemoryRelation,
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
)
from app.schemas.memory import (
    MemoryCreateCandidate,
    MemoryPage,
    MemoryResponse,
    MemoryUpdate,
)
from app.services.ai_service import maybe_embed_text
from app.services.memory_node import drop_local_memory, push_local_memory
from app.services.tool_runtime_service import select_fresh_node

# 游标只在服务端构造，编码是为了让调用方无法拼一个"下一页"出来，不是为了保密
_CURSOR_SEPARATOR = "|"


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
    # 来源 id 在 schema 里是可选的（抽取流水线先产候选、后补来源），但落库是最后一道关：
    # 没有来源的记忆无法被引用回原文，只会把检索侧的引用准确率拖下来。
    if not (request.source_id or "").strip():
        raise MemoryPolicyError("记忆必须带上可回溯的来源 id")
    is_local = request.storage_location is MemoryStorageLocation.local_node
    memory = Memory(
        # 本地记忆要先把正文推给节点，推送时就得有稳定 id，因此不依赖列默认值
        id=uuid.uuid4(),
        user_id=user_id,
        assistant_id=request.assistant_id,
        workspace_id=request.workspace_id,
        memory_type=request.memory_type,
        content=None if is_local else request.content,
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
    if is_local:
        # 先推节点再落库：推送失败就不该留下一条没有正文的孤儿元数据行。
        await push_local_memory(memory=memory, content=request.content, db=db)
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
    if content_changed and memory.storage_location is MemoryStorageLocation.local_node:
        # 本地记忆的新正文只写节点；云端行恒为 NULL，推送失败则整次更新作废。
        new_content = changes["content"]
        if new_content is not None:
            await push_local_memory(memory=memory, content=str(new_content), db=db)
        changes["content"] = None
    becomes_or_stays_active = requested_status is MemoryStatus.active or (
        memory.status is MemoryStatus.active and content_changed
    )
    if becomes_or_stays_active:
        embed_source = changes.get("content", memory.content)
        # 仅存元数据的 local_node 记忆没有云端正文，跳过向量化
        changes["embedding"] = await maybe_embed_text(embed_source) if embed_source else None
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

    return list((await db.scalars(_list_query(user_id=user_id, status=status))).all())


async def list_memory_page(
    *,
    user_id: uuid.UUID,
    db: AsyncSession,
    status: MemoryStatus | None = None,
    cursor: str | None = None,
    limit: int = 50,
) -> MemoryPage:
    """返回一页记忆，并说明这一页的本地正文此刻能否读到。

    多取一行判断是否还有下一页，避免为了翻页额外做一次 COUNT。
    """

    query = _list_query(user_id=user_id, status=status)
    if cursor is not None:
        moment, identifier = _decode_cursor(cursor)
        # 与 (updated_at DESC, id DESC) 的排序对齐；写成 OR 而不是行值比较，
        # 是因为行值比较的绑定参数在 asyncpg 下需要显式类型标注。
        query = query.where(
            or_(
                Memory.updated_at < moment,
                and_(Memory.updated_at == moment, Memory.id < identifier),
            )
        )
    rows = list((await db.scalars(query.limit(limit + 1))).all())
    has_more = len(rows) > limit
    page = rows[:limit]
    return MemoryPage(
        items=[MemoryResponse.model_validate(memory) for memory in page],
        next_cursor=_encode_cursor(page[-1]) if has_more and page else None,
        local_unavailable=await _local_content_unreachable(user_id=user_id, page=page, db=db),
    )


async def _local_content_unreachable(
    *, user_id: uuid.UUID, page: list[Memory], db: AsyncSession
) -> bool:
    """判断这一页里是否有正文读不到的本地记忆。

    只有本页确实含 local_node 记忆时才查节点：云端记忆的正文一直都在，
    节点离线与否与它们无关，不该让整页都挂上"本地不可用"。
    """

    if not any(memory.storage_location is MemoryStorageLocation.local_node for memory in page):
        return False
    return (await select_fresh_node(user_id=user_id, tool_name="memory.search", db=db)) is None


def _list_query(*, user_id: uuid.UUID, status: MemoryStatus | None) -> Select[tuple[Memory]]:
    """构造按更新时间倒序、以 id 兜底的记忆列表查询。

    id 兜底不只是为了稳定展示顺序：同一毫秒写入的多条记忆若顺序不定，游标分页会漏行或重复。
    """

    query = (
        select(Memory)
        .where(Memory.user_id == user_id)
        .order_by(Memory.updated_at.desc(), Memory.id.desc())
    )
    if status is not None:
        query = query.where(Memory.status == status)
    return query


def _encode_cursor(memory: Memory) -> str:
    """把一行的排序键编码成不透明游标。"""

    raw = f"{memory.updated_at.isoformat()}{_CURSOR_SEPARATOR}{memory.id}"
    return base64.urlsafe_b64encode(raw.encode()).decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """解析客户端回传的游标；任何畸形输入都按策略错误拒绝。"""

    try:
        moment, _, identifier = (
            base64.urlsafe_b64decode(cursor.encode()).decode().partition(_CURSOR_SEPARATOR)
        )
        return datetime.fromisoformat(moment), uuid.UUID(identifier)
    except ValueError as error:  # binascii.Error 与 UnicodeDecodeError 都是它的子类
        raise MemoryPolicyError("分页游标无效") from error


async def delete_memory(*, memory_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> None:
    """在当前事务中删除内容、embedding、搜索记录和派生关系。"""

    memory = await _owned_memory(memory_id=memory_id, user_id=user_id, db=db)
    if memory.storage_location is MemoryStorageLocation.local_node:
        # 先让节点删掉正文：节点拒绝时整次删除失败，好过把正文永久遗留在用户磁盘上。
        await drop_local_memory(memory=memory, db=db)
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
