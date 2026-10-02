"""Desktop 执行节点使用的受限本地工具契约。"""

from __future__ import annotations

from app.schemas.memory import MEMORY_SEARCH_MAX_QUERY_CHARS
from app.tools.contracts import (
    SideEffect,
    ToolContext,
    ToolError,
    ToolErrorCode,
    ToolOutput,
    ToolRisk,
    ToolSpec,
)

# 相对路径：禁止绝对路径、盘符、反斜杠、路径穿越段和 NUL；细节校验由节点本地再执行一次。
_SAFE_RELATIVE_PATH_PATTERN = (
    r"^(?!/)(?!\\)(?![A-Za-z]:)(?!\.\.(?:/|$))(?!.*?/\.\.(?:/|$))[^/\\\x00]+(?:/[^/\\\x00]+)*$"
)

# 结果回传受 execution_node_result_max_bytes 约束；UTF-8 转义与 base64 展开后仍需留有余量。
_MAX_READ_BYTES = 24_576
_MAX_DIRECTORY_ENTRIES = 200
_MAX_WORKSPACE_CONTENT_BYTES = 65_536
# 剪贴板正文会整体回传模型上下文，必须远低于节点的结果字节上限
_MAX_CLIPBOARD_CHARS = 10_000

# 记忆作业的边界与 MemoryCreateCandidate / memories 检索接口保持一致
_MAX_MEMORY_CONTENT_CHARS = 10_000
# 查询上限必须与节点的 runMemorySearch 相同：声明得比节点宽，
# 超限查询就会被云端放行、在节点上报 TOOL_INVALID_INPUT，
# 最终对用户显示成「本地记忆不可用」，把参数错误伪装成节点故障。
_MAX_MEMORY_QUERY_CHARS = MEMORY_SEARCH_MAX_QUERY_CHARS
_MAX_MEMORY_RESULTS = 50
_UUID_PATTERN = r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"

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


READ_GRANTED_FILE_SPEC = ToolSpec(
    name="read_granted_file",
    description=(
        "读取用户已在 Desktop 节点显式授权的文件内容；"
        "按稳定 resource_id 定位，云端不知道真实本地路径。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "resource_id": {"type": "string", "minLength": 1, "maxLength": 200},
            "encoding": {"type": "string", "enum": ["utf8", "base64"]},
            "max_bytes": {"type": "integer", "minimum": 1, "maximum": _MAX_READ_BYTES},
        },
        "required": ["resource_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "resource_id": {"type": "string"},
            "size_bytes": {"type": "integer"},
            "encoding": {"type": "string"},
            "content": {"type": "string"},
            "truncated": {"type": "boolean"},
        },
    },
    risk_level=ToolRisk.read,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "files"},
)


async def read_granted_file(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


LIST_GRANTED_DIRECTORY_SPEC = ToolSpec(
    name="list_granted_directory",
    description=("列出用户已在 Desktop 节点显式授权目录的直接子项名称与类型；不返回绝对路径。"),
    input_schema={
        "type": "object",
        "properties": {
            "resource_id": {"type": "string", "minLength": 1, "maxLength": 200},
            "max_entries": {"type": "integer", "minimum": 1, "maximum": _MAX_DIRECTORY_ENTRIES},
        },
        "required": ["resource_id"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "resource_id": {"type": "string"},
            "entries": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "kind": {"type": "string"},
                        "size_bytes": {"type": "integer"},
                    },
                },
            },
            "truncated": {"type": "boolean"},
        },
    },
    risk_level=ToolRisk.read,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "files"},
)


async def list_granted_directory(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


WRITE_WORKSPACE_FILE_SPEC = ToolSpec(
    name="write_workspace_file",
    description=(
        "在 Desktop 节点的 Agent 工作区内写入或覆盖文件；只接受受限相对路径，"
        "禁止路径穿越，真实位置由节点本地策略决定。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "relative_path": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500,
                "pattern": _SAFE_RELATIVE_PATH_PATTERN,
            },
            "content": {"type": "string", "maxLength": _MAX_WORKSPACE_CONTENT_BYTES},
            "encoding": {"type": "string", "enum": ["utf8", "base64"]},
        },
        "required": ["relative_path", "content"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "relative_path": {"type": "string"},
            "size_bytes": {"type": "integer"},
        },
    },
    risk_level=ToolRisk.local_write,
    side_effect=SideEffect.local_write,
    idempotent=False,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "files", "write"},
)


async def write_workspace_file(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


READ_CLIPBOARD_SPEC = ToolSpec(
    name="read_clipboard",
    description=(
        "读取 Desktop 节点当前的系统剪贴板纯文本；剪贴板可能含密码等敏感内容，每次都需用户确认。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "max_chars": {"type": "integer", "minimum": 1, "maximum": _MAX_CLIPBOARD_CHARS}
        },
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "text": {"type": "string"},
            "char_count": {"type": "integer"},
            "truncated": {"type": "boolean"},
        },
    },
    # 剪贴板是用户本机的私密缓冲区，phase-6 §9.4 要求「仅在用户主动触发且每次确认」。
    # PolicyEngine 对 read 与 local_write 会自动放行，只有更高等级才会每次都走审批卡，
    # 因此这里取 external_side_effect —— 它在风险表里的默认策略正是「每次确认」。
    # 真实副作用为 none：读取不改变任何状态。
    risk_level=ToolRisk.external_side_effect,
    side_effect=SideEffect.none,
    # 剪贴板内容随时变化，同样的参数两次调用结果不同，不能被当作可重放的幂等作业。
    idempotent=False,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "clipboard"},
)


async def read_clipboard(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


MEMORY_SEARCH_SPEC = ToolSpec(
    name="memory.search",
    description=(
        "在 Desktop 节点本地检索 storage_location=local_node 的记忆正文；云端只有元数据。"
    ),
    input_schema={
        "type": "object",
        "properties": {
            "query": {"type": "string", "minLength": 1, "maxLength": _MAX_MEMORY_QUERY_CHARS},
            "limit": {"type": "integer", "minimum": 1, "maximum": _MAX_MEMORY_RESULTS},
        },
        "required": ["query", "limit"],
        "additionalProperties": False,
    },
    output_schema={
        "type": "object",
        "properties": {
            "memories": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string"},
                        "content": {"type": "string"},
                        "score": {"type": "number"},
                    },
                },
            },
        },
    },
    risk_level=ToolRisk.read,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "memory"},
)


async def memory_search(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


MEMORY_WRITE_SPEC = ToolSpec(
    name="memory.write",
    description=("把一条本地记忆的正文写入 Desktop 节点；按云端记忆 id 定位，重复写入即覆盖。"),
    input_schema={
        "type": "object",
        "properties": {
            "memoryId": {"type": "string", "pattern": _UUID_PATTERN},
            "content": {"type": "string", "minLength": 1, "maxLength": _MAX_MEMORY_CONTENT_CHARS},
            "memoryType": {
                "type": "string",
                "enum": ["profile", "preference", "semantic", "episodic"],
            },
        },
        "required": ["memoryId", "content", "memoryType"],
        "additionalProperties": False,
    },
    output_schema={"type": "object", "properties": {"stored": {"type": "boolean"}}},
    # 写入本地磁盘属于副作用，风险等级必须高于 read，否则会被节点侧自动接受策略放行。
    risk_level=ToolRisk.local_write,
    side_effect=SideEffect.local_write,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "memory", "write"},
)


async def memory_write(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


MEMORY_DELETE_SPEC = ToolSpec(
    name="memory.delete",
    description="从 Desktop 节点彻底删除一条本地记忆的正文；删除后无法从云端恢复。",
    input_schema={
        "type": "object",
        "properties": {"memoryId": {"type": "string", "pattern": _UUID_PATTERN}},
        "required": ["memoryId"],
        "additionalProperties": False,
    },
    output_schema={"type": "object", "properties": {"deleted": {"type": "boolean"}}},
    risk_level=ToolRisk.destructive,
    side_effect=SideEffect.destructive,
    execution_location="desktop",
    execution_locations={"desktop"},
    timeout_seconds=30,
    tags={"desktop", "memory", "write"},
)


async def memory_delete(arguments: dict[str, object], _context: ToolContext) -> ToolOutput:
    """拒绝在 API 进程执行 Desktop 工具，任务只允许交给节点。"""

    del arguments
    raise ToolError(ToolErrorCode.EXECUTION_FAILED, "DESKTOP_TOOL_REQUIRES_NODE")


DESKTOP_BUILTINS = (
    (BROWSER_OPEN_URL_SPEC, browser_open_url),
    (READ_GRANTED_FILE_SPEC, read_granted_file),
    (LIST_GRANTED_DIRECTORY_SPEC, list_granted_directory),
    (WRITE_WORKSPACE_FILE_SPEC, write_workspace_file),
    (READ_CLIPBOARD_SPEC, read_clipboard),
    (MEMORY_SEARCH_SPEC, memory_search),
    (MEMORY_WRITE_SPEC, memory_write),
    (MEMORY_DELETE_SPEC, memory_delete),
)
