"""记忆抽取的分级、去重、冲突与激活策略测试。

样本数据全部为明显合成的占位串：数字段一律为重复位，邮箱使用 RFC 2606 保留域名，
不得写入任何看起来真实的个人信息。
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import Memory, MemorySensitivity, MemoryStatus, MemoryType
from app.models.user import User
from app.services.ai_service import ExtractedMemory
from app.services.memory_extraction import (
    classify_sensitivity,
    decide_status,
    find_conflict,
    find_duplicate,
)


def _candidate(**overrides: object) -> ExtractedMemory:
    """构造一条默认满足全部自动激活条件的候选。"""

    values: dict[str, object] = {
        "memory_type": "preference",
        "content": "偏好靠窗座位",
        "subject": "座位偏好",
        "confidence": 0.9,
        "explicit": True,
        "stable": True,
    }
    values.update(overrides)
    return ExtractedMemory(**values)  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("content", "expected"),
    [
        ("偏好靠窗座位", MemorySensitivity.personal),
        ("证件号 00000000000000000X", MemorySensitivity.sensitive),
        ("卡号 0000000000000000", MemorySensitivity.sensitive),
        ("邮箱是 someone@example.com", MemorySensitivity.sensitive),
        ("联系号码 13000000000", MemorySensitivity.sensitive),
        ("登录密码写在便签上", MemorySensitivity.sensitive),
    ],
)
def test_classify_sensitivity_flags_personally_identifying_content(
    content: str, expected: MemorySensitivity
) -> None:
    """含证件号、卡号、邮箱、号码或凭据字样的内容必须升级为 sensitive。"""

    assert classify_sensitivity(content) is expected


def test_decide_status_auto_activates_only_when_every_condition_holds() -> None:
    """五个条件全部满足才自动激活。"""

    assert (
        decide_status(
            _candidate(),
            sensitivity=MemorySensitivity.personal,
            conflict=None,
            disabled_types=set(),
        )
        is MemoryStatus.active
    )


@pytest.mark.parametrize(
    ("candidate", "sensitivity", "conflict", "disabled"),
    [
        (_candidate(explicit=False), MemorySensitivity.personal, None, set()),
        (_candidate(stable=False), MemorySensitivity.personal, None, set()),
        (_candidate(), MemorySensitivity.sensitive, None, set()),
        (_candidate(), MemorySensitivity.restricted, None, set()),
        (_candidate(), MemorySensitivity.personal, Memory(id=uuid.uuid4()), set()),
    ],
)
def test_decide_status_falls_back_to_candidate_when_any_condition_fails(
    candidate: ExtractedMemory,
    sensitivity: MemorySensitivity,
    conflict: Memory | None,
    disabled: set[str],
) -> None:
    """任一条件不满足都只能进入 candidate，歧义一律不自动激活。"""

    status = decide_status(
        candidate, sensitivity=sensitivity, conflict=conflict, disabled_types=disabled
    )
    assert status is MemoryStatus.candidate


def test_decide_status_discards_a_disabled_type_that_cannot_even_be_reviewed() -> None:
    """用户关闭的记忆类型连候选都不产生。"""

    assert (
        decide_status(
            _candidate(memory_type="episodic"),
            sensitivity=MemorySensitivity.personal,
            conflict=None,
            disabled_types={"episodic"},
        )
        is None
    )


@pytest.mark.asyncio
async def test_find_duplicate_matches_normalized_content(db: AsyncSession, test_user: User) -> None:
    """标点和空白差异不应产生重复记忆。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    db.add(
        Memory(
            user_id=test_user.id,
            assistant_id=assistant.id,
            memory_type=MemoryType.preference,
            content="偏好靠窗座位",
            source_type="run",
            status=MemoryStatus.active,
        )
    )
    await db.flush()
    found = await find_duplicate(
        user_id=test_user.id, assistant_id=assistant.id, content=" 偏好靠窗座位。 ", db=db
    )
    assert found is not None


@pytest.mark.asyncio
async def test_find_conflict_only_looks_at_active_memories_on_the_same_subject(
    db: AsyncSession, test_user: User
) -> None:
    """冲突检测按 subject 匹配，且只与 active 记忆比较。"""

    assistant = Assistant(user_id=test_user.id, name="记忆", default_model="test-model")
    db.add(assistant)
    await db.flush()
    db.add_all(
        [
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="偏好过道座位",
                structured_data={"subject": "座位偏好"},
                source_type="run",
                status=MemoryStatus.active,
            ),
            Memory(
                user_id=test_user.id,
                assistant_id=assistant.id,
                memory_type=MemoryType.preference,
                content="偏好前排座位",
                structured_data={"subject": "座位偏好"},
                source_type="run",
                status=MemoryStatus.rejected,
            ),
        ]
    )
    await db.flush()
    conflict = await find_conflict(
        user_id=test_user.id, assistant_id=assistant.id, subject="座位偏好", db=db
    )
    assert conflict is not None
    assert conflict.content == "偏好过道座位"
