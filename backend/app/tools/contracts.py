"""Phase 5 内置工具的稳定契约与错误码。"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable, Mapping
from enum import StrEnum
from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, ConfigDict, Field

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession


class ToolRisk(StrEnum):
    """工具风险等级；Phase 5 内置工具均为只读。"""

    read = "read"
    low = "read"
    local_write = "local_write"
    reversible_write = "reversible_write"
    external_side_effect = "external_side_effect"
    destructive = "destructive"
    financial = "financial"
    privileged = "privileged"


class ExecutionLocation(StrEnum):
    """工具允许执行的位置。"""

    cloud = "cloud"
    desktop = "desktop"
    either = "either"


class ToolErrorCode(StrEnum):
    """对 coordinator 和客户端稳定的工具错误码。"""

    NOT_FOUND = "TOOL_NOT_FOUND"
    DUPLICATE = "TOOL_DUPLICATE"
    INVALID_INPUT = "TOOL_INVALID_INPUT"
    TIMEOUT = "TOOL_TIMEOUT"
    EXECUTION_FAILED = "TOOL_EXECUTION_FAILED"
    OUTPUT_TOO_LARGE = "TOOL_OUTPUT_TOO_LARGE"
    CALCULATION_FAILED = "TOOL_CALCULATION_FAILED"
    INVALID_TIMEZONE = "TOOL_INVALID_TIMEZONE"
    FILE_CONTEXT_REQUIRED = "TOOL_FILE_CONTEXT_REQUIRED"
    FILE_NOT_FOUND = "TOOL_FILE_NOT_FOUND"


class ToolError(RuntimeError):
    """工具执行可安全暴露的稳定错误，不携带 provider 或 SQL 详情。"""

    def __init__(self, code: ToolErrorCode, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code.value)


class ToolRegistrationError(ValueError):
    """工具注册失败，例如重复注册。"""

    def __init__(self, code: ToolErrorCode, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code.value)


class ToolValidationError(ValueError):
    """工具输入不符合显式 JSON Schema。"""

    def __init__(self, code: ToolErrorCode = ToolErrorCode.INVALID_INPUT) -> None:
        self.code = code
        super().__init__(code.value)


class ToolExecutionError(ToolError):
    """工具执行超时、输出过大或内部失败。"""


class ToolSpec(BaseModel):
    """描述一个可由代码显式注册的 Phase 5 工具。"""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(min_length=1, max_length=100, pattern=r"^[a-z][a-z0-9_]{0,99}$")
    description: str = Field(min_length=1, max_length=500)
    input_schema: dict[str, object]
    output_schema: dict[str, object] | None = None
    risk_level: ToolRisk
    execution_location: Literal["cloud", "desktop", "either"]
    timeout_seconds: int = Field(default=30, ge=0, le=300)
    idempotent: bool = True


class ToolContext:
    """为需要租户或数据库访问的工具提供受限执行上下文。"""

    def __init__(
        self,
        *,
        user_id: uuid.UUID | None = None,
        db: AsyncSession | None = None,
    ) -> None:
        self.user_id = user_id
        self.db = db


type ToolOutput = dict[str, object] | list[object]
type ToolHandler = Callable[[dict[str, object], ToolContext], Awaitable[ToolOutput] | ToolOutput]
type ToolArguments = Mapping[str, object]
