"""Task 4 的事件存储、队列、租约和 worker 契约测试。"""

from __future__ import annotations

import asyncio
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass

import pytest

from app.models.agent_run import AgentRunStatus
from app.services.agent.event_service import EventStore
from app.services.agent.queue import AgentQueue, QueueItem
from app.workers.agent_worker import AgentWorker, CancellationToken
from app.workers.recovery_worker import RecoveryWorker


class FakeRedis:
    """提供 Task 4 所需的最小异步 Redis 语义。"""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.expiry: dict[str, int] = {}
        self.lists: dict[str, list[str]] = {}
        self.sets: dict[str, set[str]] = {}
        self.published: list[tuple[str, str]] = []

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool:
        if nx and key in self.values:
            return False
        self.values[key] = value
        if ex is not None:
            self.expiry[key] = ex
        return True

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def delete(self, key: str) -> int:
        existed = key in self.values
        self.values.pop(key, None)
        self.expiry.pop(key, None)
        return int(existed)

    async def expire(self, key: str, seconds: int) -> bool:
        if key not in self.values:
            return False
        self.expiry[key] = seconds
        return True

    async def rpush(self, key: str, value: str) -> int:
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    async def lpop(self, key: str) -> str | None:
        values = self.lists.get(key, [])
        return values.pop(0) if values else None

    async def sadd(self, key: str, value: str) -> int:
        values = self.sets.setdefault(key, set())
        before = len(values)
        values.add(value)
        return int(len(values) > before)

    async def srem(self, key: str, value: str) -> int:
        values = self.sets.setdefault(key, set())
        existed = value in values
        values.discard(value)
        return int(existed)

    async def publish(self, channel: str, message: str) -> int:
        self.published.append((channel, message))
        return 1


@dataclass
class FakeEvent:
    """用于测试 EventStore 事务顺序的持久化事件。"""

    run_id: uuid.UUID
    sequence: int
    event_type: str
    payload: dict[str, object]


@pytest.mark.asyncio
async def test_event_store_persists_before_broadcast() -> None:
    """数据库提交完成后才允许广播事件。"""

    order: list[str] = []
    run_id = uuid.uuid4()

    async def persist(event: FakeEvent) -> FakeEvent:
        order.append("persist")
        return event

    async def broadcast(_event: FakeEvent) -> None:
        order.append("broadcast")

    store = EventStore(persist=persist, broadcast=broadcast)
    event = await store.append(run_id, "run_started", {"safe": True})

    assert event.sequence == 1
    assert order == ["persist", "broadcast"]


@pytest.mark.asyncio
async def test_event_store_assigns_monotonic_sequences_per_run() -> None:
    """同一 Run 的连续事件序号严格递增。"""

    store = EventStore(persist=lambda event: _persist_event(event))
    run_id = uuid.uuid4()

    first = await store.append(run_id, "first", {})
    second = await store.append(run_id, "second", {})

    assert (first.sequence, second.sequence) == (1, 2)


@pytest.mark.asyncio
async def test_event_store_replays_after_broadcast_failure() -> None:
    """广播失败不能丢失已提交事件，后续仍可从存储重放。"""

    run_id = uuid.uuid4()
    persisted: list[FakeEvent] = []

    async def persist(event: FakeEvent) -> FakeEvent:
        persisted.append(event)
        return event

    async def broadcast(_event: FakeEvent) -> None:
        raise OSError("redis unavailable")

    store = EventStore(persist=persist, broadcast=broadcast)
    await store.append(run_id, "run_started", {})

    replay = await store.replay(run_id, after_sequence=0)
    assert [event.sequence for event in replay] == [1]
    assert len(persisted) == 1


@pytest.mark.asyncio
async def test_queue_enqueue_and_dequeue_are_idempotent() -> None:
    """重复投递只产生一个待消费项，重复消费不会重复交付。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()

    assert await queue.enqueue(tenant_id, run_id) is True
    assert await queue.enqueue(tenant_id, run_id) is False
    item = await queue.dequeue(tenant_id)
    assert item == QueueItem(tenant_id=tenant_id, run_id=run_id)
    assert await queue.dequeue(tenant_id) is None


@pytest.mark.asyncio
async def test_queue_dequeue_respects_tenant_filter() -> None:
    """按租户消费时不会交付另一租户的 Run。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_a = uuid.uuid4()
    tenant_b = uuid.uuid4()
    run_a = uuid.uuid4()
    run_b = uuid.uuid4()
    await queue.enqueue(tenant_b, run_b)
    await queue.enqueue(tenant_a, run_a)

    assert await queue.dequeue(tenant_a) == QueueItem(tenant_a, run_a)
    assert await queue.dequeue(tenant_b) == QueueItem(tenant_b, run_b)


@pytest.mark.asyncio
async def test_lease_renewal_and_cancellation_token() -> None:
    """租约固定 60 秒，支持续租和取消标记。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()

    lease = await queue.acquire_lease(tenant_id, run_id, "worker-a")
    assert lease is True
    assert redis.expiry[queue.lease_key(tenant_id, run_id)] == 60
    assert await queue.renew_lease(tenant_id, run_id, "worker-a") is True
    await queue.cancel(tenant_id, run_id)
    assert await queue.is_cancelled(tenant_id, run_id) is True


@pytest.mark.asyncio
async def test_worker_stops_on_cancellation_and_releases_lease() -> None:
    """取消 token 触发后不再调用执行器，并释放租约。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    await queue.enqueue(tenant_id, run_id)
    await queue.cancel(tenant_id, run_id)
    calls: list[QueueItem] = []

    async def handler(item: QueueItem, token: CancellationToken) -> None:
        del token
        calls.append(item)

    worker = AgentWorker(queue, handler, poll_interval=0.001)
    stop_event = asyncio.Event()
    stop_event.set()
    await worker.run(stop_event)

    assert calls == []
    assert await queue.lease_owner(tenant_id, run_id) is None


@pytest.mark.asyncio
async def test_worker_shutdown_cancels_cooperative_handler() -> None:
    """关闭信号会通过 token 让长任务停止，并最终释放租约。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    await queue.enqueue(tenant_id, run_id)
    handler_started = asyncio.Event()
    handler_stopped = asyncio.Event()

    async def handler(_item: QueueItem, token: CancellationToken) -> None:
        handler_started.set()
        while True:
            await token.raise_if_cancelled()
            await asyncio.sleep(0)

    worker = AgentWorker(queue, handler, worker_id="worker-b", renewal_interval=0.001)
    stop_event = asyncio.Event()
    task = asyncio.create_task(worker.run_once(stop_event))
    await handler_started.wait()
    stop_event.set()
    await task
    handler_stopped.set()

    assert handler_stopped.is_set()
    assert await queue.lease_owner(tenant_id, run_id) is None


@pytest.mark.asyncio
async def test_recovery_requeues_running_run_without_lease() -> None:
    """恢复 worker 只重新入队租约丢失的 running Run。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    statuses: dict[uuid.UUID, AgentRunStatus] = {run_id: AgentRunStatus.running}

    async def list_running() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID, AgentRunStatus]]:
        yield tenant_id, run_id, statuses[run_id]

    async def requeue(_tenant_id: uuid.UUID, _run_id: uuid.UUID) -> None:
        statuses[_run_id] = AgentRunStatus.queued
        await queue.enqueue(_tenant_id, _run_id)

    recovery = RecoveryWorker(queue, list_running=list_running, requeue=requeue)
    assert await recovery.recover_once() == 1
    assert statuses[run_id] is AgentRunStatus.queued
    assert await queue.dequeue(tenant_id) == QueueItem(tenant_id, run_id)


async def _persist_event(event: FakeEvent) -> FakeEvent:
    """测试用持久化回调。"""

    return event
