"""Google JWKS 公钥缓存单元测试。

`_fetch_google_jwks` 的 TTL 缓存是唯一不经端点就能出错的分支：
缓存不生效会让每次原生登录都打一次 Google，缓存永不过期则证书轮换后全站登录失败。
这里用假的 httpx.AsyncClient 替身，只验这两件事。
"""

from __future__ import annotations

from types import TracebackType
from typing import Any

import pytest

from app.services import oauth_service

_FAKE_JWKS = {"keys": [{"kty": "RSA", "kid": "fake-kid", "n": "AQAB", "e": "AQAB"}]}


class _FakeResponse:
    """最小 httpx 响应替身。"""

    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self._payload = payload

    def json(self) -> dict[str, Any]:
        return self._payload


class _CountingClient:
    """记录 GET 次数的 httpx.AsyncClient 替身。"""

    calls = 0

    def __init__(self, **kwargs: Any) -> None:
        pass

    async def __aenter__(self) -> _CountingClient:
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc: BaseException | None,
        tb: TracebackType | None,
    ) -> None:
        return None

    async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
        type(self).calls += 1
        return _FakeResponse(200, _FAKE_JWKS)


@pytest.fixture(autouse=True)
def _reset(monkeypatch: pytest.MonkeyPatch) -> None:
    """每个用例都从空缓存和零计数开始。"""
    _CountingClient.calls = 0
    monkeypatch.setattr(oauth_service, "_google_jwks_cache", None)
    monkeypatch.setattr(oauth_service.httpx, "AsyncClient", _CountingClient)


async def test_second_call_hits_cache() -> None:
    first = await oauth_service._fetch_google_jwks()
    second = await oauth_service._fetch_google_jwks()
    assert first == second == _FAKE_JWKS
    assert _CountingClient.calls == 1


async def test_expired_cache_refetches(monkeypatch: pytest.MonkeyPatch) -> None:
    await oauth_service._fetch_google_jwks()
    assert _CountingClient.calls == 1
    # 把缓存过期时刻推到过去，模拟 TTL 到期
    monkeypatch.setattr(oauth_service, "_google_jwks_cache", (0.0, _FAKE_JWKS))
    await oauth_service._fetch_google_jwks()
    assert _CountingClient.calls == 2


async def test_empty_key_set_is_rejected(monkeypatch: pytest.MonkeyPatch) -> None:
    class _EmptyClient(_CountingClient):
        async def get(self, url: str, **kwargs: Any) -> _FakeResponse:
            return _FakeResponse(200, {"keys": []})

    monkeypatch.setattr(oauth_service.httpx, "AsyncClient", _EmptyClient)
    with pytest.raises(oauth_service.OAuthFlowError) as err:
        await oauth_service._fetch_google_jwks()
    assert err.value.code == "OAUTH_NETWORK_ERROR"
