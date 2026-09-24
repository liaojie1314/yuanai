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

# RRF 的 k 决定名次的影响力。召回窗口只有 limit*_RECALL_MULTIPLIER（20~32）条，
# k=60 时首名与末名只差 80/61≈1.31 倍，相邻名次只差 1.6%，
# 而下面规则重排的乘子跨度是 1.15/0.27≈4.26 倍 —— 名次会被规则整个淹没，
# 最终序等于 confidence×type_weight，召回名次沦为噪声。
# k=5 把名次跨度抬到 25/6≈4.17 倍，与规则乘子同量级：
# 规则仍能把垫底召回抬过榜首（0.040×1.15 > 0.1667×0.27），但翻不了十几个名次。
RRF_K = 5
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


def accessible_filters(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    current_time: datetime,
    storage_location: MemoryStorageLocation = MemoryStorageLocation.cloud,
) -> list[ColumnElement[bool]]:
    """构造租户、助理、生命周期与时效的 SQL 过滤条件。

    权限过滤必须下推到 SQL：先跨租户召回再在应用层过滤是被明确禁止的。
    ``storage_location`` 决定这组条件针对云端正文还是只存节点的记忆元数据。
    """

    filters: list[ColumnElement[bool]] = [
        Memory.user_id == user_id,
        Memory.assistant_id == assistant_id,
        Memory.status == MemoryStatus.active,
        Memory.sensitivity.not_in((MemorySensitivity.sensitive, MemorySensitivity.restricted)),
        Memory.valid_from.is_(None) | (Memory.valid_from <= current_time),
        Memory.valid_until.is_(None) | (Memory.valid_until > current_time),
        Memory.storage_location == storage_location,
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
    """合并云端混合检索与桌面节点上的本地记忆，返回可进入上下文的记忆。

    只有当该助理下确实存在 local_node 记忆时才会访问节点：没有本地记忆的用户
    不该为一次云端检索付出节点往返的代价。
    """

    if limit < 1:
        return MemorySearchOutcome(results=[], local_unavailable=False)
    current_time = now or datetime.now(UTC)
    cloud_results = await _cloud_results(
        user_id=user_id,
        assistant_id=assistant_id,
        query=query,
        db=db,
        workspace_id=workspace_id,
        query_embedding=query_embedding,
        limit=limit,
        current_time=current_time,
    )
    local_results, local_unavailable = await _local_results(
        user_id=user_id,
        assistant_id=assistant_id,
        query=query,
        db=db,
        workspace_id=workspace_id,
        limit=limit,
        current_time=current_time,
    )
    if not local_results:
        return MemorySearchOutcome(results=cloud_results, local_unavailable=local_unavailable)
    # ponytail: 两路分数量纲不同（云端是 RRF 重排分，节点是它自己的相关度），
    # 直接同表排序只是可用的近似；要真正融合需要把节点也纳入 RRF 的名次口径。
    merged = sorted(cloud_results + local_results, key=lambda result: (-result.score, result.id))
    return MemorySearchOutcome(results=merged[:limit], local_unavailable=local_unavailable)


async def _local_results(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    db: AsyncSession,
    workspace_id: uuid.UUID | None,
    limit: int,
    current_time: datetime,
) -> tuple[list[MemorySearchResult], bool]:
    """有本地记忆时才向节点发起检索，否则跳过并报告「可用」。"""

    normalized = query.strip()
    if not normalized:
        return [], False
    has_local = await db.scalar(
        select(Memory.id)
        .where(
            *accessible_filters(
                user_id=user_id,
                assistant_id=assistant_id,
                workspace_id=workspace_id,
                current_time=current_time,
                storage_location=MemoryStorageLocation.local_node,
            )
        )
        .limit(1)
    )
    if has_local is None:
        return [], False
    # 延迟导入：memory_node 需要本模块的 accessible_filters，模块级互相导入会成环。
    from app.services.memory_node import search_local_memories

    return await search_local_memories(
        user_id=user_id,
        assistant_id=assistant_id,
        query=normalized,
        limit=limit,
        db=db,
        workspace_id=workspace_id,
    )


async def _cloud_results(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    query: str,
    db: AsyncSession,
    workspace_id: uuid.UUID | None,
    query_embedding: Sequence[float] | None,
    limit: int,
    current_time: datetime,
) -> list[MemorySearchResult]:
    """先过滤后召回，融合关键词与向量两路并重排，返回云端正文的检索结果。

    查询为空白时关键词臂整个跳过：空白子串会匹配全部记忆，那不是检索而是全表扫描。
    """

    filters = accessible_filters(
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
        return []
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
    return [
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
