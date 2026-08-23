"""Agent coordinator 的稳定错误码和领域异常。"""

from __future__ import annotations

from enum import StrEnum


class AgentErrorCode(StrEnum):
    """对 Worker、API 和客户端稳定的 Agent 错误码。"""

    AGENT_CANCELLED = "AGENT_CANCELLED"
    AGENT_LOOP_DETECTED = "AGENT_LOOP_DETECTED"
    AGENT_STEP_LIMIT_EXCEEDED = "AGENT_STEP_LIMIT_EXCEEDED"
    AGENT_TOKEN_BUDGET_EXCEEDED = "AGENT_TOKEN_BUDGET_EXCEEDED"
    AGENT_COST_BUDGET_EXCEEDED = "AGENT_COST_BUDGET_EXCEEDED"
    AGENT_TIME_BUDGET_EXCEEDED = "AGENT_TIME_BUDGET_EXCEEDED"
    MODEL_FAILED = "MODEL_FAILED"
    MODEL_TIMEOUT = "MODEL_TIMEOUT"
    TOOL_FAILED = "TOOL_FAILED"
    TOOL_TIMEOUT = "TOOL_TIMEOUT"
    INVALID_TOOL_CALL = "INVALID_TOOL_CALL"
    RUN_NOT_EXECUTABLE = "RUN_NOT_EXECUTABLE"


class AgentCoordinatorError(RuntimeError):
    """表示可预测终止的 Agent coordinator 错误。"""

    def __init__(self, code: AgentErrorCode, message: str | None = None) -> None:
        self.code = code
        self.message = message or code.value
        super().__init__(self.message)
