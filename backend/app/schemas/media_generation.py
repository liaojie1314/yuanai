"""图片与视频生成任务的 API 契约。"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator
from pydantic.alias_generators import to_camel

from app.models.media_generation_task import (
    MediaGenerationStatus,
    MediaGenerationTask,
    MediaGenerationType,
)
from app.services.storage_service import StorageService


class CreateMediaGenerationRequest(BaseModel):
    """创建文本到图片或视频任务的请求体。"""

    model_config = ConfigDict(populate_by_name=True, alias_generator=to_camel, extra="forbid")

    conversation_id: uuid.UUID
    type: MediaGenerationType
    prompt: str = Field(min_length=1, max_length=4_000)
    options: dict[str, str | int] = Field(default_factory=dict)
    source_file_ids: list[uuid.UUID] = Field(default_factory=list, max_length=4)

    @field_validator("prompt")
    @classmethod
    def normalize_prompt(cls, value: str) -> str:
        """拒绝仅包含空白的生成提示词。"""
        normalized = value.strip()
        if not normalized:
            raise ValueError("提示词不能为空")
        return normalized

    @field_validator("source_file_ids")
    @classmethod
    def validate_unique_source_file_ids(cls, value: list[uuid.UUID]) -> list[uuid.UUID]:
        """拒绝重复参考图，避免相同对象被重复发送给媒体提供商。"""
        if len(set(value)) != len(value):
            raise ValueError("参考图片不能重复")
        return value


class MediaGenerationTaskResponse(BaseModel):
    """不含供应商 URL 或凭据的跨端媒体任务表示。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    id: uuid.UUID
    conversation_id: uuid.UUID
    message_id: uuid.UUID
    source_message_id: uuid.UUID | None
    type: MediaGenerationType
    model: str
    prompt: str
    options: dict[str, str | int]
    source_file_ids: list[uuid.UUID]
    status: MediaGenerationStatus
    progress: int
    result_url: str | None
    result_poster_url: str | None
    result_mime_type: str | None
    result_width: int | None
    result_height: int | None
    result_duration_seconds: float | None
    error_code: str | None
    error_message: str | None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_task(
        cls, task: MediaGenerationTask, storage: StorageService
    ) -> MediaGenerationTaskResponse:
        """将 ORM 任务投影为客户端安全响应，只为完成结果生成对象存储 URL。"""
        result_url = None
        result_poster_url = None
        if task.status is MediaGenerationStatus.succeeded and task.result_s3_key is not None:
            result_url = storage.get_url(task.result_s3_key)
        if task.status is MediaGenerationStatus.succeeded and task.result_poster_s3_key is not None:
            result_poster_url = storage.get_url(task.result_poster_s3_key)
        return cls(
            id=task.id,
            conversation_id=task.conversation_id,
            message_id=task.message_id,
            source_message_id=task.source_message_id,
            type=task.kind,
            model=task.model,
            prompt=task.prompt,
            options={
                key: value
                for key, value in task.request_options.items()
                if isinstance(value, (str, int)) and not isinstance(value, bool)
            },
            source_file_ids=[uuid.UUID(value) for value in task.source_file_ids],
            status=task.status,
            progress=task.progress,
            result_url=result_url,
            result_poster_url=result_poster_url,
            result_mime_type=task.result_mime_type,
            result_width=task.result_width,
            result_height=task.result_height,
            result_duration_seconds=task.result_duration_seconds,
            error_code=task.error_code,
            error_message=task.error_message,
            created_at=task.created_at,
            updated_at=task.updated_at,
        )


class MediaGenerationTaskListResponse(BaseModel):
    """会话中所有媒体任务的稳定列表响应。"""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)

    tasks: list[MediaGenerationTaskResponse]
