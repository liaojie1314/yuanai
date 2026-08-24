"""Agent 运行时的脱敏结构化指标。"""

from __future__ import annotations

import hashlib
import logging
import uuid
from typing import Final

from app.core.config import settings

logger = logging.getLogger(__name__)
_HASH_ALGORITHM: Final[str] = "sha256"


def hash_user_id(user_id: uuid.UUID, *, salt: str | None = None) -> str:
    """将用户标识转换为不可逆、稳定的指标标签。"""
    value = f"{salt if salt is not None else settings.agent_metrics_hash_salt}:{user_id}"
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


class AgentMetrics:
    """写入不包含用户内容或原始身份的结构化运行指标。"""

    def __init__(self, *, metrics_logger: logging.Logger | None = None) -> None:
        self._logger = metrics_logger or logger

    def record(
        self,
        name: str,
        *,
        run_id: uuid.UUID,
        user_id: uuid.UUID,
        step_id: uuid.UUID | None = None,
    ) -> dict[str, str | None]:
        """构造并记录指标；返回值便于测试与内存指标适配器复用。"""
        metric = {
            "metric": name,
            "run_id": str(run_id),
            "step_id": str(step_id) if step_id is not None else None,
            "user_id_hash": hash_user_id(user_id),
            "hash_algorithm": _HASH_ALGORITHM,
        }
        self._logger.info("agent_metric", extra={"agent_metric": metric})
        return metric

    def emit(
        self,
        name: str,
        *,
        run_id: uuid.UUID,
        user_id: uuid.UUID,
        step_id: uuid.UUID | None = None,
    ) -> None:
        """记录一个运行事件指标，不接受可能包含敏感内容的 payload。"""
        self.record(name, run_id=run_id, user_id=user_id, step_id=step_id)
