"""独立记忆抽取 worker：消费 Run 并写入候选记忆。"""

from __future__ import annotations

import asyncio
import logging
import signal
from typing import Any

from sqlalchemy.exc import SQLAlchemyError

from app.core.database import AsyncSessionLocal
from app.services.memory_extraction import extract_from_run
from app.services.memory_queue import dequeue_extraction

logger = logging.getLogger(__name__)


class MemoryWorker:
    """消费抽取队列并把候选记忆写入数据库的循环。"""

    def __init__(self, *, client: Any | None = None, poll_timeout: int = 5) -> None:
        self._client = client
        self._poll_timeout = poll_timeout

    async def run_once(self) -> bool:
        """处理至多一条任务，返回是否取到了任务。"""

        item = await dequeue_extraction(client=self._client, timeout=self._poll_timeout)
        if item is None:
            return False
        user_id, run_id = item
        try:
            async with AsyncSessionLocal() as db:
                created = await extract_from_run(run_id=run_id, user_id=user_id, db=db)
                await db.commit()
            logger.info("Run %s 抽取出 %d 条记忆", run_id, len(created))
        except (OSError, RuntimeError, SQLAlchemyError, ValueError):
            # 单条任务失败不能毒死 worker 进程；记录后继续消费后续任务。
            logger.exception("Run %s 的记忆抽取失败", run_id)
        return True

    async def run(self, stop_event: asyncio.Event | None = None) -> None:
        """持续消费直到收到停止事件。

        空队列时由 ``brpop`` 的 ``poll_timeout`` 阻塞等待，因此循环本身不需要退避。
        """

        shutdown = stop_event or asyncio.Event()
        while not shutdown.is_set():
            await self.run_once()


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
    """启动独立记忆抽取 worker 进程。"""

    stop_event = asyncio.Event()
    _install_signal_handlers(stop_event)
    await MemoryWorker().run(stop_event)


if __name__ == "__main__":
    asyncio.run(main())
