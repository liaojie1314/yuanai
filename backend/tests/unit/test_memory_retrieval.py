"""混合检索的融合、重排与召回边界测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.assistant import Assistant
from app.models.memory import (
    EMBEDDING_DIMENSIONS,
    Memory,
    MemorySensitivity,
    MemoryStatus,
    MemoryType,
)
from app.models.user import User
from app.services.memory_retrieval import (
    _RECALL_MULTIPLIER,
    _TYPE_WEIGHTS,
    RRF_K,
    apply_rule_rerank,
    fuse_rankings,
    search_active_memories,
)


def _embedding(*leading: float) -> list[float]:
    """构造只有前几维有值的向量，便于人工推算余弦距离的先后顺序。"""

    return [*leading, *([0.0] * (EMBEDDING_DIMENSIONS - len(leading)))]


def _memory(assistant_id, user_id, **overrides) -> Memory:
    """构造一条 active 记忆，只保留测试关心的字段。"""

    fields: dict[str, object] = {
        "user_id": user_id,
        "assistant_id": assistant_id,
        "memory_type": MemoryType.semantic,
        "source_type": "run",
        "status": MemoryStatus.active,
    }
    fields.update(overrides)
    return Memory(**fields)


def test_fuse_rankings_rewards_agreement_between_arms() -> None:
    """两路都排在前面的文档必须压过只有单路命中的文档。"""

    both = uuid.uuid4()
    keyword_only = uuid.uuid4()
    vector_only = uuid.uuid4()
    fused = fuse_rankings([both, keyword_only], [both, vector_only])
    assert fused[both] == pytest.approx(2 / (RRF_K + 1))
    assert fused[both] > fused[keyword_only]
    assert fused[keyword_only] == pytest.approx(1 / (RRF_K + 2))


def test_fuse_rankings_ignores_an_empty_arm() -> None:
    """没有 embedding 时向量臂为空，融合结果等价于纯关键词排序。"""

    first, second = uuid.uuid4(), uuid.uuid4()
    fused = fuse_rankings([first, second], [])
    assert fused[first] > fused[second]


def test_rank_spread_stays_comparable_to_the_rule_spread() -> None:
    """名次跨度必须与规则乘子跨度同量级，否则混合排序会塌成单因子排序。

    k 取得太大时召回名次的全部跨度还不到规则乘子跨度的零头，名次就成了噪声；
    取得太小则确定性规则再也翻不动任何名次。两者比值守在 0.5~2 之间。
    """

    window = 5 * _RECALL_MULTIPLIER
    rank_spread = (RRF_K + window) / (RRF_K + 1)
    # 规则乘子 = confidence(0.5~1.0) × type 权重 × recency(0.6~1.0)
    rule_spread = max(_TYPE_WEIGHTS.values()) / (0.5 * min(_TYPE_WEIGHTS.values()) * 0.6)
    assert 0.5 <= rank_spread / rule_spread <= 2.0, f"{rank_spread=} {rule_spread=}"


def test_rule_rerank_prefers_confident_and_recently_used_memories() -> None:
    """同样的融合分下，置信度高且近期用过的记忆排在前面。"""

    now = datetime.now(UTC)
    stale = Memory(
        id=uuid.uuid4(),
        memory_type=MemoryType.preference,
        content="旧偏好",
        source_type="run",
        confidence=0.2,
        last_used_at=now - timedelta(days=200),
        created_at=now - timedelta(days=200),
    )
    fresh = Memory(
        id=uuid.uuid4(),
        memory_type=MemoryType.profile,
        content="新身份事实",
        source_type="run",
        confidence=0.9,
        last_used_at=now - timedelta(hours=1),
        created_at=now - timedelta(hours=1),
    )
    ranked = apply_rule_rerank([(0.5, stale), (0.5, fresh)], now=now)
    assert [memory.id for _, memory in ranked] == [fresh.id, stale.id]


def test_rule_rerank_breaks_score_ties_by_id() -> None:
    """分数完全并列时按 id 定序，避免召回顺序把随机性带进最终结果。"""

    now = datetime.now(UTC)
    first = Memory(
        id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
        memory_type=MemoryType.semantic,
        content="记忆内容A",
        source_type="run",
        confidence=0.0,
        created_at=now,
    )
    second = Memory(
        id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
        memory_type=MemoryType.semantic,
        content="记忆内容B",
        source_type="run",
        confidence=0.0,
        created_at=now,
    )
    forward = apply_rule_rerank([(0.5, first), (0.5, second)], now=now)
    backward = apply_rule_rerank([(0.5, second), (0.5, first)], now=now)
    assert [memory.id for _, memory in forward] == [first.id, second.id]
    assert [memory.id for _, memory in backward] == [first.id, second.id]


@pytest.mark.asyncio
async def test_search_filters_sensitive_and_foreign_memories_in_sql(db, test_user: User) -> None:
    """敏感记忆和其他助理的记忆不得进入召回集合。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    other = Assistant(user_id=test_user.id, name="另一个", default_model="test-model")
    db.add_all([assistant, other])
    await db.flush()
    db.add_all(
        [
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="用户偏好中文输出",
                source_type="run",
                status=MemoryStatus.active,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.profile,
                content="用户的中文护照号",
                source_type="run",
                status=MemoryStatus.active,
                sensitivity=MemorySensitivity.sensitive,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=other.id,
                memory_type=MemoryType.preference,
                content="中文",
                source_type="run",
                status=MemoryStatus.active,
            ),
        ]
    )
    await db.flush()
    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="中文", db=db
    )
    assert [result.content for result in outcome.results] == ["用户偏好中文输出"]
    assert outcome.local_unavailable is False


@pytest.mark.asyncio
async def test_vector_arm_recalls_memories_the_keyword_arm_misses(db, test_user: User) -> None:
    """向量臂必须真的落到 SQL：字面毫不相关、但 embedding 相近的记忆要被召回并排在前面。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    near = _memory(
        assistant.id, test_user.id, content="记忆内容A", embedding=_embedding(1.0, 0.0, 0.0)
    )
    far = _memory(
        assistant.id, test_user.id, content="记忆内容B", embedding=_embedding(0.0, 1.0, 0.0)
    )
    without_embedding = _memory(assistant.id, test_user.id, content="记忆内容C")
    db.add_all([near, far, without_embedding])
    await db.flush()

    outcome = await search_active_memories(
        user_id=test_user.id,
        assistant_id=assistant.id,
        query="测试主体1",
        query_embedding=_embedding(1.0, 0.1, 0.0),
        db=db,
    )
    # 关键词臂对这条查询必然为空，结果完全来自向量臂；没有 embedding 的记忆被 SQL 过滤掉
    assert [result.content for result in outcome.results] == ["记忆内容A", "记忆内容B"]


@pytest.mark.asyncio
async def test_wildcard_query_matches_only_its_literal_text(db, test_user: User) -> None:
    """查询里的 LIKE 通配符必须按字面处理，否则 "%" 会召回并刷新全部记忆。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    plain = _memory(assistant.id, test_user.id, content="记忆内容A")
    literal = _memory(assistant.id, test_user.id, content="折扣 100% 已生效")
    db.add_all([plain, literal])
    await db.flush()

    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="%", db=db
    )
    assert [result.content for result in outcome.results] == ["折扣 100% 已生效"]
    assert plain.last_used_at is None


@pytest.mark.asyncio
async def test_blank_query_recalls_nothing(db, test_user: User) -> None:
    """空白查询不得退化成全表扫描。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    memory = _memory(assistant.id, test_user.id, content="记忆内容A")
    db.add(memory)
    await db.flush()

    outcome = await search_active_memories(
        user_id=test_user.id, assistant_id=assistant.id, query="   ", db=db
    )
    assert outcome.results == []
    assert memory.last_used_at is None
