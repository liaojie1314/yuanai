"""人格读写与版本的请求响应 Schema。"""

import uuid
from datetime import datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

from app.models.persona import (
    PersonaCandidateSource,
    PersonaCandidateStatus,
    PersonaTone,
    PersonaVerbosity,
)

# 禁止话题不参与片段截断，因此必须在入口限量，否则会把整段提示词顶爆预算。
ForbiddenTopic = Annotated[
    str, StringConstraints(max_length=40, strip_whitespace=True, min_length=1)
]
MAX_FORBIDDEN_TOPICS = 20


class PersonaSchema(BaseModel):
    """人格 Schema 的公共序列化配置。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class PersonaUpdateRequest(PersonaSchema):
    """保存人格；未传的字段保持原值。"""

    address_user: str | None = Field(default=None, max_length=40)
    self_name: str | None = Field(default=None, max_length=40)
    tone: PersonaTone | None = None
    verbosity: PersonaVerbosity | None = None
    greeting: str | None = Field(default=None, max_length=500)
    refusal_style: str | None = Field(default=None, max_length=500)
    forbidden_topics: list[ForbiddenTopic] | None = Field(
        default=None, max_length=MAX_FORBIDDEN_TOPICS
    )
    language: str | None = Field(default=None, max_length=16)


class PersonaResponse(PersonaSchema):
    """人格当前内容。"""

    assistant_id: uuid.UUID
    address_user: str
    self_name: str
    tone: PersonaTone
    verbosity: PersonaVerbosity
    greeting: str
    refusal_style: str
    forbidden_topics: list[str]
    language: str
    version: int
    updated_at: datetime


class PersonaVersionResponse(PersonaSchema):
    """人格历史版本条目。"""

    version: int
    change_reason: str
    payload: dict[str, object]
    created_at: datetime


class PersonaPreviewResponse(PersonaSchema):
    """后端真实装配出的人格片段，含是否发生过截断。"""

    fragment: str
    truncated: bool
    character_budget: int


class PersonaCandidateResponse(PersonaSchema):
    """人格候选项。"""

    id: uuid.UUID
    assistant_id: uuid.UUID
    field: str
    suggested_value: str
    evidence: str
    source_type: PersonaCandidateSource
    status: PersonaCandidateStatus
    created_at: datetime
