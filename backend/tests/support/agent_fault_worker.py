"""为 Worker 故障演练提供隔离队列和强制退出子进程。"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

from redis import asyncio as redis_asyncio

from app.services.agent.queue import AgentQueue, QueueItem
from app.workers.agent_worker import AgentWorker, CancellationToken


class IsolatedAgentQueue(AgentQueue):
    """为单个演练使用独立 Redis 键空间，避免消费其他队列项。"""

    _active_namespace = "agent-drill"

    def __init__(self, client: object, namespace: str) -> None:
        super().__init__(client)
        IsolatedAgentQueue._active_namespace = namespace

    @staticmethod
    def queue_key() -> str:
        """返回隔离的待消费队列键。"""

        return f"{IsolatedAgentQueue._active_namespace}:queue"

    @staticmethod
    def processing_key() -> str:
        """返回隔离的处理中队列键。"""

        return f"{IsolatedAgentQueue._active_namespace}:processing"

    @staticmethod
    def pending_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回隔离的重复投递标记键。"""

        return f"{IsolatedAgentQueue._active_namespace}:pending:{tenant_id}:{run_id}"

    @staticmethod
    def lease_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回隔离的租约键。"""

        return f"{IsolatedAgentQueue._active_namespace}:lease:{tenant_id}:{run_id}"

    @staticmethod
    def cancellation_key(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回隔离的取消标记键。"""

        return f"{IsolatedAgentQueue._active_namespace}:cancel:{tenant_id}:{run_id}"

    @staticmethod
    def broadcast_channel(tenant_id: uuid.UUID, run_id: uuid.UUID) -> str:
        """返回隔离的事件广播频道。"""

        return f"{IsolatedAgentQueue._active_namespace}:events:{tenant_id}:{run_id}"


def claim_side_effect(path: Path) -> bool:
    """使用文件创建作为跨进程的持久化幂等键。"""

    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        return False
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        handle.write("claimed\n")
    return True


def append_record(path: Path, value: str) -> None:
    """追加演练过程记录，不包含用户数据或凭据。"""

    with path.open("a", encoding="utf-8") as handle:
        handle.write(f"{value}\n")


async def _force_exit_after_effect(
    _item: QueueItem,
    _token: CancellationToken,
    *,
    idempotency_path: Path,
    record_path: Path,
) -> None:
    """在副作用已领取后直接终止进程，模拟不可协作的 Worker 退出。"""

    if claim_side_effect(idempotency_path):
        append_record(record_path, "effect")
    os._exit(71)


async def run_forced_exit(
    *,
    redis_url: str,
    namespace: str,
    tenant_id: uuid.UUID,
    run_id: uuid.UUID,
    idempotency_path: Path,
    record_path: Path,
) -> None:
    """消费一次任务并在副作用后强制退出当前子进程。"""

    client = redis_asyncio.from_url(redis_url, decode_responses=True)
    try:
        queue = IsolatedAgentQueue(client, namespace)
        worker = AgentWorker(
            queue,
            lambda item, token: _force_exit_after_effect(
                item,
                token,
                idempotency_path=idempotency_path,
                record_path=record_path,
            ),
            worker_id="fault-injection-worker",
        )
        await worker.run_once(asyncio.Event())
    finally:
        await client.aclose()


def main() -> None:
    """解析演练子进程参数并执行强制退出路径。"""

    if len(sys.argv) != 7:
        raise SystemExit(
            "expected redis URL, namespace, tenant ID, run ID, idempotency path and record path"
        )
    asyncio.run(
        run_forced_exit(
            redis_url=sys.argv[1],
            namespace=sys.argv[2],
            tenant_id=uuid.UUID(sys.argv[3]),
            run_id=uuid.UUID(sys.argv[4]),
            idempotency_path=Path(sys.argv[5]),
            record_path=Path(sys.argv[6]),
        )
    )


if __name__ == "__main__":
    main()
