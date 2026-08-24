"""运行时指标的哈希与脱敏契约测试。"""

from __future__ import annotations

import logging
import uuid

from app.services.agent.metrics import AgentMetrics, hash_user_id


def test_hash_user_id_is_stable_and_does_not_equal_raw_identifier() -> None:
    user_id = uuid.uuid4()
    hashed = hash_user_id(user_id, salt="test-salt")
    assert hashed == hash_user_id(user_id, salt="test-salt")
    assert str(user_id) not in hashed
    assert len(hashed) == 64


def test_metrics_include_run_step_and_hashed_user_without_content(caplog) -> None:
    run_id = uuid.uuid4()
    step_id = uuid.uuid4()
    user_id = uuid.uuid4()
    metrics = AgentMetrics()
    with caplog.at_level(logging.INFO, logger="app.services.agent.metrics"):
        metric = metrics.record("tool_completed", run_id=run_id, step_id=step_id, user_id=user_id)

    assert metric["run_id"] == str(run_id)
    assert metric["step_id"] == str(step_id)
    assert metric["user_id_hash"] == hash_user_id(user_id)
    assert str(user_id) not in caplog.text
    assert "prompt" not in caplog.text.lower()
