"""Memory 的租户隔离检索与上下文表示。"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import ColumnElement, Connection, Table, event, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory import (
    Memory,
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
    MemoryType,
)
from app.schemas.memory import MemoryContextItem, MemorySearchOutcome, MemorySearchResult

RRF_K = 60
_RECALL_MULTIPLIER = 4
_HALF_LIFE_DAYS = 90.0
_TYPE_WEIGHTS: dict[MemoryType, float] = {
    MemoryType.profile: 1.15,
    MemoryType.preference: 1.10,
    MemoryType.semantic: 1.0,
    MemoryType.episodic: 0.9,
}

# 关键词臂依赖 pg_trgm 的 word_similarity 排序。迁移会装这个扩展，
# 但用 Base.metadata.create_all 建库的路径（测试库）拿不到迁移，
# 所以把扩展挂到建表事件上，两条路径都能用到。
def _ensure_trgm_extension(target: Table, connection: Connection, **kw: object) -> None:
    """建 memories 表之前确保 pg_trgm 已安装。"""

    if connection.dialect.name == "postgresql":
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))


event.listen(Memory.__table__, "before_create", _ensure_trgm_extension)


def _accessible_filters(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    current_time: datetime,
) -> list[ColumnElement[bool]]:
    """构造租户、助理、生命周期与时效的 SQL 过滤条件。

    权限过滤必须下推到 SQL：先跨租户召回再在应用层过滤是被明确禁止的。
    """

    filters: list[ColumnElement[bool]] = [
        Memory.user_id == user_id,
        Memory.assistant_id == assistant_id,
        Memory.status == MemoryStatus.active,
        Memory.sensitivity.not_in((MemorySensitivity.sensitive, MemorySensitivity.restricted)),
        Memory.valid_from.is_(None) | (Memory.valid_from <= current_time),
        Memory.valid_until.is_(None) | (Memory.valid_until > current_time),
        Memory.storage_location == MemoryStorageLocation.cloud,
    ]
    if workspace_id is not None:
        filters.append(or_(Memory.workspace_id == workspace_id, Memory.workspace_id.is_(None)))
    else:
        filters.append(Memory.workspace_id.is_(None))
    return filters


def fuse_rankings(*ranked_id_lists: Sequence[uuid.UUID], k: int = RRF_K) -> dict[uuid.UUID, float]:
    """按 Reciprocal Rank Fusion 合并多路召回的排名。

    RRF 只消费名次，因此关键词分数与向量距离这两种不可比的量纲永远不会混算。
    """

    fused: dict[uuid.UUID, float] = {}
    for ranked in ranked_id_lists:
        for rank, identifier in enumerate(ranked, start=1):
            fused[identifier] = fused.get(identifier, 0.0) + 1.0 / (k + rank)
    return fused


def apply_rule_rerank(
    scored: Sequence[tuple[float, Memory]], *, now: datetime
) -> list[tuple[float, Memory]]:
    """用置信度、新鲜度和记忆类型做确定性重排。

    阶段文档禁止只按 embedding 距离排序；规则重排在不引入第二次模型调用的前提下满足该要求。
    分数并列很常见（候选记忆的 confidence 默认 0.0），因此以 id 兜底，保证顺序可复现。
    """

    adjusted: list[tuple[float, Memory]] = []
    for score, memory in scored:
        reference = memory.last_used_at or memory.created_at
        age_days = max((now - reference).total_seconds() / 86400.0, 0.0) if reference else 0.0
        recency = 0.5 ** (age_days / _HALF_LIFE_DAYS)
        confidence = 0.5 + 0.5 * max(0.0, min(1.0, memory.confidence))
        weight = _TYPE_WEIGHTS.get(memory.memory_type, 1.0)
        adjusted.append((score * confidence * weight * (0.6 + 0.4 * recency), memory))
    return sorted(adjusted, key=lambda item: (-item[0], item[1].id))


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
) -> MemorySearchOutcome:
    """先过滤后召回，融合关键词与向量两路并重排，返回可进入上下文的记忆。

    查询为空白时关键词臂整个跳过：空白子串会匹配全部记忆，那不是检索而是全表扫描。
    """

    if limit < 1:
        return MemorySearchOutcome(results=[], local_unavailable=False)
    current_time = now or datetime.now(UTC)
    filters = _accessible_filters(
        user_id=user_id,
        assistant_id=assistant_id,
        workspace_id=workspace_id,
        current_time=current_time,
    )
    recall = limit * _RECALL_MULTIPLIER

    keyword_ids: list[uuid.UUID] = []
    normalized = query.strip()
    if normalized:
        fts_query = func.plainto_tsquery("simple", normalized)
        # LIKE 通配符必须转义：查询 "%" 原样拼进 pattern 会命中全部记忆，
        # 并把这些记忆的 last_used_at 全部刷新，等于一次查询污染整个租户的新鲜度。
        escaped = normalized.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        # simple 配置不切分中文，整句只得到一个词元，中文查询实际全靠 ILIKE 子串匹配，
        # 而 ts_rank 对中文恒为 0，排序会塌成 updated_at：召回预过滤等于「只留最近更新的，
        # 其余静默丢弃」。改用 pg_trgm 的 word_similarity 给出真实相关度，
        # 同一个三元组 GIN 索引也让子串匹配从顺序扫描变成索引扫描。
        # ponytail: 三元组是字符三连而不是词，两字中文查询（如「中文」）只能靠补白三元组匹配，
        # 既吃不到索引、相关度也恒为 0，召回仍弱于真正的分词；
        # 升级路径是换成带中文分词的文本检索配置（zhparser / pg_jieba）。
        relevance = func.word_similarity(normalized, func.coalesce(Memory.content, ""))
        keyword_rows = await db.execute(
            select(Memory.id)
            .where(
                *filters,
                or_(
                    Memory.search_vector.op("@@")(fts_query),
                    Memory.content.ilike(f"%{escaped}%", escape="\\"),
                ),
            )
            .order_by(relevance.desc(), Memory.updated_at.desc(), Memory.id)
            .limit(recall)
        )
        keyword_ids = [row[0] for row in keyword_rows]

    vector_ids: list[uuid.UUID] = []
    if query_embedding is not None:
        vector_rows = await db.execute(
            select(Memory.id)
            .where(*filters, Memory.embedding.is_not(None))
            .order_by(Memory.embedding.cosine_distance(list(query_embedding)))
            .limit(recall)
        )
        vector_ids = [row[0] for row in vector_rows]

    fused = fuse_rankings(keyword_ids, vector_ids)
    if not fused:
        return MemorySearchOutcome(results=[], local_unavailable=False)
    memories = {
        memory.id: memory
        for memory in (await db.scalars(select(Memory).where(Memory.id.in_(list(fused))))).all()
    }
    ranked = apply_rule_rerank(
        [
            (score, memories[identifier])
            for identifier, score in fused.items()
            if identifier in memories
        ],
        now=current_time,
    )[:limit]
    for _, memory in ranked:
        memory.last_used_at = current_time
    await db.flush()
    return MemorySearchOutcome(
        results=[
            MemorySearchResult(
                id=memory.id,
                assistant_id=memory.assistant_id,
                workspace_id=memory.workspace_id,
                memory_type=memory.memory_type,
                content=memory.content or "",
                source_type=memory.source_type,
                source_id=memory.source_id,
                source_excerpt=memory.source_excerpt,
                confidence=memory.confidence,
                sensitivity=memory.sensitivity,
                status=memory.status,
                score=score,
            )
            for score, memory in ranked
        ],
        local_unavailable=False,
    )


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
