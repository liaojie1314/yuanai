"""独立节点清扫器：把心跳过期的执行节点回落为离线。"""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import AsyncSessionLocal
from app.services.tool_runtime_service import sweep_stale_nodes

logger = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 30.0


class NodeSweeper:
    """周期性把心跳过期的执行节点标记为离线。"""

    def __init__(self, *, poll_interval: float = POLL_INTERVAL_SECONDS) -> None:
        if poll_interval <= 0:
            raise ValueError("poll_interval must be positive")
        self.poll_interval = poll_interval

    async def run_once(self) -> int:
        """执行一轮清扫并返回被标记离线的节点数。"""

        async with AsyncSessionLocal() as db:
            swept = await sweep_stale_nodes(now=datetime.now(UTC), db=db)
            await db.commit()
        return swept

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """持续运行直到收到停止事件。"""

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            try:
                await self.run_once()
            except (OSError, RuntimeError, SQLAlchemyError) as error:
                logger.warning("节点清扫轮次失败: %s", error)
            try:
                await asyncio.wait_for(shutdown.wait(), timeout=self.poll_interval)
            except TimeoutError:
                continue


def _install_signal_handlers(stop_event: asyncio.Event) -> None:
    """在支持的平台安装安全退出信号。"""

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
    """启动节点清扫器进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await NodeSweeper().run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
