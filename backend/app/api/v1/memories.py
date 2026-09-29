"""用户长期记忆的管理与检索 API。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.deps import DB, CurrentUser
from app.models.memory import Memory, MemoryStatus
from app.schemas.memory import (
    MEMORY_SEARCH_MAX_QUERY_CHARS,
    MemoryCreateCandidate,
    MemoryExport,
    MemoryPage,
    MemoryResponse,
    MemorySearchOutcome,
    MemoryUpdate,
)
from app.services.ai_service import maybe_embed_text
from app.services.memory_node import LocalMemoryApprovalTimeoutError, LocalMemoryUnavailableError
from app.services.memory_retrieval import search_active_memories
from app.services.memory_service import (
    MemoryNotFoundError,
    MemoryPolicyError,
    create_candidate,
    delete_memory,
    list_memories,
    list_memory_page,
    update_memory,
)

router = APIRouter(prefix="/memories", tags=["memories"])


def _local_memory_failure(error: LocalMemoryUnavailableError) -> HTTPException:
    """把本地记忆失败映射成诚实的响应。

    审批超时与节点不可用是两回事：说成后者会让用户去排查一台正常工作的机器，
    所以映射只在这一处做，新增调用点无法漏掉这层区分。
    """

    if isinstance(error, LocalMemoryApprovalTimeoutError):
        return HTTPException(status_code=504, detail="LOCAL_MEMORY_APPROVAL_TIMEOUT")
    return HTTPException(status_code=503, detail="LOCAL_MEMORY_NODE_UNAVAILABLE")


@router.post("", response_model=MemoryResponse, status_code=201)
async def create_memory(
    request: MemoryCreateCandidate, current_user: CurrentUser, db: DB
) -> Memory:
    """创建待确认记忆，不允许请求直接绕过候选状态。"""

    try:
        memory = await create_candidate(user_id=current_user.id, request=request, db=db)
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail="ASSISTANT_NOT_FOUND") from error
    except MemoryPolicyError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LocalMemoryUnavailableError as error:
        raise _local_memory_failure(error) from error
    await db.commit()
    await db.refresh(memory)
    return memory


@router.get("", response_model=MemoryPage)
async def get_memories(
    current_user: CurrentUser,
    db: DB,
    status: MemoryStatus | None = None,
    cursor: str | None = Query(default=None, max_length=200),
    limit: int = Query(default=50, ge=1, le=200),
) -> MemoryPage:
    """按游标分页列出当前用户的记忆，可按生命周期筛选。"""

    try:
        return await list_memory_page(
            user_id=current_user.id, status=status, cursor=cursor, limit=limit, db=db
        )
    except MemoryPolicyError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


# 必须排在 /{memory_id} 之前，否则 "export" 会被当成记忆 id 解析
@router.get("/export", response_model=MemoryExport)
async def export_all_memories(current_user: CurrentUser, db: DB) -> MemoryExport:
    """导出当前用户的全部记忆，供用户自持一份副本。"""

    memories = await list_memories(user_id=current_user.id, db=db)
    return MemoryExport(
        exported_at=datetime.now(UTC),
        items=[MemoryResponse.model_validate(memory) for memory in memories],
    )


@router.get("/search", response_model=MemorySearchOutcome)
async def search_memories(
    current_user: CurrentUser,
    db: DB,
    assistant_id: uuid.UUID = Query(alias="assistantId"),
    query: str = Query(min_length=1, max_length=MEMORY_SEARCH_MAX_QUERY_CHARS),
    limit: int = Query(default=8, ge=1, le=20),
    workspace_id: uuid.UUID | None = Query(default=None, alias="workspaceId"),
) -> MemorySearchOutcome:
    """检索可安全进入当前助理上下文的 active 记忆。"""

    return await search_active_memories(
        user_id=current_user.id,
        assistant_id=assistant_id,
        workspace_id=workspace_id,
        query=query,
        query_embedding=await maybe_embed_text(query),
        limit=limit,
        db=db,
    )


@router.patch("/{memory_id}", response_model=MemoryResponse)
async def patch_memory(
    memory_id: uuid.UUID, request: MemoryUpdate, current_user: CurrentUser, db: DB
) -> Memory:
    """修改当前用户的记忆或显式确认其状态。"""

    try:
        memory = await update_memory(
            memory_id=memory_id,
            user_id=current_user.id,
            request=request,
            db=db,
        )
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail="MEMORY_NOT_FOUND") from error
    except MemoryPolicyError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    except LocalMemoryUnavailableError as error:
        raise _local_memory_failure(error) from error
    await db.commit()
    await db.refresh(memory)
    return memory


@router.delete("/{memory_id}", status_code=204)
async def remove_memory(memory_id: uuid.UUID, current_user: CurrentUser, db: DB) -> Response:
    """彻底删除用户的记忆及其派生检索数据。"""

    try:
        await delete_memory(memory_id=memory_id, user_id=current_user.id, db=db)
    except MemoryNotFoundError as error:
        raise HTTPException(status_code=404, detail="MEMORY_NOT_FOUND") from error
    except LocalMemoryUnavailableError as error:
        raise _local_memory_failure(error) from error
    await db.commit()
    return Response(status_code=204)
