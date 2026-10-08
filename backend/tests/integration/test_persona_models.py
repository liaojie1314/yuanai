"""人格三张新表与两处列变更的落库行为。"""

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.memory import Memory, MemoryType
from app.models.persona import (
    AssistantPersona,
    AssistantPersonaVersion,
    PersonaCandidate,
    PersonaCandidateSource,
    PersonaCandidateStatus,
    PersonaTone,
    PersonaVerbosity,
)
from app.models.user import User


async def _user_with_assistant(db: AsyncSession) -> tuple[User, Assistant]:
    """建一个用户与一个助理，作为人格与记忆的挂载点。"""

    user = User(
        email=f"{uuid.uuid4()}@example.com",
        username=str(uuid.uuid4())[:12],
        hashed_password="x",
    )
    db.add(user)
    await db.flush()
    assistant = Assistant(user_id=user.id, name="工作助理", default_model="deepseek-v4-flash")
    db.add(assistant)
    await db.flush()
    return user, assistant


@pytest.mark.asyncio
async def test_persona_round_trip(db: AsyncSession) -> None:
    """人格可写入并带回默认语气与长度偏好。"""

    _, assistant = await _user_with_assistant(db)
    db.add(AssistantPersona(assistant_id=assistant.id, greeting="早", forbidden_topics=["赌博"]))
    await db.flush()
    loaded = await db.scalar(
        select(AssistantPersona).where(AssistantPersona.assistant_id == assistant.id)
    )
    assert loaded is not None
    assert loaded.tone is PersonaTone.concise
    assert loaded.verbosity is PersonaVerbosity.balanced
    assert loaded.forbidden_topics == ["赌博"]
    assert loaded.version == 1


@pytest.mark.asyncio
async def test_persona_version_snapshot_is_unique_per_version(db: AsyncSession) -> None:
    """同一助理的同一版本号只能存一条。"""

    _, assistant = await _user_with_assistant(db)
    db.add(
        AssistantPersonaVersion(
            assistant_id=assistant.id,
            version=1,
            payload={"tone": "concise"},
            change_reason="manual",
        )
    )
    await db.flush()
    db.add(
        AssistantPersonaVersion(
            assistant_id=assistant.id,
            version=1,
            payload={"tone": "patient"},
            change_reason="manual",
        )
    )
    with pytest.raises(Exception):  # noqa: B017 — 唯一约束冲突的具体异常类型由驱动决定
        await db.flush()


@pytest.mark.asyncio
async def test_memory_assistant_id_accepts_null(db: AsyncSession) -> None:
    """用户级记忆以 assistant_id 为 NULL 表达。"""

    user, _ = await _user_with_assistant(db)
    memory = Memory(
        user_id=user.id,
        assistant_id=None,
        memory_type=MemoryType.profile,
        content="我在东八区",
        source_type="manual",
    )
    db.add(memory)
    await db.flush()
    assert memory.assistant_id is None


@pytest.mark.asyncio
async def test_persona_candidate_defaults_to_pending(db: AsyncSession) -> None:
    """候选项落库即为待确认，不自动生效。"""

    user, assistant = await _user_with_assistant(db)
    candidate = PersonaCandidate(
        user_id=user.id,
        assistant_id=assistant.id,
        field="verbosity",
        suggested_value="brief",
        evidence="别这么啰嗦",
        source_type=PersonaCandidateSource.chat,
    )
    db.add(candidate)
    await db.flush()
    assert candidate.status is PersonaCandidateStatus.pending
    assert candidate.decided_at is None
