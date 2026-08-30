"""Desktop 执行节点使用的受限本地工具契约。"""

from __future__ import annotations

from app.tools.contracts import (
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

BROWSER_OPEN_URL_SPEC = ToolSpec(
    name="browser_open_url",
    description="在用户明确配对的 Desktop 节点默认浏览器中打开 HTTPS URL。",
    input_schema={
        "type": "object",
        "properties": {"url": {"type": "string", "minLength": 8, "maxLength": 2_000}},
        "required": ["url"],
        "additionalProperties": False,
    },
    output_schema={"type": "object"},
    risk_level=ToolRisk.read,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "browser"},
)


async def browser_open_url(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


DESKTOP_BUILTINS = ((BROWSER_OPEN_URL_SPEC, browser_open_url),)
