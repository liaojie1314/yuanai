"""系统 Chrome Browser Worker 的真实公网集成演练。"""

from __future__ import annotations

import pytest

from app.services.tools.browser_worker import (
    BrowserWorkerError,
    build_browser_request,
    run_browser_worker,
)


@pytest.mark.asyncio
async def test_system_chrome_worker_returns_dom_and_accessibility_snapshots() -> None:
    """真实系统 Chrome 应通过隔离 Worker 返回页面 DOM 和无障碍快照。"""

    try:
        request = build_browser_request({"url": "https://example.com"}, action="open")
        result = await run_browser_worker(
            request,
            timeout_seconds=20,
        )
    except BrowserWorkerError as error:
        pytest.skip(f"公网 Browser Worker 环境不可用: {error.code}")

    assert result["title"] == "Example Domain"
    assert "Example Domain" in result["text"]
    assert "<html" in str(result["dom_snapshot"]).lower()
    assert result["accessibility_snapshot"]
