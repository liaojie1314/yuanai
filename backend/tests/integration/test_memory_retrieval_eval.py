"""检索质量的回归闸门：召回、排序与引用准确率不得低于既定下限。"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import Memory, MemoryStatus, MemoryType
from app.models.user import User
from app.services.memory_retrieval import search_active_memories
from tests.support.memory_eval_corpus import (
    EVAL_MEMORIES,
    EVAL_QUERIES,
    EvalMemory,
    citation_accuracy,
    mean_reciprocal_rank,
    recall_at_k,
)

# 测量基准：CI 不注入任何 provider key，maybe_embed_text 恒返回 None，向量臂全程关闭。
# 因此本文件一律不传 query_embedding，结果与本机是否配置了 key 无关，只测关键词单路。
# 下列三个下限取自该模式下的首次实测（recall@5 0.80 / MRR 0.80 / 引用准确率 1.00）并向下取整。
# 它们是棘轮：向量臂接入后只能上调，下调必须在 docs/master-plan.md 记录原因。
RECALL_AT_5_FLOOR = 0.80
MRR_FLOOR = 0.80
CITATION_FLOOR = 1.0


def _memory_row(entry: EvalMemory, *, user_id: uuid.UUID, assistant_id: uuid.UUID) -> Memory:
    """把一条评测语料落成 active 记忆，来源字段齐备以便校验引用可解析。"""

    return Memory(
        id=entry.memory_id,
        user_id=user_id,
        assistant_id=assistant_id,
        memory_type=entry.memory_type,
        content=entry.content,
        structured_data={"subject": entry.subject} if entry.subject else None,
        source_type="run",
        source_id=f"run-{entry.key}",
        source_excerpt=entry.content,
        confidence=entry.confidence,
        status=MemoryStatus.active,
    )


async def _seed_corpus(db: AsyncSession, user: User) -> tuple[Assistant, dict[uuid.UUID, str]]:
    """写入固定语料，返回归属助理与 id 到语料 key 的反查表。"""

    assistant = Assistant(user_id=user.id, name="评测助理", default_model="test-model")
    db.add(assistant)
    await db.flush()
    db.add_all(
        [_memory_row(entry, user_id=user.id, assistant_id=assistant.id) for entry in EVAL_MEMORIES]
    )
    await db.flush()
    return assistant, {entry.memory_id: entry.key for entry in EVAL_MEMORIES}


@pytest.mark.asyncio
async def test_corpus_covers_every_memory_type_and_enough_queries() -> None:
    """语料规模与类型覆盖是指标可信的前提，缩水必须显式失败。"""

    assert len(EVAL_MEMORIES) >= 30
    assert len(EVAL_QUERIES) >= 15
    assert {entry.memory_type for entry in EVAL_MEMORIES} == set(MemoryType)
    keys = {entry.key for entry in EVAL_MEMORIES}
    assert len(keys) == len(EVAL_MEMORIES)
    for query in EVAL_QUERIES:
        assert query.relevant_ids <= keys


@pytest.mark.asyncio
async def test_retrieval_meets_the_recall_and_ranking_floors(
    db: AsyncSession, test_user: User
) -> None:
    """检索质量不得低于既定下限，任何回退都要在 master-plan 里留痕。"""

    assistant, id_to_key = await _seed_corpus(db, test_user)
    recalls: list[float] = []
    rankings: list[list[bool]] = []
    for query in EVAL_QUERIES:
        outcome = await search_active_memories(
            user_id=test_user.id,
            assistant_id=assistant.id,
            query=query.text,
            db=db,
            limit=5,
        )
        ranked = [id_to_key[result.id] for result in outcome.results]
        recalls.append(recall_at_k(ranked, query.relevant_ids, k=5))
        rankings.append([key in query.relevant_ids for key in ranked])
    assert sum(recalls) / len(recalls) >= RECALL_AT_5_FLOOR
    assert mean_reciprocal_rank(rankings) >= MRR_FLOOR


@pytest.mark.asyncio
async def test_distractors_never_outrank_the_annotated_answers(
    db: AsyncSession, test_user: User
) -> None:
    """规则重排必须把低置信度的同话题干扰项压到标准答案之后。"""

    assistant, id_to_key = await _seed_corpus(db, test_user)
    by_key = {entry.key: entry for entry in EVAL_MEMORIES}
    for query in EVAL_QUERIES:
        outcome = await search_active_memories(
            user_id=test_user.id,
            assistant_id=assistant.id,
            query=query.text,
            db=db,
            limit=5,
        )
        ranked = [id_to_key[result.id] for result in outcome.results]
        confidences = [by_key[key].confidence for key in ranked]
        assert confidences == sorted(confidences, reverse=True), query.text


@pytest.mark.asyncio
async def test_every_result_carries_a_resolvable_source(db: AsyncSession, test_user: User) -> None:
    """引用准确率必须是 1.0：结果必须能回到原文位置。"""

    assistant, _ = await _seed_corpus(db, test_user)
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="评审会议", db=db, limit=5
    )
    assert outcome.results
    assert citation_accuracy(outcome.results) == CITATION_FLOOR
