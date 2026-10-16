"""人格候选项：预筛、落库与确认生效。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.persona import (
    AssistantPersona,
    PersonaCandidate,
    PersonaCandidateSource,
    PersonaCandidateStatus,
)
from app.services.ai_service import extract_memory_candidates
from app.services.persona_service import (
    PERSONA_EDITABLE_FIELDS,
    bump_version,
    coerce_persona_value,
    persona_for_write,
)

# 纯字符串预筛：不命中就整条路径零开销，不会为每轮聊天多付一次模型调用。
_CUE_WORDS = (
    "别这么",
    "太啰嗦",
    "啰嗦",
    "简短",
    "说简单",
    "详细点",
    "说详细",
    "语气",
    "叫我",
    "别叫我",
    "称呼",
)
CUE_MAX_CHARS = 60


def looks_like_style_correction(text: str) -> bool:
    """判断这句话是否像在纠正表达方式；纯字符串匹配，不调模型。"""

    stripped = text.strip()
    if not stripped or len(stripped) > CUE_MAX_CHARS:
        return False
    return any(cue in stripped for cue in _CUE_WORDS)


class PersonaCandidateFieldError(ValueError):
    """候选项字段不在白名单内。"""


class PersonaCandidateDecidedError(Exception):
    """候选项已经处理过，不能重复决策。"""


async def extract_from_chat(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, text: str, db: AsyncSession
) -> list[PersonaCandidate]:
    """从一句疑似表达方式纠正里抽人格候选项，落库为待确认。

    只取模型输出里 ``persona_field`` 非空的条目 —— 聊天侧这条路径是为人格而开的，
    顺带抽出的用户事实归 Run 侧的记忆抽取负责，两边都写会造出重复。
    """

    assistant = await db.scalar(
        select(Assistant).where(Assistant.id == assistant_id, Assistant.user_id == user_id)
    )
    if assistant is None:
        return []
    extracted = await extract_memory_candidates(goal=text, transcript=text)
    if not extracted:
        return []
    created: list[PersonaCandidate] = []
    for item in extracted:
        if item.persona_field is None:
            continue
        if await _pending_duplicate(
            user_id=user_id,
            assistant_id=assistant_id,
            field=item.persona_field,
            value=item.suggested_value,
            db=db,
        ):
            # 用户把同一句话说三遍不该在收件箱里堆出三条一样的待确认项。
            continue
        candidate = PersonaCandidate(
            user_id=user_id,
            assistant_id=assistant_id,
            field=item.persona_field,
            suggested_value=item.suggested_value,
            evidence=text[:2000],
            source_type=PersonaCandidateSource.chat,
        )
        db.add(candidate)
        created.append(candidate)
    await db.flush()
    return created


async def _pending_duplicate(
    *,
    user_id: uuid.UUID,
    assistant_id: uuid.UUID,
    field: str,
    value: str,
    db: AsyncSession,
) -> bool:
    """判断同一助理下是否已有同字段同取值的待确认候选项。"""

    existing = await db.scalar(
        select(PersonaCandidate.id).where(
            PersonaCandidate.user_id == user_id,
            PersonaCandidate.assistant_id == assistant_id,
            PersonaCandidate.field == field,
            PersonaCandidate.suggested_value == value,
            PersonaCandidate.status == PersonaCandidateStatus.pending,
        )
    )
    return existing is not None


async def list_candidates(
    *, user_id: uuid.UUID, status: PersonaCandidateStatus | None, db: AsyncSession
) -> list[PersonaCandidate]:
    """列出当前用户的候选项，可按状态筛选，最新的在前。"""

    query = select(PersonaCandidate).where(PersonaCandidate.user_id == user_id)
    if status is not None:
        query = query.where(PersonaCandidate.status == status)
    rows = await db.scalars(query.order_by(PersonaCandidate.created_at.desc()))
    return list(rows.all())


async def owned_candidate(
    *, candidate_id: uuid.UUID, user_id: uuid.UUID, db: AsyncSession
) -> PersonaCandidate | None:
    """按归属取候选项；不存在与属于别人一律返回 ``None``。"""

    candidate: PersonaCandidate | None = await db.scalar(
        select(PersonaCandidate).where(
            PersonaCandidate.id == candidate_id, PersonaCandidate.user_id == user_id
        )
    )
    return candidate


async def accept_candidate(*, candidate: PersonaCandidate, db: AsyncSession) -> AssistantPersona:
    """确认候选项：写入人格、生成新版本、标记候选项已接受。

    ``candidate.field`` 来自模型输出，是不可信输入，因此必须过白名单 ——
    直接 setattr 的话，模型吐一个 ``is_default`` 就能改到人格以外的东西。
    白名单刻意不含 ``forbidden_topics``：限制类字段只能由用户自己改，
    否则模型可以靠一条候选项把禁止话题清空。
    """

    _require_pending(candidate)
    if candidate.field not in PERSONA_EDITABLE_FIELDS:
        raise PersonaCandidateFieldError(candidate.field)
    value = coerce_persona_value(candidate.field, candidate.suggested_value)
    persona = await persona_for_write(assistant_id=candidate.assistant_id, db=db)
    setattr(persona, candidate.field, value)
    await bump_version(persona=persona, change_reason=f"candidate:{candidate.id}", db=db)
    candidate.status = PersonaCandidateStatus.accepted
    candidate.decided_at = datetime.now(UTC)
    return persona


async def reject_candidate(*, candidate: PersonaCandidate, db: AsyncSession) -> PersonaCandidate:
    """拒绝候选项：只改状态，人格与版本号都不动。"""

    _require_pending(candidate)
    candidate.status = PersonaCandidateStatus.rejected
    candidate.decided_at = datetime.now(UTC)
    await db.flush()
    return candidate


def _require_pending(candidate: PersonaCandidate) -> None:
    """已决策的候选项不能再次决策。

    重复 accept 会把人格版本号白白推高一级，历史里出现一条内容没变的版本。
    """

    if candidate.status is not PersonaCandidateStatus.pending:
        raise PersonaCandidateDecidedError(str(candidate.id))
