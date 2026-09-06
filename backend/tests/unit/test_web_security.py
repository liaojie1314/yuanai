"""联网工具的 SSRF、重定向和固定 DNS 单元测试。"""

from __future__ import annotations

from typing import Any

import pytest

from app.services.tools import web_security


class _Response:
    """为抓取测试提供最小的 httpx 响应替身。"""

    def __init__(self, *, location: str | None = None) -> None:
        self.is_redirect = location is not None
        self.headers = {"location": location} if location else {"content-type": "text/html"}
        self.text = "<html><body>safe</body></html>"

    def raise_for_status(self) -> None:
        return None


class _Client:
    """记录请求并返回预设重定向或正文。"""

    responses: list[_Response] = []
    urls: list[str] = []

    def __init__(self, **_: Any) -> None:
        pass

    async def __aenter__(self) -> _Client:
        return self

    async def __aexit__(self, *_args: object) -> None:
        return None

    async def get(self, url: str, **_: Any) -> _Response:
        self.urls.append(url)
        return self.responses.pop(0)


@pytest.mark.asyncio
async def test_fetch_public_html_pins_each_redirect_hop(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """每一跳都必须使用该跳校验得到的固定 DNS 地址。"""

    resolutions = iter(
        [
            ("https://first.example", "93.184.216.34"),
            ("https://second.example/path", "93.184.216.35"),
        ]
    )
    addresses: list[str] = []

    class _Transport:
        async def aclose(self) -> None:
            return None

    def resolve(value: str) -> tuple[str, str]:
        del value
        return next(resolutions)

    def transport(address: str) -> _Transport:
        addresses.append(address)
        return _Transport()

    _Client.responses = [_Response(location="https://second.example/path"), _Response()]
    _Client.urls = []
    monkeypatch.setattr(web_security, "resolve_public_url", resolve)
    monkeypatch.setattr(web_security, "create_pinned_http_transport", transport)
    monkeypatch.setattr(web_security.httpx, "AsyncClient", _Client)

    result = await web_security.fetch_public_html("https://first.example")

    assert result == ("https://second.example/path", "<html><body>safe</body></html>")
    assert addresses == ["93.184.216.34", "93.184.216.35"]
    assert _Client.urls == ["https://first.example", "https://second.example/path"]


@pytest.mark.asyncio
async def test_fetch_public_html_revalidates_private_redirect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """重定向到私网地址必须在发起第二跳请求前拒绝。"""

    monkeypatch.setattr(
        web_security,
        "resolve_public_url",
        lambda value: (
            (value, "93.184.216.34")
            if value == "https://public.example"
            else (_ for _ in ()).throw(web_security.UrlPolicyError("private"))
        ),
    )

    class _RedirectClient(_Client):
        async def get(self, url: str, **_: Any) -> _Response:
            self.urls.append(url)
            return _Response(location="https://127.0.0.1/admin")

    class _Transport:
        async def aclose(self) -> None:
            return None

    monkeypatch.setattr(web_security, "create_pinned_http_transport", lambda _: _Transport())
    monkeypatch.setattr(web_security.httpx, "AsyncClient", _RedirectClient)
    _RedirectClient.urls = []

    with pytest.raises(web_security.UrlPolicyError, match="private"):
        await web_security.fetch_public_html("https://public.example")

    assert _RedirectClient.urls == ["https://public.example"]
