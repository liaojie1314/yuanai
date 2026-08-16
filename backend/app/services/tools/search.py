"""可配置联网搜索的 provider、缓存和限流边界。"""

import hashlib
import json
import re
import time
import uuid
from dataclasses import asdict, dataclass
from typing import Literal, Protocol
from urllib.parse import urlsplit, urlunsplit

import httpx
from redis.exceptions import RedisError

from app.core.config import SearchProviderName, settings
from app.core.redis import redis_client

SearchProviderId = Literal["searxng", "brave", "tavily"]
_CONTROL_CHARS = re.compile(r"[\x00-\x1f\x7f]")
_WHITESPACE = re.compile(r"\s+")
_MAX_QUERY_LENGTH = 300
_MAX_RESULT_COUNT = 5
_CAPABILITY_TTL_SECONDS = 30.0


class SearchError(RuntimeError):
    """联网搜索可安全返回给模型和客户端的基础错误。"""


class SearchUnavailableError(SearchError):
    """当前没有可用 provider 或缓存服务。"""


class SearchRateLimitError(SearchError):
    """用户超过联网搜索的滚动时间窗限制。"""


class SearchProviderProtocolError(SearchError):
    """provider 返回的 JSON 不是预期的安全结果结构。"""


@dataclass(frozen=True)
class SearchSource:
    """对客户端公开的单条净化搜索来源。"""

    title: str
    url: str
    snippet: str
    provider: SearchProviderId


@dataclass(frozen=True)
class SearchCapability:
    """客户端开关需要的 provider 可用性，不含任何配置或密钥。"""

    enabled: bool
    provider: SearchProviderId | None
    reason: Literal["disabled", "unavailable"] | None


class SearchProvider(Protocol):
    """第三方搜索 provider 的最小协议。"""

    name: SearchProviderId

    async def search(self, query: str, *, max_results: int) -> list[SearchSource]:
        """执行一次已验证的公共网页搜索。"""


def normalize_query(query: str) -> str:
    """折叠查询空白和控制字符，并拒绝空白或超长输入。"""
    normalized = _WHITESPACE.sub(" ", _CONTROL_CHARS.sub(" ", query)).strip()
    if not normalized:
        raise SearchUnavailableError("WEB_SEARCH_INVALID_QUERY")
    if len(normalized) > _MAX_QUERY_LENGTH:
        raise SearchUnavailableError("WEB_SEARCH_QUERY_TOO_LONG")
    return normalized


def _clean_text(value: object, *, limit: int) -> str:
    """将 provider 文本转为可展示的单行数据，而不是指令。"""
    if not isinstance(value, str):
        return ""
    return _WHITESPACE.sub(" ", _CONTROL_CHARS.sub(" ", value)).strip()[:limit]


def _safe_https_url(value: object) -> str | None:
    """只保留没有凭据、查询串或片段的 HTTPS 外部来源。"""
    if not isinstance(value, str) or _CONTROL_CHARS.search(value):
        return None
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme != "https"
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return None
    return urlunsplit(("https", parsed.netloc, parsed.path or "/", "", ""))


def _safe_loopback_base_url(value: str) -> str | None:
    """验证 SearXNG 地址，禁止把明文 HTTP 发往非本机地址。"""
    parsed = urlsplit(value.strip())
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
    ):
        return None
    loopback_hosts = {"127.0.0.1", "localhost", "::1"}
    if parsed.scheme == "http" and parsed.hostname not in loopback_hosts:
        return None
    return urlunsplit((parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", ""))


def _normalize_sources(
    candidates: object, *, provider: SearchProviderId, max_results: int
) -> list[SearchSource]:
    """统一三个 provider 的非可信结果并去重。"""
    if not isinstance(candidates, list):
        raise SearchProviderProtocolError("SEARCH_PROVIDER_INVALID_RESPONSE")
    sources: list[SearchSource] = []
    seen_urls: set[str] = set()
    for candidate in candidates:
        if not isinstance(candidate, dict):
            continue
        url = _safe_https_url(candidate.get("url"))
        if url is None or url in seen_urls:
            continue
        title = _clean_text(candidate.get("title"), limit=160)
        snippet = _clean_text(candidate.get("snippet"), limit=600)
        if not title:
            title = urlsplit(url).hostname or "来源"
        if not snippet:
            snippet = "暂无摘要"
        sources.append(SearchSource(title=title, url=url, snippet=snippet, provider=provider))
        seen_urls.add(url)
        if len(sources) >= min(max(1, max_results), _MAX_RESULT_COUNT):
            break
    return sources


class _HttpSearchProvider:
    """HTTP provider 的公共超时和 JSON 错误处理。"""

    name: SearchProviderId

    def __init__(self, *, transport: httpx.AsyncBaseTransport | None = None) -> None:
        self._transport = transport

    async def _request_json(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, str] | None = None,
        headers: dict[str, str] | None = None,
        json_body: dict[str, object] | None = None,
    ) -> dict[str, object]:
        try:
            async with httpx.AsyncClient(
                timeout=settings.web_search_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.request(
                    method, url, params=params, headers=headers, json=json_body
                )
                response.raise_for_status()
        except (httpx.HTTPError, TimeoutError) as exc:
            raise SearchUnavailableError("WEB_SEARCH_PROVIDER_UNAVAILABLE") from exc
        try:
            payload = response.json()
        except json.JSONDecodeError as exc:
            raise SearchProviderProtocolError("SEARCH_PROVIDER_INVALID_RESPONSE") from exc
        if not isinstance(payload, dict):
            raise SearchProviderProtocolError("SEARCH_PROVIDER_INVALID_RESPONSE")
        return payload


class SearxngSearchProvider(_HttpSearchProvider):
    """私有 SearXNG JSON API 适配器。"""

    name: SearchProviderId = "searxng"

    def __init__(
        self, base_url: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport=transport)
        self._base_url = base_url.rstrip("/")

    async def healthy(self) -> bool:
        """检查本地 SearXNG 是否可达，不泄漏配置。"""
        try:
            async with httpx.AsyncClient(
                timeout=settings.web_search_timeout_seconds,
                transport=self._transport,
            ) as client:
                response = await client.get(self._base_url)
                return response.is_success
        except (httpx.HTTPError, TimeoutError):
            return False

    async def search(self, query: str, *, max_results: int) -> list[SearchSource]:
        """调用 SearXNG 的安全 JSON 搜索接口。"""
        payload = await self._request_json(
            "GET",
            f"{self._base_url}/search",
            params={
                "q": normalize_query(query),
                "format": "json",
                "categories": "general",
                "safesearch": "2",
            },
        )
        raw_results = payload.get("results")
        candidates = [
            {
                "title": item.get("title"),
                "url": item.get("url"),
                "snippet": item.get("content"),
            }
            for item in raw_results
            if isinstance(item, dict)
        ] if isinstance(raw_results, list) else raw_results
        return _normalize_sources(candidates, provider=self.name, max_results=max_results)


class BraveSearchProvider(_HttpSearchProvider):
    """Brave Search API 适配器。"""

    name: SearchProviderId = "brave"

    def __init__(
        self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport=transport)
        self._api_key = api_key

    async def search(self, query: str, *, max_results: int) -> list[SearchSource]:
        """调用 Brave Web Search 并归一化公共来源。"""
        payload = await self._request_json(
            "GET",
            "https://api.search.brave.com/res/v1/web/search",
            params={"q": normalize_query(query), "count": str(min(max_results, _MAX_RESULT_COUNT))},
            headers={"X-Subscription-Token": self._api_key, "Accept": "application/json"},
        )
        web = payload.get("web")
        raw_results = web.get("results") if isinstance(web, dict) else None
        return _normalize_sources(raw_results, provider=self.name, max_results=max_results)


class TavilySearchProvider(_HttpSearchProvider):
    """Tavily Search API 适配器。"""

    name: SearchProviderId = "tavily"

    def __init__(
        self, api_key: str, *, transport: httpx.AsyncBaseTransport | None = None
    ) -> None:
        super().__init__(transport=transport)
        self._api_key = api_key

    async def search(self, query: str, *, max_results: int) -> list[SearchSource]:
        """调用 Tavily 搜索并归一化公共来源。"""
        payload = await self._request_json(
            "POST",
            "https://api.tavily.com/search",
            json_body={
                "api_key": self._api_key,
                "query": normalize_query(query),
                "max_results": min(max_results, _MAX_RESULT_COUNT),
                "search_depth": "basic",
            },
        )
        raw_results = payload.get("results")
        return _normalize_sources(raw_results, provider=self.name, max_results=max_results)


def _configured_provider(name: SearchProviderId) -> SearchProvider | None:
    """只在配置完整时创建 provider，绝不回退到不同 provider。"""
    if name == "searxng":
        base_url = _safe_loopback_base_url(settings.searxng_base_url)
        return SearxngSearchProvider(base_url) if base_url else None
    if name == "brave":
        if settings.brave_search_api_key:
            return BraveSearchProvider(settings.brave_search_api_key)
        return None
    return TavilySearchProvider(settings.tavily_api_key) if settings.tavily_api_key else None


def resolve_search_provider(
    *, settings_provider: SearchProviderName, health: dict[SearchProviderId, bool]
) -> SearchCapability:
    """基于健康状态解析确定性 provider 顺序，便于无网络单元测试。"""
    if settings_provider == "disabled":
        return SearchCapability(enabled=False, provider=None, reason="disabled")
    if settings_provider != "auto":
        name = settings_provider
        return SearchCapability(
            enabled=health.get(name, False),
            provider=name,
            reason=None if health.get(name, False) else "unavailable",
        )
    for name in ("searxng", "brave", "tavily"):
        if health.get(name, False):
            return SearchCapability(enabled=True, provider=name, reason=None)
    return SearchCapability(enabled=False, provider=None, reason="unavailable")


_capability_cache: tuple[float, SearchCapability] | None = None


async def _provider_health(name: SearchProviderId) -> bool:
    """在不把密钥传给客户端的前提下确认 provider 是否可用。"""
    provider = _configured_provider(name)
    if provider is None:
        return False
    if isinstance(provider, SearxngSearchProvider):
        return await provider.healthy()
    # 第三方 provider 无免费健康检查。已配置即允许在用户显式请求时调用，失败会安全降级。
    return True


async def get_search_capability(*, refresh: bool = False) -> SearchCapability:
    """返回可缓存的联网搜索能力，客户端无需获知 endpoint 或密钥。"""
    global _capability_cache
    now = time.monotonic()
    if not refresh and _capability_cache and now - _capability_cache[0] < _CAPABILITY_TTL_SECONDS:
        return _capability_cache[1]

    configured = settings.search_provider
    names: tuple[SearchProviderId, ...]
    if configured == "disabled":
        capability = SearchCapability(enabled=False, provider=None, reason="disabled")
    elif configured == "auto":
        names = ("searxng", "brave", "tavily")
        health = {name: await _provider_health(name) for name in names}
        capability = resolve_search_provider(settings_provider=configured, health=health)
    else:
        names = (configured,)
        health = {configured: await _provider_health(configured)}
        capability = resolve_search_provider(settings_provider=configured, health=health)
    _capability_cache = (now, capability)
    return capability


async def _candidate_providers() -> list[SearchProvider]:
    """按配置顺序取可用 provider，auto 在请求失败后可尝试下一项。"""
    configured = settings.search_provider
    if configured == "disabled":
        return []
    names: tuple[SearchProviderId, ...] = (
        ("searxng", "brave", "tavily") if configured == "auto" else (configured,)
    )
    providers: list[SearchProvider] = []
    for name in names:
        provider = _configured_provider(name)
        if provider is None:
            continue
        if isinstance(provider, SearxngSearchProvider) and not await provider.healthy():
            continue
        providers.append(provider)
    return providers


async def _increment_limit(user_id: uuid.UUID) -> None:
    """使用 Redis 的自然分钟桶限制用户主动联网搜索次数。"""
    bucket = int(time.time() // 60)
    key = f"web-search:limit:{user_id}:{bucket}"
    try:
        count = await redis_client.incr(key)
        if count == 1:
            await redis_client.expire(key, 60)
    except RedisError as exc:
        raise SearchUnavailableError("WEB_SEARCH_CACHE_UNAVAILABLE") from exc
    if count > settings.web_search_per_user_limit_per_minute:
        raise SearchRateLimitError("WEB_SEARCH_RATE_LIMITED")


def _cache_key(query: str) -> str:
    return f"web-search:result:{hashlib.sha256(query.encode('utf-8')).hexdigest()}"


async def _read_cache(query: str) -> list[SearchSource] | None:
    """读取并重新校验 Redis 中的净化来源。"""
    try:
        raw = await redis_client.get(_cache_key(query))
    except RedisError as exc:
        raise SearchUnavailableError("WEB_SEARCH_CACHE_UNAVAILABLE") from exc
    if raw is None:
        return None
    try:
        payload = json.loads(raw)
    except json.JSONDecodeError:
        return None
    if not isinstance(payload, list):
        return None
    sources: list[SearchSource] = []
    for item in payload:
        if not isinstance(item, dict):
            continue
        provider = item.get("provider")
        if provider not in {"searxng", "brave", "tavily"}:
            continue
        sources.extend(
            _normalize_sources(
                [item], provider=provider, max_results=_MAX_RESULT_COUNT - len(sources)
            )
        )
    return sources or None


async def _write_cache(query: str, sources: list[SearchSource]) -> None:
    """缓存已净化的来源，Redis 不可用时不继续外部请求。"""
    try:
        await redis_client.set(
            _cache_key(query),
            json.dumps([asdict(source) for source in sources], ensure_ascii=False),
            ex=settings.web_search_cache_ttl_seconds,
        )
    except RedisError as exc:
        raise SearchUnavailableError("WEB_SEARCH_CACHE_UNAVAILABLE") from exc


async def search_web(
    *, user_id: uuid.UUID, query: str, max_results: int | None = None
) -> list[SearchSource]:
    """执行限流、缓存和 provider 降级后的公共网页搜索。"""
    normalized_query = normalize_query(query)
    await _increment_limit(user_id)
    cached = await _read_cache(normalized_query)
    if cached is not None:
        return cached

    requested_count = min(max_results or settings.web_search_max_results, _MAX_RESULT_COUNT)
    providers = await _candidate_providers()
    if not providers:
        raise SearchUnavailableError("WEB_SEARCH_UNAVAILABLE")
    for provider in providers:
        try:
            sources = await provider.search(normalized_query, max_results=requested_count)
        except (SearchUnavailableError, SearchProviderProtocolError):
            if settings.search_provider != "auto":
                raise
            continue
        if sources:
            await _write_cache(normalized_query, sources)
            return sources
    raise SearchUnavailableError("WEB_SEARCH_NO_RESULTS")
