"""在隔离子进程中运行受控的 MCP stdio transport。"""

from __future__ import annotations

import asyncio
import json
import os
import re
import signal
from collections.abc import Mapping
from pathlib import Path
from shlex import split as shell_split
from shutil import which

from app.core.config import settings

_COMMAND_RE = re.compile(r"^[A-Za-z0-9_./-]+$")
_ARGUMENT_RE = re.compile(r"^[A-Za-z0-9_./:@=+,%~-]+$")
_ENV_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,63}$")
_PROTOCOL_VERSION = "2025-06-18"
_FORBIDDEN_ARGUMENTS = frozenset({"-c", "--command", "--eval", "--execute"})


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


class StdioMcpClient:
    """为一次 MCP 请求创建独立子进程并在结束后回收。"""

    def __init__(
        self,
        argv: tuple[str, ...],
        *,
        environment: Mapping[str, str] | None = None,
        timeout_seconds: float | None = None,
        max_output_bytes: int | None = None,
    ) -> None:
        self._argv = argv
        self._environment = {
            "PATH": "/usr/local/bin:/usr/bin:/bin",
            "LC_ALL": "C",
            "PYTHONNOUSERSITE": "1",
            **(environment or {}),
        }
        self._timeout_seconds = timeout_seconds or settings.mcp_stdio_timeout_seconds
        self._max_output_bytes = max_output_bytes or settings.mcp_stdio_max_output_bytes
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0

    def _sandbox_argv(self) -> tuple[str, ...]:
        """将允许的命令和输入文件映射到 bubblewrap 的只读命名空间。"""

        bwrap = which("bwrap")
        if bwrap is None or os.name != "posix":
            raise StdioMcpError("MCP_STDIO_SANDBOX_UNAVAILABLE")
        command = Path(self._argv[0]).resolve()
        if not command.is_file():
            raise StdioMcpError("MCP_STDIO_COMMAND_NOT_FOUND")
        runtime_root = command.parent.parent if command.parent.name == "bin" else command.parent
        args: list[str] = []
        bindings = [
            (runtime_root, Path("/mcp-runtime")),
        ]
        for index, value in enumerate(self._argv[1:]):
            path = Path(value)
            if path.is_absolute() and path.is_file():
                target = Path("/mcp-input") / str(index)
                bindings.append((path, target))
                args.append(str(target))
            else:
                args.append(value)
        command_in_namespace = Path("/mcp-runtime") / command.relative_to(runtime_root)
        command_args = [bwrap, "--die-with-parent", "--unshare-all", "--new-session", "--clearenv"]
        command_args.extend(["--ro-bind", "/usr", "/usr"])
        for system_dir in ("/lib", "/lib64"):
            if Path(system_dir).exists():
                command_args.extend(["--ro-bind", system_dir, system_dir])
        command_args.extend(["--proc", "/proc", "--dev", "/dev", "--tmpfs", "/tmp"])
        for source, target in bindings:
            command_args.extend(["--ro-bind", str(source), str(target)])
        command_args.extend(
            [
                "--chdir",
                "/tmp",
                "--setenv",
                "PATH",
                "/usr/local/bin:/usr/bin:/bin",
                "--setenv",
                "LC_ALL",
                "C",
                "--setenv",
                "PYTHONNOUSERSITE",
                "1",
            ]
        )
        for name, value in self._environment.items():
            if name in {"PATH", "LC_ALL", "PYTHONNOUSERSITE"}:
                continue
            if not _ENV_NAME_RE.fullmatch(name) or name in {
                "LD_PRELOAD",
                "LD_LIBRARY_PATH",
                "PYTHONPATH",
                "PYTHONHOME",
            }:
                raise StdioMcpError("MCP_STDIO_ENV_INVALID")
            command_args.extend(["--setenv", name, value])
        command_args.extend([str(command_in_namespace), *args])
        return tuple(command_args)

    async def __aenter__(self) -> StdioMcpClient:
        """启动子进程并完成 MCP initialize 握手。"""

        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._sandbox_argv(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=self._environment,
                start_new_session=True,
                limit=self._max_output_bytes + 1,
            )
            await self.request(
                "initialize",
                {
                    "protocolVersion": _PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": {"name": "yuanai", "version": "0.1.0"},
                },
            )
            await self.notify("notifications/initialized", {})
        except (OSError, StdioMcpError, TimeoutError) as error:
            await self.close()
            if isinstance(error, StdioMcpError):
                raise
            raise StdioMcpError("MCP_STDIO_START_FAILED") from error
        return self

    async def __aexit__(self, *_exc_info: object) -> None:
        """关闭 stdio 子进程及其子进程组。"""

        await self.close()

    async def notify(self, method: str, params: Mapping[str, object]) -> None:
        """发送无需响应的 JSON-RPC notification。"""

        await self._write({"jsonrpc": "2.0", "method": method, "params": dict(params)})

    async def request(self, method: str, params: Mapping[str, object]) -> dict[str, object]:
        """发送一个 JSON-RPC request 并读取匹配 ID 的响应。"""

        self._request_id += 1
        request_id = self._request_id
        await self._write(
            {"jsonrpc": "2.0", "id": request_id, "method": method, "params": dict(params)}
        )
        while True:
            payload = await self._read_message()
            if "id" not in payload:
                continue
            if payload.get("id") != request_id:
                raise StdioMcpError("MCP_STDIO_RESPONSE_INVALID")
            if payload.get("error") is not None:
                raise StdioMcpError("MCP_STDIO_RPC_ERROR")
            result = payload.get("result")
            if not isinstance(result, dict):
                raise StdioMcpError("MCP_STDIO_RESPONSE_INVALID")
            return result

    async def _write(self, payload: Mapping[str, object]) -> None:
        """写入单行 JSON-RPC 消息，拒绝在关闭进程后继续发送。"""

        if self._process is None or self._process.stdin is None:
            raise StdioMcpError("MCP_STDIO_NOT_RUNNING")
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        if len(encoded) > self._max_output_bytes:
            raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE")
        self._process.stdin.write(encoded + b"\n")
        try:
            await self._process.stdin.drain()
        except (BrokenPipeError, ConnectionResetError) as error:
            raise StdioMcpError("MCP_STDIO_PROCESS_FAILED") from error

    async def _read_message(self) -> dict[str, object]:
        """读取一行 JSON-RPC 消息并执行长度与类型校验。"""

        if self._process is None or self._process.stdout is None:
            raise StdioMcpError("MCP_STDIO_NOT_RUNNING")
        try:
            line = await asyncio.wait_for(
                self._process.stdout.readuntil(b"\n"), timeout=self._timeout_seconds
            )
        except (asyncio.IncompleteReadError, asyncio.LimitOverrunError, TimeoutError) as error:
            code = (
                "MCP_STDIO_TIMEOUT"
                if isinstance(error, TimeoutError)
                else "MCP_STDIO_PROCESS_FAILED"
            )
            raise StdioMcpError(code) from error
        if len(line) > self._max_output_bytes:
            raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE")
        try:
            payload = json.loads(line.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise StdioMcpError("MCP_STDIO_RESPONSE_INVALID") from error
        if not isinstance(payload, dict) or payload.get("jsonrpc") != "2.0":
            raise StdioMcpError("MCP_STDIO_RESPONSE_INVALID")
        return payload

    async def close(self) -> None:
        """优先终止整个进程组，超时后强制回收。"""

        process = self._process
        self._process = None
        if process is None or process.returncode is not None:
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
                await process.wait()
            except ProcessLookupError:
                pass


async def call_stdio_mcp(
    command: str,
    arguments: list[str],
    *,
    method: str,
    params: Mapping[str, object],
    environment: Mapping[str, str] | None = None,
) -> dict[str, object]:
    """在一次隔离生命周期内执行 MCP discovery 或 tools/call。"""

    argv = validate_stdio_command(command, arguments)
    async with StdioMcpClient(argv, environment=environment) as client:
        return await client.request(method, params)
