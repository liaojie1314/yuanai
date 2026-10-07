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
# 下列三个下限是在 pg_trgm 相关度排序与 RRF_K 重新配平之后重测的：连续三次均为
# recall@5 0.800000 / MRR 0.800000 / 引用准确率 1.00，取实测值向下取整。
# 0.80 是本语料在关键词单路下的天花板：20 条查询里有 4 条与标准答案没有任何字面重合
# （靠语义关联），关键词臂必然召回为空；其余 16 条全部首位命中，16/20 = 0.80。
# 它们是棘轮：向量臂接入 CI 或语料补充字面查询后只能上调，
# 下调必须在 docs/master-plan.md 记录原因。
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
    average_recall = sum(recalls) / len(recalls)
    mrr = mean_reciprocal_rank(rankings)
    # 失败时直接给出实测值，省去重跑一遍才知道掉到了多少
    assert average_recall >= RECALL_AT_5_FLOOR, f"recall@5={average_recall:.6f}"
    assert mrr >= MRR_FLOOR, f"MRR={mrr:.6f}"


@pytest.mark.asyncio
async def test_distractors_never_outrank_the_annotated_answers(
    db: AsyncSession, test_user: User
) -> None:
    """规则重排必须把低置信度的同话题干扰项压到标准答案之后。

    只断言结果按置信度递减是同义反复：语料里只有 0.98 与 0.10 两档，
    而重排公式本身就含置信度因子，返回五条毫不相关的记忆也能通过。
    这里改为直接检查名次：命中的标准答案必须整体排在非答案之前。
    """

    assistant, id_to_key = await _seed_corpus(db, test_user)
    for query in EVAL_QUERIES:
        outcome = await search_active_memories(
            user_id=test_user.id,
            assistant_id=assistant.id,
            query=query.text,
            db=db,
            limit=5,
        )
        ranked = [id_to_key[result.id] for result in outcome.results]
        hits = [index for index, key in enumerate(ranked) if key in query.relevant_ids]
        misses = [index for index, key in enumerate(ranked) if key not in query.relevant_ids]
        if not hits or not misses:
            continue
        assert max(hits) < min(misses), f"{query.text}: {ranked}"


@pytest.mark.asyncio
async def test_every_result_carries_a_resolvable_source(db: AsyncSession, test_user: User) -> None:
    """引用准确率必须是 1.0：结果必须能回到原文位置。"""

    assistant, id_to_key = await _seed_corpus(db, test_user)
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="评审会议", db=db, limit=5
    )
    assert outcome.results
    assert citation_accuracy(outcome.results) == CITATION_FLOOR
    # 非空还不够：来源 id 必须真的解析回它自己那条语料，否则指标只是在校验字段有没有填
    for result in outcome.results:
        assert result.source_id == f"run-{id_to_key[result.id]}"


@pytest.mark.asyncio
async def test_citation_accuracy_drops_when_a_memory_has_no_source(
    db: AsyncSession, test_user: User
) -> None:
    """闸门必须有失败的可能：source_id 在写入契约里是可选的，缺来源就该把指标拉下来。"""

    assistant, _ = await _seed_corpus(db, test_user)
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.episodic,
            content="评审会议的结论没有留下来源",
            source_type="run",
            source_id=None,
            confidence=1.0,
            status=MemoryStatus.active,
        )
    )
    await db.flush()
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="评审会议", db=db, limit=5
    )
    assert any(result.source_id is None for result in outcome.results)
    assert citation_accuracy(outcome.results) < CITATION_FLOOR
