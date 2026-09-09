"""Memory and Context API 的输入输出契约。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.memory import (
    MemorySensitivity,
    MemoryStatus,
    MemoryStorageLocation,
    MemoryType,
)


class MemorySchema(BaseModel):
    """记忆 Schema 的公共序列化配置。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class MemoryCreateCandidate(MemorySchema):
    """创建待确认记忆的可信边界输入。"""

    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None = None
    memory_type: MemoryType
    content: str = Field(min_length=1, max_length=10_000)
    structured_data: dict[str, object] | None = None
    source_type: str = Field(min_length=1, max_length=40)
    source_id: str | None = Field(default=None, max_length=100)
    source_excerpt: str | None = Field(default=None, max_length=2_000)
    confidence: float = Field(default=0.0, ge=0, le=1)
    sensitivity: MemorySensitivity = MemorySensitivity.personal
    storage_location: MemoryStorageLocation = MemoryStorageLocation.cloud
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryUpdate(MemorySchema):
    """修改记忆内容或经政策允许的生命周期字段。"""

    content: str | None = Field(default=None, min_length=1, max_length=10_000)
    structured_data: dict[str, object] | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    sensitivity: MemorySensitivity | None = None
    status: MemoryStatus | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryResponse(MemorySchema):
    """记忆管理接口返回的完整资源表示。"""

    id: uuid.UUID
    user_id: uuid.UUID
    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None
    memory_type: MemoryType
    content: str
    structured_data: dict[str, object] | None
    source_type: str
    source_id: str | None
    source_excerpt: str | None
    confidence: float
    sensitivity: MemorySensitivity
    storage_location: MemoryStorageLocation
    status: MemoryStatus
    valid_from: datetime | None
    valid_until: datetime | None
    last_used_at: datetime | None
    created_at: datetime
    updated_at: datetime


class MemorySearchResult(MemorySchema):
    """用于管理界面或上下文组装的检索结果。"""

    id: uuid.UUID
    assistant_id: uuid.UUID
    workspace_id: uuid.UUID | None
    memory_type: MemoryType
    content: str
    source_type: str
    source_id: str | None
    source_excerpt: str | None
    confidence: float
    sensitivity: MemorySensitivity
    status: MemoryStatus
    score: float


class MemoryContextItem(MemorySchema):
    """可注入 Agent 上下文的、不可信记忆表示。"""

    id: uuid.UUID
    content: str
    source_type: str
    source_id: str | None
    confidence: float
    untrusted: bool = True
