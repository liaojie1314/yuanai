"""Agent API 的授权、幂等和事件重放集成测试。"""

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from time import monotonic

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy import update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

import app.api.v1.agent as agent_api
from app.core.config import settings
from app.core.security import create_access_token, hash_password
from app.models.agent_run import (
    AgentEvent,
    AgentRun,
    AgentRunStatus,
    AgentStep,
    AgentStepKind,
    AgentStepStatus,
)
from app.models.approval import ApprovalRequest, ApprovalRiskLevel, ApprovalStatus
from app.models.assistant import Assistant
from app.models.user import User
from app.schemas.agent import AgentRunCreateRequest


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
async def test_run_enqueue_timeout_is_bounded_to_500ms(
    test_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Redis 入队阻塞时，创建流程的入队等待不超过 500ms。"""

    class SlowQueue:
        """模拟 Redis 入队阻塞，但保留 API 的超时包装。"""

        async def enqueue(self, _user_id: uuid.UUID, _run_id: uuid.UUID) -> None:
            await asyncio.sleep(1)

    monkeypatch.setattr(agent_api, "AgentQueue", SlowQueue)
    started = monotonic()
    await agent_api._enqueue_run(test_user.id, uuid.uuid4())

    assert monotonic() - started < 0.5


@pytest.mark.asyncio
async def test_run_is_committed_before_enqueue(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """入队回调只能在 Run 已提交后观察到它。"""
    assistant = await _assistant(db, test_user)
    observed: list[uuid.UUID] = []

    class ObservingQueue:
        async def enqueue(self, _user_id: uuid.UUID, run_id: uuid.UUID) -> None:
            persisted = await db.scalar(select(AgentRun).where(AgentRun.id == run_id))
            assert persisted is not None
            observed.append(run_id)

    monkeypatch.setattr(agent_api, "AgentQueue", ObservingQueue)
    response = await client.post(
        "/api/v1/agent/runs",
        headers=auth_headers,
        json={"assistantId": str(assistant.id), "goal": "先持久化"},
    )

    assert response.status_code == 202, response.text
    assert observed == [uuid.UUID(response.json()["id"])]


@pytest.mark.asyncio
async def test_concurrent_idempotent_run_creation_returns_one_run(
    db: AsyncSession,
    test_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """并发提交同一幂等键时只持久化一个 Run。"""
    assistant = await _assistant(db, test_user)

    class NoopQueue:
        async def enqueue(self, _user_id: uuid.UUID, _run_id: uuid.UUID) -> None:
            return

    monkeypatch.setattr(agent_api, "AgentQueue", NoopQueue)
    engine = create_async_engine(
        "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test",
        poolclass=NullPool,
    )
    try:
        session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

        async def create_with_independent_session() -> AgentRun:
            async with session_factory() as session:
                return await agent_api.create_run(
                    AgentRunCreateRequest(
                        assistant_id=assistant.id,
                        goal="并发幂等创建",
                        idempotency_key="concurrent-idempotency-key",
                    ),
                    test_user,
                    session,
                )

        first, second = await asyncio.gather(
            create_with_independent_session(), create_with_independent_session()
        )
    finally:
        await engine.dispose()

    assert first.id == second.id
    count = await db.scalar(
        select(AgentRun.id).where(
            AgentRun.user_id == test_user.id,
            AgentRun.idempotency_key == "concurrent-idempotency-key",
        )
    )
    assert count == first.id


@pytest.mark.asyncio
async def test_cancel_run_persists_terminal_event_and_is_idempotent(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """取消只生成一次终态事件，重复取消不会重复追加事件。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="取消测试",
        model="test-model",
        status=AgentRunStatus.running,
    )
    db.add(run)
    await db.commit()
    monkeypatch.setattr(agent_api, "_cancel_queued_run", lambda *_args: asyncio.sleep(0))
    first = await client.post(f"/api/v1/agent/runs/{run.id}/cancel", headers=auth_headers)
    second = await client.post(f"/api/v1/agent/runs/{run.id}/cancel", headers=auth_headers)

    assert first.status_code == 200
    assert second.status_code == 200
    events = list(
        (
            await db.scalars(
                select(AgentEvent).where(
                    AgentEvent.run_id == run.id,
                    AgentEvent.event_type == "run_cancelled",
                )
            )
        ).all()
    )
    assert len(events) == 1


@pytest.mark.asyncio
async def test_cancel_run_concurrent_requests_append_one_event(
    db: AsyncSession,
    test_user: User,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """并发取消只能将 Run 转为终态一次并追加一个取消事件。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="并发取消测试",
        model="test-model",
        status=AgentRunStatus.running,
    )
    db.add(run)
    await db.commit()
    appended: list[str] = []

    async def append_event(
        _run_id: uuid.UUID,
        event_type: str,
        _payload: dict[str, object],
        *,
        tenant_id: uuid.UUID | None = None,
    ) -> None:
        del tenant_id
        appended.append(event_type)

    async def cancel_queued_run(*_args: object) -> None:
        return

    monkeypatch.setattr(agent_api._events, "append", append_event)
    monkeypatch.setattr(agent_api, "_cancel_queued_run", cancel_queued_run)

    async def cancel_with_independent_session() -> AgentRun:
        engine = create_async_engine(
            "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test",
            poolclass=NullPool,
        )
        try:
            session_factory = async_sessionmaker(
                engine, class_=AsyncSession, expire_on_commit=False
            )
            async with session_factory() as session:
                return await agent_api.cancel_run(run.id, test_user, session)
        finally:
            await engine.dispose()

    first, second = await asyncio.gather(
        cancel_with_independent_session(), cancel_with_independent_session()
    )

    assert first.status is AgentRunStatus.cancelled
    assert second.status is AgentRunStatus.cancelled
    assert appended == ["run_cancelled"]


@pytest.mark.asyncio
async def test_run_creation_is_disabled_without_internal_rollout(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """默认关闭时，未在内部灰度范围内的用户不能创建 Run。"""
    assistant = await _assistant(db, test_user)
    monkeypatch.setattr(settings, "agent_enabled", False)
    monkeypatch.setattr(settings, "agent_allowlist_user_ids", "")
    response = await client.post(
        "/api/v1/agent/runs",
        headers=auth_headers,
        json={"assistantId": str(assistant.id), "goal": "被关闭的任务"},
    )
    assert response.status_code == 404


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
async def test_event_stream_waits_for_events_created_after_connection(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """SSE 连接建立后仍应接收后续持久化事件，而不是立即结束。"""

    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="持续事件测试",
        model="test-model",
        status=AgentRunStatus.running,
    )
    db.add(run)
    await db.commit()

    class FakeEvent:
        def __init__(self, sequence: int, event_type: str, payload: dict[str, object]) -> None:
            self.sequence = sequence
            self.event_type = event_type
            self.payload = payload

    class FakeEventStore:
        def __init__(self) -> None:
            self.calls = 0

        async def get_run_status(
            self,
            _run_id: uuid.UUID,
            *,
            tenant_id: uuid.UUID | None = None,
            session: AsyncSession | None = None,
        ) -> AgentRunStatus | None:
            del tenant_id, session
            return AgentRunStatus.running

        async def replay_after(
            self,
            _run_id: uuid.UUID,
            after_sequence: int,
            *,
            session: AsyncSession | None = None,
        ) -> list[FakeEvent]:
            del session
            self.calls += 1
            if after_sequence == 0:
                return [FakeEvent(1, "run_started", {"status": "running"})]
            return [FakeEvent(2, "run_completed", {"status": "succeeded"})]

    fake_events = FakeEventStore()
    monkeypatch.setattr(agent_api, "_events", fake_events)
    response = await client.get(
        f"/api/v1/agent/runs/{run.id}/stream",
        headers=auth_headers,
    )

    assert response.status_code == 200
    assert "data: [DONE]" in response.text
    assert "id: 1" in response.text
    assert "id: 2" in response.text
    assert fake_events.calls >= 2


@pytest.mark.asyncio
async def test_approval_decision_requeues_run_and_denial_terminates(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """审批决定必须恢复 Run；拒绝则发布可终止 SSE 的取消事件。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="审批恢复测试",
        model="test-model",
        status=AgentRunStatus.waiting_approval,
    )
    db.add(run)
    await db.flush()
    step = AgentStep(
        run_id=run.id,
        sequence=1,
        kind=AgentStepKind.approval,
        status=AgentStepStatus.waiting,
    )
    db.add(step)
    await db.flush()
    approved = ApprovalRequest(
        run_id=run.id,
        step_id=step.id,
        user_id=test_user.id,
        tool_name="external_write",
        execution_location="cloud",
        risk_level=ApprovalRiskLevel.high,
        action_summary="执行外部工具",
        arguments_preview={},
        payload_hash="a" * 64,
        status=ApprovalStatus.pending,
        expires_at=datetime.now(UTC) + timedelta(minutes=5),
    )
    db.add(approved)
    await db.commit()

    class FakeEventStore:
        async def append(
            self,
            _run_id: uuid.UUID,
            _event_type: str,
            _payload: dict[str, object],
            *,
            tenant_id: uuid.UUID | None = None,
        ) -> None:
            del tenant_id

    monkeypatch.setattr(agent_api, "_events", FakeEventStore())

    response = await client.post(
        f"/api/v1/agent/approvals/{approved.id}",
        headers=auth_headers,
        json={"decision": "approve"},
    )
    assert response.status_code == 200, response.text
    await db.refresh(run)
    await db.refresh(step)
    assert run.status is AgentRunStatus.queued
    assert step.status is AgentStepStatus.succeeded


@pytest.mark.asyncio
async def test_admin_summary_requires_allowlisted_user(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """普通登录用户不能访问运营摘要。"""
    response = await client.get("/api/v1/admin/agent-runs", headers=auth_headers)
    assert response.status_code == 403


@pytest.mark.asyncio
async def test_admin_detail_redacts_user_identity_and_goal(
    client: AsyncClient,
    db: AsyncSession,
    test_user: User,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """运营详情只返回哈希用户标识，不返回目标或原始用户 UUID。"""
    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="包含不应暴露的用户目标",
        model="test-model",
        status=AgentRunStatus.queued,
    )
    db.add(run)
    await db.commit()
    monkeypatch.setattr(settings, "agent_admin_user_ids", str(test_user.id))

    response = await client.get(f"/api/v1/admin/agent-runs/{run.id}", headers=auth_headers)

    assert response.status_code == 200
    payload = response.json()
    assert payload["userIdHash"] != str(test_user.id)
    assert "user_id" not in payload
    assert "goal" not in payload
    assert "包含不应暴露的用户目标" not in response.text


@pytest.mark.asyncio
async def test_event_append_does_not_block_behind_open_run_transaction(
    db: AsyncSession, test_user: User
) -> None:
    """协调器持有未提交的 Run 行更新时，事件序号分配仍能立即提交。

    Worker 侧协调器在整个执行期间持有未提交事务；事件持久化若对同一
    Run 行加锁，会与自身事务形成进程内死锁，Worker 将永久挂起。
    """
    from app.services.agent.event_service import EventStore

    assistant = await _assistant(db, test_user)
    run = AgentRun(
        user_id=test_user.id,
        assistant_id=assistant.id,
        goal="事件追加不应等待 Run 行锁",
        model="test-model",
        status=AgentRunStatus.queued,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    engine = create_async_engine(
        "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test",
        poolclass=NullPool,
    )
    try:
        holder_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
        async with holder_factory() as holder:
            await holder.execute(
                sa_update(AgentRun)
                .where(AgentRun.id == run.id)
                .values(status=AgentRunStatus.running)
            )
            store = EventStore(session_factory=holder_factory, queue=None)

            async def _append() -> None:
                await asyncio.wait_for(
                    store.append(run.id, "step_started", {"sequence": 1, "kind": "model"}),
                    timeout=10.0,
                )

            await _append()
            await holder.rollback()
    finally:
        await engine.dispose()

    sequences = (
        await db.scalars(select(AgentEvent.sequence).where(AgentEvent.run_id == run.id))
    ).all()
    assert sequences == [1]
