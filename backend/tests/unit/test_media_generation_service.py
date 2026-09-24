"""媒体任务 worker 的状态转换与恢复单元测试。"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.services.ai_service as ai_service
import app.services.media_generation_service as media_service
from app.models.conversation import Conversation
from app.models.media_generation_task import (
    MediaGenerationStatus,
    MediaGenerationTask,
    MediaGenerationType,
)
from app.models.message import Message
from app.models.user import User
from app.schemas.media_generation import CreateMediaGenerationRequest
from app.services.ai_service import (
    AgnesImageResult,
    AgnesVideoSnapshot,
    MediaLyricsGenerationError,
    MediaProviderError,
    MediaProviderUnavailableError,
)
from tests.conftest import TestSessionLocal


async def _create_task(
    db: AsyncSession,
    user: User,
    *,
    kind: MediaGenerationType = MediaGenerationType.image,
    lyrics: str | None = None,
) -> MediaGenerationTask:
    """创建可由 worker 认领的测试媒体任务。"""
    conversation = Conversation(user_id=user.id, title="媒体 worker 测试", model="agnes-2.5-flash")
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    return await media_service.create_media_task(
        user_id=user.id,
        conversation_id=conversation.id,
        request=CreateMediaGenerationRequest(
            conversation_id=conversation.id,
            type=kind,
            prompt="测试媒体生成",
            options={"lyrics": lyrics} if lyrics is not None else {},
        ),
        db=db,
    )


async def _load_task(db: AsyncSession, task_id: uuid.UUID) -> MediaGenerationTask:
    """从测试数据库重新读取任务，避免 identity map 遮蔽 worker 的独立事务。"""
    db.expire_all()
    result = await db.execute(select(MediaGenerationTask).where(MediaGenerationTask.id == task_id))
    return result.scalar_one()


async def _message_content(db: AsyncSession, task: MediaGenerationTask) -> str:
    """读取任务关联 assistant 消息的当前文案。"""
    message = await db.get(Message, task.message_id)
    assert message is not None
    return message.content


async def test_image_worker_persists_output_and_notifies(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """图片任务成功时必须持久化结果、完成卡片并发送一次通知。"""
    task = await _create_task(db, test_user)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    generate = AsyncMock(return_value=AgnesImageResult(url="https://provider.example/result.png"))
    monkeypatch.setattr(media_service, "generate_agnes_image", generate)

    async def persist_output(task_row: MediaGenerationTask, _url: str) -> None:
        task_row.result_s3_key = f"generated/{task_row.user_id}/{task_row.id}.png"
        task_row.result_mime_type = "image/png"

    notify = AsyncMock()
    monkeypatch.setattr(media_service, "_persist_provider_output", persist_output)
    monkeypatch.setattr(media_service, "send_to_user", notify)

    task_id = await media_service._claim_next_task()
    assert task_id == task.id
    await media_service._process_claimed_task(task.id)

    completed = await _load_task(db, task.id)
    assert completed.status is MediaGenerationStatus.succeeded
    assert completed.progress == 100
    assert completed.result_s3_key == f"generated/{task.user_id}/{task.id}.png"
    assert await _message_content(db, completed) == "图片生成完成"
    notify.assert_awaited_once()
    # 发给供应商的模型必须与任务持久化的模型一致，否则任务卡会撒谎
    assert generate.await_args is not None
    assert generate.await_args.kwargs["model"] == completed.model


async def test_music_worker_persists_mp3_output_and_notifies(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """音乐任务保存 MP3 到用户隔离的 generated 前缀并完成通知。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.music)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(media_service.settings, "media_music_provider", "local")
    monkeypatch.setattr(
        media_service,
        "generate_local_music",
        AsyncMock(return_value=(b"mp3-bytes", "audio/mpeg")),
    )
    put_object = AsyncMock()
    notify = AsyncMock()
    monkeypatch.setattr(media_service.storage, "put_object", put_object)
    monkeypatch.setattr(media_service, "send_to_user", notify)

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    completed = await _load_task(db, task.id)
    assert completed.status is MediaGenerationStatus.succeeded
    assert completed.result_s3_key == f"generated/{task.user_id}/{task.id}.mp3"
    assert completed.result_mime_type == "audio/mpeg"
    assert completed.result_duration_seconds == 30
    assert await _message_content(db, completed) == "音乐生成完成"
    put_object.assert_awaited_once_with(completed.result_s3_key, b"mp3-bytes", "audio/mpeg")
    notify.assert_awaited_once()


async def test_wav_music_output_is_persisted_with_mp3_mime(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """WAV/FLAC provider 输出转码后必须以 audio/mpeg 写入对象存储。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.music)

    class FakeProcess:
        returncode = 0

        async def wait(self) -> None:
            output_path = Path(str(fake_args[-1]))
            output_path.write_bytes(b"mp3-bytes")

    fake_args: tuple[object, ...] = ()

    async def fake_create_subprocess_exec(*args: object, **kwargs: object) -> FakeProcess:
        nonlocal fake_args
        fake_args = args
        del kwargs
        return FakeProcess()

    monkeypatch.setattr(
        media_service.asyncio, "create_subprocess_exec", fake_create_subprocess_exec
    )
    put_object = AsyncMock()
    monkeypatch.setattr(media_service.storage, "put_object", put_object)

    await media_service._persist_audio_output(task, b"wav-bytes", "audio/wav", 30)

    put_object.assert_awaited_once_with(
        f"generated/{task.user_id}/{task.id}.mp3", b"mp3-bytes", "audio/mpeg"
    )
    assert task.result_mime_type == "audio/mpeg"


async def test_remote_music_falls_back_to_local_musicgen(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """远程 provider 失败时应自动使用本机 MusicGen 完成任务。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.music)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(media_service.settings, "media_music_provider", "huggingface")
    monkeypatch.setattr(media_service.settings, "media_music_fallback_to_local", True)
    remote = AsyncMock(side_effect=MediaProviderUnavailableError())
    local = AsyncMock(return_value=(b"local-wav", "audio/wav"))
    monkeypatch.setattr(media_service, "generate_huggingface_music", remote)
    monkeypatch.setattr(media_service, "generate_local_music", local)
    monkeypatch.setattr(media_service, "_persist_audio_output", AsyncMock())
    monkeypatch.setattr(media_service, "send_to_user", AsyncMock())

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    completed = await _load_task(db, task.id)
    assert completed.status is MediaGenerationStatus.succeeded
    remote.assert_awaited_once()
    local.assert_awaited_once_with(task.prompt, duration_ms=30_000)


async def test_lyrics_music_persists_ace_step_task_id_for_poll_recovery(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ACE-Step 已提交后暂时失败时，worker 必须保留任务 ID 以便后续恢复。"""
    task = await _create_task(
        db, test_user, kind=MediaGenerationType.music, lyrics="[Verse]\n回到夏天"
    )
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(media_service.settings, "ace_step_max_poll_failures", 3)

    async def submit_then_fail(
        _prompt: str,
        _lyrics: str,
        **kwargs: object,
    ) -> tuple[bytes, str]:
        callback = kwargs["on_task_id"]
        assert callable(callback)
        await callback("ace-task-1")
        raise MediaProviderError()

    monkeypatch.setattr(media_service, "generate_ace_step_music", submit_then_fail)
    monkeypatch.setattr(media_service, "generate_local_music", AsyncMock())
    monkeypatch.setattr(media_service, "send_to_user", AsyncMock())

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    retrying = await _load_task(db, task.id)
    assert retrying.status is MediaGenerationStatus.running
    assert retrying.provider_task_id == "ace-task-1"
    assert retrying.poll_failure_count == 1
    media_service.generate_local_music.assert_not_awaited()


async def test_lyrics_music_terminal_provider_failure_does_not_retry_polling(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ACE-Step 已给出终态失败时不能伪装成短暂轮询断连。"""
    task = await _create_task(
        db, test_user, kind=MediaGenerationType.music, lyrics="[Verse]\\n回到夏天"
    )
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)

    async def submit_then_fail(
        _prompt: str,
        _lyrics: str,
        **kwargs: object,
    ) -> tuple[bytes, str]:
        callback = kwargs["on_task_id"]
        assert callable(callback)
        await callback("ace-task-terminal-failure")
        raise MediaLyricsGenerationError()

    monkeypatch.setattr(media_service, "generate_ace_step_music", submit_then_fail)
    monkeypatch.setattr(media_service, "send_to_user", AsyncMock())

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    assert failed.provider_task_id == "ace-task-terminal-failure"
    assert failed.poll_failure_count == 0
    assert failed.error_code == "MEDIA_PROVIDER_GENERATION_FAILED"
    assert failed.error_message == "音乐生成未完成，请调整描述后重试"


async def test_lyrics_music_never_falls_back_to_instrumental(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """歌词任务失败时不能静默改用 MusicGen 生成无歌词音乐。"""
    task = await _create_task(
        db, test_user, kind=MediaGenerationType.music, lyrics="[Verse]\n新的歌"
    )
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    ace_step = AsyncMock(side_effect=MediaProviderError())
    local = AsyncMock()
    monkeypatch.setattr(media_service, "generate_ace_step_music", ace_step)
    monkeypatch.setattr(media_service, "generate_local_music", local)
    monkeypatch.setattr(media_service, "send_to_user", AsyncMock())

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    ace_step.assert_awaited_once()
    local.assert_not_awaited()


async def test_music_task_rejects_provider_options_and_source_files(
    db: AsyncSession, test_user: User
) -> None:
    """音乐仅接受固定时长，且不能携带图片/视频参数或附件。"""
    conversation = Conversation(user_id=test_user.id, title="音乐参数测试", model="agnes-2.5-flash")
    db.add(conversation)
    await db.commit()
    await db.refresh(conversation)
    with pytest.raises(media_service.MediaGenerationValidationError):
        await media_service.create_media_task(
            user_id=test_user.id,
            conversation_id=conversation.id,
            request=CreateMediaGenerationRequest(
                conversation_id=conversation.id,
                type=MediaGenerationType.music,
                prompt="测试",
                options={"durationSeconds": 5},
            ),
            db=db,
        )


async def test_video_output_persists_optional_poster_without_blocking_result(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """视频首帧封面成功时应单独保存，封面失败不能使原视频结果丢失。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    put_object = AsyncMock()
    monkeypatch.setattr(
        media_service,
        "_download_provider_output",
        AsyncMock(return_value=(b"video-bytes", "video/mp4")),
    )
    monkeypatch.setattr(
        media_service, "_extract_video_poster", AsyncMock(return_value=b"poster-bytes")
    )
    monkeypatch.setattr(media_service.storage, "put_object", put_object)

    await media_service._persist_provider_output(task, "https://provider.example/result.mp4")

    assert task.result_s3_key == f"generated/{task.user_id}/{task.id}.mp4"
    assert task.result_poster_s3_key == f"generated/{task.user_id}/{task.id}.poster.jpg"
    assert task.result_mime_type == "video/mp4"
    assert put_object.await_args_list[0].args == (
        f"generated/{task.user_id}/{task.id}.mp4",
        b"video-bytes",
        "video/mp4",
    )
    assert put_object.await_args_list[1].args == (
        f"generated/{task.user_id}/{task.id}.poster.jpg",
        b"poster-bytes",
        "image/jpeg",
    )


async def test_video_output_remains_available_when_poster_extraction_fails(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """缺少 ffmpeg 或非法首帧时只降级缩略图，视频任务仍可完成。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    put_object = AsyncMock()
    monkeypatch.setattr(
        media_service,
        "_download_provider_output",
        AsyncMock(return_value=(b"video-bytes", "video/mp4")),
    )
    monkeypatch.setattr(media_service, "_extract_video_poster", AsyncMock(return_value=None))
    monkeypatch.setattr(media_service.storage, "put_object", put_object)

    await media_service._persist_provider_output(task, "https://provider.example/result.mp4")

    assert task.result_s3_key == f"generated/{task.user_id}/{task.id}.mp4"
    assert task.result_poster_s3_key is None
    put_object.assert_awaited_once_with(
        f"generated/{task.user_id}/{task.id}.mp4", b"video-bytes", "video/mp4"
    )


async def test_backfill_adds_poster_to_existing_completed_video(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """历史已完成视频在后端重启后可补齐首帧封面。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    task.status = MediaGenerationStatus.succeeded
    task.result_s3_key = f"generated/{task.user_id}/{task.id}.mp4"
    task.result_mime_type = "video/mp4"
    await db.commit()
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(media_service.storage, "get_object", AsyncMock(return_value=b"video-bytes"))
    monkeypatch.setattr(media_service.storage, "put_object", AsyncMock())
    monkeypatch.setattr(
        media_service, "_extract_video_poster", AsyncMock(return_value=b"poster-bytes")
    )

    assert await media_service._backfill_video_poster(task.id)

    completed = await _load_task(db, task.id)
    assert completed.result_poster_s3_key == f"generated/{task.user_id}/{task.id}.poster.jpg"


async def test_cancellation_wins_when_provider_returns_after_cancel(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """用户在 provider 完成期间取消时，worker 绝不能回写成功状态或通知。"""
    task = await _create_task(db, test_user)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        media_service,
        "generate_agnes_image",
        AsyncMock(return_value=AgnesImageResult(url="https://provider.example/result.png")),
    )

    async def persist_then_cancel(task_row: MediaGenerationTask, _url: str) -> None:
        task_row.result_s3_key = f"generated/{task_row.user_id}/{task_row.id}.png"
        task_row.result_mime_type = "image/png"
        async with TestSessionLocal() as competing_db:
            competing_task = await competing_db.get(MediaGenerationTask, task_row.id)
            assert competing_task is not None
            competing_task.status = MediaGenerationStatus.canceled
            competing_task.lease_expires_at = None
            await competing_db.commit()

    notify = AsyncMock()
    monkeypatch.setattr(media_service, "_persist_provider_output", persist_then_cancel)
    monkeypatch.setattr(media_service, "send_to_user", notify)

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    canceled = await _load_task(db, task.id)
    assert canceled.status is MediaGenerationStatus.canceled
    assert canceled.result_s3_key is None
    notify.assert_not_awaited()


async def test_worker_marks_provider_failure_without_provider_details(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """上游失败只落库稳定错误码，不能暴露 provider 原文。"""
    task = await _create_task(db, test_user)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        media_service,
        "generate_agnes_image",
        AsyncMock(side_effect=MediaProviderError()),
    )
    monkeypatch.setattr(media_service, "send_to_user", AsyncMock())

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    assert failed.error_code == "MEDIA_PROVIDER_CREATE_FAILED"
    assert failed.error_message == "暂时无法创建图片任务，请稍后重试"
    assert await _message_content(db, failed) == "图片生成失败"


async def test_video_poll_retries_transient_provider_failure_before_terminal_failure(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """视频已创建后轮询失败须延迟重试，耗尽次数后才落明确错误。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    task.provider_video_id = "video-provider-id"
    await db.commit()
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        media_service,
        "get_agnes_video",
        AsyncMock(side_effect=MediaProviderError()),
    )
    monkeypatch.setattr(media_service.settings, "media_video_max_poll_failures", 2)

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    retrying = await _load_task(db, task.id)
    assert retrying.status is MediaGenerationStatus.running
    assert retrying.poll_failure_count == 1
    assert retrying.lease_expires_at is not None
    assert retrying.error_code is None

    retrying.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()
    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    assert failed.poll_failure_count == 2
    assert failed.error_code == "MEDIA_PROVIDER_POLL_FAILED"
    assert failed.error_message == "无法继续查询视频生成进度，请重试"


async def test_expired_interrupted_image_fails_after_recovery_limit(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """重复恢复已中断图片任务时必须有限失败，避免永无止境重试。"""
    task = await _create_task(db, test_user)
    task.status = MediaGenerationStatus.running
    task.attempt_count = 2
    task.lease_expires_at = datetime.now(UTC) - timedelta(seconds=1)
    await db.commit()
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)

    assert await media_service._claim_next_task() is None

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    assert failed.error_code == "MEDIA_WORKER_RECOVERY_EXHAUSTED"
    assert await _message_content(db, failed) == "图片生成失败"


def test_video_flash_rejects_a_size_other_than_720p() -> None:
    """Flash 只支持 720P，非法尺寸必须在本地拦下，不发请求也不计费。"""

    with pytest.raises(ai_service.AgnesVideoValidationError, match="720P"):
        ai_service.build_video_flash_body(
            prompt="一只猫", seconds="5", mode="text", size="1080P", aspect_ratio="16:9"
        )


def test_video_flash_rejects_more_than_five_reference_images() -> None:
    """参考图上限 5 张。"""

    with pytest.raises(ai_service.AgnesVideoValidationError):
        ai_service.build_video_flash_body(
            prompt="一只猫",
            seconds="5",
            mode="reference",
            size="720P",
            aspect_ratio="16:9",
            image_urls=tuple(f"https://example.invalid/{i}.png" for i in range(6)),
        )


def test_video_flash_rejects_more_than_three_reference_audios() -> None:
    """参考音频上限 3 条。"""

    with pytest.raises(ai_service.AgnesVideoValidationError):
        ai_service.build_video_flash_body(
            prompt="一只猫",
            seconds="5",
            mode="reference",
            size="720P",
            aspect_ratio="16:9",
            audio_urls=("a", "b", "c", "d"),
        )


def test_video_flash_body_carries_the_flash_schema() -> None:
    """请求体使用 seconds/mode/size/aspect_ratio，而不是 V2.0 的宽高帧率。"""

    body = ai_service.build_video_flash_body(
        prompt="一只猫", seconds="5", mode="text", size="720P", aspect_ratio="16:9"
    )
    assert body["model"] == "agnes-video-2.5-flash"
    assert body["seconds"] == "5"
    assert "width" not in body and "num_frames" not in body


async def test_get_agnes_video_sends_model_name_for_flash_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非 text 模式的 Flash 任务必须带 model_name 才能查到结果。"""

    captured: dict[str, object] = {}

    async def _request(method: str, path: str, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"video_id": "v1", "status": "completed"}

    monkeypatch.setattr(ai_service, "_agnes_video_request", _request)
    await ai_service.get_agnes_video("v1", model_name="agnes-video-2.5-flash")
    assert captured["params"] == {"video_id": "v1", "model_name": "agnes-video-2.5-flash"}


async def test_get_agnes_video_omits_model_name_for_v2_tasks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """V2.0 的查询参数必须保持原样，不能被 Flash 的新参数污染。"""

    captured: dict[str, object] = {}

    async def _request(method: str, path: str, **kwargs: object) -> dict[str, object]:
        captured.update(kwargs)
        return {"video_id": "v1", "status": "processing"}

    monkeypatch.setattr(ai_service, "_agnes_video_request", _request)
    await ai_service.get_agnes_video("v1")
    assert captured["params"] == {"video_id": "v1"}


async def test_video_flash_worker_uses_the_flash_request_and_model_name(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """任务选中 Flash 模型时，worker 必须走 Flash 建任务与带 model_name 的查询。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    task.model = media_service.AGNES_VIDEO_FLASH_MODEL
    await db.commit()
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    create_flash = AsyncMock(
        return_value=AgnesVideoSnapshot(
            provider_task_id=None,
            video_id="flash-1",
            status="running",
            progress=10,
            result_url=None,
            width=None,
            height=None,
            duration_seconds=None,
        )
    )
    create_v2 = AsyncMock()
    get_video = AsyncMock(
        return_value=AgnesVideoSnapshot(
            provider_task_id=None,
            video_id="flash-1",
            status="running",
            progress=40,
            result_url=None,
            width=None,
            height=None,
            duration_seconds=None,
        )
    )
    monkeypatch.setattr(media_service, "create_agnes_video_flash", create_flash)
    monkeypatch.setattr(media_service, "create_agnes_video", create_v2)
    monkeypatch.setattr(media_service, "get_agnes_video", get_video)

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)
    await media_service._process_claimed_task(task.id)

    create_v2.assert_not_awaited()
    assert create_flash.await_args is not None
    assert create_flash.await_args.kwargs["seconds"] == "5"
    assert create_flash.await_args.kwargs["size"] == "720P"
    assert create_flash.await_args.kwargs["mode"] == "text"
    assert get_video.await_args is not None
    assert get_video.await_args.kwargs["model_name"] == media_service.AGNES_VIDEO_FLASH_MODEL


async def test_video_flash_worker_fails_the_task_on_local_validation(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Flash 的本地校验失败必须落为参数非法，而不是逃出 worker。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.video)
    task.model = media_service.AGNES_VIDEO_FLASH_MODEL
    task.request_options = {**task.request_options, "resolution": "1080p"}
    await db.commit()
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)

    assert await media_service._claim_next_task() == task.id
    await media_service._process_claimed_task(task.id)

    failed = await _load_task(db, task.id)
    assert failed.status is MediaGenerationStatus.failed
    assert failed.error_code == "MEDIA_TASK_INVALID"


async def test_media_worker_survives_a_failing_claim(monkeypatch: pytest.MonkeyPatch) -> None:
    """认领失败不得终结 worker，否则 lifespan 的 await media_worker 会重新抛出异常。"""
    stop_event = asyncio.Event()
    claims = 0

    async def failing_claim() -> uuid.UUID | None:
        nonlocal claims
        claims += 1
        if claims == 1:
            raise OSError("claim failed")
        stop_event.set()
        return None

    monkeypatch.setattr(media_service, "_claim_next_task", failing_claim)
    monkeypatch.setattr(
        media_service, "_claim_next_missing_video_poster", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(media_service.settings, "media_worker_poll_interval_seconds", 0.01)

    await asyncio.wait_for(media_service.run_media_generation_worker(stop_event), timeout=5)

    assert claims == 2
