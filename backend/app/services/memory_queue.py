"""记忆抽取任务的 Redis 队列，只负责投递与取出。"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.core.redis import redis_client

logger = logging.getLogger(__name__)

MEMORY_EXTRACTION_QUEUE_KEY = "memory:extract"
PERSONA_CANDIDATE_QUEUE_KEY = "persona:candidate"


async def enqueue_persona_candidate(
    *, user_id: uuid.UUID, assistant_id: uuid.UUID, text: str, client: Any | None = None
) -> None:
    """把一句疑似表达方式纠正投递给 worker 去抽人格候选项。

    必须在聊天事务提交之后调用：人格候选项是旁路能力，不能回滚或拖慢主链路。
    调用方应先过 ``looks_like_style_correction`` 预筛 —— 抽取是模型调用，
    每轮聊天都调一次不可接受。
    """

    payload = json.dumps({"userId": str(user_id), "assistantId": str(assistant_id), "text": text})
    await (client or redis_client).lpush(PERSONA_CANDIDATE_QUEUE_KEY, payload)


async def dequeue_persona_candidate(
    *, client: Any | None = None, timeout: int = 5
) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """取出一条人格候选项抽取任务；队列为空或数据损坏时返回 ``None``。"""

    item = await (client or redis_client).brpop(PERSONA_CANDIDATE_QUEUE_KEY, timeout=timeout)
    if not item:
        return None
    try:
        payload = json.loads(item[1])
        text = payload["text"]
        if not isinstance(text, str) or not text.strip():
            raise ValueError("empty text")
        return uuid.UUID(payload["userId"]), uuid.UUID(payload["assistantId"]), text
    except (TypeError, ValueError, KeyError):
        logger.warning("丢弃损坏的人格候选项任务")
        return None


async def enqueue_extraction(
    *, user_id: uuid.UUID, run_id: uuid.UUID, client: Any | None = None
) -> None:
    """把一次成功的 Run 投递给抽取 worker。

    必须在 Run 自身事务提交之后调用：抽取失败不能回滚或拖慢主链路。
    """

    payload = json.dumps({"userId": str(user_id), "runId": str(run_id)})
    await (client or redis_client).lpush(MEMORY_EXTRACTION_QUEUE_KEY, payload)


async def dequeue_extraction(
    *, client: Any | None = None, timeout: int = 5
) -> tuple[uuid.UUID, uuid.UUID] | None:
    """取出一条抽取任务；队列为空或数据损坏时返回 ``None``。"""

    item = await (client or redis_client).brpop(MEMORY_EXTRACTION_QUEUE_KEY, timeout=timeout)
    if not item:
        return None
    try:
        payload = json.loads(item[1])
        return uuid.UUID(payload["userId"]), uuid.UUID(payload["runId"])
    except (TypeError, ValueError, KeyError):
        logger.warning("丢弃损坏的记忆抽取任务")
        return None
