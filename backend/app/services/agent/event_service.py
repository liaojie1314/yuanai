"""AgentEvent 的 PostgreSQL 持久化、顺序分配与 Redis 广播。"""

from __future__ import annotations

import asyncio
import json
import logging
import uuid
from collections.abc import Awaitable, Callable, Mapping
from typing import Protocol

from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionLocal
from app.models.agent_run import AgentEvent, AgentRun, AgentRunStatus
from app.services.agent.queue import AgentQueue

logger = logging.getLogger(__name__)

PersistEvent = Callable[[AgentEvent], Awaitable[AgentEvent]]
BroadcastEvent = Callable[[AgentEvent], Awaitable[None]]


class EventStoreError(RuntimeError):
    """表示 AgentEvent 无法持久化或关联的 Run 不存在。"""


class EventSessionFactory(Protocol):
    """异步 SQLAlchemy Session 工厂协议。"""

    def __call__(self) -> AsyncSession: ...


class EventStore:
    """以 PostgreSQL 为真相源保存事件，并在提交后广播事件。"""

    def __init__(
        self,
        session_factory: EventSessionFactory = AsyncSessionLocal,
        *,
        queue: AgentQueue | None = None,
        persist: PersistEvent | None = None,
        broadcast: BroadcastEvent | None = None,
    ) -> None:
        self._session_factory = session_factory
        self._queue = queue
        self._persist_override = persist
        self._broadcast_override = broadcast
        self._memory_events: dict[uuid.UUID, list[AgentEvent]] = {}
        self._memory_locks: dict[uuid.UUID, asyncio.Lock] = {}

    async def append(
        self,
        run_id: uuid.UUID,
        event_type: str,
        payload: Mapping[str, object],
        *,
        tenant_id: uuid.UUID | None = None,
    ) -> AgentEvent:
        """分配 Run 内下一个序号，提交事件后再尝试广播。"""

        if self._persist_override is not None:
            lock = self._memory_locks.setdefault(run_id, asyncio.Lock())
            async with lock:
                sequence = len(self._memory_events.get(run_id, ())) + 1
                event = AgentEvent(
                    run_id=run_id,
                    sequence=sequence,
                    event_type=event_type,
                    payload=dict(payload),
                )
                persisted = await self._persist_override(event)
                self._memory_events.setdefault(run_id, []).append(persisted)
        else:
            event, persisted_tenant_id = await self._persist_database(run_id, event_type, payload)
            tenant_id = tenant_id or persisted_tenant_id
        try:
            await self._broadcast(event, tenant_id=tenant_id)
        except (RedisError, OSError, RuntimeError) as error:
            logger.warning("Agent event broadcast failed for run %s: %s", run_id, error)
        return event

    async def append_event(
        self,
        run_id: uuid.UUID,
        event_type: str,
        payload: Mapping[str, object],
        *,
        tenant_id: uuid.UUID | None = None,
    ) -> AgentEvent:
        """兼容更明确的事件存储方法名。"""

        return await self.append(run_id, event_type, payload, tenant_id=tenant_id)

    async def replay(
        self,
        run_id: uuid.UUID,
        *,
        after_sequence: int = 0,
        limit: int = 500,
    ) -> list[AgentEvent]:
        """返回 sequence 大于给定游标的有序事件，用于断线重放。"""

        if limit <= 0:
            return []
        if self._persist_override is not None:
            return [
                event
                for event in self._memory_events.get(run_id, ())
                if event.sequence > after_sequence
            ][:limit]
        async with self._session_factory() as session:
            result = await session.execute(
                select(AgentEvent)
                .where(AgentEvent.run_id == run_id, AgentEvent.sequence > after_sequence)
                .order_by(AgentEvent.sequence)
                .limit(limit)
            )
            return list(result.scalars().all())

    async def replay_after(
        self,
        run_id: uuid.UUID,
        after_sequence: int,
        *,
        limit: int = 500,
    ) -> list[AgentEvent]:
        """返回指定 sequence 之后的事件，供 Last-Event-ID 使用。"""

        return await self.replay(run_id, after_sequence=after_sequence, limit=limit)

    async def get_run_status(
        self, run_id: uuid.UUID, *, tenant_id: uuid.UUID | None = None
    ) -> AgentRunStatus | None:
        """查询 Run 状态，供长连接判断是否可以结束。"""

        if self._persist_override is not None:
            return None
        async with self._session_factory() as session:
            query = select(AgentRun.status).where(AgentRun.id == run_id)
            if tenant_id is not None:
                query = query.where(AgentRun.user_id == tenant_id)
            return await session.scalar(query)

    async def _persist_database(
        self,
        run_id: uuid.UUID,
        event_type: str,
        payload: Mapping[str, object],
    ) -> tuple[AgentEvent, uuid.UUID]:
        """锁定 Run 行后在同一事务内分配并提交事件序号。"""

        async with self._session_factory() as session:
            async with session.begin():
                run = await session.scalar(
                    select(AgentRun).where(AgentRun.id == run_id).with_for_update()
                )
                if run is None:
                    raise EventStoreError(f"Agent Run not found: {run_id}")
                current = await session.scalar(
                    select(func.max(AgentEvent.sequence)).where(AgentEvent.run_id == run_id)
                )
                event = AgentEvent(
                    run_id=run_id,
                    sequence=(current or 0) + 1,
                    event_type=event_type,
                    payload=dict(payload),
                )
                session.add(event)
                await session.flush()
            return event, run.user_id

    async def _broadcast(self, event: AgentEvent, *, tenant_id: uuid.UUID | None) -> None:
        """广播已提交事件；没有租户 ID 时只调用显式测试回调。"""

        if self._broadcast_override is not None:
            await self._broadcast_override(event)
            return
        if self._queue is None or tenant_id is None:
            return
        payload = json.dumps(
            {
                "event_id": event.id,
                "run_id": str(event.run_id),
                "sequence": event.sequence,
                "event_type": event.event_type,
                "payload": event.payload,
            },
            default=str,
            separators=(",", ":"),
        )
        await self._queue.publish(tenant_id, event.run_id, payload)
