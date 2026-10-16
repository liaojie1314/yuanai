"""记忆抽取队列与 worker 的投递、消费和容错测试。"""

import uuid

import pytest

from app.services.memory_queue import (
    MEMORY_EXTRACTION_QUEUE_KEY,
    PERSONA_CANDIDATE_QUEUE_KEY,
    dequeue_extraction,
    dequeue_persona_candidate,
    enqueue_extraction,
    enqueue_persona_candidate,
)
from app.workers.memory_worker import MemoryWorker

_KNOWN_QUEUES = (MEMORY_EXTRACTION_QUEUE_KEY, PERSONA_CANDIDATE_QUEUE_KEY)


class _StubRedis:
    """按队列分别记录 push 并按 FIFO 弹出的最小 Redis 替身。"""

    def __init__(self) -> None:
        self.queues: dict[str, list[str]] = {key: [] for key in _KNOWN_QUEUES}

    @property
    def items(self) -> list[str]:
        """记忆抽取队列，保持既有用例的写法可用。"""

        return self.queues[MEMORY_EXTRACTION_QUEUE_KEY]

    async def lpush(self, key: str, value: str) -> int:
        assert key in _KNOWN_QUEUES
        self.queues[key].insert(0, value)
        return len(self.queues[key])

    async def brpop(self, key: str, timeout: int = 0) -> tuple[str, str] | None:
        assert key in _KNOWN_QUEUES
        if not self.queues[key]:
            return None
        return (key, self.queues[key].pop())


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


@pytest.mark.asyncio
async def test_persona_candidate_queue_round_trips_payload() -> None:
    """人格候选项任务的三个字段必须原样取回。"""

    client = _StubRedis()
    user_id, assistant_id = uuid.uuid4(), uuid.uuid4()
    await enqueue_persona_candidate(
        user_id=user_id, assistant_id=assistant_id, text="别这么啰嗦", client=client
    )
    assert await dequeue_persona_candidate(client=client) == (
        user_id,
        assistant_id,
        "别这么啰嗦",
    )


@pytest.mark.asyncio
async def test_persona_candidate_dequeue_discards_blank_text() -> None:
    """空文本的任务直接丢弃：没有内容可抽，不值得为它开一次模型调用。"""

    client = _StubRedis()
    await enqueue_persona_candidate(
        user_id=uuid.uuid4(), assistant_id=uuid.uuid4(), text="   ", client=client
    )
    assert await dequeue_persona_candidate(client=client) is None


@pytest.mark.asyncio
async def test_worker_consumes_persona_candidates_when_extraction_queue_is_empty(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """记忆队列为空时 worker 继续消费人格候选项队列，不让旁路饿死。"""

    client = _StubRedis()
    await enqueue_persona_candidate(
        user_id=uuid.uuid4(), assistant_id=uuid.uuid4(), text="以后叫我老板", client=client
    )
    seen: list[str] = []

    async def _record(**kwargs: object) -> list[object]:
        seen.append(str(kwargs["text"]))
        return []

    monkeypatch.setattr("app.workers.memory_worker.extract_from_chat", _record)
    assert await MemoryWorker(client=client).run_once() is True
    assert seen == ["以后叫我老板"]


@pytest.mark.asyncio
async def test_worker_survives_a_persona_candidate_failure(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """人格候选项抽取失败同样只记录日志，不得毒死 worker。"""

    client = _StubRedis()
    await enqueue_persona_candidate(
        user_id=uuid.uuid4(), assistant_id=uuid.uuid4(), text="语气太生硬", client=client
    )

    async def _boom(**_: object) -> list[object]:
        raise RuntimeError("persona extraction exploded")

    monkeypatch.setattr("app.workers.memory_worker.extract_from_chat", _boom)
    assert await MemoryWorker(client=client).run_once() is True


@pytest.mark.asyncio
async def test_worker_reports_no_work_when_both_queues_are_empty() -> None:
    """两条队列都空时返回 False。"""

    assert await MemoryWorker(client=_StubRedis()).run_once() is False
