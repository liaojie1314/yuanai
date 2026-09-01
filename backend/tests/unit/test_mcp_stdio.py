"""MCP stdio transport 的命令边界和进程生命周期测试。"""

import sys
from pathlib import Path

import pytest

from app.services.tools.mcp_stdio import (
    StdioMcpError,
    call_stdio_mcp,
    validate_secret_environment_name,
    validate_stdio_command,
)


def test_stdio_command_requires_exact_allowlist(monkeypatch: pytest.MonkeyPatch) -> None:
    """命令必须是部署 allowlist 中的精确可执行文件。"""

    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        "/usr/bin/node server.js",
    )
    assert validate_stdio_command("/usr/bin/node", ["server.js"]) == (
        "/usr/bin/node",
        "server.js",
    )
    with pytest.raises(StdioMcpError, match="MCP_STDIO_COMMAND_NOT_ALLOWED"):
        validate_stdio_command("/bin/sh", ["echo"])
    with pytest.raises(StdioMcpError, match="MCP_STDIO_ARGUMENTS_NOT_ALLOWED"):
        validate_stdio_command("/usr/bin/node", ["--eval", "process.env.SECRET"])


def test_stdio_secret_environment_name_is_restricted() -> None:
    """只允许普通大写环境变量名，不能覆盖运行时特殊变量。"""

    assert validate_secret_environment_name("MCP_AUTH_TOKEN") == "MCP_AUTH_TOKEN"
    with pytest.raises(StdioMcpError, match="MCP_STDIO_ENV_INVALID"):
        validate_secret_environment_name("PATH=OVERRIDE")


@pytest.mark.asyncio
async def test_stdio_client_completes_initialize_and_tool_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """真实子进程能完成 MCP 初始化和工具调用，并接收受限 Secret。"""

    command = sys.executable
    script = str(Path(__file__).parents[1] / "support" / "stdio_mcp_server.py")
    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        f"{command} {script}",
    )
    result = await call_stdio_mcp(
        command,
        [script],
        method="tools/call",
        params={"name": "lookup", "arguments": {"query": "yuanai"}},
        environment={"MCP_AUTH_TOKEN": "secret-value"},
    )
    content = result["content"]
    assert isinstance(content, list)
    assert content[0]["text"] == "yuanai:secret-value"
