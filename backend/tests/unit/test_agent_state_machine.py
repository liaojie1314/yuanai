"""Agent Runtime 领域模型与状态机单元测试。"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import AgentRun, AgentRunStatus, Assistant, User
from app.models.agent_run import AgentEvent, AgentStep, AgentStepKind
from app.models.approval import ApprovalRequest, ApprovalRiskLevel, ApprovalStatus
from app.services.agent.state_machine import InvalidRunTransition, RunStateMachine


def test_valid_run_transitions() -> None:
    """状态机接受规格中的正常执行和暂停恢复路径。"""

    machine = RunStateMachine()
    assert machine.transition("running") is AgentRunStatus.running
    assert machine.transition("waiting_input") is AgentRunStatus.waiting_input
    assert machine.transition("queued") is AgentRunStatus.queued
    assert machine.transition("running") is AgentRunStatus.running
    assert machine.transition("succeeded") is AgentRunStatus.succeeded


@pytest.mark.parametrize(
    ("source", "target"),
    [
        ("queued", "succeeded"),
        ("running", "queued"),
        ("succeeded", "running"),
        ("failed", "cancelled"),
    ],
)
def test_invalid_run_transitions(source: str, target: str) -> None:
    """状态机拒绝跳过中间态、终态回退和未知路径。"""

    machine = RunStateMachine(source)
    with pytest.raises(InvalidRunTransition):
        machine.transition(target)


@pytest.mark.asyncio
async def test_agent_models_tenant_filter_cascade_and_idempotency(db, test_user: User) -> None:
    """Run 只能按 user_id 查询，删除助理时级联清理其执行数据。"""

    other_user = User(
        id=uuid.uuid4(),
        email="other-agent@example.com",
        username="other-agent",
        hashed_password="x",
    )
    assistant = Assistant(
        user_id=test_user.id, name="默认", default_model="test-model", is_default=True
    )
    other_assistant = Assistant(
        user_id=other_user.id, name="另一个", default_model="test-model", is_default=True
    )
    db.add(other_user)
    await db.flush()
    db.add_all([assistant, other_assistant])
    await db.flush()
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="测试",
        model="test-model",
        idempotency_key="same-key",
    )
    db.add(run)
    await db.flush()
    step = AgentStep(run_id=run.id, sequence=1, kind=AgentStepKind.model)
    db.add(step)
    await db.flush()
    db.add_all(
        [
            AgentEvent(run_id=run.id, sequence=1, event_type="run_queued", payload={}),
            ApprovalRequest(
                run_id=run.id,
                step_id=step.id,
                user_id=test_user.id,
                tool_name="simulated",
                execution_location="worker",
                risk_level=ApprovalRiskLevel.high,
                action_summary="测试",
                arguments_preview={},
                payload_hash="a" * 64,
                status=ApprovalStatus.pending,
                expires_at=run.created_at,
            ),
        ]
    )
    await db.commit()
    visible = list(
        (await db.scalars(select(AgentRun).where(AgentRun.user_id == test_user.id))).all()
    )
    assert visible == [run]
    duplicate = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="重复",
        model="test-model",
        idempotency_key="same-key",
    )
    db.add(duplicate)
    with pytest.raises(IntegrityError):
        await db.commit()
    await db.rollback()
    await db.delete(assistant)
    await db.commit()
    assert await db.scalar(select(AgentRun).where(AgentRun.id == run.id)) is None
