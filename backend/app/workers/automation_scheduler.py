"""独立自动化调度器：认领到期触发器并复用 Agent 队列。"""

from __future__ import annotations

import asyncio
import logging
import signal
from datetime import UTC, datetime

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import AsyncSessionLocal
from app.core.redis import redis_client
from app.services.agent.queue import AgentQueue
from app.services.automation_service import (
    expire_waiting_automation_runs,
    notify_waiting_automation_runs,
    run_due_automations,
    sync_automation_runs,
)

logger = logging.getLogger(__name__)
POLL_INTERVAL_SECONDS = 10.0


async def run_automation_scheduler_once(*, queue: AgentQueue | None = None) -> int:
    """执行一轮同步、到期认领、通知和等待超时处理。"""

    agent_queue = queue or AgentQueue(redis_client)
    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        await sync_automation_runs(now=now, db=db)
        created = await run_due_automations(now=now, db=db, queue=agent_queue)
        await notify_waiting_automation_runs(db=db)
        await expire_waiting_automation_runs(now=now, db=db, queue=agent_queue)
    return created


class AutomationScheduler:
    """可嵌入进程或独立运行的自动化调度循环。"""

    def __init__(self, *, poll_interval: float = POLL_INTERVAL_SECONDS) -> None:
        if poll_interval <= 0:
            raise ValueError("poll_interval must be positive")
        self.poll_interval = poll_interval

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """持续运行直到收到停止事件。"""

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            try:
                await run_automation_scheduler_once()
            except (OSError, RuntimeError, SQLAlchemyError) as error:
                logger.warning("自动化调度轮次失败: %s", error)
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
    """启动自动化调度器进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await AutomationScheduler().run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
