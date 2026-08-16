"""持久化图片与视频生成任务的数据模型。"""

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    CheckConstraint,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MediaGenerationType(StrEnum):
    """当前支持的媒体生成类型。"""

    image = "image"
    video = "video"


class MediaGenerationStatus(StrEnum):
    """媒体任务的稳定生命周期状态。"""

    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"
    canceled = "canceled"


class MediaGenerationTask(Base):
    """会话中一张 assistant 任务卡对应的唯一可恢复媒体任务。"""

    __tablename__ = "media_generation_tasks"
    __table_args__ = (
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_media_generation_progress"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    conversation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True, nullable=False
    )
    message_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    # 任务卡对应的用户生成请求。与 assistant 占位消息分开存储，避免客户端只能依赖
    # 时间相邻关系将任务卡错误折叠进上一轮回答版本。
    source_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="CASCADE"), index=True, nullable=True
    )
    kind: Mapped[MediaGenerationType] = mapped_column(
        Enum(MediaGenerationType, native_enum=False, length=8), nullable=False
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    request_options: Mapped[dict[str, object]] = mapped_column(JSON, default=dict, nullable=False)
    source_file_ids: Mapped[list[str]] = mapped_column(JSON, default=list, nullable=False)
    status: Mapped[MediaGenerationStatus] = mapped_column(
        Enum(MediaGenerationStatus, native_enum=False, length=16),
        default=MediaGenerationStatus.queued,
        index=True,
        nullable=False,
    )
    progress: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    attempt_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    poll_failure_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    provider_task_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    provider_video_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    result_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result_poster_s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    result_mime_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    result_width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    result_duration_seconds: Mapped[float | None] = mapped_column(nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(String(500), nullable=True)
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
