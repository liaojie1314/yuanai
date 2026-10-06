import threading
import uuid
from http.server import BaseHTTPRequestHandler, HTTPServer

import httpx
import pytest

from app.services.tools import search


class _OkHandler(BaseHTTPRequestHandler):
    """只回 200 的最小环回服务端，用于验证请求确实打到了本机。"""

    def do_GET(self) -> None:  # noqa: N802 - BaseHTTPRequestHandler 规定的方法名
        self.send_response(200)
        self.end_headers()

    def log_message(self, *_args: object) -> None:
        """屏蔽 stderr 噪声。"""


class FakeRedis:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.counts: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        return self.values.get(key)

    async def set(self, key: str, value: str, *, ex: int) -> bool:
        assert ex > 0
        self.values[key] = value
        return True

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, seconds: int) -> bool:
        assert seconds == 60
        return True


class FakeProvider:
    name = "searxng"

    def __init__(self) -> None:
        self.calls = 0

    async def search(self, query: str, *, max_results: int) -> list[search.SearchSource]:
        self.calls += 1
        assert query == "stable query"
        assert max_results == 5
        return [
            search.SearchSource(
                title="Title",
                url="https://example.test/a",
                snippet="Summary",
                provider="searxng",
            )
        ]


@pytest.mark.asyncio
async def test_searxng_requests_safe_json_and_normalizes_sources() -> None:
    async def handler(request: httpx.Request) -> httpx.Response:
        assert request.url.path == "/search"
        assert request.url.params["q"] == "query"
        assert request.url.params["format"] == "json"
        assert request.url.params["safesearch"] == "2"
        return httpx.Response(
            200,
            json={
                "results": [
                    {"title": "Title\n", "url": "https://example.test/a", "content": "Summary"},
                    {"title": "Unsafe", "url": "http://example.test/b", "content": "ignore"},
                ]
            },
        )

    provider = search.SearxngSearchProvider(
        "http://127.0.0.1:8082", transport=httpx.MockTransport(handler)
    )

    result = await provider.search("  query\n", max_results=5)

    assert result == [
        search.SearchSource(
            title="Title",
            url="https://example.test/a",
            snippet="Summary",
            provider="searxng",
        )
    ]


@pytest.mark.asyncio
async def test_cache_hit_skips_provider_and_rate_limit_rejects_eleventh_call(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    fake_redis = FakeRedis()
    provider = FakeProvider()
    monkeypatch.setattr(search, "redis_client", fake_redis)

    async def providers() -> list[FakeProvider]:
        return [provider]

    monkeypatch.setattr(search, "_candidate_providers", providers)
    user_id = uuid.uuid4()
    first = await search.search_web(user_id=user_id, query="stable   query")
    second = await search.search_web(user_id=user_id, query="stable query")

    assert first == second
    assert provider.calls == 1

    rate_redis = FakeRedis()
    monkeypatch.setattr(search, "redis_client", rate_redis)
    for _ in range(10):
        await search._increment_limit(user_id)
    with pytest.raises(search.SearchRateLimitError, match="WEB_SEARCH_RATE_LIMITED"):
        await search._increment_limit(user_id)


@pytest.mark.asyncio
async def test_unavailable_redis_never_calls_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    class BrokenRedis:
        async def incr(self, _key: str) -> int:
            from redis.exceptions import ConnectionError

            raise ConnectionError("offline")

    provider = FakeProvider()

    async def providers() -> list[FakeProvider]:
        return [provider]

    monkeypatch.setattr(search, "redis_client", BrokenRedis())
    monkeypatch.setattr(search, "_candidate_providers", providers)

    with pytest.raises(search.SearchUnavailableError, match="WEB_SEARCH_CACHE_UNAVAILABLE"):
        await search.search_web(user_id=uuid.uuid4(), query="stable query")
    assert provider.calls == 0


@pytest.mark.asyncio
async def test_searxng_health_ignores_environment_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    """环回健康检查不得走环境代理，否则联网搜索会静默判定为不可用。

    httpx 的 no_proxy 不认 ``127.0.0.0/8`` 这类网段写法，本机地址照样被发往代理。
    这里把代理指向一个没人监听的端口：只要实现读了环境变量，健康检查必然失败。
    """
    server = HTTPServer(("127.0.0.1", 0), _OkHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        port = server.server_address[1]
        dead_proxy = "http://127.0.0.1:9"
        for name in ("HTTP_PROXY", "http_proxy", "ALL_PROXY", "all_proxy"):
            monkeypatch.setenv(name, dead_proxy)
        monkeypatch.setenv("NO_PROXY", "localhost,127.0.0.0/8,::1")

        provider = search.SearxngSearchProvider(f"http://127.0.0.1:{port}")

        assert await provider.healthy() is True
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
