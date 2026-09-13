"""自动化时间规则和幂等键单元测试。"""

import uuid
from datetime import UTC, datetime

import pytest

from app.services.automation_service import (
    AutomationValidationError,
    next_cron_occurrence,
    occurrence_key,
)


def test_next_cron_occurrence_resolves_dst_fall_back_deterministically() -> None:
    """重复的本地时刻按两个真实 UTC 时刻依次执行。"""

    first = next_cron_occurrence(
        "30 2 * * *", datetime(2026, 10, 24, 23, tzinfo=UTC), "Europe/Berlin"
    )
    second = next_cron_occurrence("30 2 * * *", first, "Europe/Berlin")
    assert first.isoformat() == "2026-10-25T00:30:00+00:00"
    assert second.isoformat() == "2026-10-25T01:30:00+00:00"


def test_next_cron_occurrence_skips_nonexistent_dst_time() -> None:
    """春季跳时不存在的本地时刻不会被错误映射。"""

    result = next_cron_occurrence(
        "30 2 * * *", datetime(2026, 3, 28, 23, tzinfo=UTC), "Europe/Berlin"
    )
    assert result.isoformat() == "2026-03-30T00:30:00+00:00"


def test_invalid_cron_and_timezone_fail_closed() -> None:
    """无效规则和未知时区都必须拒绝。"""

    with pytest.raises(AutomationValidationError):
        next_cron_occurrence("60 * * * *", datetime.now(UTC), "UTC")
    with pytest.raises(AutomationValidationError):
        next_cron_occurrence("* * * * *", datetime.now(UTC), "Mars/Olympus")


def test_occurrence_key_is_stable() -> None:
    """同一瞬时触发得到相同的 Agent 幂等键。"""

    automation_id = uuid.uuid4()
    scheduled = datetime(2026, 1, 1, tzinfo=UTC)
    assert occurrence_key(automation_id, scheduled) == occurrence_key(
        automation_id, scheduled.replace(microsecond=123)
    )
