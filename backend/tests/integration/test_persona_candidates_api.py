"""人格候选项的列表、白名单与确认生效。"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.assistant import Assistant
from app.models.persona import PersonaCandidate, PersonaCandidateSource


async def _assistant(client: AsyncClient, headers: dict[str, str], db: AsyncSession) -> Assistant:
    """取当前用户的默认助理实体（顺带触发懒建）。"""

    listed = (await client.get("/api/v1/agent/assistants", headers=headers)).json()
    assistant = await db.get(Assistant, uuid.UUID(listed[0]["id"]))
    assert assistant is not None
    return assistant


async def _candidate(
    db: AsyncSession, assistant: Assistant, *, field: str, value: str
) -> PersonaCandidate:
    """落一条待确认的候选项。"""

    candidate = PersonaCandidate(
        user_id=assistant.user_id,
        assistant_id=assistant.id,
        field=field,
        suggested_value=value,
        evidence="别这么啰嗦",
        source_type=PersonaCandidateSource.chat,
    )
    db.add(candidate)
    await db.commit()
    return candidate


@pytest.mark.asyncio
async def test_accept_rejects_fields_outside_whitelist(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """候选项的 field 来自模型输出，白名单外的一律拒绝，不得 setattr 任意属性。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="is_default", value="False")

    response = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=auth_headers
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "PERSONA_FIELD_NOT_EDITABLE"
    await db.refresh(assistant)
    assert assistant.is_default is True


@pytest.mark.asyncio
async def test_accept_rejects_forbidden_topics(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """限制类字段不接受模型建议：放宽禁止话题不能靠一条候选项完成。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="forbidden_topics", value="[]")

    response = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=auth_headers
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "PERSONA_FIELD_NOT_EDITABLE"


@pytest.mark.asyncio
async def test_accept_rejects_invalid_enum_value(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """白名单内但取值非法时 400，不把脏值推到落库才炸。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="tone", value="怎么都行")

    response = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=auth_headers
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "PERSONA_VALUE_INVALID"


@pytest.mark.asyncio
async def test_candidate_does_not_apply_until_accepted(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """未确认的候选项不改变人格（phase-7 §8.5.5：人格是身份，不能被悄悄改写）。"""

    assistant = await _assistant(client, auth_headers, db)
    await _candidate(db, assistant, field="verbosity", value="brief")

    listed = await client.get("/api/v1/agent/persona-candidates", headers=auth_headers)
    assert listed.status_code == 200, listed.text
    assert len(listed.json()) == 1
    persona = await client.get(
        f"/api/v1/agent/assistants/{assistant.id}/persona", headers=auth_headers
    )
    assert persona.json()["verbosity"] == "balanced"
    assert persona.json()["version"] == 1


@pytest.mark.asyncio
async def test_accept_bumps_persona_version(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """确认后人格生效并生成 change_reason=candidate:{id} 的新版本。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="verbosity", value="brief")

    accepted = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=auth_headers
    )
    assert accepted.status_code == 200, accepted.text
    assert accepted.json()["verbosity"] == "brief"
    versions = await client.get(
        f"/api/v1/agent/assistants/{assistant.id}/persona/versions", headers=auth_headers
    )
    assert versions.json()[0]["changeReason"] == f"candidate:{candidate.id}"
    again = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=auth_headers
    )
    assert again.status_code == 409
    assert again.json()["detail"] == "PERSONA_CANDIDATE_ALREADY_DECIDED"


@pytest.mark.asyncio
async def test_reject_marks_candidate_without_touching_persona(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """拒绝只改候选项状态，人格与版本号都不动。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="verbosity", value="brief")

    rejected = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/reject", headers=auth_headers
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["status"] == "rejected"

    persona = await client.get(
        f"/api/v1/agent/assistants/{assistant.id}/persona", headers=auth_headers
    )
    assert persona.json()["verbosity"] == "balanced"
    assert persona.json()["version"] == 1
    assert (await client.get("/api/v1/agent/persona-candidates", headers=auth_headers)).json() == []


@pytest.mark.asyncio
async def test_other_users_candidate_is_404(
    client: AsyncClient, auth_headers: dict[str, str], db: AsyncSession
) -> None:
    """别人的候选项既不可见也不可决策。"""

    assistant = await _assistant(client, auth_headers, db)
    candidate = await _candidate(db, assistant, field="verbosity", value="brief")

    from app.core.security import create_access_token
    from app.models.user import User

    other = User(
        id=uuid.uuid4(),
        email="persona-candidate-other@example.com",
        username="pc-other",
        hashed_password="x",
    )
    db.add(other)
    await db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}

    assert (
        await client.get("/api/v1/agent/persona-candidates", headers=other_headers)
    ).json() == []
    response = await client.post(
        f"/api/v1/agent/persona-candidates/{candidate.id}/accept", headers=other_headers
    )
    assert response.status_code == 404
