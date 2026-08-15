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

import httpx
import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

import app.services.ai_service as ai_svc  # noqa: E402
from app.services.ai_service import (  # noqa: E402
    AVAILABLE_MODELS,
    PROVIDER_CONFIG,
    ModelVisionUnsupportedError,
    VoiceTranscriptionProviderError,
    VoiceTranscriptionUnavailableError,
    _get_client,
    generate_conversation_title,
    get_available_models,
    stream_chat,
    transcribe_audio,
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


def test_public_catalog_only_offers_current_models(monkeypatch: pytest.MonkeyPatch) -> None:
    """弃用模型仅保留流式兼容路由，不能再从公开模型目录选择。"""
    monkeypatch.setitem(ai_svc.API_KEYS, "deepseek", "test-deepseek-key")
    monkeypatch.setitem(ai_svc.API_KEYS, "agnes", "test-agnes-key")

    models = get_available_models()

    assert [model["id"] for model in models] == [
        "deepseek-v4-flash",
        "deepseek-v4-pro",
        "agnes-2.5-flash",
        "agnes-image-2.1-flash",
        "agnes-video-v2.0",
    ]
    assert all(
        model["id"] not in {"gpt-4o", "claude-3-5-sonnet-20241022"} for model in models
    )
    assert models[0]["is_default"] is True


def test_legacy_chat_routes_remain_available_for_existing_conversations() -> None:
    assert "gpt-4o" in PROVIDER_CONFIG
    assert "claude-3-5-sonnet-20241022" in PROVIDER_CONFIG


def test_agnes_models_are_registered_without_embedded_credentials() -> None:
    assert PROVIDER_CONFIG["agnes-2.5-flash"]["base_url"] == "https://apihub.agnes-ai.com/v1"
    assert any(m["id"] == "agnes-image-2.1-flash" for m in AVAILABLE_MODELS)
    assert any(m["id"] == "agnes-video-v2.0" for m in AVAILABLE_MODELS)


async def test_generate_conversation_title_retries_agnes_after_reasoning_budget_exhaustion(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Agnes 的 reasoning token 耗尽首轮预算时应仅重试一次并返回完整标题。"""
    monkeypatch.setattr(ai_svc.settings, "agnes_api_key", "test-agnes-key")
    first = MagicMock()
    first.choices = [MagicMock()]
    first.choices[0].finish_reason = "length"
    first.choices[0].message.content = ""
    second = MagicMock()
    second.choices = [MagicMock()]
    second.choices[0].finish_reason = "stop"
    second.choices[0].message.content = "Async SQLAlchemy 事务边界"
    client = MagicMock()
    client.chat.completions.create = AsyncMock(side_effect=[first, second])
    monkeypatch.setattr(ai_svc, "_get_client", lambda _provider, _base_url: client)

    title = await generate_conversation_title("解释 async SQLAlchemy 的事务边界")

    assert title == "Async SQLAlchemy 事务边界"
    assert client.chat.completions.create.await_count == 2
    assert [
        call_kwargs.kwargs["max_tokens"]
        for call_kwargs in client.chat.completions.create.await_args_list
    ] == [128, 256]


async def test_generate_conversation_title_uses_first_complete_agnes_response(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未截断的 Agnes 标题不应额外请求，避免首问产生不必要的模型调用。"""
    monkeypatch.setattr(ai_svc.settings, "agnes_api_key", "test-agnes-key")
    completion = MagicMock()
    completion.choices = [MagicMock()]
    completion.choices[0].finish_reason = "stop"
    completion.choices[0].message.content = "SQLAlchemy 事务边界"
    client = MagicMock()
    client.chat.completions.create = AsyncMock(return_value=completion)
    monkeypatch.setattr(ai_svc, "_get_client", lambda _provider, _base_url: client)

    title = await generate_conversation_title("解释 async SQLAlchemy 的事务边界")

    assert title == "SQLAlchemy 事务边界"
    client.chat.completions.create.assert_awaited_once()
    assert client.chat.completions.create.await_args.kwargs["max_tokens"] == 128


def test_deepseek_v4_official_metadata() -> None:
    flash = next(m for m in AVAILABLE_MODELS if m["id"] == "deepseek-v4-flash")
    pro = next(m for m in AVAILABLE_MODELS if m["id"] == "deepseek-v4-pro")
    assert flash["context_length"] == pro["context_length"] == 1_000_000
    assert flash["pricing"]["output_cny_per_million"] == 2.0  # type: ignore[index]
    assert pro["pricing"]["output_cny_per_million"] == 6.0  # type: ignore[index]


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


async def test_stream_chat_rejects_image_for_text_only_model() -> None:
    """纯文本模型不得把视觉块转交给 provider，避免暴露其底层反序列化错误。"""
    messages: list[dict[str, object]] = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": "看图"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,AA=="}},
            ],
        }
    ]

    with pytest.raises(ModelVisionUnsupportedError, match="不支持图片识别"):
        async for _ in stream_chat("deepseek-v4-flash", messages):
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


async def test_stream_chat_deepseek_extra_body_enable_thinking() -> None:
    """enable_thinking=True 时 DeepSeek 请求应携带 extra_body={"thinking": {"type": "enabled"}}。"""
    mock_client = _build_mock_client(["ok"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        async for _ in stream_chat(
            "deepseek-v4-flash", [{"role": "user", "content": "hi"}], enable_thinking=True
        ):
            pass

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert "extra_body" in call_kwargs
    assert call_kwargs["extra_body"]["thinking"]["type"] == "enabled"


async def test_stream_chat_deepseek_extra_body_disable_thinking() -> None:
    """enable_thinking=False 时 DeepSeek 请求应携带禁用思考的 extra_body。"""
    mock_client = _build_mock_client(["ok"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        async for _ in stream_chat(
            "deepseek-v4-flash", [{"role": "user", "content": "hi"}], enable_thinking=False
        ):
            pass

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert "extra_body" in call_kwargs
    assert call_kwargs["extra_body"]["thinking"]["type"] == "disabled"


@pytest.mark.parametrize("enable_thinking", [True, False])
async def test_stream_chat_agnes_passes_documented_thinking_toggle(
    enable_thinking: bool,
) -> None:
    """Agnes OpenAI 兼容接口必须接收 chat_template_kwargs 开关。"""
    mock_client = _build_mock_client(["ok"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        async for _ in stream_chat(
            "agnes-2.5-flash", [{"role": "user", "content": "hi"}], enable_thinking=enable_thinking
        ):
            pass

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert call_kwargs["extra_body"] == {
        "chat_template_kwargs": {"enable_thinking": enable_thinking}
    }


async def test_stream_chat_openai_no_extra_body() -> None:
    """OpenAI 模型不应携带 extra_body（非 DeepSeek 提供商）。"""
    mock_client = _build_mock_client(["ok"])

    with patch("app.services.ai_service._get_client", return_value=mock_client):
        async for _ in stream_chat(
            "gpt-4o", [{"role": "user", "content": "hi"}], enable_thinking=True
        ):
            pass

    call_kwargs = mock_client.chat.completions.create.call_args.kwargs
    assert "extra_body" not in call_kwargs


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
            async for event_type, token in stream_chat(
                "gpt-4o", [{"role": "user", "content": "hi"}]
            ):
                collected.append((event_type, token))

    assert collected == [("content", "first")]  # 第一个 token 已 yield，之后报错


class _AssemblyAIResponse:
    """用于验证 AssemblyAI HTTP 协议的最小响应替身。"""

    def __init__(self, body: object) -> None:
        self.body = body

    def json(self) -> object:
        """返回测试指定的 JSON 载荷。"""
        return self.body

    def raise_for_status(self) -> None:
        """模拟成功的 HTTP 响应。"""


class _AssemblyAIClient:
    """用于断言预录制转写请求顺序的异步 HTTP 客户端替身。"""

    def __init__(self) -> None:
        self.get = AsyncMock(
            return_value=_AssemblyAIResponse({"status": "completed", "text": "  转写文本  "})
        )
        self.post = AsyncMock(
            side_effect=[
                _AssemblyAIResponse({"upload_url": "https://cdn.assemblyai.example/audio"}),
                _AssemblyAIResponse({"id": "transcript-1"}),
            ]
        )

    async def __aenter__(self) -> "_AssemblyAIClient":
        """提供异步上下文管理器入口。"""
        return self

    async def __aexit__(self, exc_type: object, exc: object, traceback: object) -> None:
        """提供异步上下文管理器出口。"""


async def test_transcribe_audio_uses_assemblyai_pre_recorded_stt_and_trims_result(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """AssemblyAI 先上传、创建任务、轮询完成，并返回清理后的文本。"""
    client = _AssemblyAIClient()
    monkeypatch.setattr(ai_svc.settings, "assemblyai_api_key", "test-key")
    monkeypatch.setattr(ai_svc.settings, "voice_transcription_poll_interval_seconds", 0.0)

    with patch("app.services.ai_service.httpx.AsyncClient", return_value=client):
        result = await transcribe_audio(
            filename="voice.webm", content=b"audio", mime_type="audio/webm"
        )

    assert result == "转写文本"
    client.post.assert_has_awaits(
        [
            call("/v2/upload", content=b"audio", headers={"content-type": "audio/webm"}),
            call(
                "/v2/transcript",
                json={
                    "audio_url": "https://cdn.assemblyai.example/audio",
                    "speech_models": ["universal-3-5-pro"],
                },
            ),
        ]
    )
    client.get.assert_awaited_once_with("/v2/transcript/transcript-1")


async def test_transcribe_audio_rejects_missing_assemblyai_key(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未配置 AssemblyAI 密钥时不得构造 HTTP 客户端。"""
    monkeypatch.setattr(ai_svc.settings, "assemblyai_api_key", "")

    with pytest.raises(VoiceTranscriptionUnavailableError):
        await transcribe_audio(filename="voice.webm", content=b"audio", mime_type="audio/webm")


async def test_transcribe_audio_hides_provider_exception(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """普通 provider 故障应映射为稳定领域错误。"""
    client = _AssemblyAIClient()
    client.post = AsyncMock(
        side_effect=httpx.HTTPStatusError(
            "sensitive upstream failure",
            request=MagicMock(),
            response=MagicMock(),
        )
    )
    monkeypatch.setattr(ai_svc.settings, "assemblyai_api_key", "test-key")

    with patch("app.services.ai_service.httpx.AsyncClient", return_value=client):
        with pytest.raises(VoiceTranscriptionProviderError) as exc_info:
            await transcribe_audio(filename="voice.webm", content=b"audio", mime_type="audio/webm")

    assert "sensitive upstream failure" not in str(exc_info.value)
