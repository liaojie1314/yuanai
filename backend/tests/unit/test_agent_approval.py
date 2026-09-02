"""Agent 工具审批和用户输入恢复的单元测试。"""

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.dialects import postgresql

from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.approval import ApprovalRiskLevel, ApprovalStatus
from app.services.agent.approval_service import (
    ApprovalAlreadyDecidedError,
    ApprovalDecision,
    ApprovalExpiredError,
    ApprovalNotFoundError,
    ApprovalPayloadMismatchError,
    ApprovalService,
)


def _run(user_id: uuid.UUID | None = None) -> tuple[AgentRun, AgentStep]:
    owner = user_id or uuid.uuid4()
    run_id = uuid.uuid4()
    step = AgentStep(
        id=uuid.uuid4(),
        run_id=run_id,
        sequence=1,
        kind=AgentStepKind.approval,
        status=AgentStepStatus.waiting,
    )
    run = AgentRun(
        id=run_id,
        user_id=owner,
        assistant_id=uuid.uuid4(),
        goal="test",
        model="test-model",
        steps=[step],
        status=AgentRunStatus.waiting_approval,
    )
    return run, step


@pytest.mark.asyncio
async def test_approval_binds_sanitized_payload_and_is_single_decision() -> None:
    service = ApprovalService()
    user_id = uuid.uuid4()
    run, step = _run(user_id)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={"path": "/tmp/a", "token": "secret"},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="inspect",
    )
    assert request.status is ApprovalStatus.pending
    assert request.arguments_preview["token"] == "[redacted]"
    await service.decide(request.id, user_id=user_id, decision=ApprovalDecision.approve)
    with pytest.raises(ApprovalAlreadyDecidedError):
        await service.decide(request.id, user_id=user_id, decision=ApprovalDecision.deny)
    with pytest.raises(ApprovalPayloadMismatchError):
        await service.authorize_execution(
            request.id,
            user_id=user_id,
            tool_name="dangerous_tool",
            arguments={"path": "/tmp/a", "token": "different"},
            execution_location="cloud",
        )


@pytest.mark.asyncio
async def test_approval_rejects_parameter_substitution_and_duplicate_execution() -> None:
    service = ApprovalService()
    user_id = uuid.uuid4()
    run, step = _run(user_id)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={"value": 1},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="calculate",
    )
    await service.decide(request.id, user_id=user_id, decision="approve")
    with pytest.raises(ApprovalPayloadMismatchError):
        await service.authorize_execution(
            request.id,
            user_id=user_id,
            tool_name="dangerous_tool",
            arguments={"value": 2},
            execution_location="cloud",
        )
    await service.authorize_execution(
        request.id,
        user_id=user_id,
        tool_name="dangerous_tool",
        arguments={"value": 1},
        execution_location="cloud",
    )
    with pytest.raises(ApprovalAlreadyDecidedError):
        await service.authorize_execution(
            request.id,
            user_id=user_id,
            tool_name="dangerous_tool",
            arguments={"value": 1},
            execution_location="cloud",
        )


@pytest.mark.asyncio
async def test_approval_expiry_and_user_isolation() -> None:
    service = ApprovalService()
    owner = uuid.uuid4()
    run, step = _run(owner)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="run",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
    )
    with pytest.raises(ApprovalNotFoundError):
        await service.decide(request.id, user_id=uuid.uuid4(), decision="approve")
    with pytest.raises(ApprovalExpiredError):
        await service.decide(request.id, user_id=owner, decision="approve")
    assert request.status is ApprovalStatus.expired


@pytest.mark.asyncio
async def test_database_approval_lookup_locks_the_row() -> None:
    """数据库审批读取必须锁定行，避免并发决定或消费通过同一 pending 状态。"""

    user_id = uuid.uuid4()
    service = ApprovalService()
    run, step = _run(user_id)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="test",
    )
    db = AsyncMock()
    db.scalar.return_value = request

    await service.approve(request.id, user_id=user_id, db=db)

    statement = db.scalar.await_args.args[0]
    assert "FOR UPDATE" in str(statement.compile(dialect=postgresql.dialect()))


@pytest.mark.asyncio
async def test_waiting_input_submission_requeues_run() -> None:
    service = ApprovalService()
    user_id = uuid.uuid4()
    run, step = _run(user_id)
    del step
    run.status = AgentRunStatus.waiting_input
    await service.submit_input(run=run, user_id=user_id, answer="继续")
    assert run.status is AgentRunStatus.queued
    assert run.steps[-1].kind is AgentStepKind.user_input


@pytest.mark.asyncio
async def test_approved_request_requeues_waiting_run() -> None:
    """批准审批后，Run 进入 queued 且审批步骤完成。"""
    service = ApprovalService()
    user_id = uuid.uuid4()
    run, step = _run(user_id)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={"value": 1},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行工具",
    )

    await service.decide(request.id, user_id=user_id, decision="approve")
    await service.resume_after_decision(request, user_id=user_id)

    assert run.status is AgentRunStatus.queued
    assert step.status is AgentStepStatus.succeeded


@pytest.mark.asyncio
async def test_denied_request_cancels_waiting_run() -> None:
    """拒绝审批后，Run 进入取消终态且不会继续排队。"""
    service = ApprovalService()
    user_id = uuid.uuid4()
    run, step = _run(user_id)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="dangerous_tool",
        arguments={},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行工具",
    )

    await service.decide(request.id, user_id=user_id, decision="deny")
    await service.resume_after_decision(request, user_id=user_id)

    assert run.status is AgentRunStatus.cancelled
    assert run.error_code == "APPROVAL_DENIED"
    assert step.status is AgentStepStatus.cancelled
