"""受限 Python 执行器的进程边界。"""

from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path


class SandboxExecutionError(RuntimeError):
    """代码不符合沙箱约束或子进程执行失败。"""


async def execute_python(code: str, *, timeout_seconds: float = 10.0) -> dict[str, object]:
    """在无继承环境的独立进程中执行受限表达式。"""

    if not code.strip() or len(code) > 8_000:
        raise SandboxExecutionError("SANDBOX_CODE_INVALID")
    backend_root = Path(__file__).resolve().parents[2]
    clean_env = {"PATH": os.defpath, "PYTHONNOUSERSITE": "1"}
    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-m",
        "app.services.tools.sandbox_worker",
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=backend_root,
        env=clean_env,
    )
    payload = json.dumps({"code": code}, ensure_ascii=False).encode("utf-8")
    try:
        stdout, stderr = await asyncio.wait_for(
            process.communicate(payload), timeout=timeout_seconds
        )
    except TimeoutError as error:
        process.kill()
        await process.wait()
        raise SandboxExecutionError("SANDBOX_TIMEOUT") from error
    if process.returncode != 0:
        raise SandboxExecutionError("SANDBOX_EXECUTION_FAILED")
    try:
        result = json.loads(stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        del stderr
        raise SandboxExecutionError("SANDBOX_INVALID_RESULT") from error
    if not isinstance(result, dict) or result.get("status") != "succeeded":
        raise SandboxExecutionError("SANDBOX_EXECUTION_FAILED")
    return result
