"""用户版本化 Skill 的管理 API。"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException

from app.api.deps import DB, CurrentUser
from app.models.skill import Skill, SkillInstallation, SkillVersion
from app.schemas.skill import (
    SkillDraftCreate,
    SkillInstallationResponse,
    SkillInstallationUpdate,
    SkillResponse,
    SkillVersionDraftCreate,
    SkillVersionResponse,
)
from app.services.skill_service import (
    SkillNotFoundError,
    SkillStateError,
    activate_skill_version,
    create_skill_draft,
    create_skill_version_draft,
    install_skill,
    list_skills,
    rollback_skill_version,
    validate_skill_version,
)
from app.services.skill_validation import SkillManifestError

router = APIRouter(prefix="/skills", tags=["skills"])


@router.get("", response_model=list[SkillResponse])
async def get_skills(current_user: CurrentUser, db: DB) -> list[Skill]:
    """列出当前用户的 Skill、版本与安装范围。"""

    return await list_skills(user_id=current_user.id, db=db)


@router.post("", response_model=SkillResponse, status_code=201)
async def create_skill(request: SkillDraftCreate, current_user: CurrentUser, db: DB) -> Skill:
    """创建一个包含首个草稿版本的新 Skill。"""

    try:
        return await create_skill_draft(user_id=current_user.id, request=request, db=db)
    except SkillManifestError as error:
        raise HTTPException(status_code=422, detail=error.errors) from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{skill_id}/versions", response_model=SkillResponse, status_code=201)
async def create_skill_version(
    skill_id: uuid.UUID, request: SkillVersionDraftCreate, current_user: CurrentUser, db: DB
) -> Skill:
    """为已有 Skill 追加不可变草稿版本。"""

    try:
        return await create_skill_version_draft(
            skill_id=skill_id, user_id=current_user.id, request=request, db=db
        )
    except SkillManifestError as error:
        raise HTTPException(status_code=422, detail=error.errors) from error
    except SkillNotFoundError as error:
        raise HTTPException(status_code=404, detail="SKILL_NOT_FOUND") from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{skill_id}/versions/{version_id}/validate", response_model=SkillVersionResponse)
async def validate_version(
    skill_id: uuid.UUID, version_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> SkillVersion:
    """验证草稿版本引用的工具、版本与风险声明。"""

    try:
        return await validate_skill_version(
            skill_id=skill_id, version_id=version_id, user_id=current_user.id, db=db
        )
    except SkillNotFoundError as error:
        raise HTTPException(status_code=404, detail="SKILL_VERSION_NOT_FOUND") from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{skill_id}/versions/{version_id}/activate", response_model=SkillResponse)
async def activate_version(
    skill_id: uuid.UUID, version_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> Skill:
    """显式激活已验证版本。"""

    try:
        return await activate_skill_version(
            skill_id=skill_id, version_id=version_id, user_id=current_user.id, db=db
        )
    except SkillNotFoundError as error:
        raise HTTPException(status_code=404, detail="SKILL_VERSION_NOT_FOUND") from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.post("/{skill_id}/versions/{version_id}/rollback", response_model=SkillResponse)
async def rollback_version(
    skill_id: uuid.UUID, version_id: uuid.UUID, current_user: CurrentUser, db: DB
) -> Skill:
    """将历史已验证版本回滚为活动版本。"""

    try:
        return await rollback_skill_version(
            skill_id=skill_id, version_id=version_id, user_id=current_user.id, db=db
        )
    except SkillNotFoundError as error:
        raise HTTPException(status_code=404, detail="SKILL_VERSION_NOT_FOUND") from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error


@router.put("/{skill_id}/installations", response_model=SkillInstallationResponse)
async def update_installation(
    skill_id: uuid.UUID, request: SkillInstallationUpdate, current_user: CurrentUser, db: DB
) -> SkillInstallation:
    """设置当前用户的 Skill 可用范围。"""

    try:
        return await install_skill(
            skill_id=skill_id, user_id=current_user.id, request=request, db=db
        )
    except SkillNotFoundError as error:
        raise HTTPException(status_code=404, detail="SKILL_OR_ASSISTANT_NOT_FOUND") from error
    except SkillStateError as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
