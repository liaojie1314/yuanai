from collections.abc import AsyncGenerator

from openai import AsyncOpenAI

from app.core.config import settings

PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    "gpt-4o": {"provider": "openai", "base_url": "https://api.openai.com/v1"},
    "gpt-4o-mini": {"provider": "openai", "base_url": "https://api.openai.com/v1"},
    "claude-3-5-sonnet-20241022": {
        "provider": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
    },
    "deepseek-chat": {"provider": "deepseek", "base_url": "https://api.deepseek.com/v1"},
    "qwen-plus": {
        "provider": "qwen",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
}

API_KEYS: dict[str, str] = {
    "openai": settings.openai_api_key,
    "anthropic": settings.anthropic_api_key,
    "deepseek": settings.deepseek_api_key,
    "qwen": "",  # 通过 DASHSCOPE_API_KEY 环境变量
}

AVAILABLE_MODELS = [
    {
        "id": "gpt-4o",
        "name": "GPT-4o",
        "provider": "openai",
        "description": "OpenAI 最强多模态模型",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 128000,
        "is_default": True,
    },
    {
        "id": "claude-3-5-sonnet-20241022",
        "name": "Claude 3.5 Sonnet",
        "provider": "anthropic",
        "description": "Anthropic 旗舰推理模型",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 200000,
        "is_default": False,
    },
    {
        "id": "deepseek-chat",
        "name": "DeepSeek V3",
        "provider": "deepseek",
        "description": "高性价比国产大模型",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 64000,
        "is_default": False,
    },
]


async def stream_chat(
    model: str,
    messages: list[dict[str, object]],
) -> AsyncGenerator[str, None]:
    config = PROVIDER_CONFIG.get(model)
    if not config:
        raise ValueError(f"Unsupported model: {model}")

    client = AsyncOpenAI(
        api_key=API_KEYS[config["provider"]],
        base_url=config["base_url"],
    )

    stream = await client.chat.completions.create(
        model=model,
        messages=messages,  # type: ignore[arg-type]
        stream=True,
    )

    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            yield delta.content
