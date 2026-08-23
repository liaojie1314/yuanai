"""Agent API 的授权、幂等和事件重放集成测试。"""

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, hash_password
from app.models.agent_run import AgentEvent, AgentRun, AgentRunStatus
from app.models.assistant import Assistant
from app.models.user import User


async def _assistant(db: AsyncSession, user: User) -> Assistant:
    assistant = Assistant(
        user_id=user.id,
        name="API 测试助理",
        default_model="test-model",
    )
    db.add(assistant)
    await db.commit()
    await db.refresh(assistant)
    return assistant


@pytest.mark.asyncio
async def test_run_creation_is_accepted_and_idempotent(
    client: AsyncClient, db: AsyncSession, test_user: User, auth_headers: dict[str, str]
) -> None:
    """Run 创建立即返回 202，重复幂等键复用同一个 Run。"""
    assistant = await _assistant(db, test_user)
    payload = {
        "assistantId": str(assistant.id),
        "goal": "读取当前时间",
        "idempotencyKey": "api-idempotency-1",
    }
    first = await client.post("/api/v1/agent/runs", headers=auth_headers, json=payload)
    second = await client.post("/api/v1/agent/runs", headers=auth_headers, json=payload)
    assert first.status_code == 202, first.text
    assert second.status_code == 202, second.text
    assert first.json()["id"] == second.json()["id"]


@pytest.mark.asyncio
async def test_run_and_events_are_tenant_isolated(
    client: AsyncClient, db: AsyncSession, test_user: User, auth_headers: dict[str, str]
) -> None:
    """另一个用户不能读取 Run 或事件。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="隔离测试",
        model="test-model",
        status=AgentRunStatus.queued,
    )
    db.add(run)
    await db.flush()
    db.add(
        AgentEvent(
            run_id=run.id,
            sequence=1,
            event_type="run_started",
            payload={"status": "queued"},
        )
    )
    await db.commit()
    other = User(
        email="other-agent@example.com",
        username=f"other-{uuid.uuid4().hex[:10]}",
        hashed_password=hash_password("Test1234!"),
    )
    db.add(other)
    await db.commit()
    other_headers = {"Authorization": f"Bearer {create_access_token(str(other.id))}"}
    response = await client.get(f"/api/v1/agent/runs/{run.id}", headers=other_headers)
    events = await client.get(f"/api/v1/agent/runs/{run.id}/events", headers=other_headers)
    assert response.status_code == 404
    assert events.status_code == 404


@pytest.mark.asyncio
async def test_event_stream_replays_after_last_event_id(
    client: AsyncClient, db: AsyncSession, test_user: User, auth_headers: dict[str, str]
) -> None:
    """SSE 只返回游标之后的事件，并保留事件 ID。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="重放测试",
        model="test-model",
        status=AgentRunStatus.queued,
    )
    db.add(run)
    await db.flush()
    db.add_all(
        [
            AgentEvent(run_id=run.id, sequence=1, event_type="run_started", payload={"n": 1}),
            AgentEvent(run_id=run.id, sequence=2, event_type="run_completed", payload={"n": 2}),
        ]
    )
    await db.commit()
    response = await client.get(
        f"/api/v1/agent/runs/{run.id}/stream",
        headers={**auth_headers, "Last-Event-ID": "1"},
    )
    assert response.status_code == 200
    assert "id: 2" in response.text
    assert '"n": 1' not in response.text
    assert "data: [DONE]" in response.text


@pytest.mark.asyncio
async def test_admin_summary_requires_allowlisted_user(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """普通登录用户不能访问运营摘要。"""
    response = await client.get("/api/v1/admin/agent-runs", headers=auth_headers)
    assert response.status_code == 403
