"""记忆抽取任务的 Redis 队列，只负责投递与取出。"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any

from app.core.redis import redis_client

logger = logging.getLogger(__name__)

MEMORY_EXTRACTION_QUEUE_KEY = "memory:extract"


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
