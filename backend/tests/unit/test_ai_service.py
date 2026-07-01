"""ai_service 单元测试 — mock openai，不调用真实 API。"""

import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

os.environ.setdefault("DATABASE_URL", "postgresql+asyncpg://yuanai:password@localhost:5433/yuanai_test")
os.environ.setdefault("JWT_SECRET_KEY", "test-secret-key-for-unit-tests")

from app.services.ai_service import AVAILABLE_MODELS, PROVIDER_CONFIG, stream_chat  # noqa: E402


def test_available_models_not_empty() -> None:
    assert len(AVAILABLE_MODELS) > 0


def test_exactly_one_default_model() -> None:
    defaults = [m for m in AVAILABLE_MODELS if m["is_default"]]
    assert len(defaults) == 1


def test_all_models_have_required_fields() -> None:
    required = {"id", "name", "provider", "is_default", "supports_vision", "supports_files", "context_length"}  # noqa: E501
    for model in AVAILABLE_MODELS:
        assert required <= model.keys(), f"Model {model.get('id')} missing fields"


def test_unsupported_model_raises() -> None:
    async def _run() -> None:
        async for _ in stream_chat("unknown-model-xyz", []):
            pass

    with pytest.raises(ValueError, match="Unsupported model"):
        import asyncio
        asyncio.get_event_loop().run_until_complete(_run())


def test_provider_config_covers_all_models() -> None:
    for model in AVAILABLE_MODELS:
        assert model["id"] in PROVIDER_CONFIG, f"{model['id']} not in PROVIDER_CONFIG"


async def test_stream_chat_yields_tokens() -> None:
    mock_chunk = MagicMock()
    mock_chunk.choices = [MagicMock()]
    mock_chunk.choices[0].delta = MagicMock()
    mock_chunk.choices[0].delta.content = "hello"

    async def mock_aiter():  # type: ignore[return]
        yield mock_chunk

    mock_stream = MagicMock()
    mock_stream.__aiter__ = lambda self: mock_aiter()

    mock_completion = AsyncMock(return_value=mock_stream)

    with patch("app.services.ai_service.AsyncOpenAI") as mock_client_cls:
        mock_client = MagicMock()
        mock_client.chat.completions.create = mock_completion
        mock_client_cls.return_value = mock_client

        tokens = []
        async for token in stream_chat("gpt-4o", [{"role": "user", "content": "hi"}]):
            tokens.append(token)

        assert tokens == ["hello"]
