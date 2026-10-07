"""记忆抽取队列与 worker 的投递、消费和容错测试。"""

import uuid

import pytest

from app.services.memory_queue import (
    MEMORY_EXTRACTION_QUEUE_KEY,
    dequeue_extraction,
    enqueue_extraction,
)
from app.workers.memory_worker import MemoryWorker


class _StubRedis:
    """记录 push 并按 FIFO 弹出的最小 Redis 替身。"""

    def __init__(self) -> None:
        self.items: list[str] = []

    async def lpush(self, key: str, value: str) -> int:
        assert key == MEMORY_EXTRACTION_QUEUE_KEY
        self.items.insert(0, value)
        return len(self.items)

    async def brpop(self, key: str, timeout: int = 0) -> tuple[str, str] | None:
        assert key == MEMORY_EXTRACTION_QUEUE_KEY
        if not self.items:
            return None
        return (key, self.items.pop())


@pytest.mark.asyncio
async def test_enqueue_then_dequeue_round_trips_both_identifiers() -> None:
    """投递的租户与 Run 标识必须原样取回。"""

    client = _StubRedis()
    user_id, run_id = uuid.uuid4(), uuid.uuid4()
    await enqueue_extraction(user_id=user_id, run_id=run_id, client=client)
    assert await dequeue_extraction(client=client) == (user_id, run_id)


@pytest.mark.asyncio
async def test_dequeue_returns_none_on_an_empty_queue() -> None:
    """队列为空时返回 None，worker 据此进入下一轮等待。"""

    assert await dequeue_extraction(client=_StubRedis()) is None


@pytest.mark.asyncio
async def test_dequeue_discards_a_malformed_entry() -> None:
    """脏数据不得让 worker 崩溃，直接丢弃继续消费。"""

    client = _StubRedis()
    client.items.append("not-a-json-payload")
    assert await dequeue_extraction(client=client) is None


@pytest.mark.asyncio
async def test_worker_keeps_consuming_after_an_extraction_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """单条抽取失败只记录日志，不得毒死 worker 进程。"""

    client = _StubRedis()
    await enqueue_extraction(user_id=uuid.uuid4(), run_id=uuid.uuid4(), client=client)

    async def _boom(**_: object) -> list[object]:
        raise RuntimeError("extraction exploded")

    monkeypatch.setattr("app.workers.memory_worker.extract_from_run", _boom)
    worker = MemoryWorker(client=client)
    assert await worker.run_once() is True
