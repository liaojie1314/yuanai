"""浏览器 Worker 的策略、Artifact 载荷和生命周期单元测试。"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import sys
from pathlib import Path

import pytest

from app.services.tools.browser_worker import (
    BinaryArtifactContent,
    BrowserWorkerError,
    _terminate_worker,
    browser_artifact_output,
    build_browser_request,
    resolve_browser_executable,
)


def _patch_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """为纯策略测试固定公网 DNS 结果。"""

    monkeypatch.setattr(
        "app.services.tools.browser_worker.resolve_public_url",
        lambda value: (value, "93.184.216.34"),
    )


def test_resolve_browser_executable_uses_system_chrome_without_install(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """浏览器路径必须来自现有可执行文件，不调用 Playwright 安装器。"""

    monkeypatch.delenv("YUANAI_BROWSER_EXECUTABLE_PATH", raising=False)
    executable = resolve_browser_executable()
    assert executable in {
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/google-chrome",
    }


def test_build_browser_request_pins_dns_and_defaults_to_same_origin(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未声明额外域名时，初始导航和所有资源只允许同源域名。"""

    _patch_public_url(monkeypatch)
    request = build_browser_request({"url": "https://example.com/path"}, action="open")

    assert request["pinned_hosts"] == {"example.com": "93.184.216.34"}
    assert request["allowed_hosts"] == ["example.com"]
    assert request["executable_path"]


def test_browser_runtime_keeps_chromium_sandbox_enabled() -> None:
    """浏览器 Worker 不能通过启动参数关闭 Chromium 沙箱。"""

    runtime = Path(__file__).parents[2] / "app" / "services" / "tools" / "browser_worker_runtime.mjs"
    source = runtime.read_text()

    assert "--no-sandbox" not in source


def test_build_browser_request_rejects_invalid_domain_policy(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """域名策略不能携带 URL、端口或路径。"""

    _patch_public_url(monkeypatch)
    with pytest.raises(BrowserWorkerError, match="BROWSER_DOMAIN_POLICY_INVALID"):
        build_browser_request(
            {"url": "https://example.com", "allowed_domains": ["https://other.example"]},
            action="open",
        )


def test_browser_artifact_output_preserves_original_bytes() -> None:
    """二进制 Artifact 经过现有 workspace 适配时仍写入原始字节。"""

    data = b"\x89PNG\r\n\x1a\n\x00\xff"
    encoded = base64.b64encode(data).decode("ascii")
    digest = hashlib.sha256(data).hexdigest()

    output = browser_artifact_output(
        {
            "kind": "screenshot",
            "name": "browser-screenshot.png",
            "mime_type": "image/png",
            "base64": encoded,
            "sha256": digest,
            "url": "https://example.com",
        }
    )

    content = output["content"]
    assert isinstance(content, BinaryArtifactContent)
    assert content.encode() == data
    assert output["mime_type"] == "image/png"
    assert output["sha256"] == digest


def test_browser_artifact_output_rejects_download_type_and_hash_mismatch() -> None:
    """危险扩展名和篡改内容不能进入 Artifact。"""

    data = b"not executable"
    encoded = base64.b64encode(data).decode("ascii")
    with pytest.raises(BrowserWorkerError, match="BROWSER_DOWNLOAD_TYPE_BLOCKED"):
        browser_artifact_output(
            {
                "kind": "download",
                "name": "payload.exe",
                "mime_type": "application/octet-stream",
                "base64": encoded,
                "sha256": hashlib.sha256(data).hexdigest(),
            }
        )
    with pytest.raises(BrowserWorkerError, match="BROWSER_ARTIFACT_INVALID"):
        browser_artifact_output(
            {
                "kind": "screenshot",
                "name": "browser-screenshot.png",
                "mime_type": "image/png",
                "base64": encoded,
                "sha256": "0" * 64,
            }
        )


@pytest.mark.asyncio
async def test_worker_termination_reaps_the_process_group() -> None:
    """取消路径必须回收 Worker，不留下长期运行的子进程。"""

    process = await asyncio.create_subprocess_exec(
        sys.executable,
        "-c",
        "import time; time.sleep(30)",
        start_new_session=True,
    )
    await _terminate_worker(process)
    assert process.returncode is not None
