"""Agent Run 状态迁移。"""

from collections.abc import Mapping

from app.models.agent_run import AgentRunStatus


class InvalidRunTransitionError(ValueError):
    """表示尝试执行了不允许的 Run 状态迁移。"""


_TRANSITIONS: Mapping[AgentRunStatus, frozenset[AgentRunStatus]] = {
    AgentRunStatus.queued: frozenset({AgentRunStatus.running, AgentRunStatus.cancelled}),
    AgentRunStatus.running: frozenset(
        {
            AgentRunStatus.waiting_approval,
            AgentRunStatus.waiting_input,
            AgentRunStatus.succeeded,
            AgentRunStatus.failed,
            AgentRunStatus.cancelled,
        }
    ),
    AgentRunStatus.waiting_approval: frozenset({AgentRunStatus.queued, AgentRunStatus.cancelled}),
    AgentRunStatus.waiting_input: frozenset({AgentRunStatus.queued, AgentRunStatus.cancelled}),
    AgentRunStatus.succeeded: frozenset(),
    AgentRunStatus.failed: frozenset(),
    AgentRunStatus.cancelled: frozenset(),
}


class RunStateMachine:
    """集中管理 Run 的合法状态迁移。"""

    def __init__(self, status: AgentRunStatus | str = AgentRunStatus.queued) -> None:
        try:
            self._status = AgentRunStatus(status)
        except ValueError as error:
            raise InvalidRunTransitionError(f"未知 Run 状态: {status}") from error

    @property
    def status(self) -> AgentRunStatus:
        """返回当前状态。"""

        return self._status

    @staticmethod
    def can_transition(source: AgentRunStatus | str, target: AgentRunStatus | str) -> bool:
        """判断状态迁移是否符合 Phase 5 协议。"""

        try:
            source_status = AgentRunStatus(source)
            target_status = AgentRunStatus(target)
        except ValueError:
            return False
        return target_status in _TRANSITIONS[source_status]

    def transition(self, target: AgentRunStatus | str) -> AgentRunStatus:
        """执行一次合法迁移并返回新状态。"""

        try:
            target_status = AgentRunStatus(target)
        except ValueError as error:
            raise InvalidRunTransitionError(f"未知 Run 状态: {target}") from error
        if target_status not in _TRANSITIONS[self._status]:
            raise InvalidRunTransitionError(
                f"不允许从 {self._status.value} 迁移到 {target_status.value}"
            )
        self._status = target_status
        return self._status

    def recover(self) -> AgentRunStatus:
        """将租约丢失的 running Run 安全恢复到 queued。"""

        if self._status is not AgentRunStatus.running:
            raise InvalidRunTransitionError(
                f"只允许从 running 恢复 Run，当前状态为 {self._status.value}"
            )
        self._status = AgentRunStatus.queued
        return self._status


# 兼容调用方使用的简短异常名。
InvalidRunTransition = InvalidRunTransitionError
