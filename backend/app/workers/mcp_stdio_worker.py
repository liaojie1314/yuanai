"""承载受控 stdio MCP 的一次性隔离 Worker。"""

from __future__ import annotations

import asyncio
import json
import os
import signal
import sys
from collections.abc import Mapping
from pathlib import Path
from shutil import which
from typing import NoReturn

from app.core.config import settings
from app.services.tools.mcp_stdio import (
    StdioMcpError,
    validate_secret_environment_name,
    validate_stdio_command,
)

_PROTOCOL_VERSION = "2025-06-18"
_ALLOWED_METHODS = frozenset({"tools/list", "tools/call"})
_BASE_ENVIRONMENT = {
    "PATH": "/usr/local/bin:/usr/bin:/bin",
    "LC_ALL": "C",
    "PYTHONNOUSERSITE": "1",
}
_FORBIDDEN_ENVIRONMENT_NAMES = frozenset(
    {"LD_PRELOAD", "LD_LIBRARY_PATH", "PYTHONPATH", "PYTHONHOME"}
)


class StdioMcpClient:
    """在 Worker 进程中启动一个受 bubblewrap 限制的 MCP 子进程。"""

    def __init__(
        self,
        argv: tuple[str, ...],
        *,
        environment: Mapping[str, str],
        timeout_seconds: float | None = None,
        max_output_bytes: int | None = None,
    ) -> None:
        self._argv = argv
        self._environment = {
            **_BASE_ENVIRONMENT,
            **environment,
            "YUANAI_MCP_STDIO_WORKER": "1",
        }
        self._timeout_seconds = timeout_seconds or settings.mcp_stdio_timeout_seconds
        self._max_output_bytes = max_output_bytes or settings.mcp_stdio_max_output_bytes
        self._process: asyncio.subprocess.Process | None = None
        self._request_id = 0

    def _sandbox_argv(self) -> tuple[str, ...]:
        """将允许命令、输入和 Secret 映射到无网络的只读命名空间。"""

        bwrap = which("bwrap")
        if bwrap is None or os.name != "posix":
            raise StdioMcpError("MCP_STDIO_SANDBOX_UNAVAILABLE")
        command = Path(self._argv[0]).resolve()
        if not command.is_file():
            raise StdioMcpError("MCP_STDIO_COMMAND_NOT_FOUND")
        runtime_root = command.parent.parent if command.parent.name == "bin" else command.parent
        args: list[str] = []
        bindings = [(runtime_root, Path("/mcp-runtime"))]
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
        for name, value in self._environment.items():
            if name in _BASE_ENVIRONMENT:
                continue
            if name in _FORBIDDEN_ENVIRONMENT_NAMES:
                raise StdioMcpError("MCP_STDIO_ENV_INVALID")
            validate_secret_environment_name(name)
            command_args.extend(["--setenv", name, value])
        command_args.extend(
            [
                "--chdir",
                "/tmp",
                "--setenv",
                "PATH",
                _BASE_ENVIRONMENT["PATH"],
                "--setenv",
                "LC_ALL",
                _BASE_ENVIRONMENT["LC_ALL"],
                "--setenv",
                "PYTHONNOUSERSITE",
                _BASE_ENVIRONMENT["PYTHONNOUSERSITE"],
                "--setenv",
                "YUANAI_MCP_STDIO_WORKER",
                "1",
                str(command_in_namespace),
                *args,
            ]
        )
        return tuple(command_args)

    async def __aenter__(self) -> StdioMcpClient:
        """启动 MCP 进程并完成 initialize 与 initialized 生命周期。"""

        try:
            self._process = await asyncio.create_subprocess_exec(
                *self._sandbox_argv(),
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.DEVNULL,
                env=_BASE_ENVIRONMENT,
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
        """关闭 MCP 子进程和它可能创建的整个进程组。"""

        await self.close()

    async def notify(self, method: str, params: Mapping[str, object]) -> None:
        """发送无需响应的 JSON-RPC notification。"""

        await self._write({"jsonrpc": "2.0", "method": method, "params": dict(params)})

    async def request(self, method: str, params: Mapping[str, object]) -> dict[str, object]:
        """发送 JSON-RPC request 并读取相同 request ID 的响应。"""

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
        """写入单行 JSON-RPC payload，受 MCP 输出大小同一上限约束。"""

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
        """读取并校验受长度限制的 newline-delimited JSON-RPC 响应。"""

        if self._process is None or self._process.stdout is None:
            raise StdioMcpError("MCP_STDIO_NOT_RUNNING")
        try:
            line = await asyncio.wait_for(
                self._process.stdout.readuntil(b"\n"), timeout=self._timeout_seconds
            )
        except asyncio.LimitOverrunError as error:
            raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE") from error
        except (asyncio.IncompleteReadError, TimeoutError) as error:
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
        """优先关闭 MCP 进程组，超时后用 SIGKILL 彻底回收。"""

        process = self._process
        self._process = None
        if process is None or process.returncode is not None:
            return
        try:
            os.killpg(process.pid, signal.SIGTERM)
            await asyncio.wait_for(process.wait(), timeout=2)
        except (ProcessLookupError, TimeoutError):
            try:
                os.killpg(process.pid, signal.SIGKILL)
                await process.wait()
            except ProcessLookupError:
                pass


async def run_request(payload: Mapping[str, object]) -> dict[str, object]:
    """执行来自 API proxy 的单个受验证 Worker RPC 请求。"""

    argv_value = payload.get("argv")
    method = payload.get("method")
    params = payload.get("params")
    environment = payload.get("environment")
    if (
        not isinstance(argv_value, list)
        or not all(isinstance(value, str) for value in argv_value)
        or not argv_value
        or not isinstance(method, str)
        or method not in _ALLOWED_METHODS
        or not isinstance(params, dict)
        or not isinstance(environment, dict)
        or not all(
            isinstance(name, str) and isinstance(value, str) for name, value in environment.items()
        )
    ):
        raise StdioMcpError("MCP_STDIO_WORKER_REQUEST_INVALID")
    argv = validate_stdio_command(argv_value[0], argv_value[1:])
    async with StdioMcpClient(argv, environment=environment) as client:
        return await client.request(method, params)


async def _main() -> int:
    """读取一条 RPC 请求，返回结构化结果并保持 stderr 静默。"""

    try:
        line = await asyncio.get_running_loop().run_in_executor(
            None, sys.stdin.buffer.readline, settings.mcp_stdio_max_output_bytes + 1
        )
        if len(line) > settings.mcp_stdio_max_output_bytes:
            raise StdioMcpError("MCP_STDIO_OUTPUT_TOO_LARGE")
        payload = json.loads(line.decode("utf-8"))
        if not isinstance(payload, dict):
            raise StdioMcpError("MCP_STDIO_WORKER_REQUEST_INVALID")
        response: dict[str, object] = {"ok": True, "result": await run_request(payload)}
    except (EOFError, UnicodeDecodeError, json.JSONDecodeError, StdioMcpError) as error:
        code = (
            str(error) if isinstance(error, StdioMcpError) else "MCP_STDIO_WORKER_REQUEST_INVALID"
        )
        response = {"ok": False, "error": code}
    encoded = json.dumps(response, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    if len(encoded) > settings.mcp_stdio_max_output_bytes:
        response = {"ok": False, "error": "MCP_STDIO_OUTPUT_TOO_LARGE"}
    print(json.dumps(response, ensure_ascii=False, separators=(",", ":")), flush=True)
    return 0


def main() -> NoReturn:
    """运行 Worker 入口，避免 FastAPI 进程直接承载 stdio MCP。"""

    raise SystemExit(asyncio.run(_main()))


if __name__ == "__main__":
    main()
