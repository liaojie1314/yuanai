"""专属助手人格的读写、版本、回滚与预览 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException
from sqlalchemy import select

from app.api.deps import DB, CurrentUser
from app.models.assistant import Assistant
from app.models.persona import AssistantPersona, PersonaCandidate, PersonaCandidateStatus
from app.schemas.persona import (
    PersonaCandidateResponse,
    PersonaPreviewResponse,
    PersonaResponse,
    PersonaUpdateRequest,
    PersonaVersionResponse,
)
from app.services.persona_candidate_service import (
    PersonaCandidateDecidedError,
    PersonaCandidateFieldError,
    accept_candidate,
    list_candidates,
    owned_candidate,
    reject_candidate,
)
from app.services.persona_service import (
    PERSONA_CHARACTER_BUDGET,
    PersonaVersionNotFoundError,
    build_persona_fragment,
    list_persona_versions,
    load_persona,
    persona_with_overrides,
    rollback_persona,
    save_persona,
    unsaved_default_persona,
)

router = APIRouter(prefix="/agent/assistants", tags=["persona"])
# 候选项不挂在某个助理之下：收件箱是「用户的待确认事项」，跨助理一起看。
candidates_router = APIRouter(prefix="/agent/persona-candidates", tags=["persona"])


@candidates_router.get("", response_model=list[PersonaCandidateResponse])
async def get_persona_candidates(
    current_user: CurrentUser,
    db: DB,
    status: PersonaCandidateStatus = PersonaCandidateStatus.pending,
) -> list[PersonaCandidateResponse]:
    """列出当前用户的人格候选项，默认只看待确认的。"""

    candidates = await list_candidates(user_id=current_user.id, status=status, db=db)
    return [PersonaCandidateResponse.model_validate(item) for item in candidates]


@candidates_router.post("/{candidate_id}/accept", response_model=PersonaResponse)
async def accept_persona_candidate(
    candidate_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> AssistantPersona:
    """确认候选项：写入人格并生成新版本。"""

    candidate = await _owned_candidate(candidate_id, current_user.id, db)
    try:
        persona = await accept_candidate(candidate=candidate, db=db)
    except PersonaCandidateDecidedError as error:
        raise HTTPException(status_code=409, detail="PERSONA_CANDIDATE_ALREADY_DECIDED") from error
    except PersonaCandidateFieldError as error:
        raise HTTPException(status_code=400, detail="PERSONA_FIELD_NOT_EDITABLE") from error
    except ValueError as error:
        raise HTTPException(status_code=400, detail="PERSONA_VALUE_INVALID") from error
    await db.commit()
    await db.refresh(persona)
    return persona


@candidates_router.post("/{candidate_id}/reject", response_model=PersonaCandidateResponse)
async def reject_persona_candidate(
    candidate_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> PersonaCandidate:
    """拒绝候选项：人格不变，只记下这次决策。"""

    candidate = await _owned_candidate(candidate_id, current_user.id, db)
    try:
        rejected = await reject_candidate(candidate=candidate, db=db)
    except PersonaCandidateDecidedError as error:
        raise HTTPException(status_code=409, detail="PERSONA_CANDIDATE_ALREADY_DECIDED") from error
    await db.commit()
    await db.refresh(rejected)
    return rejected


async def _owned_candidate(candidate_id: uuid.UUID, user_id: uuid.UUID, db: DB) -> PersonaCandidate:
    """校验候选项归属；不存在与属于别人一律同一个 404。"""

    candidate = await owned_candidate(candidate_id=candidate_id, user_id=user_id, db=db)
    if candidate is None:
        raise HTTPException(status_code=404, detail="PERSONA_CANDIDATE_NOT_FOUND")
    return candidate


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


@router.post("/{assistant_id}/persona/preview", response_model=PersonaPreviewResponse)
async def post_persona_preview(
    assistant_id: uuid.UUID,
    current_user: CurrentUser,
    db: DB,
    draft: PersonaUpdateRequest | None = None,
) -> PersonaPreviewResponse:
    """返回后端真实装配出的人格片段，可带未保存草稿。

    预览故意走后端：前端自己拼就要复制一份截断逻辑，两边一旦漂移预览就会对用户撒谎。
    草稿走请求体而不是查询参数 —— 开场白与拒绝话术是自由文本，放 URL 既可能超长，
    也会把人格内容写进访问日志。草稿只影响这一次装配，不落库。
    """

    await _owned_assistant(assistant_id, current_user.id, db)
    persona = await load_persona(assistant_id=assistant_id, db=db) or unsaved_default_persona(
        assistant_id
    )
    if draft is not None:
        persona = persona_with_overrides(persona, draft.model_dump(exclude_unset=True))
    fragment = build_persona_fragment(persona)
    greeting = persona.greeting.strip()
    return PersonaPreviewResponse(
        fragment=fragment,
        truncated=bool(greeting) and greeting not in fragment,
        character_budget=PERSONA_CHARACTER_BUDGET,
    )
