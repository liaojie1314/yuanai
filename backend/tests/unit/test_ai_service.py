"""ai_service 单元测试 — mock openai，不调用真实 API。

### 关键测试场景

- AVAILABLE_MODELS 结构正确性
- PROVIDER_CONFIG 覆盖所有已声明模型
- _get_client 单例复用（同 provider 只创建一次 AsyncOpenAI）
- stream_chat 正常流式输出 token
- stream_chat 跳过空 delta（None / 空 choices）
- stream_chat 对不支持的 model 抛出 ValueError
- stream_chat 在 API 异常时正确传播异常
"""

import os
from collections.abc import AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

import app.services.ai_service as ai_svc  # noqa: E402
from app.services.ai_service import (  # noqa: E402
    AVAILABLE_MODELS,
    PROVIDER_CONFIG,
    _get_client,
    stream_chat,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_ai_clients() -> AsyncGenerator[None, None]:
    """每个测试前后清空 _AI_CLIENTS 单例缓存，防止测试间状态污染。"""
    ai_svc._AI_CLIENTS.clear()
    yield  # type: ignore[misc]
    ai_svc._AI_CLIENTS.clear()


def _build_mock_client(
    tokens: list[str],
    thinking_tokens: list[str] | None = None,
) -> MagicMock:
    """构造一个 mock AsyncOpenAI client，按 tokens 顺序 yield chunk。

    Args:
        tokens: 正文 token 列表
        thinking_tokens: 思考 token 列表（可选），先于正文 token yield
    """

    async def _mock_aiter() -> AsyncGenerator[MagicMock, None]:
        for t in thinking_tokens or []:
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            delta = MagicMock()
            delta.content = None
            delta.reasoning_content = t
            chunk.choices[0].delta = delta
            yield chunk
        for t in tokens:
            chunk = MagicMock()
            chunk.choices = [MagicMock()]
            delta = MagicMock()
            delta.content = t
            delta.reasoning_content = None
            chunk.choices[0].delta = delta
            yield chunk

    mock_stream = MagicMock()
    mock_stream.__aiter__ = lambda self: _mock_aiter()

    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)
    return mock_client


# ---------------------------------------------------------------------------
# AVAILABLE_MODELS 结构测试
# ---------------------------------------------------------------------------


def test_available_models_not_empty() -> None:
    assert len(AVAILABLE_MODELS) > 0


def test_exactly_one_default_model() -> None:
    defaults = [m for m in AVAILABLE_MODELS if m["is_default"]]
    assert len(defaults) == 1


def test_all_models_have_required_fields() -> None:
    required = {"id", "name", "provider", "is_default", "supports_vision", "supports_files", "context_length"}  # noqa: E501
    for model in AVAILABLE_MODELS:
        assert required <= model.keys(), f"Model {model.get('id')} missing fields"


def test_provider_config_covers_all_models() -> None:
    for model in AVAILABLE_MODELS:
        assert model["id"] in PROVIDER_CONFIG, f"{model['id']} not in PROVIDER_CONFIG"


# ---------------------------------------------------------------------------
# _get_client 单例测试
# ---------------------------------------------------------------------------


def test_get_client_returns_singleton() -> None:
    """同一 provider 多次调用 _get_client 必须返回同一实例（只创建一次）。

    修复背景：
        每次请求创建新 AsyncOpenAI 实例，请求结束后 GC 触发
        AsyncHttpxClientWrapper.__del__，该方法调度
          asyncio.get_running_loop().create_task(self.aclose())
        但 task 执行时 httpx _transport 可能已被 GC 部分回收，导致：
          AttributeError: 'AsyncHttpxClientWrapper' object has no attribute '_transport'
          "Task exception was never retrieved"
        单例确保 client 永不被 GC，__del__ 只在解释器退出时触发，
        届时无 running event loop，异常被 except 静默忽略。
    """
    with patch("app.services.ai_service.AsyncOpenAI") as mock_cls:
        mock_instance = MagicMock()
        mock_cls.return_value = mock_instance

        c1 = _get_client("openai", "https://api.openai.com/v1")
        c2 = _get_client("openai", "https://api.openai.com/v1")
        c3 = _get_client("openai", "https://api.openai.com/v1")

        assert c1 is c2 is c3, "同一 provider 应返回相同实例"
        mock_cls.assert_called_once()  # AsyncOpenAI() 只调用一次


def test_get_client_different_providers_create_separate_instances() -> None:
    """不同 provider 应获得不同的 AsyncOpenAI 实例。"""
    with patch("app.services.ai_service.AsyncOpenAI") as mock_cls:
        mock_cls.side_effect = lambda **kwargs: MagicMock()

        c_openai = _get_client("openai", "https://api.openai.com/v1")
        c_deepseek = _get_client("deepseek", "https://api.deepseek.com")

        assert c_openai is not c_deepseek
        assert mock_cls.call_count == 2


# ---------------------------------------------------------------------------
# stream_chat 行为测试
# ---------------------------------------------------------------------------


async def test_unsupported_model_raises() -> None:
    """不支持的 model ID 应在迭代开始时抛出 ValueError。"""
    with pytest.raises(ValueError, match="Unsupported model"):
        async for _ in stream_chat("unknown-model-xyz", []):
            pass


async def test_stream_chat_yields_tokens() -> None:
    """stream_chat 应逐 token 以 ('content', token) 元组 yield AI 回复内容。"""
    mock_client = _build_mock_client(["hello", " world"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        events: list[tuple[str, str]] = []
        async for event_type, token in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
            events.append((event_type, token))

    assert events == [("content", "hello"), ("content", " world")]


async def test_stream_chat_yields_thinking_tokens() -> None:
    """stream_chat 应对 reasoning_content 字段 yield ('thinking', token) 事件。"""
    mock_client = _build_mock_client(["answer"], thinking_tokens=["think1", "think2"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        events: list[tuple[str, str]] = []
        async for event_type, token in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
            events.append((event_type, token))

    assert events == [("thinking", "think1"), ("thinking", "think2"), ("content", "answer")]


async def test_stream_chat_skips_empty_delta() -> None:
    """delta.content 为 None 且 reasoning_content 也为 None / choices 为空时不应 yield。"""

    async def _mock_aiter() -> AsyncGenerator[MagicMock, None]:
        c1 = MagicMock()
        c1.choices = [MagicMock()]
        delta1 = MagicMock()
        delta1.content = "token"
        delta1.reasoning_content = None
        c1.choices[0].delta = delta1
        yield c1
        c2 = MagicMock()
        c2.choices = [MagicMock()]
        delta2 = MagicMock()
        delta2.content = None  # None → skip
        delta2.reasoning_content = None
        c2.choices[0].delta = delta2
        yield c2
        c3 = MagicMock()
        c3.choices = []  # empty choices → skip
        yield c3

    mock_stream = MagicMock()
    mock_stream.__aiter__ = lambda self: _mock_aiter()
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        events: list[tuple[str, str]] = []
        async for event_type, token in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
            events.append((event_type, token))

    assert events == [("content", "token")]


async def test_stream_chat_propagates_api_error() -> None:
    """chat.completions.create 抛出异常时应向调用方传播。"""
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(side_effect=RuntimeError("API timeout"))

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        with pytest.raises(RuntimeError, match="API timeout"):
            async for _ in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
                pass


async def test_stream_chat_propagates_stream_error() -> None:
    """流式迭代中途抛出异常时应向调用方传播。"""

    async def _failing_aiter() -> AsyncGenerator[MagicMock, None]:
        chunk = MagicMock()
        chunk.choices = [MagicMock()]
        delta = MagicMock()
        delta.content = "first"
        delta.reasoning_content = None
        chunk.choices[0].delta = delta
        yield chunk
        raise RuntimeError("Stream interrupted")

    mock_stream = MagicMock()
    mock_stream.__aiter__ = lambda self: _failing_aiter()
    mock_client = MagicMock()
    mock_client.chat.completions.create = AsyncMock(return_value=mock_stream)

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        collected: list[tuple[str, str]] = []
        with pytest.raises(RuntimeError, match="Stream interrupted"):
            async for event_type, token in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
                collected.append((event_type, token))

    assert collected == [("content", "first")]  # 第一个 token 已 yield，之后报错
