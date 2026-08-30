"""Agent 助理与运行控制 API。"""

from __future__ import annotations

import asyncio
import json
import uuid
from collections.abc import AsyncGenerator

from fastapi import APIRouter, Header, HTTPException, Response
from fastapi.responses import StreamingResponse
from redis.exceptions import RedisError
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.core.config import settings
from app.models.agent_run import AgentEvent, AgentRun, AgentRunStatus, AgentStep
from app.models.approval import ApprovalRequest
from app.models.assistant import Assistant
from app.models.conversation import Conversation
from app.schemas.agent import (
    AgentEventResponse,
    AgentInputRequest,
    AgentRunCreateRequest,
    AgentRunResponse,
    AgentStepResponse,
    ApprovalDecisionRequest,
    ApprovalRequestResponse,
    AssistantCreateRequest,
    AssistantResponse,
    AssistantUpdateRequest,
)
from app.services.agent.approval_service import (
    ApprovalAlreadyDecidedError,
    ApprovalError,
    ApprovalExpiredError,
    ApprovalNotFoundError,
    ApprovalService,
)
from app.services.agent.event_service import EventStore
from app.services.agent.queue import AgentQueue
from app.services.secret_store import EnvironmentSecretStore
from app.services.tool_runtime_service import ToolRuntimeService
from app.tools.builtin import build_phase6_registry

router = APIRouter(prefix="/agent", tags=["agent"])
_approvals = ApprovalService()
_events = EventStore()
_tools_runtime = ToolRuntimeService(build_phase6_registry(), secret_store=EnvironmentSecretStore())


def _agent_enabled_for(user_id: uuid.UUID) -> bool:
    """返回当前用户是否被允许创建 Agent Run。"""
    if settings.agent_enabled:
        return True
    allowed = {
        item.strip() for item in settings.agent_allowlist_user_ids.split(",") if item.strip()
    }
    return str(user_id) in allowed


async def _assistant(assistant_id: uuid.UUID, user_id: uuid.UUID, db: DB) -> Assistant:
    item = await db.scalar(
        select(Assistant).where(Assistant.id == assistant_id, Assistant.user_id == user_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return item


async def _run(run_id: uuid.UUID, user_id: uuid.UUID, db: DB) -> AgentRun:
    item = await db.scalar(
        select(AgentRun).where(AgentRun.id == run_id, AgentRun.user_id == user_id)
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return item


@router.post("/assistants", response_model=AssistantResponse, status_code=201)
async def create_assistant(
    req: AssistantCreateRequest, current_user: CurrentUser, db: DB
) -> Assistant:
    assistant = Assistant(user_id=current_user.id, **req.model_dump())
    db.add(assistant)
    await db.commit()
    await db.refresh(assistant)
    return assistant


@router.get("/assistants", response_model=list[AssistantResponse])
async def list_assistants(current_user: CurrentUser, db: DB) -> list[Assistant]:
    return list(
        (
            await db.scalars(
                select(Assistant)
                .where(Assistant.user_id == current_user.id)
                .order_by(Assistant.created_at)
            )
        ).all()
    )


@router.get("/assistants/{assistant_id}", response_model=AssistantResponse)
async def get_assistant(assistant_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Assistant:
    return await _assistant(assistant_id, current_user.id, db)


@router.patch("/assistants/{assistant_id}", response_model=AssistantResponse)
async def update_assistant(
    assistant_id: uuid.UUID, req: AssistantUpdateRequest, current_user: CurrentUser, db: DB
) -> Assistant:
    assistant = await _assistant(assistant_id, current_user.id, db)
    for key, value in req.model_dump(exclude_unset=True).items():
        setattr(assistant, key, value)
    await db.commit()
    await db.refresh(assistant)
    return assistant


@router.delete("/assistants/{assistant_id}", status_code=204)
async def delete_assistant(assistant_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Response:
    assistant = await _assistant(assistant_id, current_user.id, db)
    await db.delete(assistant)
    await db.commit()
    return Response(status_code=204)


@router.post("/runs", response_model=AgentRunResponse, status_code=202)
async def create_run(req: AgentRunCreateRequest, current_user: CurrentUser, db: DB) -> AgentRun:
    if not _agent_enabled_for(current_user.id):
        raise HTTPException(status_code=404, detail="Agent is unavailable")
    assistant = await _assistant(req.assistant_id, current_user.id, db)
    if req.conversation_id is not None:
        conversation = await db.scalar(
            select(Conversation).where(
                Conversation.id == req.conversation_id,
                Conversation.user_id == current_user.id,
            )
        )
        if conversation is None:
            raise HTTPException(status_code=404, detail="Conversation not found")
    if req.parent_run_id is not None:
        await _run(req.parent_run_id, current_user.id, db)
    if req.idempotency_key:
        existing = await db.scalar(
            select(AgentRun).where(
                AgentRun.user_id == current_user.id,
                AgentRun.idempotency_key == req.idempotency_key,
            )
        )
        if existing is not None:
            return existing
    run = AgentRun(
        user_id=current_user.id,
        assistant_id=assistant.id,
        goal=req.goal,
        model=req.model or assistant.default_model,
        conversation_id=req.conversation_id,
        parent_run_id=req.parent_run_id,
        max_steps=req.max_steps,
        idempotency_key=req.idempotency_key,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)
    try:
        await AgentQueue().enqueue(current_user.id, run.id)
    except (OSError, RuntimeError, RedisError):
        pass
    return run


@router.get("/runs", response_model=list[AgentRunResponse])
async def list_runs(current_user: CurrentUser, db: DB, limit: int = 50) -> list[AgentRun]:
    limit = max(1, min(limit, 100))
    return list(
        (
            await db.scalars(
                select(AgentRun)
                .where(AgentRun.user_id == current_user.id)
                .order_by(AgentRun.created_at.desc())
                .limit(limit)
            )
        ).all()
    )


@router.get("/runs/{run_id}", response_model=AgentRunResponse)
async def get_run(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> AgentRun:
    return await _run(run_id, current_user.id, db)


@router.get("/runs/{run_id}/steps", response_model=list[AgentStepResponse])
async def list_steps(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> list[AgentStep]:
    await _run(run_id, current_user.id, db)
    return list(
        (
            await db.scalars(
                select(AgentStep).where(AgentStep.run_id == run_id).order_by(AgentStep.sequence)
            )
        ).all()
    )


@router.get("/runs/{run_id}/stream")
async def stream_events(
    run_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
) -> StreamingResponse:
    await _run(run_id, current_user.id, db)

    async def generate() -> AsyncGenerator[str, None]:
        seen: set[int] = set()
        cursor = last_event_id
        while True:
            events = await _events.replay_after(run_id, cursor)
            for event in events:
                if event.sequence <= cursor or event.sequence in seen:
                    continue
                seen.add(event.sequence)
                cursor = event.sequence
                data = json.dumps(event.payload, ensure_ascii=False)
                yield f"id: {event.sequence}\nevent: {event.event_type}\ndata: {data}\n\n"
                if event.event_type in {"run_completed", "run_failed", "run_cancelled"}:
                    yield "data: [DONE]\n\n"
                    return
            status = await _events.get_run_status(run_id, tenant_id=current_user.id)
            if status in {
                AgentRunStatus.succeeded,
                AgentRunStatus.failed,
                AgentRunStatus.cancelled,
            }:
                yield "data: [DONE]\n\n"
                return
            await asyncio.sleep(0.25)

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/runs/{run_id}/events", response_model=list[AgentEventResponse])
async def replay_events(
    run_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    last_event_id: int = Header(default=0, alias="Last-Event-ID"),
) -> list[AgentEvent]:
    """返回游标之后的结构化事件；SSE 断线重连使用同一游标的 stream 端点。"""
    await _run(run_id, current_user.id, db)
    return list(
        (
            await db.scalars(
                select(AgentEvent)
                .where(AgentEvent.run_id == run_id, AgentEvent.sequence > last_event_id)
                .order_by(AgentEvent.sequence)
            )
        ).all()
    )


@router.post("/runs/{run_id}/cancel", response_model=AgentRunResponse)
async def cancel_run(run_id: uuid.UUID, current_user: CurrentUser, db: DB) -> AgentRun:
    run = await _run(run_id, current_user.id, db)
    if run.status not in {
        AgentRunStatus.succeeded,
        AgentRunStatus.failed,
        AgentRunStatus.cancelled,
    }:
        run.status = AgentRunStatus.cancelled
        await db.commit()
    try:
        await AgentQueue().cancel(current_user.id, run.id)
    except (OSError, RuntimeError, RedisError):
        pass
    return run


@router.post("/runs/{run_id}/input", response_model=AgentRunResponse)
async def submit_input(
    run_id: uuid.UUID, req: AgentInputRequest, current_user: CurrentUser, db: DB
) -> AgentRun:
    run = await _run(run_id, current_user.id, db)
    try:
        await _approvals.submit_input(run=run, user_id=current_user.id, answer=req.input, db=db)
    except ApprovalNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except (ValueError, RuntimeError) as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await db.commit()
    try:
        await AgentQueue().enqueue(current_user.id, run.id)
    except (OSError, RuntimeError, RedisError):
        pass
    return run


@router.post("/approvals/{approval_id}", response_model=ApprovalRequestResponse)
async def decide_approval(
    approval_id: uuid.UUID, req: ApprovalDecisionRequest, current_user: CurrentUser, db: DB
) -> ApprovalRequest:
    try:
        item = await _approvals.decide(
            approval_id, user_id=current_user.id, decision=req.decision, note=req.note, db=db
        )
        run = None
        if item.tool_execution_id is not None:
            await _approvals.resolve_tool_execution(item, user_id=current_user.id, db=db)
            if req.decision == "approve":
                await _tools_runtime.resume_approved_execution(
                    item.tool_execution_id, user_id=current_user.id, db=db
                )
        else:
            run = await _approvals.resume_after_decision(item, user_id=current_user.id, db=db)
    except ApprovalNotFoundError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error
    except ApprovalExpiredError as error:
        raise HTTPException(status_code=410, detail=str(error)) from error
    except ApprovalAlreadyDecidedError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except ApprovalError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    await db.commit()
    if run is not None and run.status is AgentRunStatus.queued:
        try:
            await AgentQueue().enqueue(current_user.id, run.id)
        except (OSError, RuntimeError, RedisError):
            pass
        await _events.append(
            run.id,
            "approval_resolved",
            {"approval_id": str(item.id), "decision": "approve"},
            tenant_id=current_user.id,
        )
    elif run is not None:
        await _events.append(
            run.id,
            "run_cancelled",
            {"status": AgentRunStatus.cancelled.value, "reason": "approval_denied"},
            tenant_id=current_user.id,
        )
    return item


@router.get("/approvals", response_model=list[ApprovalRequestResponse])
async def list_approvals(current_user: CurrentUser, db: DB) -> list[ApprovalRequest]:
    """列出当前用户的审批请求，参数字段只返回脱敏预览。"""
    return list(
        (
            await db.scalars(
                select(ApprovalRequest)
                .where(ApprovalRequest.user_id == current_user.id)
                .order_by(ApprovalRequest.created_at.desc())
            )
        ).all()
    )
