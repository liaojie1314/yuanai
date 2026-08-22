"""无副作用的当前时间工具。"""

from __future__ import annotations

from datetime import UTC, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

CURRENT_TIME_SPEC = ToolSpec(
    name="get_current_time",
    description="获取当前时间；默认返回 UTC，可选择系统时区数据库中的时区。",
    input_schema={
        "type": "object",
        "properties": {"timezone": {"type": "string", "minLength": 1, "maxLength": 64}},
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {"datetime": {"type": "string"}, "timezone": {"type": "string"}},
        "required": ["datetime", "timezone"],
    },
    risk_level=ToolRisk.read,
    execution_location="cloud",
    timeout_seconds=5,
    idempotent=True,
)


async def get_current_time(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """返回带时区的 ISO-8601 时间戳，不访问外部服务。"""

    timezone_name = arguments.get("timezone", "UTC")
    if not isinstance(timezone_name, str):
        raise ToolError(ToolErrorCode.INVALID_TIMEZONE)
    if timezone_name == "UTC":
        current = datetime.now(UTC)
    else:
        try:
            current = datetime.now(ZoneInfo(timezone_name))
        except (ZoneInfoNotFoundError, ValueError) as error:
            raise ToolError(ToolErrorCode.INVALID_TIMEZONE) from error
    return {"datetime": current.isoformat(), "timezone": timezone_name}
