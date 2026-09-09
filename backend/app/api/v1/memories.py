"""用户长期记忆的管理与检索 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.deps import DB, CurrentUser
from app.models.memory import Memory, MemoryStatus
from app.schemas.memory import (
    MemoryCreateCandidate,
    MemoryResponse,
    MemorySearchResult,
    MemoryUpdate,
)
from app.services.memory_retrieval import maybe_embed_text, search_active_memories
from app.services.memory_service import (
    MemoryNotFoundError,
    MemoryPolicyError,
    create_candidate,
    delete_memory,
    list_memories,
    update_memory,
)

router = APIRouter(prefix="/memories", tags=["memories"])


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
    await db.commit()
    await db.refresh(memory)
    return memory


@router.get("", response_model=list[MemoryResponse])
async def get_memories(
    current_user: CurrentUser,
    db: DB,
    status: MemoryStatus | None = None,
) -> list[Memory]:
    """列出当前用户的记忆，可按生命周期筛选。"""

    return await list_memories(user_id=current_user.id, status=status, db=db)


@router.get("/search", response_model=list[MemorySearchResult])
async def search_memories(
    current_user: CurrentUser,
    db: DB,
    assistant_id: uuid.UUID = Query(alias="assistantId"),
    query: str = Query(min_length=1, max_length=10_000),
    limit: int = Query(default=8, ge=1, le=20),
    workspace_id: uuid.UUID | None = Query(default=None, alias="workspaceId"),
) -> list[MemorySearchResult]:
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
    await db.commit()
    return Response(status_code=204)
