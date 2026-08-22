"""扫描丢失租约的 Agent Run 并幂等恢复入队。"""

from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable

from sqlalchemy import select

from app.core.database import AsyncSessionLocal
from app.core.redis import redis_client
from app.models.agent_run import AgentRun, AgentRunStatus
from app.services.agent.queue import AgentQueue
from app.services.agent.state_machine import RunStateMachine

logger = logging.getLogger(__name__)

RunningRunSource = Callable[[], AsyncIterator[tuple[uuid.UUID, uuid.UUID, AgentRunStatus]]]
RequeueRun = Callable[[uuid.UUID, uuid.UUID], Awaitable[None]]


async def _list_running_runs() -> AsyncIterator[tuple[uuid.UUID, uuid.UUID, AgentRunStatus]]:
    """从 PostgreSQL 读取当前仍处于 running 的 Run。"""

    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(AgentRun.user_id, AgentRun.id, AgentRun.status).where(
                AgentRun.status == AgentRunStatus.running
            )
        )
        for tenant_id, run_id, status in result.all():
            yield tenant_id, run_id, status


async def _requeue_run(tenant_id: uuid.UUID, run_id: uuid.UUID) -> None:
    """锁定 Run，确认状态后迁移到 queued 并重新入队。"""

    async with AsyncSessionLocal() as session:
        async with session.begin():
            result = await session.execute(
                select(AgentRun)
                .where(AgentRun.id == run_id, AgentRun.user_id == tenant_id)
                .with_for_update()
            )
            run = result.scalar_one_or_none()
            if run is None or run.status is not AgentRunStatus.running:
                return
            machine = RunStateMachine(run.status)
            run.status = machine.recover()
    await AgentQueue(redis_client).enqueue(tenant_id, run_id)


class RecoveryWorker:
    """独立恢复进程，处理 Worker 崩溃后的租约丢失。"""

    def __init__(
        self,
        queue: AgentQueue | None = None,
        *,
        list_running: RunningRunSource | None = None,
        requeue: RequeueRun | None = None,
        poll_interval: float = 5.0,
    ) -> None:
        self._queue = queue or AgentQueue()
        self._list_running = list_running or _list_running_runs
        self._requeue = requeue or _requeue_run
        self._poll_interval = poll_interval

    async def recover_once(self) -> int:
        """恢复所有租约不存在且仍可执行的 Run，返回恢复数量。"""

        recovered = 0
        async for tenant_id, run_id, status in self._list_running():
            if status is not AgentRunStatus.running:
                continue
            if await self._queue.lease_owner(tenant_id, run_id) is not None:
                continue
            if await self._queue.is_cancelled(tenant_id, run_id):
                continue
            await self._requeue(tenant_id, run_id)
            recovered += 1
        return recovered

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """周期性扫描租约丢失的 Run，直到收到停止信号。"""

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            await self.recover_once()
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=self._poll_interval)
            except TimeoutError:
                continue


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    """在支持的事件循环中安装安全关闭信号。"""

    loop = asyncio.get_running_loop()
    for name in ("SIGINT", "SIGTERM"):
        signal_name = getattr(signal, name, None)
        if signal_name is None:
            continue
        try:
            loop.add_signal_handler(signal_name, stop_event.set)
        except (NotImplementedError, RuntimeError, ValueError):
            continue


async def main() -> None:
    """启动独立恢复 worker 进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await RecoveryWorker(AgentQueue(redis_client)).run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
