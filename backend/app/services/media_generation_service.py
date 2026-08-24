"""媒体生成任务的持久化、执行、恢复和权限服务。"""

from __future__ import annotations

import asyncio
import logging
import uuid
from asyncio.subprocess import DEVNULL
from datetime import UTC, datetime, timedelta
from pathlib import Path
from subprocess import SubprocessError
from tempfile import TemporaryDirectory
from typing import cast

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.conversation import Conversation
from app.models.file import File, MessageFile
from app.models.media_generation_task import (
    MediaGenerationStatus,
    MediaGenerationTask,
    MediaGenerationType,
)
from app.models.message import Message, MessageRole
from app.schemas.media_generation import CreateMediaGenerationRequest
from app.services.ai_service import (
    MediaProviderError,
    MediaProviderUnavailableError,
    create_agnes_video,
    generate_agnes_image,
    generate_elevenlabs_music,
    get_agnes_video,
)
from app.services.push_service import send_to_user
from app.services.storage_service import storage

logger = logging.getLogger(__name__)

IMAGE_DEFAULT_OPTIONS: dict[str, str | int] = {"size": "1K", "ratio": "1:1"}
VIDEO_DEFAULT_OPTIONS: dict[str, str | int] = {
    "aspectRatio": "3:2",
    "resolution": "720p",
    "durationSeconds": 5,
}
MUSIC_DEFAULT_OPTIONS: dict[str, str | int] = {"durationSeconds": 30}
_IMAGE_OPTION_VALUES: dict[str, set[str | int]] = {
    "size": {"1K", "2K", "3K", "4K"},
    "ratio": {"1:1", "3:4", "4:3", "16:9", "9:16", "2:3", "3:2", "21:9"},
}
_VIDEO_OPTION_VALUES: dict[str, set[str | int]] = {
    "aspectRatio": {"3:2", "16:9", "9:16", "1:1", "4:3", "3:4"},
    "resolution": {"480p", "720p", "1080p"},
    "durationSeconds": {3, 5, 10, 18},
}
_MUSIC_OPTION_VALUES: dict[str, set[str | int]] = {"durationSeconds": {30}}
_VIDEO_SIZE_PRESETS: dict[str, dict[str, tuple[int, int]]] = {
    "3:2": {"480p": (720, 480), "720p": (1152, 768), "1080p": (1620, 1080)},
    "16:9": {"480p": (832, 448), "720p": (1280, 720), "1080p": (1920, 1080)},
    "9:16": {"480p": (448, 832), "720p": (720, 1280), "1080p": (1080, 1920)},
    "1:1": {"480p": (480, 480), "720p": (720, 720), "1080p": (1080, 1080)},
    "4:3": {"480p": (640, 480), "720p": (960, 720), "1080p": (1440, 1080)},
    "3:4": {"480p": (480, 640), "720p": (720, 960), "1080p": (1080, 1440)},
}
_VIDEO_DURATION_FRAMES: dict[int, int] = {3: 81, 5: 121, 10: 241, 18: 441}
_REFERENCE_IMAGE_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
_MEDIA_EXTENSIONS = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "audio/mpeg": "mp3",
}
_VIDEO_POSTER_MIME_TYPE = "image/jpeg"


class MediaGenerationConversationNotFoundError(LookupError):
    """用户试图在无权访问的会话中创建或查询媒体任务。"""


class MediaGenerationTaskNotFoundError(LookupError):
    """当前用户没有访问指定媒体任务的权限。"""


class MediaGenerationTaskNotCancelableError(ValueError):
    """任务已经处于终态，不能再取消。"""


class MediaGenerationValidationError(ValueError):
    """创建任务的类型、提示词或可选参数不符合受支持契约。"""


class MediaGenerationOutputError(RuntimeError):
    """provider 返回的结果无法安全复制到 YuanAI 对象存储。"""


def _task_model(kind: MediaGenerationType) -> str:
    """返回只允许由专用任务 API 调用的媒体模型 ID。"""
    if kind is MediaGenerationType.image:
        return "agnes-image-2.1-flash"
    if kind is MediaGenerationType.music:
        return "elevenlabs-music-v1"
    return "agnes-video-v2.0"


def _placeholder_content(kind: MediaGenerationType) -> str:
    """返回 provider 无关的 assistant 任务卡占位文案。"""
    if kind is MediaGenerationType.image:
        return "正在生成图片"
    if kind is MediaGenerationType.music:
        return "正在生成音乐"
    return "正在生成视频"


def _completed_content(kind: MediaGenerationType) -> str:
    """返回媒体任务成功后的简洁 assistant 卡片文案。"""
    if kind is MediaGenerationType.image:
        return "图片生成完成"
    if kind is MediaGenerationType.music:
        return "音乐生成完成"
    return "视频生成完成"


def _failed_content(kind: MediaGenerationType) -> str:
    """返回媒体任务失败后的 provider 无关 assistant 卡片文案。"""
    if kind is MediaGenerationType.image:
        return "图片生成失败"
    if kind is MediaGenerationType.music:
        return "音乐生成失败"
    return "视频生成失败"


def _canceled_content(kind: MediaGenerationType) -> str:
    """返回用户取消媒体任务后的 assistant 卡片文案。"""
    if kind is MediaGenerationType.image:
        return "已取消图片生成"
    if kind is MediaGenerationType.music:
        return "已取消音乐生成"
    return "已取消视频生成"


def _normalized_options(request: CreateMediaGenerationRequest) -> dict[str, str | int]:
    """验证并填充图片或视频的已支持选项，拒绝未经审查的 provider 参数。"""
    if len(request.prompt) > settings.media_prompt_max_chars:
        raise MediaGenerationValidationError("提示词超过允许长度")

    if request.type is MediaGenerationType.image:
        defaults = IMAGE_DEFAULT_OPTIONS
        allowed_values = _IMAGE_OPTION_VALUES
    elif request.type is MediaGenerationType.music:
        if request.source_file_ids:
            raise MediaGenerationValidationError("音乐生成不支持参考图片")
        defaults = MUSIC_DEFAULT_OPTIONS
        allowed_values = _MUSIC_OPTION_VALUES
    else:
        defaults = VIDEO_DEFAULT_OPTIONS
        allowed_values = _VIDEO_OPTION_VALUES

    unknown = set(request.options).difference(allowed_values)
    if unknown:
        raise MediaGenerationValidationError("包含不支持的生成参数")

    normalized = dict(defaults)
    for name, value in request.options.items():
        if value not in allowed_values[name]:
            raise MediaGenerationValidationError("生成参数不受支持")
        normalized[name] = value
    return normalized


def _video_provider_options(task: MediaGenerationTask) -> tuple[int, int, int, int]:
    """将受限的显示规格转换为 Agnes Video 所需的原始参数。"""
    aspect_ratio = _option_string(task, "aspectRatio")
    resolution = _option_string(task, "resolution")
    duration_seconds = _option_int(task, "durationSeconds")
    try:
        width, height = _VIDEO_SIZE_PRESETS[aspect_ratio][resolution]
        num_frames = _VIDEO_DURATION_FRAMES[duration_seconds]
    except KeyError as error:
        raise MediaGenerationValidationError("任务参数无效") from error
    return width, height, num_frames, 24


async def _owned_conversation(
    db: AsyncSession, user_id: uuid.UUID, conversation_id: uuid.UUID
) -> Conversation:
    """加载属于当前用户的会话，否则统一按不存在处理。"""
    result = await db.execute(
        select(Conversation).where(
            Conversation.id == conversation_id, Conversation.user_id == user_id
        )
    )
    conversation = result.scalar_one_or_none()
    if conversation is None:
        raise MediaGenerationConversationNotFoundError(str(conversation_id))
    return conversation


async def _owned_task(
    db: AsyncSession, user_id: uuid.UUID, task_id: uuid.UUID
) -> MediaGenerationTask:
    """加载属于当前用户的媒体任务，避免暴露任务存在性。"""
    result = await db.execute(
        select(MediaGenerationTask).where(
            MediaGenerationTask.id == task_id, MediaGenerationTask.user_id == user_id
        )
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise MediaGenerationTaskNotFoundError(str(task_id))
    return task


async def _validate_source_files(
    db: AsyncSession, user_id: uuid.UUID, source_file_ids: list[uuid.UUID]
) -> list[str]:
    """验证参考图属于当前用户且是受支持的图片，返回可持久化 UUID 字符串。"""
    if not source_file_ids:
        return []
    result = await db.execute(
        select(File).where(File.id.in_(source_file_ids), File.user_id == user_id)
    )
    files = {file.id: file for file in result.scalars()}
    if len(files) != len(source_file_ids):
        raise MediaGenerationValidationError("参考图片不存在或无权访问")
    ordered = [files[file_id] for file_id in source_file_ids]
    if any(file.mime_type not in _REFERENCE_IMAGE_MIME_TYPES for file in ordered):
        raise MediaGenerationValidationError("图片或视频生成仅支持图片附件")
    return [str(file.id) for file in ordered]


async def _source_image_urls(task: MediaGenerationTask, db: AsyncSession) -> tuple[str, ...]:
    """在 worker 执行时重新授权并解析媒体任务的对象存储图片 URL。"""
    if not task.source_file_ids:
        return ()
    try:
        source_ids = [uuid.UUID(value) for value in task.source_file_ids]
    except ValueError as error:
        raise MediaGenerationValidationError("任务参考图无效") from error
    result = await db.execute(
        select(File).where(File.id.in_(source_ids), File.user_id == task.user_id)
    )
    files = {file.id: file for file in result.scalars()}
    if len(files) != len(source_ids):
        raise MediaGenerationValidationError("任务参考图不可用")
    ordered = [files[file_id] for file_id in source_ids]
    if any(file.mime_type not in _REFERENCE_IMAGE_MIME_TYPES for file in ordered):
        raise MediaGenerationValidationError("任务参考图不可用")
    return tuple(storage.get_url(file.s3_key) for file in ordered)


async def create_media_task(
    *,
    user_id: uuid.UUID,
    conversation_id: uuid.UUID,
    request: CreateMediaGenerationRequest,
    db: AsyncSession,
) -> MediaGenerationTask:
    """为用户拥有的会话原子创建 assistant 消息和排队媒体任务。"""
    conversation = await _owned_conversation(db, user_id, conversation_id)
    options = _normalized_options(request)
    source_file_ids = await _validate_source_files(db, user_id, request.source_file_ids)
    now = datetime.now(UTC)
    user_message = Message(
        conv_id=conversation.id,
        role=MessageRole.user,
        content=request.prompt,
        model=None,
        created_at=now,
    )
    db.add(user_message)
    await db.flush()
    for sort_order, file_id in enumerate(source_file_ids):
        db.add(
            MessageFile(
                message_id=user_message.id,
                file_id=uuid.UUID(file_id),
                sort_order=sort_order,
            )
        )
    assistant_message = Message(
        conv_id=conversation.id,
        role=MessageRole.assistant,
        content=_placeholder_content(request.type),
        model=_task_model(request.type),
        # 与用户提问明确错开，保证所有客户端都把任务卡渲染为该轮回复。
        created_at=now + timedelta(microseconds=1),
    )
    db.add(assistant_message)
    await db.flush()

    task = MediaGenerationTask(
        user_id=user_id,
        conversation_id=conversation.id,
        message_id=assistant_message.id,
        source_message_id=user_message.id,
        kind=request.type,
        model=_task_model(request.type),
        prompt=request.prompt,
        request_options=cast(dict[str, object], options),
        source_file_ids=source_file_ids,
    )
    db.add(task)
    conversation.last_message_at = assistant_message.created_at
    await db.commit()
    await db.refresh(task)
    return task


async def get_media_task(
    *, user_id: uuid.UUID, task_id: uuid.UUID, db: AsyncSession
) -> MediaGenerationTask:
    """返回当前用户拥有的单个媒体任务。"""
    return await _owned_task(db, user_id, task_id)


async def list_media_tasks(
    *, user_id: uuid.UUID, conversation_id: uuid.UUID, db: AsyncSession
) -> list[MediaGenerationTask]:
    """返回一个已授权会话中按创建时间排列的媒体任务。"""
    await _owned_conversation(db, user_id, conversation_id)
    result = await db.execute(
        select(MediaGenerationTask)
        .where(
            MediaGenerationTask.user_id == user_id,
            MediaGenerationTask.conversation_id == conversation_id,
        )
        .order_by(MediaGenerationTask.created_at, MediaGenerationTask.id)
    )
    return list(result.scalars())


async def _set_message_content(db: AsyncSession, task: MediaGenerationTask, content: str) -> None:
    """更新任务绑定的 assistant 卡片文案，不创建额外时间线消息。"""
    message = await db.get(Message, task.message_id)
    if message is not None:
        message.content = content


async def cancel_media_task(
    *, user_id: uuid.UUID, task_id: uuid.UUID, db: AsyncSession
) -> MediaGenerationTask:
    """取消排队或运行任务，并保证之后的 worker 结果不会覆盖取消状态。"""
    task = await _owned_task(db, user_id, task_id)
    if task.status not in {MediaGenerationStatus.queued, MediaGenerationStatus.running}:
        raise MediaGenerationTaskNotCancelableError(str(task_id))
    task.status = MediaGenerationStatus.canceled
    task.lease_expires_at = None
    task.error_code = None
    task.error_message = None
    await _set_message_content(db, task, _canceled_content(task.kind))
    await db.commit()
    await db.refresh(task)
    return task


def _option_int(task: MediaGenerationTask, key: str) -> int:
    """读取已在创建阶段验证的整数任务选项。"""
    value = task.request_options.get(key)
    if isinstance(value, bool):
        raise MediaGenerationValidationError("任务参数无效")
    if isinstance(value, int):
        return value
    raise MediaGenerationValidationError("任务参数无效")


def _option_string(task: MediaGenerationTask, key: str) -> str:
    """读取已在创建阶段验证的字符串任务选项。"""
    value = task.request_options.get(key)
    if isinstance(value, str) and value:
        return value
    raise MediaGenerationValidationError("任务参数无效")


async def _claim_next_task() -> uuid.UUID | None:
    """通过数据库 lease 原子认领一个待执行或已超时的任务。"""
    now = datetime.now(UTC)
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MediaGenerationTask)
            .where(
                or_(
                    MediaGenerationTask.status == MediaGenerationStatus.queued,
                    and_(
                        MediaGenerationTask.status == MediaGenerationStatus.running,
                        or_(
                            MediaGenerationTask.lease_expires_at.is_(None),
                            MediaGenerationTask.lease_expires_at < now,
                        ),
                    ),
                )
            )
            .order_by(MediaGenerationTask.created_at)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        task = result.scalar_one_or_none()
        if task is None:
            return None

        was_interrupted_task = (
            task.status is MediaGenerationStatus.running
            and task.kind in {MediaGenerationType.image, MediaGenerationType.music}
            and task.provider_task_id is None
        )
        if was_interrupted_task and task.attempt_count >= 2:
            task.status = MediaGenerationStatus.failed
            task.error_code = "MEDIA_WORKER_RECOVERY_EXHAUSTED"
            task.error_message = "生成任务恢复失败，请重试"
            task.lease_expires_at = None
            await _set_message_content(db, task, _failed_content(task.kind))
            await db.commit()
            return None

        if task.status is MediaGenerationStatus.queued or was_interrupted_task:
            task.attempt_count += 1
        task.status = MediaGenerationStatus.running
        task.lease_expires_at = now + timedelta(seconds=settings.media_worker_lease_seconds)
        task_id = task.id
        await db.commit()
        return task_id


async def _download_provider_output(url: str) -> tuple[bytes, str]:
    """下载受限大小的 HTTPS provider 输出，拒绝非媒体或可疑内容。"""
    parsed = httpx.URL(url)
    if parsed.scheme != "https":
        raise MediaGenerationOutputError()
    try:
        async with httpx.AsyncClient(
            timeout=settings.media_image_timeout_seconds,
            follow_redirects=False,
        ) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()
                mime_type = response.headers.get("content-type", "").split(";", 1)[0].lower()
                if mime_type not in _MEDIA_EXTENSIONS:
                    raise MediaGenerationOutputError()
                content_length = response.headers.get("content-length")
                if (
                    content_length is not None
                    and int(content_length) > settings.media_max_output_bytes
                ):
                    raise MediaGenerationOutputError()
                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes():
                    total += len(chunk)
                    if total > settings.media_max_output_bytes:
                        raise MediaGenerationOutputError()
                    chunks.append(chunk)
    except (httpx.HTTPError, ValueError) as error:
        raise MediaGenerationOutputError() from error
    if not chunks:
        raise MediaGenerationOutputError()
    return b"".join(chunks), mime_type


async def _persist_provider_output(task: MediaGenerationTask, url: str) -> None:
    """下载 provider 成果并写入 YuanAI 存储，绝不持久化其临时 URL。"""
    data, mime_type = await _download_provider_output(url)
    extension = _MEDIA_EXTENSIONS[mime_type]
    key = f"generated/{task.user_id}/{task.id}.{extension}"
    await storage.put_object(key, data, mime_type)
    task.result_s3_key = key
    task.result_mime_type = mime_type
    task.result_poster_s3_key = None
    if mime_type == "video/mp4":
        await _persist_video_poster(task, data)


async def _persist_audio_output(
    task: MediaGenerationTask, data: bytes, mime_type: str, duration_seconds: float
) -> None:
    """保存已由 provider 校验的音乐字节，不持久化 provider 临时地址。"""
    if mime_type != "audio/mpeg" or not data:
        raise MediaGenerationOutputError()
    if len(data) > settings.media_max_output_bytes:
        raise MediaGenerationOutputError()
    key = f"generated/{task.user_id}/{task.id}.mp3"
    await storage.put_object(key, data, mime_type)
    task.result_s3_key = key
    task.result_mime_type = mime_type
    task.result_duration_seconds = duration_seconds
    task.result_poster_s3_key = None


async def _extract_video_poster(video_data: bytes) -> bytes | None:
    """从受限的视频字节中提取首帧 JPEG，失败时保持视频任务可用。"""
    if not video_data or len(video_data) > settings.media_max_output_bytes:
        logger.warning("Skipping video poster extraction for invalid media output")
        return None

    with TemporaryDirectory(prefix="yuanai-media-poster-") as temporary_directory:
        source_path = Path(temporary_directory) / "source.mp4"
        poster_path = Path(temporary_directory) / "poster.jpg"
        try:
            await asyncio.to_thread(source_path.write_bytes, video_data)
            process = await asyncio.create_subprocess_exec(
                settings.media_ffmpeg_path,
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-i",
                str(source_path),
                "-frames:v",
                "1",
                "-q:v",
                "3",
                str(poster_path),
                stdout=DEVNULL,
                stderr=DEVNULL,
            )
        except (OSError, SubprocessError) as error:
            logger.warning("Unable to start video poster extraction: %s", error)
            return None

        try:
            await asyncio.wait_for(
                process.communicate(), timeout=settings.media_video_poster_timeout_seconds
            )
        except TimeoutError:
            process.kill()
            await process.communicate()
            logger.warning("Video poster extraction timed out")
            return None

        if process.returncode != 0 or not poster_path.is_file():
            logger.warning("Video poster extraction failed with exit code %s", process.returncode)
            return None
        try:
            poster = await asyncio.to_thread(poster_path.read_bytes)
        except OSError as error:
            logger.warning("Unable to read generated video poster: %s", error)
            return None

    if not poster or len(poster) > settings.media_video_poster_max_bytes:
        logger.warning("Discarding invalid video poster output")
        return None
    return poster


async def _persist_video_poster(task: MediaGenerationTask, video_data: bytes) -> bool:
    """保存视频首帧封面；封面失败不能使已经可播放的视频结果失败。"""
    poster = await _extract_video_poster(video_data)
    if poster is None:
        return False
    key = f"generated/{task.user_id}/{task.id}.poster.jpg"
    try:
        await storage.put_object(key, poster, _VIDEO_POSTER_MIME_TYPE)
    except (BotoCoreError, ClientError, OSError) as error:
        logger.warning("Unable to persist video poster for task %s: %s", task.id, error)
        return False
    task.result_poster_s3_key = key
    return True


async def _lock_task_for_finalization(
    db: AsyncSession, task: MediaGenerationTask
) -> MediaGenerationTask | None:
    """刷新并锁定任务的当前状态，避免陈旧 ORM 实例覆盖用户取消。"""
    await db.flush()
    result = await db.execute(
        select(MediaGenerationTask)
        .where(MediaGenerationTask.id == task.id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    return result.scalar_one_or_none()


async def _discard_canceled_result(db: AsyncSession, task: MediaGenerationTask) -> None:
    """删除取消竞态中已复制的媒体对象，避免取消任务保留可访问结果。"""
    if task.result_s3_key is not None:
        await storage.delete(task.result_s3_key)
    if task.result_poster_s3_key is not None:
        await storage.delete(task.result_poster_s3_key)
    task.result_s3_key = None
    task.result_poster_s3_key = None
    task.result_mime_type = None
    task.result_width = None
    task.result_height = None
    task.result_duration_seconds = None
    await db.commit()


def _failure_message(kind: MediaGenerationType, code: str) -> str:
    """将媒体领域错误码映射为不暴露 provider 细节的用户可读提示。"""
    label = (
        "图片"
        if kind is MediaGenerationType.image
        else "音乐"
        if kind is MediaGenerationType.music
        else "视频"
    )
    messages = {
        "MEDIA_PROVIDER_UNAVAILABLE": "媒体生成服务尚未配置，请稍后重试",
        "MEDIA_PROVIDER_CREATE_FAILED": f"暂时无法创建{label}任务，请稍后重试",
        "MEDIA_PROVIDER_POLL_FAILED": f"无法继续查询{label}生成进度，请重试",
        "MEDIA_PROVIDER_GENERATION_FAILED": f"{label}生成未完成，请调整描述后重试",
        "MEDIA_PROVIDER_INVALID_RESPONSE": "生成服务返回了无效结果，请重试",
        "MEDIA_OUTPUT_INVALID": "生成结果无法保存，请重试",
        "MEDIA_TASK_INVALID": "生成任务参数无效，请重新提交",
    }
    return messages.get(code, "生成服务暂时不可用，请稍后重试")


async def _fail_task(db: AsyncSession, task: MediaGenerationTask, code: str) -> None:
    """以脱敏且可行动的错误完成任务，保留可恢复时间线卡片。"""
    locked_task = await _lock_task_for_finalization(db, task)
    if locked_task is None:
        return
    if locked_task.status is MediaGenerationStatus.canceled:
        await _discard_canceled_result(db, locked_task)
        return
    locked_task.status = MediaGenerationStatus.failed
    locked_task.error_code = code
    locked_task.error_message = _failure_message(locked_task.kind, code)
    locked_task.lease_expires_at = None
    await _set_message_content(db, locked_task, _failed_content(locked_task.kind))
    await db.commit()


async def _retry_video_poll(db: AsyncSession, task: MediaGenerationTask) -> None:
    """将一次暂时的视频状态查询失败延后重试，避免上游已完成任务被过早终结。"""
    locked_task = await _lock_task_for_finalization(db, task)
    if locked_task is None:
        return
    if locked_task.status is MediaGenerationStatus.canceled:
        await _discard_canceled_result(db, locked_task)
        return
    locked_task.poll_failure_count += 1
    if locked_task.poll_failure_count >= settings.media_video_max_poll_failures:
        locked_task.status = MediaGenerationStatus.failed
        locked_task.error_code = "MEDIA_PROVIDER_POLL_FAILED"
        locked_task.error_message = _failure_message(locked_task.kind, "MEDIA_PROVIDER_POLL_FAILED")
        locked_task.lease_expires_at = None
        await _set_message_content(db, locked_task, _failed_content(locked_task.kind))
        await db.commit()
        return
    locked_task.status = MediaGenerationStatus.running
    locked_task.lease_expires_at = datetime.now(UTC) + timedelta(
        seconds=settings.media_video_poll_interval_seconds
    )
    await db.commit()


async def _complete_task(db: AsyncSession, task: MediaGenerationTask) -> None:
    """将已持久化成果标为完成，并复用现有跨端通知通道。"""
    locked_task = await _lock_task_for_finalization(db, task)
    if locked_task is None:
        return
    if locked_task.status is MediaGenerationStatus.canceled:
        await _discard_canceled_result(db, locked_task)
        return
    locked_task.status = MediaGenerationStatus.succeeded
    locked_task.progress = 100
    locked_task.lease_expires_at = None
    locked_task.error_code = None
    locked_task.error_message = None
    await _set_message_content(db, locked_task, _completed_content(locked_task.kind))
    await db.commit()
    title = (
        "图片生成完成"
        if locked_task.kind is MediaGenerationType.image
        else "音乐生成完成"
        if locked_task.kind is MediaGenerationType.music
        else "视频生成完成"
    )
    await send_to_user(
        db,
        locked_task.user_id,
        {
            "title": title,
            "body": "已在当前会话中生成，可打开预览",
            "conversationId": str(locked_task.conversation_id),
            "mediaTaskId": str(locked_task.id),
        },
    )


async def _process_claimed_task(task_id: uuid.UUID) -> None:
    """执行已租约认领任务的一次图片、音乐生成或视频轮询。"""
    async with AsyncSessionLocal() as db:
        task = await db.get(MediaGenerationTask, task_id)
        if task is None or task.status is MediaGenerationStatus.canceled:
            return
        try:
            if task.kind is MediaGenerationType.image:
                image_urls = await _source_image_urls(task, db)
                result = await generate_agnes_image(
                    task.prompt,
                    size=_option_string(task, "size"),
                    ratio=_option_string(task, "ratio"),
                    image_urls=image_urls,
                )
                await _persist_provider_output(task, result.url)
                await _complete_task(db, task)
                return

            if task.kind is MediaGenerationType.music:
                duration_seconds = _option_int(task, "durationSeconds")
                music_data, mime_type = await generate_elevenlabs_music(
                    task.prompt,
                    duration_ms=duration_seconds * 1_000,
                )
                await _persist_audio_output(
                    task,
                    music_data,
                    mime_type,
                    float(duration_seconds),
                )
                await _complete_task(db, task)
                return

            if task.provider_video_id is None:
                width, height, num_frames, frame_rate = _video_provider_options(task)
                snapshot = await create_agnes_video(
                    task.prompt,
                    width=width,
                    height=height,
                    num_frames=num_frames,
                    frame_rate=frame_rate,
                    image_urls=await _source_image_urls(task, db),
                )
            else:
                snapshot = await get_agnes_video(task.provider_video_id)

            if snapshot.provider_task_id is not None:
                task.provider_task_id = snapshot.provider_task_id
            if snapshot.video_id is not None:
                task.provider_video_id = snapshot.video_id
            task.progress = snapshot.progress
            task.result_width = snapshot.width
            task.result_height = snapshot.height
            task.result_duration_seconds = snapshot.duration_seconds
            if snapshot.status == "succeeded":
                if snapshot.result_url is None:
                    await _fail_task(db, task, "MEDIA_PROVIDER_INVALID_RESPONSE")
                    return
                await _persist_provider_output(task, snapshot.result_url)
                await _complete_task(db, task)
                return
            if snapshot.status in {"failed", "canceled"}:
                await _fail_task(db, task, "MEDIA_PROVIDER_GENERATION_FAILED")
                return
            task.status = MediaGenerationStatus.running
            task.poll_failure_count = 0
            task.lease_expires_at = datetime.now(UTC) + timedelta(
                seconds=settings.media_video_poll_interval_seconds
            )
            await db.commit()
        except MediaProviderUnavailableError:
            await _fail_task(db, task, "MEDIA_PROVIDER_UNAVAILABLE")
        except MediaProviderError:
            if task.kind is MediaGenerationType.video and task.provider_video_id is not None:
                await _retry_video_poll(db, task)
            else:
                await _fail_task(db, task, "MEDIA_PROVIDER_CREATE_FAILED")
        except MediaGenerationOutputError:
            await _fail_task(db, task, "MEDIA_OUTPUT_INVALID")
        except MediaGenerationValidationError:
            await _fail_task(db, task, "MEDIA_TASK_INVALID")


async def _claim_next_missing_video_poster(
    skipped_task_ids: set[uuid.UUID],
) -> uuid.UUID | None:
    """认领一个旧视频的封面补偿工作，不干扰新建或运行中的生成任务。"""
    async with AsyncSessionLocal() as db:
        query = (
            select(MediaGenerationTask)
            .where(
                MediaGenerationTask.status == MediaGenerationStatus.succeeded,
                MediaGenerationTask.kind == MediaGenerationType.video,
                MediaGenerationTask.result_s3_key.is_not(None),
                MediaGenerationTask.result_poster_s3_key.is_(None),
            )
            .order_by(MediaGenerationTask.updated_at, MediaGenerationTask.id)
            .with_for_update(skip_locked=True)
            .limit(1)
        )
        if skipped_task_ids:
            query = query.where(MediaGenerationTask.id.not_in(skipped_task_ids))
        result = await db.execute(query)
        task = result.scalar_one_or_none()
        return task.id if task is not None else None


async def _backfill_video_poster(task_id: uuid.UUID) -> bool:
    """为已完成的历史视频补齐封面，任何失败都只保留无封面的可播放视频。"""
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MediaGenerationTask).where(MediaGenerationTask.id == task_id).with_for_update()
        )
        task = result.scalar_one_or_none()
        if (
            task is None
            or task.status is not MediaGenerationStatus.succeeded
            or task.kind is not MediaGenerationType.video
            or task.result_s3_key is None
        ):
            return True
        if task.result_poster_s3_key is not None:
            return True
        try:
            video_data = await storage.get_object(task.result_s3_key)
        except (BotoCoreError, ClientError, OSError, ValueError) as error:
            logger.warning("Unable to load video for poster backfill %s: %s", task.id, error)
            return False
        if len(video_data) > settings.media_max_output_bytes:
            logger.warning("Skipping oversized video poster backfill for task %s", task.id)
            return False
        persisted = await _persist_video_poster(task, video_data)
        if not persisted:
            return False
        await db.commit()
        return True


async def run_media_generation_worker(stop_event: asyncio.Event) -> None:
    """循环认领并处理 durable 媒体任务，支持进程重启后的图片有限恢复。"""
    skipped_poster_backfills: set[uuid.UUID] = set()
    while not stop_event.is_set():
        task_id = await _claim_next_task()
        if task_id is not None:
            await _process_claimed_task(task_id)
            continue
        poster_task_id = await _claim_next_missing_video_poster(skipped_poster_backfills)
        if poster_task_id is not None:
            if not await _backfill_video_poster(poster_task_id):
                skipped_poster_backfills.add(poster_task_id)
            continue
        try:
            await asyncio.wait_for(
                stop_event.wait(), timeout=settings.media_worker_poll_interval_seconds
            )
        except TimeoutError:
            continue
