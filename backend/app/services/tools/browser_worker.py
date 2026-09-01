"""隔离的 Playwright 浏览器 Worker 调度和浏览器 Artifact 适配。"""

from __future__ import annotations

import asyncio
import base64
import binascii
import hashlib
import ipaddress
import json
import os
import shutil
import signal
import socket
from collections.abc import Mapping
from pathlib import Path
from urllib.parse import urlsplit

from app.services.tools.web_security import UrlPolicyError, resolve_public_url

MAX_BROWSER_DOWNLOAD_BYTES = 4 * 1024 * 1024
MAX_BROWSER_SNAPSHOT_CHARS = 8_000
MAX_BROWSER_RPC_OUTPUT_BYTES = MAX_BROWSER_DOWNLOAD_BYTES * 4 // 3 + 64 * 1024
_ALLOWED_DOWNLOAD_EXTENSIONS = {
    ".7z",
    ".csv",
    ".doc",
    ".docx",
    ".gif",
    ".gz",
    ".jpeg",
    ".jpg",
    ".json",
    ".md",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".tar",
    ".text",
    ".txt",
    ".webp",
    ".xls",
    ".xlsx",
    ".xml",
    ".zip",
}
_BLOCKED_DOWNLOAD_EXTENSIONS = {
    ".apk",
    ".bat",
    ".cmd",
    ".com",
    ".deb",
    ".dmg",
    ".dll",
    ".exe",
    ".js",
    ".msi",
    ".pkg",
    ".ps1",
    ".sh",
}
_ALLOWED_DOWNLOAD_MIME_TYPES = {
    "application/gzip",
    "application/json",
    "application/msword",
    "application/octet-stream",
    "application/pdf",
    "application/vnd.ms-excel",
    "application/vnd.ms-powerpoint",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/xml",
    "application/zip",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/webp",
    "text/csv",
    "text/markdown",
    "text/plain",
    "text/xml",
}
_WORKER_SCRIPT = Path(__file__).with_name("browser_worker_runtime.mjs")


class BrowserWorkerError(RuntimeError):
    """浏览器 Worker 可以安全暴露给 Tool Runtime 的稳定错误。"""

    def __init__(self, code: str, message: str | None = None) -> None:
        self.code = code
        super().__init__(message or code)


class BinaryArtifactContent(str):
    """让现有 workspace Artifact 边界接收真实二进制而不扩大 Runtime API。"""

    _data: bytes

    def __new__(cls, data: bytes, digest: str) -> BinaryArtifactContent:
        instance = super().__new__(cls, f"binary artifact sha256={digest}")
        instance._data = data
        return instance

    def encode(self, encoding: str = "utf-8", errors: str = "strict") -> bytes:
        """在 Runtime 创建 Artifact 时返回 Worker 已验证的原始字节。"""

        del encoding, errors
        return self._data


def resolve_browser_executable() -> str:
    """解析部署允许的系统 Chrome 路径，不触发任何浏览器下载。"""

    configured = os.environ.get("YUANAI_BROWSER_EXECUTABLE_PATH")
    candidates = (
        configured,
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/google-chrome",
    )
    for candidate in candidates:
        if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
            return str(Path(candidate).resolve())
    raise BrowserWorkerError("BROWSER_EXECUTABLE_NOT_FOUND")


def _resolve_node_executable() -> str:
    """解析 Worker 使用的 Node.js，不安装运行时或浏览器。"""

    configured = os.environ.get("YUANAI_NODE_EXECUTABLE_PATH")
    candidate = configured or shutil.which("node")
    if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
        return str(Path(candidate).resolve())
    raise BrowserWorkerError("BROWSER_NODE_NOT_FOUND")


def _normalize_allowed_domains(value: object, hostname: str) -> list[str]:
    """把用户提供的域名范围归一化为精确域名或其子域。"""

    if value is None:
        return [hostname]
    if not isinstance(value, list) or len(value) > 20:
        raise BrowserWorkerError("BROWSER_DOMAIN_POLICY_INVALID")
    domains: list[str] = []
    for item in value:
        if not isinstance(item, str) or not item or len(item) > 253:
            raise BrowserWorkerError("BROWSER_DOMAIN_POLICY_INVALID")
        candidate = item.strip().lower().rstrip(".")
        if "://" in candidate or "/" in candidate or "@" in candidate:
            raise BrowserWorkerError("BROWSER_DOMAIN_POLICY_INVALID")
        try:
            parsed = urlsplit(f"https://{candidate}")
            if parsed.hostname != candidate or parsed.port is not None:
                raise BrowserWorkerError("BROWSER_DOMAIN_POLICY_INVALID")
        except ValueError as error:
            raise BrowserWorkerError("BROWSER_DOMAIN_POLICY_INVALID") from error
        domains.append(candidate)
    return sorted(set(domains)) or [hostname]


def build_browser_request(arguments: Mapping[str, object], *, action: str) -> dict[str, object]:
    """校验浏览器请求并固定首个导航的 DNS 结果。"""

    url = arguments.get("url")
    if not isinstance(url, str):
        raise BrowserWorkerError("BROWSER_INVALID_INPUT")
    try:
        resolved_url, address = resolve_public_url(url)
        parsed = urlsplit(resolved_url)
        if parsed.port not in (None, 443):
            raise UrlPolicyError("Only HTTPS port 443 is allowed")
        hostname = parsed.hostname
    except (UrlPolicyError, ValueError) as error:
        raise BrowserWorkerError("BROWSER_NAVIGATION_BLOCKED") from error
    if hostname is None:
        raise BrowserWorkerError("BROWSER_NAVIGATION_BLOCKED")
    if ":" in address:
        try:
            addresses = {
                str(item[4][0])
                for item in socket.getaddrinfo(hostname, 443, type=socket.SOCK_STREAM)
            }
            parsed_addresses = [ipaddress.ip_address(item) for item in addresses]
        except (ValueError, socket.gaierror) as error:
            raise BrowserWorkerError("BROWSER_NAVIGATION_BLOCKED") from error
        if not parsed_addresses or any(
            item.is_private
            or item.is_loopback
            or item.is_link_local
            or item.is_reserved
            or item.is_multicast
            or item.is_unspecified
            for item in parsed_addresses
        ):
            raise BrowserWorkerError("BROWSER_NAVIGATION_BLOCKED")
        address = str(
            next((item for item in parsed_addresses if item.version == 4), parsed_addresses[0])
        )

    request: dict[str, object] = {
        "action": action,
        "url": resolved_url,
        "allowed_hosts": _normalize_allowed_domains(arguments.get("allowed_domains"), hostname),
        "pinned_hosts": {hostname: address},
        "executable_path": resolve_browser_executable(),
    }
    timeout_ms = arguments.get("timeout_ms", 30_000)
    if (
        isinstance(timeout_ms, bool)
        or not isinstance(timeout_ms, int)
        or not 100 <= timeout_ms <= 30_000
    ):
        raise BrowserWorkerError("BROWSER_INVALID_INPUT")
    request["timeout_ms"] = timeout_ms
    if action in {"click", "download"}:
        target = arguments.get("target")
        if not isinstance(target, Mapping):
            raise BrowserWorkerError("BROWSER_INVALID_INPUT")
        request["target"] = dict(target)
    if action == "fill":
        target = arguments.get("target")
        value = arguments.get("value")
        if not isinstance(target, Mapping) or not isinstance(value, str):
            raise BrowserWorkerError("BROWSER_INVALID_INPUT")
        if len(value) > 5_000:
            raise BrowserWorkerError("BROWSER_INVALID_INPUT")
        request["target"] = dict(target)
        request["value"] = value
    if action == "screenshot":
        full_page = arguments.get("full_page", False)
        if not isinstance(full_page, bool):
            raise BrowserWorkerError("BROWSER_INVALID_INPUT")
        request["full_page"] = full_page
    return request


async def run_browser_worker(
    request: Mapping[str, object],
    *,
    timeout_seconds: float = 35.0,
    max_output_bytes: int = MAX_BROWSER_RPC_OUTPUT_BYTES,
) -> dict[str, object]:
    """在独立进程组中执行一次 Playwright RPC，并保证超时时回收整组进程。"""

    if not _WORKER_SCRIPT.is_file():
        raise BrowserWorkerError("BROWSER_WORKER_UNAVAILABLE")
    try:
        encoded = json.dumps(request, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    except (TypeError, ValueError) as error:
        raise BrowserWorkerError("BROWSER_INVALID_INPUT") from error
    if len(encoded) > max_output_bytes:
        raise BrowserWorkerError("BROWSER_RPC_INPUT_TOO_LARGE")

    repo_root = _WORKER_SCRIPT.parents[4]
    playwright_entrypoint = repo_root / "node_modules" / "playwright" / "index.js"
    if not playwright_entrypoint.is_file():
        raise BrowserWorkerError("BROWSER_PLAYWRIGHT_UNAVAILABLE")
    environment = {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1",
        "YUANAI_PLAYWRIGHT_ENTRYPOINT": str(playwright_entrypoint),
        "YUANAI_BROWSER_EXECUTABLE_PATH": str(request.get("executable_path", "")),
        "NODE_NO_WARNINGS": "1",
    }
    try:
        process = await asyncio.create_subprocess_exec(
            _resolve_node_executable(),
            str(_WORKER_SCRIPT),
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.DEVNULL,
            cwd="/tmp",
            env=environment,
            start_new_session=True,
            limit=max_output_bytes + 1,
        )
    except OSError as error:
        raise BrowserWorkerError("BROWSER_WORKER_UNAVAILABLE") from error

    try:
        if process.stdin is None or process.stdout is None:
            raise BrowserWorkerError("BROWSER_WORKER_UNAVAILABLE")
        process.stdin.write(encoded + b"\n")
        await process.stdin.drain()
        process.stdin.close()
        line = await asyncio.wait_for(
            process.stdout.readuntil(b"\n"), timeout=max(timeout_seconds, 0.1)
        )
        await asyncio.wait_for(process.wait(), timeout=2)
    except asyncio.CancelledError:
        await _terminate_worker(process)
        raise
    except BrowserWorkerError:
        await _terminate_worker(process)
        raise
    except (BrokenPipeError, ConnectionResetError, asyncio.IncompleteReadError) as error:
        await _terminate_worker(process)
        raise BrowserWorkerError("BROWSER_WORKER_FAILED") from error
    except (asyncio.LimitOverrunError, TimeoutError) as error:
        await _terminate_worker(process)
        code = (
            "BROWSER_RPC_OUTPUT_TOO_LARGE"
            if isinstance(error, asyncio.LimitOverrunError)
            else "BROWSER_WORKER_TIMEOUT"
        )
        raise BrowserWorkerError(code) from error

    if len(line) > max_output_bytes:
        raise BrowserWorkerError("BROWSER_RPC_OUTPUT_TOO_LARGE")
    try:
        response = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BrowserWorkerError("BROWSER_WORKER_FAILED") from error
    if not isinstance(response, dict):
        raise BrowserWorkerError("BROWSER_WORKER_FAILED")
    if response.get("ok") is not True:
        error_code: object = response.get("error")
        raise BrowserWorkerError(
            error_code if isinstance(error_code, str) else "BROWSER_WORKER_FAILED"
        )
    result = response.get("result")
    if not isinstance(result, dict):
        raise BrowserWorkerError("BROWSER_WORKER_FAILED")
    return result


async def _terminate_worker(process: asyncio.subprocess.Process) -> None:
    """终止 Worker 进程组，避免浏览器或代理成为孤儿进程。"""

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


def _artifact_name(value: object, fallback: str) -> str:
    """约束下载文件名，避免 Artifact storage key 路径逃逸。"""

    candidate = value if isinstance(value, str) else fallback
    name = Path(candidate).name.replace("\x00", "_").strip(" .")
    return name[:255] or fallback


def _validate_download_payload(result: Mapping[str, object]) -> tuple[bytes, str, str]:
    """验证 Worker 返回的下载/截图二进制、MIME、大小和哈希。"""

    encoded = result.get("base64")
    name = _artifact_name(result.get("name"), "browser-download.bin")
    mime_type = result.get("mime_type")
    digest = result.get("sha256")
    if (
        not isinstance(encoded, str)
        or not isinstance(mime_type, str)
        or not isinstance(digest, str)
    ):
        raise BrowserWorkerError("BROWSER_ARTIFACT_INVALID")
    if result.get("kind") == "download":
        extension = Path(name).suffix.lower()
        if extension in _BLOCKED_DOWNLOAD_EXTENSIONS or (
            extension and extension not in _ALLOWED_DOWNLOAD_EXTENSIONS
        ):
            raise BrowserWorkerError("BROWSER_DOWNLOAD_TYPE_BLOCKED")
        normalized_mime = mime_type.split(";", 1)[0].strip().lower()
        if normalized_mime not in _ALLOWED_DOWNLOAD_MIME_TYPES:
            raise BrowserWorkerError("BROWSER_DOWNLOAD_TYPE_BLOCKED")
    try:
        data = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as error:
        raise BrowserWorkerError("BROWSER_ARTIFACT_INVALID") from error
    if len(data) > MAX_BROWSER_DOWNLOAD_BYTES:
        raise BrowserWorkerError("BROWSER_DOWNLOAD_TOO_LARGE")
    if hashlib.sha256(data).hexdigest() != digest:
        raise BrowserWorkerError("BROWSER_ARTIFACT_INVALID")
    return data, name, mime_type.split(";", 1)[0].strip().lower()


def browser_artifact_output(result: Mapping[str, object]) -> dict[str, object]:
    """构造由现有 Tool Runtime 持久化的二进制 workspace Artifact 输出。"""

    data, name, mime_type = _validate_download_payload(result)
    digest = hashlib.sha256(data).hexdigest()
    return {
        "workspace": True,
        "name": name,
        "mime_type": mime_type,
        "content": BinaryArtifactContent(data, digest),
        "source_url": str(result.get("url", ""))[:2_000],
        "content_encoding": "binary",
        "size_bytes": len(data),
        "sha256": digest,
    }
