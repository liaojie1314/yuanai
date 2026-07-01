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
    "deepseek-v4-flash": {"provider": "deepseek", "base_url": "https://api.deepseek.com"},
    "deepseek-v4-pro": {"provider": "deepseek", "base_url": "https://api.deepseek.com"},
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
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash",
        "provider": "deepseek",
        "description": "快速响应，高性价比",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 64000,
        "is_default": False,
    },
    {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro",
        "provider": "deepseek",
        "description": "中文理解强，旗舰推理",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 128000,
        "is_default": False,
    },
]


def get_available_models() -> list[dict[str, object]]:
    """返回已配置 API Key 的模型列表，第一个标记为默认模型。"""
    result = [
        m for m in AVAILABLE_MODELS
        if API_KEYS.get(PROVIDER_CONFIG.get(str(m["id"]), {}).get("provider", ""), "")
    ]
    for i, m in enumerate(result):
        result[i] = {**m, "is_default": i == 0}
    return result


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

    async for chunk in stream:  # type: ignore[union-attr]
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta and delta.content:
            yield delta.content
