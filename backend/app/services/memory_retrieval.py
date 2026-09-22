"""Memory 的租户隔离检索与上下文表示。"""

from __future__ import annotations

import math
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import (
    Memory,
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
)
from app.schemas.memory import MemoryContextItem, MemorySearchResult

_TOKEN_PATTERN = re.compile(r"[\w\u4e00-\u9fff]+", re.UNICODE)


async def search_active_memories(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    db: AsyncSession,
    workspace_id: uuid.UUID | None = None,
    query_embedding: Sequence[float] | None = None,
    limit: int = 8,
    now: datetime | None = None,
) -> list[MemorySearchResult]:
    """先过滤可访问 active 记忆，再融合关键词和向量分数。"""

    if limit < 1:
        return []
    current_time = now or datetime.now(UTC)
    filters = [
        Memory.user_id == user_id,
        Memory.assistant_id == assistant_id,
        Memory.status == MemoryStatus.active,
        Memory.sensitivity.not_in((MemorySensitivity.sensitive, MemorySensitivity.restricted)),
        (Memory.valid_from.is_(None) | (Memory.valid_from <= current_time)),
        (Memory.valid_until.is_(None) | (Memory.valid_until > current_time)),
        Memory.storage_location == MemoryStorageLocation.cloud,
    ]
    if workspace_id is not None:
        filters.append(or_(Memory.workspace_id == workspace_id, Memory.workspace_id.is_(None)))
    else:
        filters.append(Memory.workspace_id.is_(None))
    fts_query = func.plainto_tsquery("simple", query)
    fts_match = Memory.search_vector.op("@@")(fts_query)
    candidate_query = select(Memory).where(*filters)
    if query_embedding is None:
        candidate_query = candidate_query.where(or_(fts_match, Memory.content.ilike(f"%{query}%")))
    # ponytail: in-process JSON-vector ranking; migrate to pgvector ANN/RRF as corpus grows.
    candidates = list((await db.scalars(candidate_query)).all())
    terms = _terms(query)
    scored = [(_score(memory, terms, query_embedding), memory) for memory in candidates]
    ranked = sorted(
        (item for item in scored if item[0] > 0), key=lambda item: item[0], reverse=True
    )[:limit]
    for _, memory in ranked:
        memory.last_used_at = current_time
    await db.flush()
    return [
        MemorySearchResult(
            id=memory.id,
            assistant_id=memory.assistant_id,
            workspace_id=memory.workspace_id,
            memory_type=memory.memory_type,
            content=memory.content,
            source_type=memory.source_type,
            source_id=memory.source_id,
            source_excerpt=memory.source_excerpt,
            confidence=memory.confidence,
            sensitivity=memory.sensitivity,
            status=memory.status,
            score=score,
        )
        for score, memory in ranked
    ]


def to_context_items(results: Sequence[MemorySearchResult]) -> list[MemoryContextItem]:
    """将检索结果转换为明确标注不可信的上下文数据。"""

    return [
        MemoryContextItem(
            id=result.id,
            content=result.content,
            source_type=result.source_type,
            source_id=result.source_id,
            confidence=result.confidence,
        )
        for result in results
    ]


def _score(memory: Memory, terms: set[str], query_embedding: Sequence[float] | None) -> float:
    """合并关键词重叠和可用 embedding 的无状态分数。"""

    content_terms = _terms(memory.content)
    keyword_score = len(terms & content_terms) / max(len(terms), 1)
    vector_score = _cosine_similarity(query_embedding, memory.embedding)
    return (keyword_score + vector_score) / 2 if vector_score is not None else keyword_score


def _terms(value: str) -> set[str]:
    """保留词语并拆分中文字符，避免无空格文本无法命中关键词。"""

    words = set(_TOKEN_PATTERN.findall(value.lower()))
    return words | {
        character for word in words for character in word if "\u4e00" <= character <= "\u9fff"
    }


def _cosine_similarity(left: Sequence[float] | None, right: Sequence[float] | None) -> float | None:
    """计算同维向量的余弦相似度，异常数据不参与语义排序。"""

    if left is None or right is None or len(left) != len(right) or not left:
        return None
    numerator = sum(a * b for a, b in zip(left, right, strict=True))
    denominator = math.sqrt(sum(a * a for a in left)) * math.sqrt(sum(b * b for b in right))
    return numerator / denominator if denominator else None
