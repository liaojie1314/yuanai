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


@pytest.mark.parametrize("name", ["PATH", "PYTHONPATH", "LD_PRELOAD", "NODE_OPTIONS"])
def test_stdio_environment_rejects_runtime_override_names(
    monkeypatch: pytest.MonkeyPatch, name: str
) -> None:
    """Secret 入口不能改变 Worker 的解释器、动态加载或搜索路径。"""

    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        "/usr/bin/node server.js",
    )
    with pytest.raises(StdioMcpError, match="MCP_STDIO_ENV_INVALID"):
        # 通过公开调用入口验证，而不是只测试下游 Worker。
        import asyncio

        asyncio.run(
            call_stdio_mcp(
                "/usr/bin/node",
                ["server.js"],
                method="tools/list",
                params={},
                environment={name: "unsafe"},
            )
        )


def test_stdio_environment_requires_mcp_prefix_and_bounded_secret(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """只允许 MCP_ 前缀且限制 Secret 长度，避免任意环境注入和资源滥用。"""

    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        "/usr/bin/node server.js",
    )
    import asyncio

    for environment in ({"AUTH_TOKEN": "secret"}, {"MCP_AUTH_TOKEN": "x" * 4097}):
        with pytest.raises(StdioMcpError, match="MCP_STDIO_ENV_INVALID"):
            asyncio.run(
                call_stdio_mcp(
                    "/usr/bin/node",
                    ["server.js"],
                    method="tools/list",
                    params={},
                    environment=environment,
                )
            )


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
    assert content[0]["text"].startswith("yuanai:secret-value:worker=1:parent=")


@pytest.mark.asyncio
async def test_stdio_worker_rejects_hung_fixture_and_recovers_process_group(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """超时的真实 MCP fixture 必须由 Worker 回收，不能阻塞 API 进程。"""

    command = sys.executable
    script = str(Path(__file__).parents[1] / "support" / "stdio_mcp_server.py")
    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        f"{command} {script}",
    )
    monkeypatch.setattr("app.services.tools.mcp_stdio.settings.mcp_stdio_timeout_seconds", 0.05)

    with pytest.raises(StdioMcpError, match="MCP_STDIO_TIMEOUT"):
        await call_stdio_mcp(
            command,
            [script],
            method="tools/call",
            params={"name": "lookup", "arguments": {"query": "hang"}},
        )


@pytest.mark.asyncio
async def test_stdio_worker_rejects_fixture_output_above_limit(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """超过协议输出限制的 MCP 响应不会泄露回 API 进程。"""

    command = sys.executable
    script = str(Path(__file__).parents[1] / "support" / "stdio_mcp_server.py")
    monkeypatch.setattr(
        "app.services.tools.mcp_stdio.settings.mcp_stdio_command_allowlist",
        f"{command} {script}",
    )
    monkeypatch.setattr("app.services.tools.mcp_stdio.settings.mcp_stdio_max_output_bytes", 256)

    with pytest.raises(StdioMcpError, match="MCP_STDIO_OUTPUT_TOO_LARGE"):
        await call_stdio_mcp(
            command,
            [script],
            method="tools/call",
            params={"name": "lookup", "arguments": {"query": "large"}},
        )
