"""运行时指标的哈希脱敏契约，以及 Phase 5 §14 的 8 个具名指标与 /metrics 渲染。"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncGenerator
from datetime import UTC, datetime, timedelta

import pytest

from app.core.metrics import Counter, Histogram, render_metrics
from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind
from app.models.approval import ApprovalRiskLevel
from app.services.agent.approval_service import ApprovalService
from app.services.agent.coordinator import AgentCoordinator, ModelStream
from app.services.agent.metrics import AgentMetrics, hash_user_id
from app.services.ai_service import (
    ContentDelta,
    ModelCompleted,
    ModelEvent,
    ToolCallArgumentsDelta,
    ToolCallEnd,
    ToolCallStart,
    UsageDelta,
)
from app.tools.contracts import ToolRisk, ToolSpec
from app.tools.registry import ToolRegistry

PHASE5_METRIC_NAMES = (
    "agent_runs_total",
    "agent_run_duration_seconds",
    "agent_steps_per_run",
    "agent_tool_calls_total",
    "agent_approval_wait_seconds",
    "agent_recovery_total",
    "agent_tokens_total",
    "agent_estimated_cost_usd",
)


def metric_value(series: str) -> float:
    """从当前渲染结果里读取一条序列的值；未出现过的序列按 0 处理。

    指标是进程级全局状态，整套测试共享，因此断言必须比较调用前后的差值。
    """

    for line in render_metrics().splitlines():
        if line.startswith("#"):
            continue
        name, _, value = line.rpartition(" ")
        if name == series:
            return float(value)
    return 0.0


def _tool_registry() -> ToolRegistry:
    """构造一个无副作用的测试工具注册表。"""

    registry = ToolRegistry()
    registry.register(
        ToolSpec(
            name="echo",
            description="返回输入文本",
            input_schema={
                "type": "object",
                "properties": {"text": {"type": "string"}},
                "required": ["text"],
                "additionalProperties": False,
            },
            risk_level=ToolRisk.read,
            execution_location="cloud",
            timeout_seconds=30,
        ),
        lambda args, _context: {"echo": args["text"]},
    )
    return registry


def _scripted_model(rounds: list[list[ModelEvent]]) -> ModelStream:
    """返回按轮次吐出 provider-neutral 事件的模型流替身。"""

    async def stream(
        _model: str,
        _messages: list[dict[str, object]],
        _tools: list[dict[str, object]],
        *,
        enable_thinking: bool = False,
    ) -> AsyncGenerator[ModelEvent, None]:
        del enable_thinking
        for event in rounds.pop(0):
            yield event

    return stream


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


def test_counter_renders_escaped_labels_and_rejects_bad_input() -> None:
    counter = Counter("unit_counter_total", "单元测试计数器", ("kind",))
    counter.inc(kind='a"b')
    counter.inc(2, kind='a"b')

    assert metric_value('unit_counter_total{kind="a\\"b"}') == 2 + 1
    with pytest.raises(ValueError):
        counter.inc(-1, kind="a")
    with pytest.raises(ValueError):
        counter.inc()


def test_histogram_buckets_are_cumulative_with_sum_and_count() -> None:
    histogram = Histogram("unit_latency_seconds", "单元测试直方图", buckets=(1.0, 2.0))
    histogram.observe(0.5)
    histogram.observe(1.0)
    histogram.observe(7.0)

    assert metric_value('unit_latency_seconds_bucket{le="1"}') == 2
    assert metric_value('unit_latency_seconds_bucket{le="2"}') == 2
    assert metric_value('unit_latency_seconds_bucket{le="+Inf"}') == 3
    assert metric_value("unit_latency_seconds_count") == 3
    assert metric_value("unit_latency_seconds_sum") == 8.5


def test_render_metrics_declares_all_eight_phase5_metrics() -> None:
    rendered = render_metrics()
    for name in PHASE5_METRIC_NAMES:
        assert f"# HELP {name} " in rendered
        assert f"# TYPE {name} " in rendered


@pytest.mark.asyncio
async def test_coordinator_run_records_run_tool_and_token_metrics() -> None:
    """一次带工具调用的成功 Run 要同时记录终态、耗时、Step、工具与 token。"""

    model = "metrics-test-model"
    before = {
        "runs": metric_value(f'agent_runs_total{{status="succeeded",model="{model}"}}'),
        "tool": metric_value('agent_tool_calls_total{tool="echo",status="succeeded"}'),
        "input": metric_value(f'agent_tokens_total{{model="{model}",direction="input"}}'),
        "output": metric_value(f'agent_tokens_total{{model="{model}",direction="output"}}'),
        "duration": metric_value("agent_run_duration_seconds_count"),
        "steps": metric_value("agent_steps_per_run_sum"),
    }
    coordinator = AgentCoordinator(
        model_stream=_scripted_model(
            [
                [
                    ToolCallStart(tool_call_id="call-1", name="echo"),
                    ToolCallArgumentsDelta(
                        tool_call_id="call-1", args_chunk=json.dumps({"text": "hi"})
                    ),
                    ToolCallEnd(tool_call_id="call-1"),
                    UsageDelta(input_tokens=11, output_tokens=7, total_tokens=18),
                    ModelCompleted(finish_reason="tool_calls"),
                ],
                [ContentDelta(token="好了"), ModelCompleted()],
            ]
        ),
        tool_registry=_tool_registry(),
    )
    run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        assistant_id=uuid.uuid4(),
        goal="记录指标",
        model=model,
        status=AgentRunStatus.queued,
    )

    result = await coordinator.run(run)

    assert result.status is AgentRunStatus.succeeded
    assert metric_value(f'agent_runs_total{{status="succeeded",model="{model}"}}') == (
        before["runs"] + 1
    )
    assert metric_value('agent_tool_calls_total{tool="echo",status="succeeded"}') == (
        before["tool"] + 1
    )
    assert metric_value(f'agent_tokens_total{{model="{model}",direction="input"}}') == (
        before["input"] + 11
    )
    assert metric_value(f'agent_tokens_total{{model="{model}",direction="output"}}') == (
        before["output"] + 7
    )
    assert metric_value("agent_run_duration_seconds_count") == before["duration"] + 1
    assert metric_value("agent_steps_per_run_sum") == before["steps"] + run.current_step


@pytest.mark.asyncio
async def test_approval_decision_records_wait_seconds() -> None:
    """审批决定要记录等待时长；无 created_at 的内存请求只是不记录，不得报错。"""

    service = ApprovalService()
    run = AgentRun(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        assistant_id=uuid.uuid4(),
        goal="审批指标",
        model="metrics-test-model",
        status=AgentRunStatus.waiting_approval,
    )
    step = AgentStep(id=uuid.uuid4(), run_id=run.id, sequence=1, kind=AgentStepKind.approval)

    before_count = metric_value("agent_approval_wait_seconds_count")
    before_sum = metric_value("agent_approval_wait_seconds_sum")

    # 未落库的请求上 created_at 不存在，不应记录也不应抛错
    pending = await service.create_request(
        run=run,
        step=step,
        tool_name="echo",
        arguments={"text": "hi"},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行工具 echo",
    )
    await service.approve(pending.id, user_id=run.user_id)
    assert metric_value("agent_approval_wait_seconds_count") == before_count

    timed = await service.create_request(
        run=run,
        step=step,
        tool_name="echo",
        arguments={"text": "hi"},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行工具 echo",
    )
    timed.created_at = datetime.now(UTC) - timedelta(seconds=30)
    await service.deny(timed.id, user_id=run.user_id)

    assert metric_value("agent_approval_wait_seconds_count") == before_count + 1
    assert metric_value("agent_approval_wait_seconds_sum") >= before_sum + 30
