from collections.abc import AsyncGenerator
from typing import cast

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionMessageParam

from app.core.config import settings

# ---------------------------------------------------------------------------
# 模块级单例：每个 provider 只创建一个 AsyncOpenAI 实例。
#
# 根本原因：AsyncOpenAI 内部持有 AsyncHttpxClientWrapper（继承自 httpx.AsyncClient）。
# 若每次请求都创建新实例，请求结束后 client 被 GC 回收，__del__ 会执行：
#   asyncio.get_running_loop().create_task(self.aclose())
# 这个异步 task 与 GC 之间存在竞态，在 Python 3.13 下 task 运行时
# httpx 对象内部 _transport 属性可能已被部分清理，导致：
#   AttributeError: 'AsyncHttpxClientWrapper' object has no attribute '_transport'
#   Task exception was never retrieved
#
# 使用单例后 client 永不被 GC，__del__ 只在解释器退出时触发，
# 届时已无 running event loop，get_running_loop() 抛异常被 except 静默忽略。
# ---------------------------------------------------------------------------
_AI_CLIENTS: dict[str, AsyncOpenAI] = {}

PROVIDER_CONFIG: dict[str, dict[str, str]] = {
    "gpt-4o": {"provider": "openai", "base_url": "https://api.openai.com/v1"},
    "gpt-4o-mini": {"provider": "openai", "base_url": "https://api.openai.com/v1"},
    "claude-3-5-sonnet-20241022": {
        "provider": "anthropic",
        "base_url": "https://api.anthropic.com/v1",
    },
    "deepseek-v4-flash": {"provider": "deepseek", "base_url": "https://api.deepseek.com"},
    "deepseek-v4-pro": {"provider": "deepseek", "base_url": "https://api.deepseek.com"},
    "agnes-2.5-flash": {
        "provider": "agnes",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "kind": "chat",
    },
    "agnes-image-2.1-flash": {
        "provider": "agnes",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "kind": "image",
    },
    "agnes-video-v2.0": {
        "provider": "agnes",
        "base_url": "https://apihub.agnes-ai.com/v1",
        "kind": "video",
    },
    "qwen-plus": {
        "provider": "qwen",
        "base_url": "https://dashscope.aliyuncs.com/compatible-mode/v1",
    },
}

API_KEYS: dict[str, str] = {
    "openai": settings.openai_api_key,
    "anthropic": settings.anthropic_api_key,
    "deepseek": settings.deepseek_api_key,
    "agnes": settings.agnes_api_key,
    "qwen": "",  # 通过 DASHSCOPE_API_KEY 环境变量
}


class ModelVisionUnsupportedError(ValueError):
    """模型接收到视觉输入但其公开能力声明不支持图片识别时抛出。"""

    def __init__(self) -> None:
        super().__init__("当前模型不支持图片识别，请切换至支持视觉的模型后发送")


AVAILABLE_MODELS = [
    {
        "id": "deepseek-v4-flash",
        "name": "DeepSeek V4 Flash-0731",
        "provider": "deepseek",
        "description": "快速响应，高性价比",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 1000000,
        "pricing": {
            "input_cached_cny_per_million": 0.02,
            "input_uncached_cny_per_million": 1.0,
            "output_cny_per_million": 2.0,
        },
        "is_default": True,
    },
    {
        "id": "deepseek-v4-pro",
        "name": "DeepSeek V4 Pro-0813",
        "provider": "deepseek",
        "description": "中文理解强，旗舰推理",
        "supports_vision": False,
        "supports_files": False,
        "context_length": 1000000,
        "pricing": {
            "input_cached_cny_per_million": 0.025,
            "input_uncached_cny_per_million": 3.0,
            "output_cny_per_million": 6.0,
        },
        "is_default": False,
    },
    {
        "id": "agnes-2.5-flash",
        "name": "Agnes 2.5 Flash",
        "provider": "agnes",
        "description": "支持推理、工具调用、多轮对话和图像理解",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 128000,
        "is_default": False,
    },
    {
        "id": "agnes-image-2.1-flash",
        "name": "Agnes Image 2.1 Flash",
        "provider": "agnes",
        "description": "文本生成图片与图片编辑",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 0,
        "is_default": False,
        "capability": "image_generation",
    },
    {
        "id": "agnes-video-v2.0",
        "name": "Agnes Video V2.0",
        "provider": "agnes",
        "description": "异步文本生成视频与图生视频",
        "supports_vision": True,
        "supports_files": True,
        "context_length": 0,
        "is_default": False,
        "capability": "video_generation",
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


def _get_client(provider: str, base_url: str) -> AsyncOpenAI:
    """获取（或懒创建）指定 provider 的单例 AsyncOpenAI 客户端。

    Args:
        provider: AI 提供商标识（openai / anthropic / deepseek / qwen）
        base_url: API 基础 URL

    Returns:
        复用的 AsyncOpenAI 实例（持有 httpx 连接池）
    """
    if provider not in _AI_CLIENTS:
        _AI_CLIENTS[provider] = AsyncOpenAI(
            api_key=API_KEYS[provider],
            base_url=base_url,
        )
    return _AI_CLIENTS[provider]


def _has_image_input(messages: list[dict[str, object]]) -> bool:
    """判断 OpenAI 格式消息是否包含 ``image_url`` 视觉块。"""
    for message in messages:
        content = message.get("content")
        if not isinstance(content, list):
            continue
        for part in content:
            if isinstance(part, dict) and part.get("type") == "image_url":
                return True
    return False


def _model_supports_vision(model: str) -> bool:
    """从公开模型目录读取视觉能力；历史兼容模型缺少元数据时保持原有行为。"""
    metadata = next((item for item in AVAILABLE_MODELS if item["id"] == model), None)
    return metadata is None or bool(metadata["supports_vision"])


async def stream_chat(
    model: str,
    messages: list[dict[str, object]],
    enable_thinking: bool = False,
) -> AsyncGenerator[tuple[str, str], None]:
    """向 AI 提供商发送流式聊天请求，逐 token yield 事件元组。

    使用模块级单例 client（_get_client），避免每请求创建/销毁 AsyncOpenAI 实例，
    从根本上消除 GC 触发 AsyncHttpxClientWrapper.__del__ 调度孤立 aclose() task
    导致 "Task exception was never retrieved" 的竞态问题。

    Args:
        model: 模型 ID（须在 PROVIDER_CONFIG 中注册）
        messages: OpenAI 格式的消息列表
        enable_thinking: 是否开启思考/推理模式（DeepSeek 系列通过 extra_body 传递）

    Yields:
        tuple[str, str]: (event_type, token)
            event_type: 'content' — 正文 token
                        'thinking' — 思考/推理 token（DeepSeek-R1 等支持 reasoning 的模型）

    Raises:
        ValueError: 当 model 不在 PROVIDER_CONFIG 中时
    """
    config = PROVIDER_CONFIG.get(model)
    if not config:
        raise ValueError(f"Unsupported model: {model}")
    if config.get("kind", "chat") != "chat":
        raise ValueError(f"Model {model} is not a chat model")
    if _has_image_input(messages) and not _model_supports_vision(model):
        raise ModelVisionUnsupportedError()

    client = _get_client(config["provider"], config["base_url"])

    # DeepSeek 模型通过 extra_body 控制思考模式：
    # https://api-docs.deepseek.com/zh-cn/guides/thinking_mode
    extra_body: dict[str, object] | None = None
    if config["provider"] == "deepseek":
        extra_body = {
            "thinking": {
                "type": "enabled" if enable_thinking else "disabled",
                "budget_tokens": 8000,
            }
        }

    provider_messages = cast(list[ChatCompletionMessageParam], messages)
    if extra_body is None:
        stream = await client.chat.completions.create(
            model=model,
            messages=provider_messages,
            stream=True,
        )
    else:
        stream = await client.chat.completions.create(
            model=model,
            messages=provider_messages,
            stream=True,
            extra_body=extra_body,
        )

    async for chunk in stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta:
            # 思考/推理 token（DeepSeek-R1 / Qwen-thinking 等扩展字段）
            reasoning: str | None = getattr(delta, "reasoning_content", None)
            if reasoning:
                yield ("thinking", reasoning)
            # 正文 token
            if delta.content:
                yield ("content", delta.content)
