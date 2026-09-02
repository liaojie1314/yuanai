"""Agent 运行恢复和长断线重连演练。"""

from __future__ import annotations

import asyncio
import os
import subprocess
import sys
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from httpx import AsyncClient
from redis import asyncio as redis_asyncio
from sqlalchemy.ext.asyncio import AsyncSession

import app.api.v1.agent as agent_api
from app.models import AgentEvent, AgentRun, Assistant
from app.models.agent_run import AgentRunStatus
from app.models.user import User
from app.services.agent.event_service import EventStore
from app.services.agent.queue import QueueItem
from app.workers.agent_worker import AgentWorker, CancellationToken
from app.workers.recovery_worker import RecoveryWorker
from tests.conftest import TestSessionLocal
from tests.support.agent_fault_worker import IsolatedAgentQueue, append_record, claim_side_effect


@pytest.mark.asyncio
async def test_last_event_id_replays_terminal_events_persisted_five_minutes_apart(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db: AsyncSession,
    test_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """断线五分钟后按游标重连会完整返回一次终态事件。"""

    assistant = Assistant(
        user_id=test_user.id,
        name="Recovery drill assistant",
        default_model="test-model",
        is_default=True,
    )
    db.add(assistant)
    await db.flush()
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="验证事件恢复",
        model="test-model",
        status=AgentRunStatus.succeeded,
    )
    db.add(run)
    await db.flush()
    disconnected_at = datetime.now(UTC) - timedelta(minutes=5)

    events = [
        AgentEvent(
            run_id=run.id,
            sequence=1,
            event_type="run_started",
            payload={"model": "test-model"},
            created_at=disconnected_at,
        ),
        AgentEvent(
            run_id=run.id,
            sequence=2,
            event_type="tool_completed",
            payload={"name": "get_current_time", "status": "succeeded"},
            created_at=disconnected_at + timedelta(minutes=2),
        ),
        AgentEvent(
            run_id=run.id,
            sequence=3,
            event_type="run_completed",
            payload={"status": "succeeded", "content": "已完成"},
            created_at=disconnected_at + timedelta(minutes=5),
        ),
    ]
    db.add_all(events)
    await db.commit()
    replayed = await EventStore(session_factory=TestSessionLocal).replay_after(
        run.id, after_sequence=1
    )
    assert [event.sequence for event in replayed] == [2, 3]
    assert replayed[-1].created_at - events[0].created_at == timedelta(minutes=5)

    class FakeEventStore:
        async def replay_after(self, _run_id: uuid.UUID, after_sequence: int) -> list[AgentEvent]:
            return [event for event in replayed if event.sequence > after_sequence]

        async def get_run_status(
            self, _run_id: uuid.UUID, *, tenant_id: uuid.UUID | None = None
        ) -> AgentRunStatus:
            return AgentRunStatus.succeeded

    monkeypatch.setattr(agent_api, "_events", FakeEventStore())

    response = await client.get(
        f"/api/v1/agent/runs/{run.id}/stream",
        headers={**auth_headers, "Last-Event-ID": "1"},
    )

    assert response.status_code == 200
    assert events[-1].created_at - events[0].created_at == timedelta(minutes=5)
    assert "id: 2\nevent: tool_completed" in response.text
    assert "id: 3\nevent: run_completed" in response.text
    assert "id: 1" not in response.text
    assert response.text.count("data: [DONE]") == 1


@pytest.mark.asyncio
async def test_forced_worker_exit_recovers_without_repeating_claimed_side_effect(
    tmp_path: Path,
) -> None:
    """真实子进程强制退出后恢复任务重投，幂等账本阻止副作用重复。"""

    redis_url = os.environ["REDIS_URL"]
    namespace = f"agent-drill:{uuid.uuid4()}"
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    idempotency_path = tmp_path / "effect.claim"
    record_path = tmp_path / "effects.log"
    client = redis_asyncio.from_url(redis_url, decode_responses=True)
    queue = IsolatedAgentQueue(client, namespace)
    statuses = {run_id: AgentRunStatus.running}

    async def list_running() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID, AgentRunStatus]]:
        yield tenant_id, run_id, statuses[run_id]

    async def requeue(requeue_tenant_id: uuid.UUID, requeue_run_id: uuid.UUID) -> None:
        statuses[requeue_run_id] = AgentRunStatus.queued
        await queue.enqueue(requeue_tenant_id, requeue_run_id)

    async def complete_without_repeating_effect(
        _item: QueueItem, _token: CancellationToken
    ) -> None:
        if claim_side_effect(idempotency_path):
            append_record(record_path, "effect")
        append_record(record_path, "recovered")
        statuses[run_id] = AgentRunStatus.succeeded

    try:
        await queue.enqueue(tenant_id, run_id)
        process = await asyncio.to_thread(
            subprocess.run,
            [
                sys.executable,
                "-m",
                "tests.support.agent_fault_worker",
                redis_url,
                namespace,
                str(tenant_id),
                str(run_id),
                str(idempotency_path),
                str(record_path),
            ],
            cwd=Path(__file__).parents[2],
            capture_output=True,
            text=True,
            timeout=15,
            check=False,
        )

        assert process.returncode == 71
        assert record_path.read_text(encoding="utf-8").splitlines() == ["effect"]
        assert await queue.lease_owner(tenant_id, run_id) == "fault-injection-worker"

        await client.delete(queue.lease_key(tenant_id, run_id))
        recovery = RecoveryWorker(queue, list_running=list_running, requeue=requeue)
        assert await recovery.recover_once() == 1
        assert statuses[run_id] is AgentRunStatus.queued

        worker = AgentWorker(queue, complete_without_repeating_effect, worker_id="recovery-worker")
        assert await worker.run_once(asyncio.Event()) is True
        assert statuses[run_id] is AgentRunStatus.succeeded
        assert record_path.read_text(encoding="utf-8").splitlines() == ["effect", "recovered"]
        assert await recovery.recover_once() == 0
    finally:
        await client.delete(
            queue.queue_key(),
            queue.processing_key(),
            queue.pending_key(tenant_id, run_id),
            queue.lease_key(tenant_id, run_id),
            queue.cancellation_key(tenant_id, run_id),
        )
        await client.aclose()
