"""Agent Run 的 Redis 队列、广播、租约和取消令牌。"""

from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from typing import Protocol, cast

from redis.exceptions import RedisError

from app.core.redis import redis_client

LEASE_TTL_SECONDS = 60
LEASE_RENEW_INTERVAL_SECONDS = 20
CANCEL_TTL_SECONDS = 24 * 60 * 60

_RENEW_LEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('expire', KEYS[1], ARGV[2])
end
return 0
"""
_RELEASE_LEASE_SCRIPT = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


class AsyncRedisLike(Protocol):
    """Event loop 中使用的最小 Redis 异步接口。"""

    async def delete(self, key: str) -> int: ...

    async def expire(self, key: str, seconds: int) -> bool: ...

    async def get(self, key: str) -> str | None: ...

    async def lpop(self, key: str) -> str | None: ...

    async def publish(self, channel: str, message: str) -> int: ...

    async def rpush(self, key: str, value: str) -> int: ...

    async def sadd(self, key: str, value: str) -> int: ...

    async def set(
        self,
        key: str,
        value: str,
        *,
        ex: int | None = None,
        nx: bool = False,
    ) -> bool: ...

    async def srem(self, key: str, value: str) -> int: ...


@dataclass(frozen=True, slots=True)
class QueueItem:
    """队列中的租户与 Run 标识，不携带目标或凭据。"""

    tenant_id: uuid.UUID
    run_id: uuid.UUID


def _identifier(value: uuid.UUID) -> str:
    """将 UUID 规范化为 Redis key 的安全文本。"""

    return str(value)


class AgentQueue:
    """封装 Agent 队列及其短期运行控制信号。"""

    def __init__(self, client: object = redis_client) -> None:
        self._redis = cast(AsyncRedisLike, client)

    @staticmethod
    def queue_key() -> str:
        """返回所有租户共享的队列名；队列项本身始终携带租户边界。"""

        return "agent:queue"

    @staticmethod
    def pending_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回租户与 Run 隔离的去重集合键。"""

        return f"agent:pending:{_identifier(tenant_id)}:{_identifier(run_id)}"

    @staticmethod
    def lease_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回租户与 Run 隔离的租约键。"""

        return f"agent:lease:{_identifier(tenant_id)}:{_identifier(run_id)}"

    @staticmethod
    def cancellation_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回租户与 Run 隔离的取消键。"""

        return f"agent:cancel:{_identifier(tenant_id)}:{_identifier(run_id)}"

    @staticmethod
    def broadcast_channel(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回租户与 Run 隔离的事件广播频道。"""

        return f"agent:events:{_identifier(tenant_id)}:{_identifier(run_id)}"

    async def enqueue(self, tenant_id: uuid.UUID, run_id: uuid.UUID) -> bool:
        """幂等地将 Run 放入队列，返回是否真的新增了队列项。"""

        pending_key = self.pending_key(tenant_id, run_id)
        item_key = f"{_identifier(tenant_id)}:{_identifier(run_id)}"
        added = await self._redis.sadd(pending_key, item_key)
        if added == 0:
            return False
        payload = json.dumps(
            {"tenant_id": _identifier(tenant_id), "run_id": _identifier(run_id)},
            separators=(",", ":"),
        )
        try:
            await self._redis.rpush(self.queue_key(), payload)
        except (RedisError, OSError):
            await self._redis.srem(pending_key, item_key)
            raise
        return True

    async def dequeue(self, tenant_id: uuid.UUID | None = None) -> QueueItem | None:
        """取出一个 Run；指定租户时不会交付其他租户的队列项。"""

        skipped: list[str] = []
        item: QueueItem | None = None
        while item is None:
            payload = await self._redis.lpop(self.queue_key())
            if payload is None:
                break
            candidate = self._decode_item(payload)
            if tenant_id is None or candidate.tenant_id == tenant_id:
                item = candidate
                break
            skipped.append(payload)
        for payload in skipped:
            await self._redis.rpush(self.queue_key(), payload)
        if item is None:
            return None
        await self._redis.srem(
            self.pending_key(item.tenant_id, item.run_id),
            f"{_identifier(item.tenant_id)}:{_identifier(item.run_id)}",
        )
        return item

    @staticmethod
    def _decode_item(payload: str) -> QueueItem:
        """解析并校验不含敏感信息的队列项。"""

        try:
            data = json.loads(payload)
            return QueueItem(
                tenant_id=uuid.UUID(str(data["tenant_id"])),
                run_id=uuid.UUID(str(data["run_id"])),
            )
        except (KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
            raise ValueError("Agent queue payload is invalid") from error

    async def publish(self, tenant_id: uuid.UUID, run_id: uuid.UUID, payload: str) -> None:
        """发布已经持久化的事件；Redis 失败由上层按可重放语义处理。"""

        await self._redis.publish(self.broadcast_channel(tenant_id, run_id), payload)

    async def acquire_lease(self, tenant_id: uuid.UUID, run_id: uuid.UUID, owner: str) -> bool:
        """以 60 秒 TTL 原子认领 Run 租约。"""

        return await self._redis.set(
            self.lease_key(tenant_id, run_id), owner, ex=LEASE_TTL_SECONDS, nx=True
        )

    async def lease_owner(self, tenant_id: uuid.UUID, run_id: uuid.UUID) -> str | None:
        """读取当前租约持有者；键不存在表示租约已丢失或过期。"""

        return await self._redis.get(self.lease_key(tenant_id, run_id))

    async def renew_lease(self, tenant_id: uuid.UUID, run_id: uuid.UUID, owner: str) -> bool:
        """仅允许原持有者续租，避免覆盖其他 Worker 的租约。"""

        key = self.lease_key(tenant_id, run_id)
        evaluate = getattr(self._redis, "eval", None)
        if callable(evaluate):
            return bool(
                await evaluate(
                    _RENEW_LEASE_SCRIPT,
                    1,
                    key,
                    owner,
                    str(LEASE_TTL_SECONDS),
                )
            )
        current = await self._redis.get(key)
        if current != owner:
            return False
        return await self._redis.expire(key, LEASE_TTL_SECONDS)

    async def release_lease(self, tenant_id: uuid.UUID, run_id: uuid.UUID, owner: str) -> bool:
        """仅删除仍由指定 Worker 持有的租约。"""

        key = self.lease_key(tenant_id, run_id)
        evaluate = getattr(self._redis, "eval", None)
        if callable(evaluate):
            return bool(await evaluate(_RELEASE_LEASE_SCRIPT, 1, key, owner))
        current = await self._redis.get(key)
        if current != owner:
            return False
        return bool(await self._redis.delete(key))

    async def cancel(self, tenant_id: uuid.UUID, run_id: uuid.UUID) -> None:
        """写入短期取消令牌，Worker 会在下一安全检查点停止。"""

        await self._redis.set(self.cancellation_key(tenant_id, run_id), "1", ex=CANCEL_TTL_SECONDS)

    async def is_cancelled(self, tenant_id: uuid.UUID, run_id: uuid.UUID) -> bool:
        """返回 Run 是否已被标记取消。"""

        return await self._redis.get(self.cancellation_key(tenant_id, run_id)) is not None

    async def clear_cancel(self, tenant_id: uuid.UUID, run_id: uuid.UUID) -> None:
        """清理一次已处理的取消令牌。"""

        await self._redis.delete(self.cancellation_key(tenant_id, run_id))
