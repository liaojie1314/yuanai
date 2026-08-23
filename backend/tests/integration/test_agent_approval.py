"""Agent 审批持久化和租户隔离集成测试。"""

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.agent_run import AgentRun, AgentRunStatus, AgentStep, AgentStepKind, AgentStepStatus
from app.models.approval import ApprovalRiskLevel, ApprovalStatus
from app.models.assistant import Assistant
from app.models.user import User
from app.services.agent.approval_service import (
    ApprovalAlreadyDecidedError,
    ApprovalExpiredError,
    ApprovalNotFoundError,
    ApprovalService,
)


async def _approval_fixture(db: AsyncSession, user: User) -> tuple[AgentRun, AgentStep]:
    """创建带真实外键的 Run 和审批步骤。"""
    assistant = Assistant(
        user_id=user.id,
        name="审批测试助理",
        default_model="test-model",
    )
    db.add(assistant)
    await db.flush()
    run = AgentRun(
        user_id=user.id,
        assistant_id=assistant.id,
        goal="审批测试",
        model="test-model",
        status=AgentRunStatus.waiting_approval,
    )
    db.add(run)
    await db.flush()
    step = AgentStep(
        run_id=run.id,
        sequence=1,
        kind=AgentStepKind.approval,
        status=AgentStepStatus.waiting,
    )
    db.add(step)
    await db.flush()
    return run, step


@pytest.mark.asyncio
async def test_persisted_approval_is_isolated_and_single_decision(
    db: AsyncSession, test_user: User
) -> None:
    """数据库中的审批只能由所属用户决定一次。"""
    service = ApprovalService()
    run, step = await _approval_fixture(db, test_user)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="external_tool",
        arguments={"path": "/tmp/report"},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行外部工具",
        db=db,
    )
    with pytest.raises(ApprovalNotFoundError):
        await service.approve(request.id, user_id=uuid.uuid4(), db=db)
    approved = await service.approve(request.id, user_id=test_user.id, db=db)
    assert approved.status is ApprovalStatus.approved
    with pytest.raises(ApprovalAlreadyDecidedError):
        await service.deny(request.id, user_id=test_user.id, db=db)


@pytest.mark.asyncio
async def test_persisted_approval_expires_before_decision(
    db: AsyncSession, test_user: User
) -> None:
    """过期审批不能被批准。"""
    service = ApprovalService()
    run, step = await _approval_fixture(db, test_user)
    request = await service.create_request(
        run=run,
        step=step,
        tool_name="external_tool",
        arguments={},
        risk_level=ApprovalRiskLevel.high,
        execution_location="cloud",
        action_summary="执行外部工具",
        expires_at=datetime.now(UTC) - timedelta(seconds=1),
        db=db,
    )
    with pytest.raises(ApprovalExpiredError):
        await service.approve(request.id, user_id=test_user.id, db=db)
    assert request.status is ApprovalStatus.expired
