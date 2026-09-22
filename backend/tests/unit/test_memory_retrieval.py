"""混合检索的融合、重排与召回边界测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.assistant import Assistant
from app.models.memory import Memory, MemorySensitivity, MemoryStatus, MemoryType
from app.models.user import User
from app.services.memory_retrieval import (
    RRF_K,
    apply_rule_rerank,
    fuse_rankings,
    search_active_memories,
)


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
