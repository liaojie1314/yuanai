"""在隔离子进程中运行受控的 MCP stdio transport。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
import sys
from collections.abc import Mapping
from pathlib import Path
from shlex import split as shell_split

from app.core.config import settings

_COMMAND_RE = re.compile(r"^[A-Za-z0-9_./-]+$")
_ARGUMENT_RE = re.compile(r"^[A-Za-z0-9_./:@=+,%~-]+$")
_ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_PROTOCOL_VERSION = "2025-06-18"
_FORBIDDEN_ARGUMENTS = frozenset({"-c", "--command", "--eval", "--execute"})
_ALLOWED_METHODS = frozenset({"tools/list", "tools/call"})
_WORKER_MODULE = "app.workers.mcp_stdio_worker"
_WORKER_ENVIRONMENT = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LC_ALL": "C",
    "PYTHONNOUSERSITE": "1",
}


class StdioMcpError(RuntimeError):
    """MCP stdio 配置、协议或子进程执行失败。"""


def validate_stdio_command(command: str, arguments: list[str]) -> tuple[str, ...]:
    """校验完整命令行来自部署 allowlist，避免用户拼接任意进程参数。"""

    allowed = frozenset(
        item.strip() for item in settings.mcp_stdio_command_allowlist.split(";") if item.strip()
    )
    candidate = (command, *arguments)
    if not command or not _COMMAND_RE.fullmatch(command):
        raise StdioMcpError("MCP_STDIO_COMMAND_NOT_ALLOWED")
    if len(arguments) > settings.mcp_stdio_max_arguments or any(
        not argument
        or len(argument) > 200
        or not _ARGUMENT_RE.fullmatch(argument)
        or argument in _FORBIDDEN_ARGUMENTS
        for argument in arguments
    ):
        raise StdioMcpError("MCP_STDIO_ARGUMENTS_NOT_ALLOWED")
    try:
        allowed_commands = {tuple(shell_split(item)) for item in allowed}
    except ValueError as error:
        raise StdioMcpError("MCP_STDIO_ALLOWLIST_INVALID") from error
    if candidate not in allowed_commands:
        raise StdioMcpError("MCP_STDIO_COMMAND_NOT_ALLOWED")
    return candidate


def validate_secret_environment_name(name: str) -> str:
    """限制 stdio 子进程可接收的认证环境变量名称。"""

    if not _ENV_NAME_RE.fullmatch(name):
        raise StdioMcpError("MCP_STDIO_ENV_INVALID")
    return name


async def call_stdio_mcp(
    command: str,
    arguments: list[str],
    *,
    method: str,
    params: Mapping[str, object],
    environment: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """通过专用 Worker 执行一次 stdio MCP 生命周期，API 进程不启动 MCP 子进程。"""

    argv = validate_stdio_command(command, arguments)
    if method not in _ALLOWED_METHODS:
        raise StdioMcpError("MCP_STDIO_METHOD_NOT_ALLOWED")
    secret_environment = _validate_environment(environment)
    payload = {
        "argv": list(argv),
        "method": method,
        "params": dict(params),
        "environment": secret_environment,
    }
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    max_output_bytes = settings.mcp_stdio_max_output_bytes
    if len(encoded) > max_output_bytes:
        raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE")
    try:
        backend_root = Path(__file__).resolve().parents[3]
        worker_environment = {
            **_WORKER_ENVIRONMENT,
            "PYTHONPATH": str(backend_root),
            "DATABASE_URL": "sqlite+aiosqlite://",
            "JWT_SECRET_KEY": "stdio-worker-only",
            "EXECUTION_NODE_ENCRYPTION_KEY": "stdio-worker-only",
            "MCP_STDIO_COMMAND_ALLOWLIST": settings.mcp_stdio_command_allowlist,
            "MCP_STDIO_MAX_ARGUMENTS": str(settings.mcp_stdio_max_arguments),
            "MCP_STDIO_TIMEOUT_SECONDS": str(settings.mcp_stdio_timeout_seconds),
            "MCP_STDIO_MAX_OUTPUT_BYTES": str(max_output_bytes),
        }
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            _WORKER_MODULE,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd="/tmp",
            env=worker_environment,
            start_new_session=True,
            limit=max_output_bytes + 1,
        )
    except OSError as error:
        raise StdioMcpError("MCP_STDIO_WORKER_UNAVAILABLE") from error
    try:
        if process.stdin is None or process.stdout is None:
            raise StdioMcpError("MCP_STDIO_WORKER_UNAVAILABLE")
        process.stdin.write(encoded + b"\n")
        await process.stdin.drain()
        process.stdin.close()
        timeout_seconds = settings.mcp_stdio_timeout_seconds * 2 + 2
        line = await asyncio.wait_for(process.stdout.readuntil(b"\n"), timeout=timeout_seconds)
        await asyncio.wait_for(process.wait(), timeout=2)
    except StdioMcpError:
        await _terminate_worker(process)
        raise
    except (BrokenPipeError, ConnectionResetError, asyncio.IncompleteReadError) as error:
        await _terminate_worker(process)
        raise StdioMcpError("MCP_STDIO_WORKER_FAILED") from error
    except (asyncio.LimitOverrunError, TimeoutError) as error:
        await _terminate_worker(process)
        code = (
            "MCP_STDIO_TIMEOUT" if isinstance(error, TimeoutError) else "MCP_STDIO_OUTPUT_TOO_LARGE"
        )
        raise StdioMcpError(code) from error
    if len(line) > max_output_bytes:
        raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE")
    try:
        response = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise StdioMcpError("MCP_STDIO_WORKER_FAILED") from error
    if not isinstance(response, dict) or response.get("ok") is not True:
        error_code = response.get("error") if isinstance(response, dict) else None
        raise StdioMcpError(
            error_code if isinstance(error_code, str) else "MCP_STDIO_WORKER_FAILED"
        )
    result = response.get("result")
    if not isinstance(result, dict):
        raise StdioMcpError("MCP_STDIO_WORKER_FAILED")
    return result


def _validate_environment(environment: Mapping[str, str] | None) -> dict[str, str]:
    """仅允许 Worker 向 MCP 子进程转交受限的 Secret 环境变量。"""

    validated: dict[str, str] = {}
    for name, value in (environment or {}).items():
        if validate_secret_environment_name(name) in _WORKER_ENVIRONMENT or not isinstance(
            value, str
        ):
            raise StdioMcpError("MCP_STDIO_ENV_INVALID")
        validated[name] = value
    return validated


async def _terminate_worker(process: asyncio.subprocess.Process) -> None:
    """在 Worker RPC 失败时回收其独立进程组。"""

    if process.returncode is not None:
        return
    try:
        if os.name == "posix":
            os.killpg(process.pid, signal.SIGTERM)
        else:
            process.terminate()
        await asyncio.wait_for(process.wait(), timeout=2)
    except (ProcessLookupError, TimeoutError):
        try:
            if os.name == "posix":
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
        except ProcessLookupError:
            return
        await process.wait()
