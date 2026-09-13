"""主动自动化管理 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Response

from app.api.deps import DB, CurrentUser
from app.models.automation import Automation, AutomationRun, AutomationStatus
from app.schemas.automation import (
    AutomationCreateRequest,
    AutomationResponse,
    AutomationRunResponse,
    AutomationUpdateRequest,
)
from app.services.automation_service import (
    AgentUnavailableError,
    AutomationNotFoundError,
    AutomationStateError,
    AutomationValidationError,
    create_automation,
    delete_automation,
    get_automation,
    list_automations,
    run_automation_now,
    update_automation,
)

router = APIRouter(prefix="/automations", tags=["automations"])


@router.post("", response_model=AutomationResponse, status_code=201)
async def create(request: AutomationCreateRequest, current_user: CurrentUser, db: DB) -> Automation:
    """创建当前用户的自动化。"""

    try:
        return await create_automation(user_id=current_user.id, request=request, db=db)
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="ASSISTANT_NOT_FOUND") from error
    except AutomationValidationError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@router.get("", response_model=list[AutomationResponse])
async def list_all(current_user: CurrentUser, db: DB) -> list[Automation]:
    """列出当前用户的自动化。"""

    return await list_automations(user_id=current_user.id, db=db)


@router.get("/{automation_id}", response_model=AutomationResponse)
async def get_one(automation_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Automation:
    """读取当前用户的一个自动化。"""

    try:
        return await get_automation(automation_id, user_id=current_user.id, db=db)
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error


@router.patch("/{automation_id}", response_model=AutomationResponse)
async def patch(
    automation_id: uuid.UUID,
    request: AutomationUpdateRequest,
    current_user: CurrentUser,
    db: DB,
) -> Automation:
    """更新当前用户的自动化或暂停/恢复它。"""

    try:
        return await update_automation(
            automation_id, user_id=current_user.id, request=request, db=db
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except AutomationStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.delete("/{automation_id}", status_code=204)
async def remove(automation_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Response:
    """删除当前用户的自动化。"""

    try:
        await delete_automation(automation_id, user_id=current_user.id, db=db)
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    return Response(status_code=204)


@router.post("/{automation_id}/run-now", response_model=AutomationRunResponse, status_code=202)
async def run_now(automation_id: uuid.UUID, current_user: CurrentUser, db: DB) -> AutomationRun:
    """立即触发一次自动化，并复用标准 Agent 队列。"""

    try:
        return await run_automation_now(automation_id, user_id=current_user.id, db=db)
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except AutomationStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    except AgentUnavailableError as error:
        raise HTTPException(status_code=404, detail=str(error)) from error


@router.get("/{automation_id}/runs", response_model=list[AutomationRunResponse])
async def list_runs(
    automation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[AutomationRun]:
    """列出当前用户自动化的触发历史。"""

    try:
        automation = await get_automation(automation_id, user_id=current_user.id, db=db)
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    return automation.runs


@router.post("/{automation_id}/pause", response_model=AutomationResponse)
async def pause(automation_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Automation:
    """暂停自动化但保留下一次触发时间。"""

    return await _set_status(automation_id, current_user.id, AutomationStatus.paused, db)


@router.post("/{automation_id}/resume", response_model=AutomationResponse)
async def resume(automation_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Automation:
    """恢复尚未完成的自动化。"""

    return await _set_status(automation_id, current_user.id, AutomationStatus.active, db)


async def _set_status(
    automation_id: uuid.UUID, user_id: uuid.UUID, status: AutomationStatus, db: DB
) -> Automation:
    """将状态更新委托给自动化服务。"""

    try:
        return await update_automation(
            automation_id,
            user_id=user_id,
            request=AutomationUpdateRequest(status=status),
            db=db,
        )
    except AutomationNotFoundError as error:
        raise HTTPException(status_code=404, detail="AUTOMATION_NOT_FOUND") from error
    except AutomationStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
