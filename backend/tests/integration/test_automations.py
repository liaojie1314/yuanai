"""自动化 API、租户隔离和并发 due claim 集成覆盖。"""

import asyncio
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select

from app.core.config import settings
from app.models.agent_run import AgentRun, AgentRunStatus
from app.models.automation import AutomationRun, AutomationRunStatus
from app.services.automation_service import claim_due_automations, sync_automation_runs
from tests.conftest import TestSessionLocal


async def _create_assistant(client: AsyncClient, headers: dict[str, str]) -> str:
    response = await client.post(
        "/api/v1/agent/assistants",
        headers=headers,
        json={"name": "Automation", "defaultModel": "deepseek-chat"},
    )
    assert response.status_code == 201
    return response.json()["id"]


async def test_automation_api_is_tenant_scoped_and_supports_pause_resume(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """自动化创建、暂停、恢复和列表只暴露当前租户数据。"""

    assistant_id = await _create_assistant(client, auth_headers)
    response = await client.post(
        "/api/v1/automations",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "name": "Daily brief",
            "goal": "Summarize today",
            "timezone": "Asia/Shanghai",
            "trigger": {
                "triggerType": "once",
                "scheduledAt": (datetime.now(UTC) + timedelta(hours=1)).isoformat(),
            },
        },
    )
    assert response.status_code == 201
    automation_id = response.json()["id"]
    assert response.json()["trigger"]["triggerType"] == "once"

    paused = await client.post(f"/api/v1/automations/{automation_id}/pause", headers=auth_headers)
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"
    resumed = await client.post(f"/api/v1/automations/{automation_id}/resume", headers=auth_headers)
    assert resumed.status_code == 200
    assert resumed.json()["status"] == "active"
    listed = await client.get("/api/v1/automations", headers=auth_headers)
    assert listed.json()[0]["id"] == automation_id


async def test_concurrent_due_claim_creates_one_agent_run(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """两个调度器同时扫描同一到期触发器时只产生一个标准 Run。"""

    assistant_id = await _create_assistant(client, auth_headers)
    scheduled = datetime.now(UTC) - timedelta(minutes=1)
    created = await client.post(
        "/api/v1/automations",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "name": "Once",
            "goal": "Run once",
            "timezone": "UTC",
            "trigger": {"triggerType": "once", "scheduledAt": scheduled.isoformat()},
        },
    )
    assert created.status_code == 201
    now = datetime.now(UTC)

    async def claim() -> int:
        async with TestSessionLocal() as session:
            return len(await claim_due_automations(now=now, db=session))

    claimed = await asyncio.gather(claim(), claim())
    assert sorted(claimed) == [0, 1]
    async with TestSessionLocal() as session:
        assert await session.scalar(select(func.count(AgentRun.id))) == 1
        assert await session.scalar(select(func.count(AutomationRun.id))) == 1


async def test_run_now_creates_a_standard_agent_run(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """手动触发也只创建标准 AgentRun 映射。"""

    assistant_id = await _create_assistant(client, auth_headers)
    created = await client.post(
        "/api/v1/automations",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "name": "Manual",
            "goal": "Run now",
            "timezone": "UTC",
            "trigger": {
                "triggerType": "cron",
                "cronExpression": "*/5 * * * *",
            },
        },
    )
    assert created.status_code == 201
    run_now = await client.post(
        f"/api/v1/automations/{created.json()['id']}/run-now", headers=auth_headers
    )
    assert run_now.status_code == 202
    assert run_now.json()["agentRunId"] is not None


async def test_run_now_respects_the_agent_availability_gate(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Agent 被禁用时，自动化不能绕过既有 Run 创建门禁。"""

    assistant_id = await _create_assistant(client, auth_headers)
    created = await client.post(
        "/api/v1/automations",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "name": "Blocked",
            "goal": "Do not run",
            "timezone": "UTC",
            "trigger": {"triggerType": "cron", "cronExpression": "*/5 * * * *"},
        },
    )
    assert created.status_code == 201
    monkeypatch.setattr(settings, "agent_enabled", False)
    monkeypatch.setattr(settings, "agent_allowlist_user_ids", "")

    run_now = await client.post(
        f"/api/v1/automations/{created.json()['id']}/run-now", headers=auth_headers
    )

    assert run_now.status_code == 404
    assert run_now.json()["detail"] == "AGENT_UNAVAILABLE"


async def test_waiting_input_receives_a_deadline_for_expiry(
    client: AsyncClient, auth_headers: dict[str, str], db
) -> None:
    """输入等待状态会记录期限，后续调度轮次才能通知并取消。"""

    assistant_id = await _create_assistant(client, auth_headers)
    created = await client.post(
        "/api/v1/automations",
        headers=auth_headers,
        json={
            "assistantId": assistant_id,
            "name": "Await input",
            "goal": "Wait for a user reply",
            "timezone": "UTC",
            "trigger": {"triggerType": "cron", "cronExpression": "*/5 * * * *"},
        },
    )
    run_now = await client.post(
        f"/api/v1/automations/{created.json()['id']}/run-now", headers=auth_headers
    )
    agent_run = await db.scalar(select(AgentRun).where(AgentRun.id == run_now.json()["agentRunId"]))
    assert agent_run is not None
    agent_run.status = AgentRunStatus.waiting_input
    await db.commit()

    await sync_automation_runs(now=datetime.now(UTC), db=db)
    automation_run = await db.scalar(
        select(AutomationRun).where(AutomationRun.agent_run_id == agent_run.id)
    )

    assert automation_run is not None
    assert automation_run.status is AutomationRunStatus.waiting_input
    assert automation_run.wait_reason == "input"
    assert automation_run.wait_deadline is not None
