"""事件存储、队列、租约和 worker 契约测试。"""

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
    """提供测试所需的最小异步 Redis 语义。"""

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

    async def rpoplpush(self, source: str, destination: str) -> str | None:
        values = self.lists.get(source, [])
        if not values:
            return None
        payload = values.pop()
        self.lists.setdefault(destination, []).insert(0, payload)
        return payload

    async def lrem(self, key: str, count: int, value: str) -> int:
        values = self.lists.get(key, [])
        removed = 0
        while value in values and (count == 0 or removed < count):
            values.remove(value)
            removed += 1
        return removed

    async def lrange(self, key: str, start: int, end: int) -> list[str]:
        values = self.lists.get(key, [])
        stop = None if end == -1 else end + 1
        return list(values[start:stop])

    async def sadd(self, key: str, value: str) -> int:
        values = self.sets.setdefault(key, set())
        before = len(values)
        values.add(value)
        return int(len(values) > before)

    async def scard(self, key: str) -> int:
        return len(self.sets.get(key, set()))

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
async def test_event_store_replays_events_after_long_disconnect_window() -> None:
    """事件持久化后，长时间断线仍按游标完整恢复。"""
    run_id = uuid.uuid4()
    store = EventStore(persist=_persist_event)
    for sequence in range(1, 8):
        await store.append(run_id, "step_completed", {"sequence": sequence})

    replay = await store.replay_after(run_id, after_sequence=2)
    assert [event.sequence for event in replay] == list(range(3, 8))


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
async def test_worker_delivery_is_recovered_before_lease_ack() -> None:
    """worker 在获取租约前崩溃时，processing delivery 不会丢失。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    await queue.enqueue(tenant_id, run_id)

    item = await queue.dequeue()
    assert item == QueueItem(tenant_id, run_id)
    assert await queue.recover_inflight() == [item]

    await queue.enqueue(tenant_id, run_id)
    assert await queue.dequeue() == item


@pytest.mark.asyncio
async def test_worker_ack_removes_processing_delivery() -> None:
    """取得租约后 ack，后续恢复扫描不会重复投递。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    await queue.enqueue(tenant_id, run_id)
    item = await queue.dequeue()
    assert item is not None
    assert await queue.acquire_lease(tenant_id, run_id, "worker-a") is True
    await queue.acknowledge(item)
    assert await queue.recover_inflight() == []


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


class EvalFakeRedis(FakeRedis):
    """模拟真实 Redis eval 的租约脚本返回值。"""

    async def eval(self, _script: str, _numkeys: int, key: str, owner: str, *args: str) -> int:
        if self.values.get(key) != owner:
            return 0
        if args:
            await self.expire(key, int(args[0]))
            return 1
        return await self.delete(key)


@pytest.mark.asyncio
async def test_lease_renewal_and_release_use_eval_when_available() -> None:
    """Redis 原子租约路径只允许原 owner 续租和释放。"""

    redis = EvalFakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()
    assert await queue.acquire_lease(tenant_id, run_id, "worker-a") is True
    assert await queue.renew_lease(tenant_id, run_id, "worker-a") is True
    assert await queue.release_lease(tenant_id, run_id, "worker-b") is False
    assert await queue.release_lease(tenant_id, run_id, "worker-a") is True


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
async def test_worker_stops_cooperative_handler_after_lease_loss() -> None:
    """租约丢失后，续租任务会让执行器停止后续副作用。"""

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

    worker = AgentWorker(queue, handler, worker_id="worker-c", renewal_interval=0.001)
    task = asyncio.create_task(worker.run_once(asyncio.Event()))
    await handler_started.wait()
    await redis.delete(queue.lease_key(tenant_id, run_id))
    await task
    handler_stopped.set()

    assert handler_stopped.is_set()


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


@pytest.mark.asyncio
async def test_recovery_requeues_queued_run_without_pending_marker() -> None:
    """queued 状态但入队失败的 Run 会被恢复 worker 补投。"""

    redis = FakeRedis()
    queue = AgentQueue(redis)
    tenant_id = uuid.uuid4()
    run_id = uuid.uuid4()

    async def list_recoverable() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID, AgentRunStatus]]:
        yield tenant_id, run_id, AgentRunStatus.queued

    async def requeue(_tenant_id: uuid.UUID, _run_id: uuid.UUID) -> None:
        await queue.enqueue(_tenant_id, _run_id)

    recovery = RecoveryWorker(queue, list_running=list_recoverable, requeue=requeue)
    assert await recovery.recover_once() == 1
    assert await queue.dequeue(tenant_id) == QueueItem(tenant_id, run_id)


async def _persist_event(event: FakeEvent) -> FakeEvent:
    """测试用持久化回调。"""

    return event
