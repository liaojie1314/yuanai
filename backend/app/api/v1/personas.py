"""专属助手人格的读写、版本、回滚与预览 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.models.assistant import Assistant
from app.models.persona import AssistantPersona
from app.schemas.persona import (
    PersonaPreviewResponse,
    PersonaResponse,
    PersonaUpdateRequest,
    PersonaVersionResponse,
)
from app.services.persona_service import (
    PERSONA_CHARACTER_BUDGET,
    PersonaVersionNotFoundError,
    build_persona_fragment,
    list_persona_versions,
    load_persona,
    rollback_persona,
    save_persona,
    unsaved_default_persona,
)

router = APIRouter(prefix="/agent/assistants", tags=["persona"])


async def _owned_assistant(assistant_id: uuid.UUID, user_id: uuid.UUID, db: DB) -> Assistant:
    """校验助理归属。

    「不存在」与「是别人的」一律回同一个 404：区分开等于把助理 id 变成存在性探针。
    """

    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        raise HTTPException(status_code=404, detail="Assistant not found")
    return assistant


@router.get("/{assistant_id}/persona", response_model=PersonaResponse)
async def get_persona(
    assistant_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> AssistantPersona:
    """读取人格；从未编辑过的助理返回一份默认人格而不是 404。"""

    await _owned_assistant(assistant_id, current_user.id, db)
    persona = await load_persona(assistant_id=assistant_id, db=db)
    return persona or unsaved_default_persona(assistant_id)


@router.put("/{assistant_id}/persona", response_model=PersonaResponse)
async def put_persona(
    assistant_id: uuid.UUID, req: PersonaUpdateRequest, current_user: CurrentUser, db: DB
) -> AssistantPersona:
    """保存人格；每次保存生成一个新版本。"""

    await _owned_assistant(assistant_id, current_user.id, db)
    persona = await save_persona(
        assistant_id=assistant_id, changes=req.model_dump(exclude_unset=True), db=db
    )
    await db.commit()
    await db.refresh(persona)
    return persona


@router.get("/{assistant_id}/persona/versions", response_model=list[PersonaVersionResponse])
async def get_persona_versions(
    assistant_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> list[PersonaVersionResponse]:
    """按版本号倒序列出人格历史，含每次变更的原因。"""

    await _owned_assistant(assistant_id, current_user.id, db)
    versions = await list_persona_versions(assistant_id=assistant_id, db=db)
    return [PersonaVersionResponse.model_validate(version) for version in versions]


@router.post("/{assistant_id}/persona/versions/{version}/rollback", response_model=PersonaResponse)
async def post_persona_rollback(
    assistant_id: uuid.UUID, version: int, current_user: CurrentUser, db: DB
) -> AssistantPersona:
    """回滚到指定版本：取它的内容生成一个新版本。"""

    await _owned_assistant(assistant_id, current_user.id, db)
    try:
        persona = await rollback_persona(assistant_id=assistant_id, version=version, db=db)
    except PersonaVersionNotFoundError as error:
        raise HTTPException(status_code=404, detail="PERSONA_VERSION_NOT_FOUND") from error
    await db.commit()
    await db.refresh(persona)
    return persona


@router.get("/{assistant_id}/persona/preview", response_model=PersonaPreviewResponse)
async def get_persona_preview(
    assistant_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> PersonaPreviewResponse:
    """返回后端真实装配出的人格片段。

    预览故意走后端：前端自己拼就要复制一份截断逻辑，两边一旦漂移预览就会对用户撒谎。
    """

    await _owned_assistant(assistant_id, current_user.id, db)
    persona = await load_persona(assistant_id=assistant_id, db=db) or unsaved_default_persona(
        assistant_id
    )
    fragment = build_persona_fragment(persona)
    greeting = persona.greeting.strip()
    return PersonaPreviewResponse(
        fragment=fragment,
        truncated=bool(greeting) and greeting not in fragment,
        character_budget=PERSONA_CHARACTER_BUDGET,
    )
