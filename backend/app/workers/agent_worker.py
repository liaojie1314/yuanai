"""独立 Agent worker：从 Redis 取 Run、持有租约并响应取消。"""

from __future__ import annotations

import asyncio
import logging
import signal
import uuid
from collections.abc import Awaitable, Callable

from app.core.redis import redis_client
from app.services.agent.queue import (
    LEASE_RENEW_INTERVAL_SECONDS,
    AgentQueue,
    QueueItem,
)

logger = logging.getLogger(__name__)

RunHandler = Callable[[QueueItem, "CancellationToken"], Awaitable[None]]


class CancellationToken:
    """提供 Redis 取消令牌与 Worker 停止信号的统一检查。"""

    def __init__(
        self,
        queue: AgentQueue,
        item: QueueItem,
        stop_event: asyncio.Event,
    ) -> None:
        self._queue = queue
        self._item = item
        self._stop_event = stop_event
        self._lease_lost = asyncio.Event()

    async def is_cancelled(self) -> bool:
        """返回 Run 是否应停止后续执行。"""

        if self._stop_event.is_set() or self._lease_lost.is_set():
            return True
        return await self._queue.is_cancelled(self._item.tenant_id, self._item.run_id)

    def mark_lease_lost(self) -> None:
        """标记租约丢失，阻止协调器继续发起副作用操作。"""

        self._lease_lost.set()

    async def raise_if_cancelled(self) -> None:
        """在取消时抛出稳定的 Worker 取消异常。"""

        if await self.is_cancelled():
            raise AgentRunCancelledError("Agent Run was cancelled")


class AgentRunCancelledError(RuntimeError):
    """表示 Agent Run 已取消或 Worker 正在关闭。"""


async def _noop_handler(_item: QueueItem, _token: CancellationToken) -> None:
    """Task 6 coordinator 接入前的安全空处理器。"""


class AgentWorker:
    """在独立进程中消费 Agent Run，并保证租约续期和释放。"""

    def __init__(
        self,
        queue: AgentQueue | None = None,
        handler: RunHandler | None = None,
        *,
        worker_id: str | None = None,
        poll_interval: float = 1.0,
        renewal_interval: float = LEASE_RENEW_INTERVAL_SECONDS,
    ) -> None:
        self._queue = queue or AgentQueue()
        self._handler = handler or _noop_handler
        self._worker_id = worker_id or str(uuid.uuid4())
        self._poll_interval = poll_interval
        self._renewal_interval = renewal_interval

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """持续消费队列，直到收到停止信号。"""

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            processed = await self.run_once(shutdown)
            if processed:
                continue
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=self._poll_interval)
            except TimeoutError:
                continue

    async def run_once(self, stop_event: asyncio.Event) -> bool:
        """消费并处理一个队列项，返回是否实际取得了队列项。"""

        item = await self._queue.dequeue()
        if item is None:
            return False
        if stop_event.is_set() or await self._queue.is_cancelled(item.tenant_id, item.run_id):
            await self._queue.acknowledge(item)
            return True
        acquired = await self._queue.acquire_lease(item.tenant_id, item.run_id, self._worker_id)
        if not acquired:
            await self._queue.acknowledge(item)
            return True

        await self._queue.acknowledge(item)

        token = CancellationToken(self._queue, item, stop_event)
        finished = asyncio.Event()
        renewal = asyncio.create_task(
            self._renew_lease(item, token, finished), name=f"agent-lease-renew-{item.run_id}"
        )
        try:
            await token.raise_if_cancelled()
            await self._handler(item, token)
        except AgentRunCancelledError:
            logger.info("Agent Run %s cancelled", item.run_id)
        finally:
            finished.set()
            renewal.cancel()
            try:
                await renewal
            except asyncio.CancelledError:
                pass
            await self._queue.release_lease(item.tenant_id, item.run_id, self._worker_id)
        return True

    async def _renew_lease(
        self,
        item: QueueItem,
        token: CancellationToken,
        finished: asyncio.Event,
    ) -> None:
        """每 20 秒续租，租约丢失时让当前处理自然停止。"""

        while not finished.is_set():
            try:
                await asyncio.wait_for(finished.wait(), timeout=self._renewal_interval)
            except TimeoutError:
                renewed = await self._queue.renew_lease(
                    item.tenant_id, item.run_id, self._worker_id
                )
                if not renewed:
                    token.mark_lease_lost()
                    logger.warning("Agent Run %s lease lost", item.run_id)
                    return


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
    """启动独立 Agent worker 进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await AgentWorker(AgentQueue(redis_client)).run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
