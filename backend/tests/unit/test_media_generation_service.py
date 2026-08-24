"""媒体任务 worker 的状态转换与恢复单元测试。"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

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
from app.services.ai_service import AgnesImageResult, MediaProviderError
from tests.conftest import TestSessionLocal


async def _create_task(
    db: AsyncSession, user: User, *, kind: MediaGenerationType = MediaGenerationType.image
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
    monkeypatch.setattr(
        media_service,
        "generate_agnes_image",
        AsyncMock(return_value=AgnesImageResult(url="https://provider.example/result.png")),
    )

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


async def test_music_worker_persists_mp3_output_and_notifies(
    db: AsyncSession, test_user: User, monkeypatch: pytest.MonkeyPatch
) -> None:
    """音乐任务保存 MP3 到用户隔离的 generated 前缀并完成通知。"""
    task = await _create_task(db, test_user, kind=MediaGenerationType.music)
    monkeypatch.setattr(media_service, "AsyncSessionLocal", TestSessionLocal)
    monkeypatch.setattr(
        media_service,
        "generate_elevenlabs_music",
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
