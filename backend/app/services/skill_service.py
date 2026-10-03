"""Skill 草稿、验证、评测、激活、回滚和安装范围服务。"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from decimal import Decimal

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.assistant import Assistant
from app.models.skill import (
    Skill,
    SkillEvaluation,
    SkillEvaluationMode,
    SkillEvaluationStatus,
    SkillInstallation,
    SkillInstallationScope,
    SkillVersion,
    SkillVersionStatus,
)
from app.schemas.skill import SkillDraftCreate, SkillInstallationUpdate, SkillVersionDraftCreate
from app.services.skill_evaluation import run_static_contract_cases
from app.services.skill_validation import (
    SkillManifest,
    SkillManifestError,
    content_digest,
    parse_manifest,
    validate_manifest_tools,
)
from app.tools.builtin import build_phase6_registry
from app.tools.registry import ToolRegistry


class SkillNotFoundError(RuntimeError):
    """目标 Skill 或版本不属于当前用户时使用的稳定错误。"""


class SkillStateError(RuntimeError):
    """Skill 生命周期不允许当前操作时使用的稳定错误。"""


async def list_skills(*, user_id: uuid.UUID, db: AsyncSession) -> list[Skill]:
    """返回当前用户的完整 Skill 管理快照。"""

    return list(
        (
            await db.scalars(
                _skill_query().where(Skill.user_id == user_id).order_by(Skill.updated_at.desc())
            )
        )
        .unique()
        .all()
    )


async def create_skill_draft(
    *, user_id: uuid.UUID, request: SkillDraftCreate, db: AsyncSession
) -> Skill:
    """创建稳定 Skill 身份及其首个不可变草稿版本。"""

    manifest = parse_manifest(request.manifest, request.skill_md)
    existing = await db.scalar(
        select(Skill.id).where(Skill.user_id == user_id, Skill.slug == manifest.id)
    )
    if existing is not None:
        raise SkillStateError("SKILL_SLUG_ALREADY_EXISTS")
    skill = Skill(
        user_id=user_id, slug=manifest.id, name=manifest.name, description=manifest.description
    )
    skill.versions.append(_draft_version(manifest=manifest, request=request))
    db.add(skill)
    await db.commit()
    return await _owned_skill(skill_id=skill.id, user_id=user_id, db=db)


async def create_skill_version_draft(
    *, skill_id: uuid.UUID, user_id: uuid.UUID, request: SkillVersionDraftCreate, db: AsyncSession
) -> Skill:
    """为已有 Skill 追加新版草稿，绝不覆盖已有版本内容。"""

    skill = await _owned_skill(skill_id=skill_id, user_id=user_id, db=db)
    manifest = parse_manifest(request.manifest, request.skill_md)
    if manifest.id != skill.slug:
        raise SkillStateError("SKILL_MANIFEST_ID_MISMATCH")
    if any(version.version == manifest.version for version in skill.versions):
        raise SkillStateError("SKILL_VERSION_ALREADY_EXISTS")
    skill.versions.append(_draft_version(manifest=manifest, request=request))
    skill.name = manifest.name
    skill.description = manifest.description
    await db.commit()
    return await _owned_skill(skill_id=skill_id, user_id=user_id, db=db)


async def validate_skill_version(
    *,
    skill_id: uuid.UUID,
    version_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    registry: ToolRegistry | None = None,
) -> SkillVersion:
    """针对当前注册工具验证草稿，失败时保留拒绝结果供用户修订。"""

    version = await _owned_version(skill_id, version_id, user_id=user_id, db=db)
    if version.status not in {SkillVersionStatus.draft, SkillVersionStatus.rejected}:
        raise SkillStateError("SKILL_VERSION_NOT_VALIDATABLE")
    version.status = SkillVersionStatus.validating
    await db.flush()
    try:
        manifest = parse_manifest(version.manifest_text, version.skill_md)
        result = validate_manifest_tools(manifest, registry or build_phase6_registry())
    except SkillManifestError as error:
        version.status = SkillVersionStatus.rejected
        version.validation_result = {"valid": False}
        version.validation_errors = error.errors
        version.validated_at = datetime.now(UTC)
    else:
        version.status = SkillVersionStatus.validated
        version.required_tools = manifest.required_tools
        version.risk_ceiling = manifest.risk_ceiling
        version.validation_result = result
        version.validation_errors = []
        version.validated_at = datetime.now(UTC)
    await db.commit()
    # 不能用 refresh：它会连关系一起过期，响应随后读 evaluations 就会在异步会话里
    # 惰性加载并抛 MissingGreenlet。重新按预加载查询取一次。
    return await _owned_version(skill_id, version_id, user_id=user_id, db=db)


async def evaluate_skill_version(
    *,
    skill_id: uuid.UUID,
    version_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    registry: ToolRegistry | None = None,
) -> SkillEvaluation:
    """针对当前工具注册表重放静态契约用例并留档，供激活门禁读取。

    评测不改版本状态：版本内容不可变，一次评测只是对「当下的注册表与 active 版本」
    下的一次判定，允许重复执行，门禁只看最近一次结果。
    """

    skill = await _owned_skill(skill_id=skill_id, user_id=user_id, db=db)
    version = next((item for item in skill.versions if item.id == version_id), None)
    if version is None:
        raise SkillNotFoundError()
    started = time.perf_counter()
    cases = run_static_contract_cases(
        version=version,
        active_version=_active_version(skill),
        registry=registry or build_phase6_registry(),
    )
    duration_ms = int((time.perf_counter() - started) * 1000)
    passed_cases = sum(1 for case in cases if case.passed)
    evaluation = SkillEvaluation(
        skill_id=skill.id,
        version_id=version.id,
        status=(
            SkillEvaluationStatus.passed
            if passed_cases == len(cases)
            else SkillEvaluationStatus.failed
        ),
        # 静态契约评测不执行 Skill，成本与平均 Step 没有数据源，必须留 NULL。
        mode=SkillEvaluationMode.static_contract,
        case_results=[case.as_record() for case in cases],
        total_cases=len(cases),
        passed_cases=passed_cases,
        pass_rate=Decimal(passed_cases) / Decimal(len(cases)),
        estimated_cost_usd=None,
        avg_steps=None,
        duration_ms=duration_ms,
    )
    # 挂到关系上而不是只写外键：会话不过期提交时，内存里的 evaluations 必须同步更新，
    # 否则同一会话随后读到的版本看起来「从未评测过」。
    version.evaluations.append(evaluation)
    await db.commit()
    await db.refresh(evaluation)
    return evaluation


async def activate_skill_version(
    *, skill_id: uuid.UUID, version_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> Skill:
    """显式激活已验证版本，并废弃此前活动版本。"""

    return await _set_active_version(
        skill_id=skill_id,
        version_id=version_id,
        user_id=user_id,
        db=db,
        rollback=False,
    )


async def rollback_skill_version(
    *, skill_id: uuid.UUID, version_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> Skill:
    """把通过过验证的历史版本重新设为活动版本。"""

    return await _set_active_version(
        skill_id=skill_id,
        version_id=version_id,
        user_id=user_id,
        db=db,
        rollback=True,
    )


async def install_skill(
    *, skill_id: uuid.UUID, user_id: uuid.UUID, request: SkillInstallationUpdate, db: AsyncSession
) -> SkillInstallation:
    """为已激活 Skill 写入全局或单助理安装范围。"""

    skill = await _owned_skill(skill_id=skill_id, user_id=user_id, db=db)
    if skill.current_version_id is None:
        raise SkillStateError("SKILL_ACTIVE_VERSION_REQUIRED")
    if request.scope is SkillInstallationScope.global_:
        if request.assistant_id is not None:
            raise SkillStateError("SKILL_GLOBAL_INSTALLATION_CANNOT_TARGET_ASSISTANT")
        scope_key = "global"
    else:
        if request.assistant_id is None:
            raise SkillStateError("SKILL_ASSISTANT_REQUIRED")
        assistant = await db.scalar(
            select(Assistant.id).where(
                Assistant.id == request.assistant_id, Assistant.user_id == user_id
            )
        )
        if assistant is None:
            raise SkillNotFoundError()
        scope_key = f"assistant:{request.assistant_id}"
    installation = await db.scalar(
        select(SkillInstallation).where(
            SkillInstallation.user_id == user_id,
            SkillInstallation.skill_id == skill.id,
            SkillInstallation.scope_key == scope_key,
        )
    )
    if installation is None:
        installation = SkillInstallation(
            user_id=user_id,
            skill_id=skill.id,
            scope=request.scope,
            scope_key=scope_key,
            assistant_id=request.assistant_id,
        )
        db.add(installation)
        await db.commit()
        await db.refresh(installation)
    return installation


async def _set_active_version(
    *,
    skill_id: uuid.UUID,
    version_id: uuid.UUID,
    user_id: uuid.UUID,
    db: AsyncSession,
    rollback: bool,
) -> Skill:
    """在单个事务内切换当前版本，保持同时只有一个活动版本。"""

    skill = await db.scalar(
        _skill_query().where(Skill.id == skill_id, Skill.user_id == user_id).with_for_update()
    )
    if skill is None:
        raise SkillNotFoundError()
    version = next((item for item in skill.versions if item.id == version_id), None)
    if version is None:
        raise SkillNotFoundError()
    allowed_status = SkillVersionStatus.deprecated if rollback else SkillVersionStatus.validated
    if version.status is not allowed_status:
        raise SkillStateError(
            "SKILL_VERSION_NOT_ROLLBACKABLE" if rollback else "SKILL_VERSION_NOT_VALIDATED"
        )
    # 门禁只在「替换已有 active 版本」时强制：首次激活没有可被弄坏的生产版本，
    # 回滚是评测回退时的恢复手段，再加门禁会把唯一的退路也堵上。
    if not rollback:
        previous = _active_version(skill)
        if previous is not None and previous.id != version.id:
            await _require_passing_evaluation(version_id=version.id, db=db)
    for item in skill.versions:
        if item.status is SkillVersionStatus.active:
            item.status = SkillVersionStatus.deprecated
    version.status = SkillVersionStatus.active
    skill.current_version_id = version.id
    await db.commit()
    return await _owned_skill(skill_id=skill.id, user_id=user_id, db=db)


def _active_version(skill: Skill) -> SkillVersion | None:
    """返回当前活动版本；以版本状态为准，不依赖可能滞后的外键。"""

    return next((item for item in skill.versions if item.status is SkillVersionStatus.active), None)


async def _require_passing_evaluation(*, version_id: uuid.UUID, db: AsyncSession) -> None:
    """要求目标版本最近一次评测通过，否则拒绝替换 active 版本。

    只看**最近一次**：注册表变化后重测出的失败结果必须能推翻此前的通过记录。
    没有评测记录时拒绝，而不是放行 —— 门禁 fail closed。
    """

    latest = await db.scalar(
        select(SkillEvaluation)
        .where(SkillEvaluation.version_id == version_id)
        .order_by(SkillEvaluation.created_at.desc())
        .limit(1)
    )
    if latest is None:
        raise SkillStateError("SKILL_VERSION_EVALUATION_REQUIRED")
    if latest.status is not SkillEvaluationStatus.passed:
        raise SkillStateError("SKILL_VERSION_EVALUATION_FAILED")


def _draft_version(
    *, manifest: SkillManifest, request: SkillDraftCreate | SkillVersionDraftCreate
) -> SkillVersion:
    """从已解析 manifest 构造仅可追加的草稿版本。"""

    digest = content_digest(request.manifest, request.skill_md)
    return SkillVersion(
        version=manifest.version,
        manifest_text=request.manifest,
        skill_md=request.skill_md,
        content_hash=digest,
        required_tools=manifest.required_tools,
        risk_ceiling=manifest.risk_ceiling,
    )


def _skill_query() -> Select[tuple[Skill]]:
    """构造一次性加载版本、评测和安装范围的 Skill 查询。

    评测必须随版本预加载：响应要展示门禁状态，而异步会话下惰性加载会直接抛错。
    """

    return select(Skill).options(
        selectinload(Skill.versions).selectinload(SkillVersion.evaluations),
        selectinload(Skill.installations),
    )


async def _owned_skill(*, skill_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession) -> Skill:
    """按租户读取 Skill，避免 ID 枚举。"""

    skill = await db.scalar(_skill_query().where(Skill.id == skill_id, Skill.user_id == user_id))
    if skill is None:
        raise SkillNotFoundError()
    return skill


async def _owned_version(
    skill_id: uuid.UUID, version_id: uuid.UUID, *, user_id: uuid.UUID, db: AsyncSession
) -> SkillVersion:
    """按用户与 Skill 双重条件读取版本，防止跨租户版本操作。"""

    version = await db.scalar(
        select(SkillVersion)
        .options(selectinload(SkillVersion.evaluations))
        .join(Skill, Skill.id == SkillVersion.skill_id)
        .where(
            SkillVersion.id == version_id,
            SkillVersion.skill_id == skill_id,
            Skill.user_id == user_id,
        )
    )
    if version is None:
        raise SkillNotFoundError()
    return version
