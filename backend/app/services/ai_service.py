import asyncio
import html
import json
import re
import uuid
from collections.abc import AsyncGenerator, Awaitable, Callable, Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol, cast

import httpx
from openai import AsyncOpenAI, AsyncStream, OpenAIError
from openai.types.chat import (
    ChatCompletionChunk,
    ChatCompletionMessageParam,
    ChatCompletionStreamOptionsParam,
    ChatCompletionToolParam,
)

from app.core.config import settings
from app.services.tools.search import (
    SearchError,
    SearchRateLimitError,
    get_search_capability,
    normalize_query,
    search_web,
)

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
ELEVENLABS_MUSIC_API_BASE_URL = "https://api.elevenlabs.io"
_LOCAL_MUSIC_MODEL_LOCK = asyncio.Lock()
_LOCAL_MUSIC_PROCESSOR: object | None = None
_LOCAL_MUSIC_MODEL: object | None = None
_LOCAL_MUSIC_DEVICE: str | None = None


class _LocalMusicInputs(Protocol):
    """MusicGen processor 输出的最小输入协议。"""

    def __call__(
        self, *, text: list[str], padding: bool, return_tensors: str
    ) -> "_LocalMusicInputs": ...

    def to(self, device: str) -> Mapping[str, object]: ...


class _LocalMusicAudioEncoder(Protocol):
    """MusicGen 配置中音频编码器的最小协议。"""

    sampling_rate: int


class _LocalMusicConfig(Protocol):
    """MusicGen 模型配置的最小协议。"""

    audio_encoder: _LocalMusicAudioEncoder


class _LocalMusicModel(Protocol):
    """本机 MusicGen 模型的最小协议，避免业务层绑定具体 Transformers 类型。"""

    config: _LocalMusicConfig

    def to(self, device: str) -> "_LocalMusicModel": ...

    def generate(self, **kwargs: object) -> object: ...


TITLE_GENERATION_TIMEOUT_SECONDS = 12
TITLE_GENERATION_PROMPT = (
    "Summarize the user's first question as a concise sidebar title in the same language. "
    "Return only the title, without quotes, Markdown, emoji, numbering, punctuation, "
    "explanation, or an answer to the question. Maximum 12 CJK characters or 8 words.\n\n"
    "Question: "
)
TITLE_GENERATION_TOKEN_BUDGETS = (128, 256)
MAX_TOOL_CALLS = 2
MODEL_STREAM_TIMEOUT_SECONDS = 60.0
MODEL_STREAM_MAX_RETRIES = 2
_TEXT_TOOL_CALL_PATTERN = re.compile(
    r"<tool_call>\s*<function=(?P<name>[A-Za-z_][\w-]*)>\s*"
    r"<parameter=(?P<parameter>[A-Za-z_][\w-]*)>(?P<value>.*?)</parameter>\s*"
    r"</function>\s*</tool_call>",
    re.IGNORECASE | re.DOTALL,
)
_TEXT_TOOL_CALL_OPEN = "<tool_call>"
_TEXT_TOOL_CALL_CLOSE = "</tool_call>"
_DEEPSEEK_DSML_TOKEN = "\uff5c\uff5cDSML\uff5c\uff5c"
_DEEPSEEK_DSML_TOOL_CALL_OPEN = f"<{_DEEPSEEK_DSML_TOKEN}tool_calls>"
_DEEPSEEK_DSML_TOOL_CALL_CLOSE = f"</{_DEEPSEEK_DSML_TOKEN}tool_calls>"
_DEEPSEEK_DSML_TOOL_CALL_BLOCK_PATTERN = re.compile(
    rf"<{re.escape(_DEEPSEEK_DSML_TOKEN)}tool_calls>(?P<body>.*?)"
    rf"</{re.escape(_DEEPSEEK_DSML_TOKEN)}tool_calls>",
    re.DOTALL,
)
_DEEPSEEK_DSML_INVOKE_PATTERN = re.compile(
    rf"<{re.escape(_DEEPSEEK_DSML_TOKEN)}invoke\s+name=[\"'](?P<name>[A-Za-z_][\w-]*)[\"']>\s*"
    rf"<{re.escape(_DEEPSEEK_DSML_TOKEN)}parameter\s+name=[\"']"
    rf"(?P<parameter>[A-Za-z_][\w-]*)[\"'][^>]*>(?P<value>.*?)"
    rf"</{re.escape(_DEEPSEEK_DSML_TOKEN)}parameter>\s*"
    rf"</{re.escape(_DEEPSEEK_DSML_TOKEN)}invoke>",
    re.DOTALL,
)
_TEXT_TOOL_MARKUP_PAIRS = (
    (_TEXT_TOOL_CALL_OPEN, _TEXT_TOOL_CALL_CLOSE),
    (_DEEPSEEK_DSML_TOOL_CALL_OPEN, _DEEPSEEK_DSML_TOOL_CALL_CLOSE),
)

WEB_SEARCH_TOOL = cast(
    ChatCompletionToolParam,
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": (
                "Search current public web sources when fresh factual evidence is needed."
            ),
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string", "minLength": 1, "maxLength": 300}},
                "required": ["query"],
                "additionalProperties": False,
            },
        },
    },
)
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
    """未配置媒体 provider 凭据时媒体生成请求不可用。"""

    def __init__(self) -> None:
        super().__init__("Media generation provider is unavailable")


class MediaLyricsProviderUnavailableError(MediaProviderUnavailableError):
    """本机 ACE-Step 服务未启动或未通过认证。"""

    def __init__(self) -> None:
        super().__init__()


class MediaProviderError(RuntimeError):
    """媒体 provider 请求失败时向任务 worker 暴露的脱敏错误。"""

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


@dataclass(frozen=True, slots=True)
class ThinkingDelta:
    """Provider-neutral reasoning/thinking text increment."""

    token: str


@dataclass(frozen=True, slots=True)
class ContentDelta:
    """Provider-neutral answer text increment."""

    token: str


@dataclass(frozen=True, slots=True)
class ToolCallStart:
    """Provider-neutral start of a model tool call."""

    tool_call_id: str
    name: str


@dataclass(frozen=True, slots=True)
class ToolCallArgumentsDelta:
    """Provider-neutral incremental tool arguments."""

    tool_call_id: str
    args_chunk: str


@dataclass(frozen=True, slots=True)
class ToolCallEnd:
    """Provider-neutral end of a model tool call."""

    tool_call_id: str
    status: str = "done"


@dataclass(frozen=True, slots=True)
class UsageDelta:
    """Provider-neutral token usage update."""

    input_tokens: int
    output_tokens: int
    total_tokens: int


@dataclass(frozen=True, slots=True)
class ModelCompleted:
    """Provider-neutral successful model completion."""

    finish_reason: str = "stop"


@dataclass(frozen=True, slots=True)
class ModelFailed:
    """Provider-neutral terminal model failure with a stable application code."""

    code: str
    message: str
    retryable: bool = False


type ModelMessage = dict[str, object]
type ToolDefinition = dict[str, object]
type ModelEvent = (
    ThinkingDelta
    | ContentDelta
    | ToolCallStart
    | ToolCallArgumentsDelta
    | ToolCallEnd
    | UsageDelta
    | ModelCompleted
    | ModelFailed
)


class _MalformedModelEventError(ValueError):
    """Raised internally when a provider stream cannot be safely normalized."""

    def __init__(self) -> None:
        super().__init__("MODEL_EVENT_MALFORMED")


@dataclass
class _AgentToolCallState:
    """Internal aggregation state for one provider tool-call index."""

    tool_call_id: str
    started: bool = False
    ended: bool = False


@dataclass
class _PendingToolCall:
    """流式 OpenAI tool delta 聚合到一次完整调用的内部状态。"""

    id: str
    name: str = ""
    arguments: str = ""
    started: bool = False


class _TextToolCallMarkupFilter:
    """跨 SSE 分片剥离模型错误输出的 XML 或 DSML 工具标签。"""

    def __init__(self) -> None:
        self._buffer = ""

    def push(self, text: str) -> list[str]:
        """接收一个正文分片，返回当前已能确认安全展示的正文。"""
        self._buffer += text
        output: list[str] = []
        while self._buffer:
            markup_pair = self._find_markup_pair()
            if markup_pair is None:
                suffix_length = self._open_tag_prefix_length()
                visible_end = len(self._buffer) - suffix_length
                if visible_end > 0:
                    output.append(self._buffer[:visible_end])
                    self._buffer = self._buffer[visible_end:]
                break
            start, _, close_tag = markup_pair
            if start > 0:
                output.append(self._buffer[:start])
                self._buffer = self._buffer[start:]
                continue
            end = self._buffer.lower().find(close_tag.lower())
            if end < 0:
                break
            self._buffer = self._buffer[end + len(close_tag) :]
        return output

    def flush(self) -> list[str]:
        """流结束时输出非标签残留，并丢弃不完整工具标签。"""
        if any(
            self._buffer.lower().startswith(open_tag.lower())
            for open_tag, _ in _TEXT_TOOL_MARKUP_PAIRS
        ):
            self._buffer = ""
            return []
        output = [self._buffer] if self._buffer else []
        self._buffer = ""
        return output

    def _open_tag_prefix_length(self) -> int:
        """保留可能在下一个分片补全的工具标签前缀。"""
        max_open_length = max(len(open_tag) for open_tag, _ in _TEXT_TOOL_MARKUP_PAIRS)
        max_length = min(len(self._buffer), max_open_length - 1)
        lower_buffer = self._buffer.lower()
        for length in range(max_length, 0, -1):
            if any(
                open_tag.lower().startswith(lower_buffer[-length:])
                for open_tag, _ in _TEXT_TOOL_MARKUP_PAIRS
            ):
                return length
        return 0

    def _find_markup_pair(self) -> tuple[int, str, str] | None:
        """返回缓冲区中最早出现的受限工具标签及其闭合标签。"""
        lower_buffer = self._buffer.lower()
        matches = [
            (index, open_tag, close_tag)
            for open_tag, close_tag in _TEXT_TOOL_MARKUP_PAIRS
            if (index := lower_buffer.find(open_tag.lower())) >= 0
        ]
        return min(matches, default=None, key=lambda match: match[0])


def _parse_text_tool_calls(content: str) -> list[_PendingToolCall]:
    """将 OpenAI 兼容服务返回的文本工具标签转为受限内部调用。"""
    calls: list[_PendingToolCall] = []
    for index, match in enumerate(_TEXT_TOOL_CALL_PATTERN.finditer(content)):
        name = match.group("name")
        parameter = match.group("parameter")
        value = html.unescape(match.group("value")).strip()
        if not value:
            continue
        calls.append(
            _PendingToolCall(
                id=f"text-tool-{index}",
                name=name,
                arguments=json.dumps({parameter: value}, ensure_ascii=False),
            )
        )
    for block in _DEEPSEEK_DSML_TOOL_CALL_BLOCK_PATTERN.finditer(content):
        for match in _DEEPSEEK_DSML_INVOKE_PATTERN.finditer(block.group("body")):
            name = match.group("name")
            parameter = match.group("parameter")
            value = html.unescape(match.group("value")).strip()
            if not value:
                continue
            calls.append(
                _PendingToolCall(
                    id=f"text-tool-{len(calls)}",
                    name=name,
                    arguments=json.dumps({parameter: value}, ensure_ascii=False),
                )
            )
    return calls


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
        m
        for m in AVAILABLE_MODELS
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


async def generate_huggingface_music(
    prompt: str, *, duration_ms: int = 30_000
) -> tuple[bytes, str]:
    """调用 Hugging Face MusicGen，等待模型加载并返回音频字节。"""
    token = settings.hf_token
    if not token:
        raise MediaProviderUnavailableError()
    if duration_ms != 30_000:
        raise MediaProviderError()

    endpoint = (
        f"{settings.huggingface_music_base_url.rstrip('/')}/{settings.huggingface_music_model}"
    )
    attempts = max(1, settings.media_music_max_attempts)
    delay = max(0.5, settings.media_music_retry_delay_seconds)
    try:
        async with asyncio.timeout(settings.media_music_timeout_seconds):
            async with httpx.AsyncClient(
                timeout=settings.media_music_timeout_seconds, trust_env=True
            ) as client:
                for attempt in range(attempts):
                    response = await client.post(
                        endpoint,
                        headers={"Authorization": f"Bearer {token}", "Accept": "audio/wav"},
                        json={
                            "inputs": prompt,
                            "parameters": {"max_new_tokens": 1_500},
                        },
                    )
                    if response.status_code == 200:
                        mime_type = (
                            response.headers.get("content-type", "").split(";", 1)[0].lower()
                        )
                        supported_types = {
                            "audio/wav",
                            "audio/x-wav",
                            "audio/flac",
                            "audio/mpeg",
                        }
                        if mime_type in supported_types and response.content:
                            return response.content, mime_type
                        raise MediaProviderError()

                    retryable = response.status_code in {408, 429, 500, 502, 503, 504}
                    if not retryable or attempt == attempts - 1:
                        raise MediaProviderError()

                    retry_after = response.headers.get("retry-after")
                    wait_seconds = delay * (2**attempt)
                    try:
                        if retry_after is not None:
                            wait_seconds = max(wait_seconds, min(30.0, float(retry_after)))
                    except ValueError:
                        pass
                    await asyncio.sleep(min(30.0, wait_seconds))
    except TimeoutError as error:
        raise MediaProviderError() from error
    except (httpx.HTTPError, TypeError, ValueError) as error:
        raise MediaProviderError() from error
    raise MediaProviderError()


class _AceStepRetryableError(RuntimeError):
    """ACE-Step 的限流或暂时性 HTTP 故障，交由调用方继续轮询。"""


def _ace_step_retry_after(response: httpx.Response, default: float) -> float:
    """读取 ACE-Step 的 Retry-After，并限制单次等待时间。"""
    retry_after = response.headers.get("retry-after")
    if retry_after is not None:
        try:
            return min(30.0, max(default, float(retry_after)))
        except ValueError:
            pass
    return min(30.0, default)


def _ace_step_payload(response: httpx.Response) -> object:
    """解析 ACE-Step 统一响应包，拒绝不完整的成功响应。"""
    try:
        payload = cast(object, response.json())
    except (TypeError, ValueError) as error:
        raise MediaProviderError() from error
    if not isinstance(payload, dict):
        raise MediaProviderError()
    code = payload.get("code")
    if isinstance(code, int) and code != 200:
        raise MediaProviderError()
    return payload.get("data")


async def _ace_step_post_json(
    client: httpx.AsyncClient,
    path: str,
    body: dict[str, object],
    *,
    unavailable_on_connect: bool = True,
) -> object:
    """向 ACE-Step 发出有限重试的 JSON 请求。"""
    attempts = max(1, settings.ace_step_max_attempts)
    delay = max(0.5, settings.media_music_retry_delay_seconds)
    for attempt in range(attempts):
        try:
            response = await client.post(path, json=body)
        except (httpx.ConnectError, httpx.ConnectTimeout) as error:
            if attempt == attempts - 1:
                if unavailable_on_connect:
                    raise MediaLyricsProviderUnavailableError() from error
                raise _AceStepRetryableError() from error
            await asyncio.sleep(min(30.0, delay * (2**attempt)))
            continue
        except httpx.HTTPError as error:
            if attempt == attempts - 1:
                raise MediaProviderError() from error
            await asyncio.sleep(min(30.0, delay * (2**attempt)))
            continue

        if response.status_code in {401, 403}:
            raise MediaLyricsProviderUnavailableError()
        if response.status_code in {408, 425, 429, 500, 502, 503, 504}:
            if attempt == attempts - 1:
                raise _AceStepRetryableError()
            await asyncio.sleep(_ace_step_retry_after(response, delay * (2**attempt)))
            continue
        if response.status_code < 200 or response.status_code >= 300:
            raise MediaProviderError()
        return _ace_step_payload(response)
    raise MediaProviderError()


def _ace_step_task_id(payload: object) -> str:
    """从提交响应中提取不透明的 ACE-Step 任务 ID。"""
    if isinstance(payload, dict):
        task_id = payload.get("task_id")
        if isinstance(task_id, str) and task_id.strip():
            return task_id.strip()
    raise MediaProviderError()


def _ace_step_result_item(payload: object, task_id: str) -> dict[str, object]:
    """提取查询响应中指定任务的结果项。"""
    if not isinstance(payload, list):
        raise MediaProviderError()
    for item in payload:
        if not isinstance(item, dict):
            continue
        item_task_id = item.get("task_id")
        if item_task_id is None or str(item_task_id) == task_id:
            return item
    raise MediaProviderError()


def _ace_step_result_data(item: dict[str, object]) -> dict[str, object]:
    """解析 ACE-Step result 字段中的 JSON 字符串或对象。"""
    result = item.get("result")
    if isinstance(result, str):
        try:
            result = json.loads(result)
        except (TypeError, ValueError):
            raise MediaProviderError() from None
    if isinstance(result, list) and result and isinstance(result[0], dict):
        return cast(dict[str, object], result[0])
    if isinstance(result, dict):
        return cast(dict[str, object], result)
    return item


def _ace_step_progress(item: dict[str, object], result: dict[str, object]) -> int | None:
    """读取 ACE-Step 返回的可选百分比进度。"""
    for source in (item, result):
        value = source.get("progress")
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return max(0, min(95, int(value)))
    return None


def _ace_step_audio_location(audio_path: str) -> tuple[str, dict[str, str]]:
    """将 ACE-Step 返回的音频引用限制为本机 `/v1/audio` 路由。"""
    parsed = httpx.URL(audio_path)
    if parsed.is_absolute_url:
        configured = httpx.URL(settings.ace_step_base_url)
        if (
            parsed.scheme != configured.scheme
            or parsed.host != configured.host
            or parsed.port != configured.port
        ):
            raise MediaProviderError()
    if parsed.path == "/v1/audio" and parsed.params:
        return parsed.path, dict(parsed.params.multi_items())
    if parsed.path.startswith("/") and parsed.path != "/v1/audio":
        raise MediaProviderError()
    return "/v1/audio", {"path": audio_path}


async def generate_ace_step_music(
    prompt: str,
    lyrics: str,
    *,
    duration_ms: int = 30_000,
    provider_task_id: str | None = None,
    on_progress: Callable[[int], Awaitable[None]] | None = None,
    on_task_id: Callable[[str], Awaitable[None]] | None = None,
) -> tuple[bytes, str]:
    """通过本机 ACE-Step 异步 REST API 生成带歌词的 MP3。"""
    if duration_ms != 30_000 or not lyrics.strip():
        raise MediaProviderError()
    headers = {"Accept": "application/json"}
    if settings.ace_step_api_key.strip():
        headers["Authorization"] = f"Bearer {settings.ace_step_api_key.strip()}"
    language = "zh" if re.search(r"[\u3400-\u9fff]", lyrics) else "en"
    request_body: dict[str, object] = {
        "prompt": prompt,
        "lyrics": lyrics,
        "thinking": False,
        "model": settings.ace_step_model,
        "vocal_language": language,
        "audio_duration": duration_ms / 1_000,
        "audio_format": "mp3",
        "task_type": "text2music",
        "inference_steps": 8,
        "batch_size": 1,
        "use_cot_caption": False,
        "use_cot_language": False,
    }
    timeout = max(30.0, float(settings.ace_step_timeout_seconds))
    poll_interval = max(1.0, settings.ace_step_poll_interval_seconds)
    poll_failures = 0
    last_progress = 5
    try:
        async with asyncio.timeout(timeout):
            async with httpx.AsyncClient(
                base_url=settings.ace_step_base_url.rstrip("/"),
                headers=headers,
                timeout=min(timeout, 60.0),
                trust_env=False,
            ) as client:
                task_id = provider_task_id
                if task_id is None:
                    try:
                        payload = await _ace_step_post_json(client, "/release_task", request_body)
                    except _AceStepRetryableError as error:
                        raise MediaProviderError() from error
                    task_id = _ace_step_task_id(payload)
                    if on_task_id is not None:
                        await on_task_id(task_id)
                    if on_progress is not None:
                        await on_progress(8)

                while True:
                    try:
                        payload = await _ace_step_post_json(
                            client,
                            "/query_result",
                            {"task_id_list": [task_id]},
                            unavailable_on_connect=False,
                        )
                        poll_failures = 0
                    except _AceStepRetryableError:
                        poll_failures += 1
                        if poll_failures >= max(1, settings.ace_step_max_poll_failures):
                            raise MediaProviderError() from None
                        await asyncio.sleep(poll_interval)
                        continue

                    item = _ace_step_result_item(payload, task_id)
                    result = _ace_step_result_data(item)
                    status = item.get("status", result.get("status"))
                    progress = _ace_step_progress(item, result)
                    if progress is None:
                        progress = min(92, last_progress + 4)
                    last_progress = max(last_progress, progress)
                    if on_progress is not None:
                        await on_progress(last_progress)
                    if status in {2, "failed", "error", "canceled"}:
                        raise MediaProviderError()
                    if status in {1, "succeeded", "success"}:
                        audio_path = (
                            result.get("file")
                            or result.get("audio_path")
                            or result.get("audio_url")
                        )
                        if not isinstance(audio_path, str) or not audio_path.strip():
                            raise MediaProviderError()
                        try:
                            audio_route, audio_params = _ace_step_audio_location(audio_path)
                            audio_response = await client.get(audio_route, params=audio_params)
                            audio_response.raise_for_status()
                        except (httpx.HTTPError, TypeError, ValueError) as error:
                            raise MediaProviderError() from error
                        mime_type = (
                            audio_response.headers.get("content-type", "").split(";", 1)[0].lower()
                        )
                        if (
                            mime_type
                            not in {
                                "audio/mpeg",
                                "audio/wav",
                                "audio/x-wav",
                                "audio/flac",
                            }
                            or not audio_response.content
                            or len(audio_response.content) > settings.media_max_output_bytes
                        ):
                            raise MediaProviderError()
                        return audio_response.content, "audio/mpeg"
                    await asyncio.sleep(poll_interval)
    except TimeoutError as error:
        raise MediaProviderError() from error


def _local_music_device() -> str:
    """解析本机音乐模型设备配置，默认优先使用 CUDA。"""
    configured = settings.media_music_local_device.strip().lower()
    if configured in {"cpu", "cuda"}:
        return configured
    try:
        import torch

        return "cuda" if torch.cuda.is_available() else "cpu"
    except ImportError:
        return "cpu"


async def _generate_local_music_unbounded(
    prompt: str, *, duration_ms: int = 30_000
) -> tuple[bytes, str]:
    """使用本机 Hugging Face MusicGen 生成固定 30 秒 WAV 音频。"""
    if duration_ms != 30_000:
        raise MediaProviderError()
    try:
        import numpy as np
        import soundfile as sf
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration
    except ImportError as error:
        raise MediaProviderUnavailableError() from error

    async with _LOCAL_MUSIC_MODEL_LOCK:
        global _LOCAL_MUSIC_DEVICE, _LOCAL_MUSIC_MODEL, _LOCAL_MUSIC_PROCESSOR
        device = _local_music_device()
        if (
            _LOCAL_MUSIC_MODEL is None
            or _LOCAL_MUSIC_PROCESSOR is None
            or _LOCAL_MUSIC_DEVICE != device
        ):
            try:
                _LOCAL_MUSIC_PROCESSOR = await asyncio.to_thread(
                    AutoProcessor.from_pretrained,
                    settings.media_music_local_model,
                    local_files_only=settings.media_music_local_files_only,
                )
                dtype = torch.float16 if device == "cuda" else torch.float32
                _LOCAL_MUSIC_MODEL = await asyncio.to_thread(
                    MusicgenForConditionalGeneration.from_pretrained,
                    settings.media_music_local_model,
                    torch_dtype=dtype,
                    low_cpu_mem_usage=True,
                    local_files_only=settings.media_music_local_files_only,
                )
                local_model = cast(_LocalMusicModel, _LOCAL_MUSIC_MODEL)
                _LOCAL_MUSIC_MODEL = await asyncio.to_thread(local_model.to, device)
                _LOCAL_MUSIC_DEVICE = device
            except (OSError, RuntimeError, ValueError) as error:
                _LOCAL_MUSIC_MODEL = None
                _LOCAL_MUSIC_PROCESSOR = None
                _LOCAL_MUSIC_DEVICE = None
                raise MediaProviderError() from error

        processor = cast(_LocalMusicInputs, _LOCAL_MUSIC_PROCESSOR)
        model = cast(_LocalMusicModel, _LOCAL_MUSIC_MODEL)
        if processor is None or model is None:
            raise MediaProviderError()

        try:
            inputs = await asyncio.to_thread(
                processor,
                text=[prompt],
                padding=True,
                return_tensors="pt",
            )
            model_inputs = inputs.to(device)
            with torch.inference_mode():
                audio_values = await asyncio.to_thread(
                    model.generate,
                    **model_inputs,
                    do_sample=True,
                    guidance_scale=3.0,
                    max_new_tokens=settings.media_music_local_max_new_tokens,
                )
            audio: np.ndarray = audio_values[0, 0].detach().float().cpu().numpy()  # type: ignore[index]
            sample_rate = model.config.audio_encoder.sampling_rate
            with TemporaryDirectory(prefix="yuanai-music-") as temporary_directory:
                temporary_path = Path(temporary_directory) / "output.wav"
                await asyncio.to_thread(sf.write, temporary_path, audio, sample_rate)
                data = await asyncio.to_thread(temporary_path.read_bytes)
            return data, "audio/wav"
        except (OSError, RuntimeError, TypeError, ValueError) as error:
            raise MediaProviderError() from error


async def generate_local_music(prompt: str, *, duration_ms: int = 30_000) -> tuple[bytes, str]:
    """使用本机 MusicGen 生成音频，并在模型加载或推理超时时收口任务。"""
    try:
        async with asyncio.timeout(settings.media_music_timeout_seconds):
            return await _generate_local_music_unbounded(prompt, duration_ms=duration_ms)
    except TimeoutError as error:
        raise MediaProviderError() from error


async def generate_elevenlabs_music(prompt: str, *, duration_ms: int = 30_000) -> tuple[bytes, str]:
    """调用 ElevenLabs Music API，返回待写入对象存储的 MP3 字节。"""
    api_key = settings.elevenlabs_api_key
    if not api_key:
        raise MediaProviderUnavailableError()
    if duration_ms != 30_000:
        raise MediaProviderError()

    try:
        async with asyncio.timeout(settings.media_music_timeout_seconds):
            async with httpx.AsyncClient(
                base_url=ELEVENLABS_MUSIC_API_BASE_URL,
                timeout=settings.media_music_timeout_seconds,
            ) as client:
                response = await client.post(
                    "/v1/music",
                    params={"output_format": "mp3_44100_128"},
                    headers={"xi-api-key": api_key},
                    json={
                        "prompt": prompt,
                        "music_length_ms": duration_ms,
                        "model_id": "music_v1",
                        "force_instrumental": True,
                    },
                )
                response.raise_for_status()
    except TimeoutError as error:
        raise MediaProviderError() from error
    except (httpx.HTTPError, TypeError, ValueError) as error:
        raise MediaProviderError() from error

    mime_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
    if mime_type != "audio/mpeg" or not response.content:
        raise MediaProviderError()
    return response.content, mime_type


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


def _chat_extra_body(provider: str, enable_thinking: bool) -> dict[str, object] | None:
    """构造 provider 特有的思考开关，工具调用和普通流共享这一配置。"""
    if provider == "deepseek":
        return {
            "thinking": {
                "type": "enabled" if enable_thinking else "disabled",
                "budget_tokens": 8000,
            }
        }
    if provider == "agnes":
        return {"chat_template_kwargs": {"enable_thinking": enable_thinking}}
    return None


async def _create_chat_stream(
    client: AsyncOpenAI,
    *,
    model: str,
    messages: list[ChatCompletionMessageParam],
    extra_body: dict[str, object] | None,
    tools: list[ChatCompletionToolParam] | None = None,
    stream_options: ChatCompletionStreamOptionsParam | None = None,
) -> AsyncStream[ChatCompletionChunk]:
    """在保持 provider 思考参数的同时创建 OpenAI-compatible SSE 流。"""
    if tools is None and extra_body is None:
        return await client.chat.completions.create(model=model, messages=messages, stream=True)
    if tools is None:
        return await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            extra_body=extra_body,
        )
    if stream_options is None:
        return await client.chat.completions.create(
            model=model,
            messages=messages,
            stream=True,
            extra_body=extra_body,
            tools=tools,
        )
    return await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
        extra_body=extra_body,
        tools=tools,
        stream_options=stream_options,
    )


def _provider_value(value: object, field: str, default: object = None) -> object:
    """读取 OpenAI-compatible 对象或映射中的字段，不把 provider 类型外泄。"""
    if isinstance(value, Mapping):
        return value.get(field, default)
    return getattr(value, field, default)


def _provider_non_negative_int(value: object) -> int | None:
    """把 provider usage 字段收敛为非负整数。"""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return None
    return value


def _normalize_usage(value: object) -> UsageDelta | None:
    """把 provider usage 对象转换为稳定的 token 计数事件。"""
    if value is None:
        return None
    input_tokens = _provider_non_negative_int(_provider_value(value, "prompt_tokens"))
    output_tokens = _provider_non_negative_int(_provider_value(value, "completion_tokens"))
    total_tokens = _provider_non_negative_int(_provider_value(value, "total_tokens"))
    if input_tokens is None and output_tokens is None and total_tokens is None:
        return None
    input_count = input_tokens or 0
    output_count = output_tokens or 0
    total_count = total_tokens if total_tokens is not None else input_count + output_count
    return UsageDelta(
        input_tokens=input_count,
        output_tokens=output_count,
        total_tokens=total_count,
    )


async def _normalize_agent_stream(
    stream: AsyncGenerator[object, None],
) -> AsyncGenerator[ModelEvent, None]:
    """将一个 provider 流转换成不含 SDK 对象的 Agent 事件流。"""
    pending: dict[int, _AgentToolCallState] = {}
    finish_reason = "stop"
    observed_event = False

    async for chunk in stream:
        choices_value = _provider_value(chunk, "choices")
        usage_event = _normalize_usage(_provider_value(chunk, "usage"))
        if not isinstance(choices_value, (list, tuple)):
            raise _MalformedModelEventError()
        if not choices_value:
            if usage_event is None:
                raise _MalformedModelEventError()
            observed_event = True
            yield usage_event
            continue

        choice = choices_value[0]
        delta = _provider_value(choice, "delta")
        if delta is None:
            raise _MalformedModelEventError()
        observed_event = True

        reasoning = _provider_value(delta, "reasoning_content")
        if reasoning is None:
            reasoning = _provider_value(delta, "thinking")
        if isinstance(reasoning, str) and reasoning:
            yield ThinkingDelta(token=reasoning)

        content = _provider_value(delta, "content")
        if isinstance(content, str) and content:
            yield ContentDelta(token=content)

        tool_deltas = _provider_value(delta, "tool_calls")
        if tool_deltas is not None:
            if not isinstance(tool_deltas, (list, tuple)):
                raise _MalformedModelEventError()
            for tool_delta in tool_deltas:
                function = _provider_value(tool_delta, "function")
                if function is None:
                    raise _MalformedModelEventError()
                index_value = _provider_value(tool_delta, "index", 0)
                index = index_value if isinstance(index_value, int) else 0
                call_id_value = _provider_value(tool_delta, "id")
                call_id = (
                    call_id_value
                    if isinstance(call_id_value, str) and call_id_value
                    else f"tool-{index}"
                )
                state = pending.get(index)
                if state is None:
                    state = _AgentToolCallState(tool_call_id=call_id)
                    pending[index] = state
                name = _provider_value(function, "name")
                if isinstance(name, str) and name and not state.started:
                    state.started = True
                    yield ToolCallStart(tool_call_id=state.tool_call_id, name=name)
                arguments = _provider_value(function, "arguments")
                if arguments is not None and not isinstance(arguments, str):
                    raise _MalformedModelEventError()
                if isinstance(arguments, str) and arguments:
                    if not state.started:
                        raise _MalformedModelEventError()
                    yield ToolCallArgumentsDelta(
                        tool_call_id=state.tool_call_id,
                        args_chunk=arguments,
                    )

        chunk_finish_reason = _provider_value(choice, "finish_reason")
        if isinstance(chunk_finish_reason, str) and chunk_finish_reason:
            finish_reason = chunk_finish_reason
            if chunk_finish_reason == "tool_calls":
                for state in pending.values():
                    if state.started and not state.ended:
                        state.ended = True
                        yield ToolCallEnd(tool_call_id=state.tool_call_id)
        if usage_event is not None:
            yield usage_event

    if not observed_event:
        raise _MalformedModelEventError()
    for state in pending.values():
        if state.started and not state.ended:
            yield ToolCallEnd(tool_call_id=state.tool_call_id)
    yield ModelCompleted(finish_reason=finish_reason)


async def stream_agent(
    model: str,
    messages: list[ModelMessage],
    tools: list[ToolDefinition],
    *,
    enable_thinking: bool = False,
) -> AsyncGenerator[ModelEvent, None]:
    """发送 Agent 模型流，并把 provider 事件归一化为稳定领域事件。

    Provider SDK 类型只存在于本模块内部；调用方只能接收 ``ModelEvent`` 联合中的
    不可变数据类。初始请求和尚未产生事件的 provider 故障最多重试两次，超时或
    重试耗尽则输出稳定的 ``ModelFailed`` 事件。
    """
    config = PROVIDER_CONFIG.get(model)
    if not config:
        raise ValueError(f"Unsupported model: {model}")
    if config.get("kind", "chat") != "chat":
        raise ValueError(f"Model {model} is not a chat model")
    if _has_image_input(messages) and not _model_supports_vision(model):
        raise ModelVisionUnsupportedError()

    client = _get_client(config["provider"], config["base_url"])
    provider_messages = cast(list[ChatCompletionMessageParam], messages)
    provider_tools = cast(list[ChatCompletionToolParam], tools)
    extra_body = _chat_extra_body(config["provider"], enable_thinking)

    for attempt in range(MODEL_STREAM_MAX_RETRIES + 1):
        emitted_event = False
        try:
            async with asyncio.timeout(MODEL_STREAM_TIMEOUT_SECONDS):
                stream = await _create_chat_stream(
                    client,
                    model=model,
                    messages=provider_messages,
                    extra_body=extra_body,
                    tools=provider_tools,
                    stream_options=cast(
                        ChatCompletionStreamOptionsParam,
                        {"include_usage": True},
                    ),
                )
                normalized_stream = cast(AsyncGenerator[object, None], stream)
                async for event in _normalize_agent_stream(normalized_stream):
                    emitted_event = True
                    yield event
            return
        except _MalformedModelEventError:
            yield ModelFailed(
                code="MODEL_EVENT_MALFORMED",
                message="模型返回了无效事件",
            )
            return
        except TimeoutError:
            if not emitted_event and attempt < MODEL_STREAM_MAX_RETRIES:
                continue
            yield ModelFailed(code="MODEL_TIMEOUT", message="模型调用超时")
            return
        except (OpenAIError, httpx.HTTPError, RuntimeError, TypeError, ValueError):
            if not emitted_event and attempt < MODEL_STREAM_MAX_RETRIES:
                continue
            yield ModelFailed(
                code="MODEL_PROVIDER_ERROR",
                message="模型提供商调用失败",
            )
            return


async def _stream_web_search_round(
    *,
    client: AsyncOpenAI,
    model: str,
    messages: list[ChatCompletionMessageParam],
    extra_body: dict[str, object] | None,
    user_id: uuid.UUID,
) -> AsyncGenerator[tuple[str, str | dict[str, object]], None]:
    """执行一个受限搜索工具轮，再继续生成最终自然语言回答。"""
    first_stream = await _create_chat_stream(
        client,
        model=model,
        messages=messages,
        extra_body=extra_body,
        tools=[WEB_SEARCH_TOOL],
    )
    pending: dict[int, _PendingToolCall] = {}
    text_tool_call_content: list[str] = []

    async for chunk in first_stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta is None:
            continue
        reasoning: str | None = getattr(delta, "reasoning_content", None)
        if reasoning:
            yield ("thinking", reasoning)
        if isinstance(delta.content, str) and delta.content:
            # 少数 OpenAI 兼容服务将工具调用编码为 XML/DSML 正文；先完整聚合，避免
            # 标签被切到多个 SSE 分片时泄漏为回答正文。
            text_tool_call_content.append(delta.content)
        tool_deltas = getattr(delta, "tool_calls", None)
        if not isinstance(tool_deltas, list):
            continue
        for tool_delta in tool_deltas:
            index_value = getattr(tool_delta, "index", 0)
            index = index_value if isinstance(index_value, int) else 0
            call_id = getattr(tool_delta, "id", None)
            existing = pending.get(index)
            if existing is None:
                existing = _PendingToolCall(
                    id=call_id if isinstance(call_id, str) and call_id else f"search-{index}",
                )
                pending[index] = existing
            function = getattr(tool_delta, "function", None)
            name = getattr(function, "name", None)
            if isinstance(name, str) and name:
                existing.name = name
                if not existing.started:
                    existing.started = True
                    yield (
                        "tool_call_start",
                        {"tool_call_id": existing.id, "name": existing.name},
                    )
            arguments = getattr(function, "arguments", None)
            if isinstance(arguments, str) and arguments:
                existing.arguments += arguments
                yield (
                    "tool_call_delta",
                    {"tool_call_id": existing.id, "args_chunk": arguments},
                )

    text_tool_calls = _parse_text_tool_calls("".join(text_tool_call_content))
    if text_tool_calls and not pending:
        next_index = max(pending, default=-1) + 1
        for call in text_tool_calls[:MAX_TOOL_CALLS]:
            pending[next_index] = call
            next_index += 1
            call.started = True
            yield ("tool_call_start", {"tool_call_id": call.id, "name": call.name})
            yield (
                "tool_call_delta",
                {"tool_call_id": call.id, "args_chunk": call.arguments},
            )

    calls = [call for _, call in sorted(pending.items()) if call.name][:MAX_TOOL_CALLS]
    if not calls:
        for content in text_tool_call_content:
            yield ("content", content)
        return

    # DeepSeek 等 provider 可能在原生 tool_calls 前先输出一句计划说明，
    # 或把工具调用标签混在正文分片中。它不是最终回答，应进入思考区；
    # 只要已经拿到结构化工具调用，就继续执行，不再误报 INVALID_TOOL_SEQUENCE。
    if text_tool_call_content:
        markup_filter = _TextToolCallMarkupFilter()
        for content in text_tool_call_content:
            for visible_content in markup_filter.push(content):
                yield ("thinking", visible_content)
        for visible_content in markup_filter.flush():
            yield ("thinking", visible_content)

    assistant_calls = [
        {
            "id": call.id,
            "type": "function",
            "function": {"name": call.name, "arguments": call.arguments},
        }
        for call in calls
    ]
    tool_messages: list[ChatCompletionMessageParam] = [
        cast(ChatCompletionMessageParam, {"role": "assistant", "tool_calls": assistant_calls})
    ]

    for call in calls:
        started_at = asyncio.get_running_loop().time()
        end_payload: dict[str, object] = {"tool_call_id": call.id}
        tool_content: str
        if call.name != "search_web":
            end_payload.update({"status": "error", "error": "WEB_SEARCH_UNKNOWN_TOOL"})
            tool_content = json.dumps({"error": "WEB_SEARCH_UNKNOWN_TOOL"})
        else:
            try:
                arguments = json.loads(call.arguments)
                query = arguments.get("query") if isinstance(arguments, dict) else None
                if not isinstance(query, str):
                    raise SearchError("WEB_SEARCH_INVALID_QUERY")
                sources = await search_web(user_id=user_id, query=normalize_query(query))
                source_payload = [asdict(source) for source in sources]
                end_payload.update(
                    {
                        "status": "done",
                        "result": f"已检索 {len(sources)} 条网页来源",
                        "sources": source_payload,
                    }
                )
                tool_content = json.dumps({"sources": source_payload}, ensure_ascii=False)
            except (json.JSONDecodeError, SearchError) as exc:
                error_code = str(exc) or "WEB_SEARCH_UNAVAILABLE"
                if isinstance(exc, SearchRateLimitError):
                    error_code = "WEB_SEARCH_RATE_LIMITED"
                end_payload.update({"status": "error", "error": error_code})
                tool_content = json.dumps({"error": error_code})
        end_payload["duration_ms"] = int((asyncio.get_running_loop().time() - started_at) * 1000)
        yield ("tool_call_end", end_payload)
        tool_messages.append(
            cast(
                ChatCompletionMessageParam,
                {"role": "tool", "tool_call_id": call.id, "content": tool_content},
            )
        )

    final_stream = await _create_chat_stream(
        client,
        model=model,
        messages=[*messages, *tool_messages],
        extra_body=extra_body,
    )
    markup_filter = _TextToolCallMarkupFilter()
    async for chunk in final_stream:
        delta = chunk.choices[0].delta if chunk.choices else None
        if delta is None:
            continue
        reasoning = getattr(delta, "reasoning_content", None)
        if isinstance(reasoning, str) and reasoning:
            yield ("thinking", reasoning)
        if isinstance(delta.content, str) and delta.content:
            for visible_content in markup_filter.push(delta.content):
                yield ("content", visible_content)
    for visible_content in markup_filter.flush():
        yield ("content", visible_content)


async def stream_chat(
    model: str,
    messages: list[dict[str, object]],
    enable_thinking: bool = False,
    enable_web_search: bool = False,
    user_id: uuid.UUID | None = None,
) -> AsyncGenerator[tuple[str, str | dict[str, object]], None]:
    """向 AI 提供商发送流式聊天请求，逐 token yield 事件元组。

    使用模块级单例 client（_get_client），避免每请求创建/销毁 AsyncOpenAI 实例，
    从根本上消除 GC 触发 AsyncHttpxClientWrapper.__del__ 调度孤立 aclose() task
    导致 "Task exception was never retrieved" 的竞态问题。

    Args:
        model: 模型 ID（须在 PROVIDER_CONFIG 中注册）
        messages: OpenAI 格式的消息列表
        enable_thinking: 是否开启思考/推理模式（由各 provider 的兼容参数传递）

    Yields:
        tuple[str, str | dict[str, object]]: (event_type, token)
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

    extra_body = _chat_extra_body(config["provider"], enable_thinking)
    provider_messages = cast(list[ChatCompletionMessageParam], messages)
    if enable_web_search and user_id is not None:
        capability = await get_search_capability()
        if capability.enabled:
            async for event in _stream_web_search_round(
                client=client,
                model=model,
                messages=provider_messages,
                extra_body=extra_body,
                user_id=user_id,
            ):
                yield event
            return

    stream = await _create_chat_stream(
        client,
        model=model,
        messages=provider_messages,
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
