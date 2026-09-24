"""把 storage_location=local_node 的记忆读写路由到用户的桌面节点。

正文只存在于节点磁盘上，云端只保留元数据行。节点不在线时，读取显式返回
「本地不可用」而不是把本地记忆当作不存在，写入与删除则直接失败 ——
静默改用云端副本等于把用户选择只存本地的内容复制到云上。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import Memory, MemoryStorageLocation
from app.schemas.memory import MemorySearchResult
from app.services.memory_retrieval import accessible_filters
from app.services.tool_runtime_service import run_node_job, select_fresh_node

MEMORY_NODE_TIMEOUT_SECONDS = 15
# 节点回传的正文是不可信输入，按与 MemoryCreateCandidate.content 相同的上限截断
_MAX_NODE_CONTENT_CHARS = 10_000


class LocalMemoryUnavailableError(Exception):
    """桌面节点不在线时写入或删除本地记忆的稳定错误。"""


async def search_local_memories(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    limit: int,
    db: AsyncSession,
    workspace_id: uuid.UUID | None = None,
) -> tuple[list[MemorySearchResult], bool]:
    """向在线节点请求本地记忆检索。

    第二个返回值为 ``True`` 表示本地记忆暂不可用（节点离线、超时或回包不可解析），
    调用方应当如实告知用户，而不是把本地记忆过滤掉当作不存在。
    """

    outcome = await run_node_job(
        user_id=user_id,
        tool_name="memory.search",
        arguments={"query": query, "limit": limit},
        db=db,
        timeout_seconds=MEMORY_NODE_TIMEOUT_SECONDS,
    )
    if outcome.status != "succeeded" or outcome.data is None:
        return [], True
    payload = outcome.data.get("memories")
    if not isinstance(payload, list):
        return [], True
    returned = _parse_node_hits(payload, limit=limit)
    if not returned:
        return [], False
    # 节点回包里的 id 同样不可信：只认这个租户、这个助理下真实存在的 local_node 记忆，
    # 敏感度与生命周期一律以云端元数据为准，节点无法借回包把受限记忆送进上下文。
    rows = await db.scalars(
        select(Memory).where(
            *accessible_filters(
                user_id=user_id,
                assistant_id=assistant_id,
                workspace_id=workspace_id,
                current_time=datetime.now(UTC),
                storage_location=MemoryStorageLocation.local_node,
            ),
            Memory.id.in_(list(returned)),
        )
    )
    results = [
        MemorySearchResult(
            id=memory.id,
            assistant_id=memory.assistant_id,
            workspace_id=memory.workspace_id,
            memory_type=memory.memory_type,
            content=returned[memory.id][0],
            source_type=memory.source_type,
            source_id=memory.source_id,
            source_excerpt=memory.source_excerpt,
            confidence=memory.confidence,
            sensitivity=memory.sensitivity,
            status=memory.status,
            score=returned[memory.id][1],
        )
        for memory in rows
    ]
    return sorted(results, key=lambda result: (-result.score, result.id)), False


async def push_local_memory(*, memory: Memory, content: str, db: AsyncSession) -> None:
    """把正文推送到节点并记录承载它的节点 id；节点不可用时抛错。"""

    node = await select_fresh_node(user_id=memory.user_id, tool_name="memory.write", db=db)
    if node is None:
        raise LocalMemoryUnavailableError("LOCAL_MEMORY_NODE_UNAVAILABLE")
    outcome = await run_node_job(
        user_id=memory.user_id,
        tool_name="memory.write",
        arguments={
            "memoryId": str(memory.id),
            "content": content[:_MAX_NODE_CONTENT_CHARS],
            "memoryType": str(memory.memory_type),
        },
        db=db,
        timeout_seconds=MEMORY_NODE_TIMEOUT_SECONDS,
    )
    if outcome.status != "succeeded":
        raise LocalMemoryUnavailableError(outcome.error_code or outcome.status)
    memory.node_id = node.id


async def drop_local_memory(*, memory: Memory, db: AsyncSession) -> None:
    """删除节点上的正文；节点拒绝或不可用时抛错，阻止云端先删掉元数据。"""

    outcome = await run_node_job(
        user_id=memory.user_id,
        tool_name="memory.delete",
        arguments={"memoryId": str(memory.id)},
        db=db,
        timeout_seconds=MEMORY_NODE_TIMEOUT_SECONDS,
    )
    if outcome.status != "succeeded":
        raise LocalMemoryUnavailableError(outcome.error_code or outcome.status)


def _parse_node_hits(payload: list[object], *, limit: int) -> dict[uuid.UUID, tuple[str, float]]:
    """解析节点回包中的命中项，丢弃任何形状不对的条目。"""

    hits: dict[uuid.UUID, tuple[str, float]] = {}
    for item in payload[:limit]:
        if not isinstance(item, dict):
            continue
        content = item.get("content")
        if not isinstance(content, str):
            continue
        try:
            identifier = uuid.UUID(str(item.get("id")))
        except ValueError:
            continue
        score = item.get("score")
        numeric = (
            float(score) if isinstance(score, (int, float)) and not isinstance(score, bool) else 0.0
        )
        hits[identifier] = (content[:_MAX_NODE_CONTENT_CHARS], numeric)
    return hits
