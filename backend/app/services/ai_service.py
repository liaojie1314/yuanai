import asyncio
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from typing import cast

import httpx
from openai import AsyncOpenAI, OpenAIError
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
ASSEMBLYAI_API_BASE_URL = "https://api.assemblyai.com"
ASSEMBLYAI_SPEECH_MODEL = "universal-3-5-pro"
AGNES_VIDEO_API_BASE_URL = "https://apihub.agnes-ai.com/v1"
TITLE_GENERATION_TIMEOUT_SECONDS = 12
TITLE_GENERATION_PROMPT = (
    "Summarize the user's first question as a concise sidebar title in the same language. "
    "Return only the title, without quotes, Markdown, emoji, numbering, punctuation, "
    "explanation, or an answer to the question. Maximum 12 CJK characters or 8 words.\n\n"
    "Question: "
)
TITLE_GENERATION_TOKEN_BUDGETS = (128, 256)

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


class VoiceTranscriptionUnavailableError(RuntimeError):
    """未配置 AssemblyAI 语音转写凭据时抛出。"""

    def __init__(self) -> None:
        super().__init__("Voice transcription is unavailable")


class VoiceTranscriptionTimeoutError(RuntimeError):
    """AssemblyAI 调用超出受限等待时间时抛出。"""

    def __init__(self) -> None:
        super().__init__("Voice transcription timed out")


class VoiceTranscriptionProviderError(RuntimeError):
    """AssemblyAI provider 故障的脱敏领域错误。"""

    def __init__(self) -> None:
        super().__init__("Voice transcription provider failed")


class MediaProviderUnavailableError(RuntimeError):
    """未配置 Agnes 凭据时媒体生成请求不可用。"""

    def __init__(self) -> None:
        super().__init__("Media generation provider is unavailable")


class MediaProviderError(RuntimeError):
    """Agnes 媒体请求失败时向任务 worker 暴露的脱敏错误。"""

    def __init__(self) -> None:
        super().__init__("Media generation provider failed")


@dataclass(frozen=True)
class AgnesImageResult:
    """Agnes 图片 API 返回的临时 provider 输出地址。"""

    url: str


@dataclass(frozen=True)
class AgnesVideoSnapshot:
    """Agnes 视频任务在某次查询时的标准化快照。"""

    provider_task_id: str | None
    video_id: str | None
    status: str
    progress: int
    result_url: str | None
    width: int | None
    height: int | None
    duration_seconds: float | None


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


def _require_assemblyai_string(payload: object, field: str) -> str:
    """从 AssemblyAI 的 JSON 响应中读取非空字符串字段。"""
    if not isinstance(payload, dict):
        raise VoiceTranscriptionProviderError()
    value: object = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        raise VoiceTranscriptionProviderError()
    return value.strip()


def _require_agnes_key() -> str:
    """返回当前运行时 Agnes 密钥，缺失时阻止任何上游请求。"""
    if not settings.agnes_api_key:
        raise MediaProviderUnavailableError()
    return settings.agnes_api_key


def _optional_agnes_string(payload: object, field: str) -> str | None:
    """从 Agnes 响应中读取一个可选非空字符串字段。"""
    if not isinstance(payload, dict):
        return None
    value: object = payload.get(field)
    if not isinstance(value, str) or not value.strip():
        return None
    return value.strip()


def _optional_agnes_int(payload: object, field: str) -> int | None:
    """从 Agnes 响应读取一个合理的非负整数，非法值返回 None。"""
    if not isinstance(payload, dict):
        return None
    value: object = payload.get(field)
    if isinstance(value, bool):
        return None
    if not isinstance(value, (str, bytes, bytearray, int, float)):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _optional_agnes_seconds(payload: object, field: str) -> float | None:
    """从 Agnes 响应读取非负秒数，非法值返回 None。"""
    if not isinstance(payload, dict):
        return None
    value: object = payload.get(field)
    if isinstance(value, bool):
        return None
    if not isinstance(value, (str, bytes, bytearray, int, float)):
        return None
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed >= 0 else None


def _normalize_agnes_video_status(value: str | None) -> str:
    """把 Agnes 的提供商状态收敛为应用媒体任务状态。"""
    normalized = (value or "").strip().lower()
    if normalized in {"queued", "pending", "created"}:
        return "queued"
    if normalized in {"running", "processing", "in_progress", "generating"}:
        return "running"
    if normalized in {"completed", "complete", "succeeded", "success"}:
        return "succeeded"
    if normalized in {"canceled", "cancelled"}:
        return "canceled"
    return "failed"


async def generate_agnes_image(
    prompt: str, *, size: str, ratio: str, image_urls: tuple[str, ...] = ()
) -> AgnesImageResult:
    """调用 Agnes Image 2.1 Flash，返回仅供后端持久化的临时输出 URL。

    图片不会将该 URL 返回给客户端；调用方必须下载、校验并写入 YuanAI 对象存储。
    """
    _require_agnes_key()
    config = PROVIDER_CONFIG["agnes-image-2.1-flash"]
    client = _get_client(config["provider"], config["base_url"])
    try:
        async with asyncio.timeout(settings.media_image_timeout_seconds):
            image_body: dict[str, object] = {"response_format": "url"}
            if image_urls:
                image_body["image"] = list(image_urls)
            response = await client.images.generate(
                model="agnes-image-2.1-flash",
                prompt=prompt,
                size=size,
                # Agnes requires ratio at the top level and its response/image extensions
                # inside extra_body. The OpenAI client merges this mapping into the JSON body.
                extra_body={"ratio": ratio, "extra_body": image_body},
            )
    except TimeoutError as error:
        raise MediaProviderError() from error
    except (OpenAIError, httpx.HTTPError, TypeError, ValueError) as error:
        raise MediaProviderError() from error

    data = getattr(response, "data", None)
    first = data[0] if isinstance(data, list) and data else None
    url = getattr(first, "url", None)
    if not isinstance(url, str) or not url.strip():
        raise MediaProviderError()
    return AgnesImageResult(url=url.strip())


async def _agnes_video_request(
    method: str,
    path: str,
    *,
    json_body: dict[str, object] | None = None,
    params: dict[str, str] | None = None,
) -> object:
    """执行一条受限超时的 Agnes 视频 API 请求并返回 JSON 对象。"""
    api_key = _require_agnes_key()
    try:
        async with httpx.AsyncClient(
            base_url=AGNES_VIDEO_API_BASE_URL,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=settings.media_video_poll_timeout_seconds,
        ) as client:
            if method == "GET":
                response = await client.get(path, params=params)
            else:
                response = await client.post(path, json=json_body)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, TypeError, ValueError) as error:
        raise MediaProviderError() from error


def _video_snapshot(payload: object, fallback_video_id: str | None = None) -> AgnesVideoSnapshot:
    """将 Agnes 视频创建或轮询响应转换为稳定的内部快照。"""
    if not isinstance(payload, dict):
        raise MediaProviderError()
    metadata = payload.get("metadata")
    result_url = _optional_agnes_string(metadata, "url")
    if result_url is None:
        result_url = _optional_agnes_string(payload, "url")
    return AgnesVideoSnapshot(
        provider_task_id=_optional_agnes_string(payload, "task_id"),
        video_id=_optional_agnes_string(payload, "video_id") or fallback_video_id,
        status=_normalize_agnes_video_status(_optional_agnes_string(payload, "status")),
        progress=min(100, _optional_agnes_int(payload, "progress") or 0),
        result_url=result_url,
        width=_optional_agnes_int(payload, "width"),
        height=_optional_agnes_int(payload, "height"),
        duration_seconds=_optional_agnes_seconds(payload, "seconds"),
    )


async def create_agnes_video(
    prompt: str,
    *,
    width: int,
    height: int,
    num_frames: int,
    frame_rate: int,
    image_urls: tuple[str, ...] = (),
) -> AgnesVideoSnapshot:
    """创建 Agnes Video V2.0 异步任务并返回初始标准化快照。"""
    body: dict[str, object] = {
        "model": "agnes-video-v2.0",
        "prompt": prompt,
        "width": width,
        "height": height,
        "num_frames": num_frames,
        "frame_rate": frame_rate,
    }
    if len(image_urls) == 1:
        body["image"] = image_urls[0]
    elif len(image_urls) > 1:
        body["extra_body"] = {"image": list(image_urls), "mode": "keyframes"}
    payload = await _agnes_video_request(
        "POST",
        "/videos",
        json_body=body,
    )
    snapshot = _video_snapshot(payload)
    if snapshot.video_id is None:
        raise MediaProviderError()
    return snapshot


async def get_agnes_video(video_id: str) -> AgnesVideoSnapshot:
    """查询一个 Agnes 视频任务并将结果归一化。"""
    payload = await _agnes_video_request("GET", "/agnesapi", params={"video_id": video_id})
    return _video_snapshot(payload, fallback_video_id=video_id)


async def _poll_assemblyai_transcript(client: httpx.AsyncClient, transcript_id: str) -> str:
    """轮询单个 AssemblyAI 预录制任务，直到得到完成文本或明确失败。"""
    while True:
        response = await client.get(f"/v2/transcript/{transcript_id}")
        response.raise_for_status()
        payload: object = response.json()
        status = _require_assemblyai_string(payload, "status")
        if status == "completed":
            return _require_assemblyai_string(payload, "text")
        if status == "error":
            raise VoiceTranscriptionProviderError()
        await asyncio.sleep(settings.voice_transcription_poll_interval_seconds)


async def transcribe_audio(*, filename: str, content: bytes, mime_type: str) -> str:
    """调用 AssemblyAI Pre-recorded STT 转写一段已完成校验的短音频。

    Args:
        filename: 用于 provider 识别音频容器的原始文件名。
        content: 受限大小的完整音频字节。
        mime_type: 已由上游服务白名单校验的 MIME 类型。

    Returns:
        去除首尾空白后的转写文本。

    Raises:
        VoiceTranscriptionUnavailableError: 未配置 AssemblyAI 凭据。
        VoiceTranscriptionTimeoutError: provider 调用超过配置超时。
        VoiceTranscriptionProviderError: provider 返回错误或空转写。
    """
    del filename
    if not settings.assemblyai_api_key:
        raise VoiceTranscriptionUnavailableError()

    try:
        async with asyncio.timeout(settings.voice_transcription_timeout_seconds):
            async with httpx.AsyncClient(
                base_url=ASSEMBLYAI_API_BASE_URL,
                headers={"authorization": settings.assemblyai_api_key},
                timeout=settings.voice_transcription_timeout_seconds,
            ) as client:
                upload_response = await client.post(
                    "/v2/upload",
                    content=content,
                    headers={"content-type": mime_type},
                )
                upload_response.raise_for_status()
                upload_url = _require_assemblyai_string(upload_response.json(), "upload_url")
                create_response = await client.post(
                    "/v2/transcript",
                    json={
                        "audio_url": upload_url,
                        "speech_models": [ASSEMBLYAI_SPEECH_MODEL],
                    },
                )
                create_response.raise_for_status()
                transcript_id = _require_assemblyai_string(create_response.json(), "id")
                return await _poll_assemblyai_transcript(client, transcript_id)
    except TimeoutError as exc:
        raise VoiceTranscriptionTimeoutError() from exc
    except (httpx.HTTPError, TypeError, ValueError) as exc:
        raise VoiceTranscriptionProviderError() from exc


async def generate_conversation_title(question: str) -> str | None:
    """使用 Agnes 2.5 Flash 为首个问题生成简短标题。

    标题只是界面增强，任何配置或提供商失败均返回 ``None``，调用方必须保留本地
    截断标题。此调用绝不改用其他聊天模型，避免标题功能产生意外费用或改变模型选择。
    """
    if not settings.agnes_api_key or not question.strip():
        return None

    config = PROVIDER_CONFIG["agnes-2.5-flash"]
    client = _get_client(config["provider"], config["base_url"])
    messages = cast(
        list[ChatCompletionMessageParam],
        [{"role": "user", "content": f"{TITLE_GENERATION_PROMPT}{question.strip()}"}],
    )
    try:
        async with asyncio.timeout(TITLE_GENERATION_TIMEOUT_SECONDS):
            for token_budget in TITLE_GENERATION_TOKEN_BUDGETS:
                completion = await client.chat.completions.create(
                    model="agnes-2.5-flash",
                    messages=messages,
                    temperature=0,
                    max_tokens=token_budget,
                    extra_body={"chat_template_kwargs": {"enable_thinking": False}},
                )
                if not completion.choices:
                    return None
                choice = completion.choices[0]
                content = choice.message.content
                if choice.finish_reason != "length":
                    return content if isinstance(content, str) and content.strip() else None
    except (TimeoutError, OpenAIError, httpx.HTTPError, TypeError, ValueError):
        return None
    return None


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
        enable_thinking: 是否开启思考/推理模式（由各 provider 的兼容参数传递）

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
    elif config["provider"] == "agnes":
        # Agnes 2.5 Flash 的 OpenAI-compatible Thinking Mode 参数：
        # https://www.agnes-ai.com/en/docs/agnes-25-flash
        extra_body = {"chat_template_kwargs": {"enable_thinking": enable_thinking}}

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
