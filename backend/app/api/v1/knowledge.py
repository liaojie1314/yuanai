"""Knowledge Base 的文本摄取、发布与检索 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.api.deps import DB, CurrentUser
from app.models.knowledge import (
    KnowledgeBase,
    KnowledgeBaseMember,
    KnowledgeDocument,
    KnowledgeSource,
)
from app.schemas.knowledge import (
    KnowledgeBaseCreate,
    KnowledgeBaseResponse,
    KnowledgeCitation,
    KnowledgeDocumentResponse,
    KnowledgeMemberGrant,
    KnowledgeMemberResponse,
    KnowledgeSearchRequest,
    KnowledgeSourceWithDocumentsResponse,
    KnowledgeTextSourceCreate,
    KnowledgeTextVersionCreate,
)
from app.services.knowledge_service import (
    KnowledgeNotFoundError,
    KnowledgePermissionError,
    create_knowledge_base,
    create_text_source,
    create_text_version,
    grant_member,
    list_knowledge_bases,
    list_knowledge_sources,
    publish_document,
    search_knowledge,
)

router = APIRouter(prefix="/knowledge-bases", tags=["knowledge-bases"])


@router.post("", response_model=KnowledgeBaseResponse, status_code=201)
async def create_base(
    request: KnowledgeBaseCreate, current_user: CurrentUser, db: DB
) -> KnowledgeBase:
    """创建一个当前用户拥有的知识库。"""

    knowledge_base = await create_knowledge_base(
        owner_id=current_user.id, name=request.name, space_id=request.space_id, db=db
    )
    await db.commit()
    await db.refresh(knowledge_base)
    return knowledge_base


@router.get("", response_model=list[KnowledgeBaseResponse])
async def get_bases(current_user: CurrentUser, db: DB) -> list[KnowledgeBase]:
    """仅列出当前用户有空间 ACL 的知识库。"""

    return await list_knowledge_bases(user_id=current_user.id, db=db)


@router.get(
    "/{knowledge_base_id}/sources", response_model=list[KnowledgeSourceWithDocumentsResponse]
)
async def get_sources(
    knowledge_base_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[KnowledgeSource]:
    """列出可访问知识库的来源及其版本。"""

    try:
        return await list_knowledge_sources(
            knowledge_base_id=knowledge_base_id, user_id=current_user.id, db=db
        )
    except KnowledgeNotFoundError as error:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_BASE_NOT_FOUND") from error


@router.put("/{knowledge_base_id}/members", response_model=KnowledgeMemberResponse)
async def put_member(
    knowledge_base_id: uuid.UUID, request: KnowledgeMemberGrant, current_user: CurrentUser, db: DB
) -> KnowledgeBaseMember:
    """由所有者为一个用户设置知识库成员角色。"""

    try:
        member = await grant_member(
            knowledge_base_id=knowledge_base_id,
            owner_id=current_user.id,
            user_id=request.user_id,
            role=request.role,
            db=db,
        )
    except KnowledgeNotFoundError as error:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_BASE_NOT_FOUND") from error
    except KnowledgePermissionError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    await db.commit()
    await db.refresh(member)
    return member


@router.post(
    "/{knowledge_base_id}/sources/text", response_model=KnowledgeDocumentResponse, status_code=201
)
async def create_source(
    knowledge_base_id: uuid.UUID,
    request: KnowledgeTextSourceCreate,
    current_user: CurrentUser,
    db: DB,
) -> KnowledgeDocument:
    """创建文本来源并构建未公开的初始版本。"""

    try:
        _, document = await create_text_source(
            knowledge_base_id=knowledge_base_id, user_id=current_user.id, request=request, db=db
        )
    except KnowledgeNotFoundError as error:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_BASE_NOT_FOUND") from error
    except KnowledgePermissionError as error:
        raise HTTPException(status_code=403, detail="KNOWLEDGE_BASE_WRITE_FORBIDDEN") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    await db.commit()
    await db.refresh(document)
    return document


@router.post(
    "/{knowledge_base_id}/sources/{source_id}/documents/text",
    response_model=KnowledgeDocumentResponse,
    status_code=201,
)
async def create_source_version(
    knowledge_base_id: uuid.UUID,
    source_id: uuid.UUID,
    request: KnowledgeTextVersionCreate,
    current_user: CurrentUser,
    db: DB,
) -> KnowledgeDocument:
    """为现有来源构建待发布文本版本。"""

    try:
        document = await create_text_version(
            knowledge_base_id=knowledge_base_id,
            source_id=source_id,
            user_id=current_user.id,
            content=request.content,
            db=db,
        )
    except KnowledgeNotFoundError as error:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_SOURCE_NOT_FOUND") from error
    except KnowledgePermissionError as error:
        raise HTTPException(status_code=403, detail="KNOWLEDGE_BASE_WRITE_FORBIDDEN") from error
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error
    await db.commit()
    await db.refresh(document)
    return document


@router.post(
    "/{knowledge_base_id}/sources/{source_id}/documents/{document_id}/publish",
    response_model=KnowledgeDocumentResponse,
)
async def publish_source_version(
    knowledge_base_id: uuid.UUID,
    source_id: uuid.UUID,
    document_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
) -> KnowledgeDocument:
    """原子地将已构建版本切换为可检索版本。"""

    try:
        document = await publish_document(
            knowledge_base_id=knowledge_base_id,
            source_id=source_id,
            document_id=document_id,
            user_id=current_user.id,
            db=db,
        )
    except KnowledgeNotFoundError as error:
        raise HTTPException(status_code=404, detail="KNOWLEDGE_DOCUMENT_NOT_FOUND") from error
    except KnowledgePermissionError as error:
        raise HTTPException(status_code=403, detail="KNOWLEDGE_BASE_WRITE_FORBIDDEN") from error
    await db.commit()
    await db.refresh(document)
    return document


@router.post("/{knowledge_base_id}/search", response_model=list[KnowledgeCitation])
async def search_base(
    knowledge_base_id: uuid.UUID, request: KnowledgeSearchRequest, current_user: CurrentUser, db: DB
) -> list[KnowledgeCitation]:
    """检索当前用户可访问的已发布来源片段与引用位置。"""

    return await search_knowledge(
        knowledge_base_id=knowledge_base_id,
        user_id=current_user.id,
        query=request.query,
        limit=request.limit,
        db=db,
    )
