"""媒体生成任务的认证 API。"""

import uuid

from fastapi import APIRouter, HTTPException, status

from app.api.deps import DB, CurrentUser
from app.schemas.media_generation import (
    CreateMediaGenerationRequest,
    MediaGenerationTaskListResponse,
    MediaGenerationTaskResponse,
)
from app.services.media_generation_service import (
    MediaGenerationConversationNotFoundError,
    MediaGenerationTaskNotCancelableError,
    MediaGenerationTaskNotFoundError,
    MediaGenerationValidationError,
    cancel_media_task,
    create_media_task,
    get_media_task,
    list_media_tasks,
)
from app.services.storage_service import storage

router = APIRouter(prefix="/media", tags=["media"])
chat_media_router = APIRouter(prefix="/chat/conversations", tags=["media"])


@router.post(
    "/tasks",
    response_model=MediaGenerationTaskResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_task(
    request: CreateMediaGenerationRequest, current_user: CurrentUser, db: DB
) -> MediaGenerationTaskResponse:
    """创建归属于当前用户会话的媒体生成任务。"""
    try:
        task = await create_media_task(
            user_id=current_user.id,
            conversation_id=request.conversation_id,
            request=request,
            db=db,
        )
    except MediaGenerationConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"},
        ) from error
    except MediaGenerationValidationError as error:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"code": "MEDIA_TASK_INVALID", "message": str(error)},
        ) from error
    return MediaGenerationTaskResponse.from_task(task, storage)


@router.get("/tasks/{task_id}", response_model=MediaGenerationTaskResponse)
async def get_task(
    task_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> MediaGenerationTaskResponse:
    """读取当前用户拥有的单个媒体任务。"""
    try:
        task = await get_media_task(user_id=current_user.id, task_id=task_id, db=db)
    except MediaGenerationTaskNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "MEDIA_TASK_NOT_FOUND", "message": "媒体任务不存在"},
        ) from error
    return MediaGenerationTaskResponse.from_task(task, storage)


@router.post("/tasks/{task_id}/cancel", response_model=MediaGenerationTaskResponse)
async def cancel_task(
    task_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> MediaGenerationTaskResponse:
    """取消当前用户仍可停止的图片或视频任务。"""
    try:
        task = await cancel_media_task(user_id=current_user.id, task_id=task_id, db=db)
    except MediaGenerationTaskNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "MEDIA_TASK_NOT_FOUND", "message": "媒体任务不存在"},
        ) from error
    except MediaGenerationTaskNotCancelableError as error:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"code": "MEDIA_TASK_NOT_CANCELABLE", "message": "任务已结束，不能取消"},
        ) from error
    return MediaGenerationTaskResponse.from_task(task, storage)


@chat_media_router.get(
    "/{conversation_id}/media-tasks", response_model=MediaGenerationTaskListResponse
)
async def list_conversation_tasks(
    conversation_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> MediaGenerationTaskListResponse:
    """列出当前用户会话的媒体任务，供刷新或跨端恢复任务卡。"""
    try:
        tasks = await list_media_tasks(
            user_id=current_user.id,
            conversation_id=conversation_id,
            db=db,
        )
    except MediaGenerationConversationNotFoundError as error:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "CONVERSATION_NOT_FOUND", "message": "会话不存在"},
        ) from error
    return MediaGenerationTaskListResponse(
        tasks=[MediaGenerationTaskResponse.from_task(task, storage) for task in tasks]
    )
