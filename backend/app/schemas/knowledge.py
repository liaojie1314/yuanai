"""Knowledge Base API 的输入、检索引用与响应契约。"""

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel

from app.models.knowledge import KnowledgeBaseMemberRole, KnowledgeDocumentStatus


class KnowledgeSchema(BaseModel):
    """知识库 API 统一输出 camelCase 字段。"""

    model_config = ConfigDict(from_attributes=True, alias_generator=to_camel, populate_by_name=True)


class KnowledgeBaseCreate(KnowledgeSchema):
    """创建属于当前用户的知识库。"""

    name: str = Field(min_length=1, max_length=200)
    space_id: uuid.UUID | None = None


class KnowledgeBaseResponse(KnowledgeSchema):
    """知识库可公开给其成员的基础元数据。"""

    id: uuid.UUID
    owner_id: uuid.UUID
    name: str
    space_id: uuid.UUID | None
    created_at: datetime
    updated_at: datetime


class KnowledgeMemberGrant(KnowledgeSchema):
    """所有者为一个用户授予空间读取或编辑权限。"""

    user_id: uuid.UUID
    role: KnowledgeBaseMemberRole


class KnowledgeMemberResponse(KnowledgeSchema):
    """持久化后的知识库成员关系。"""

    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    user_id: uuid.UUID
    role: KnowledgeBaseMemberRole
    created_at: datetime


class KnowledgeTextSourceCreate(KnowledgeSchema):
    """创建带首个暂存版本的纯文本来源。"""

    name: str = Field(min_length=1, max_length=300)
    content: str = Field(min_length=1, max_length=200_000)
    source_uri: str | None = Field(default=None, max_length=2_000)


class KnowledgeTextVersionCreate(KnowledgeSchema):
    """为已有来源构建一个尚未公开的新文本版本。"""

    content: str = Field(min_length=1, max_length=200_000)


class KnowledgeSourceResponse(KnowledgeSchema):
    """来源的可追溯标识与固定元数据。"""

    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    name: str
    source_type: str
    source_uri: str | None
    created_at: datetime


class KnowledgeDocumentResponse(KnowledgeSchema):
    """来源版本构建或发布后的状态。"""

    id: uuid.UUID
    source_id: uuid.UUID
    version: int
    content_hash: str
    status: KnowledgeDocumentStatus
    created_at: datetime
    published_at: datetime | None


class KnowledgeSourceWithDocumentsResponse(KnowledgeSchema):
    """来源及其可由当前用户查看的版本列表。"""

    id: uuid.UUID
    knowledge_base_id: uuid.UUID
    name: str
    source_type: str
    source_uri: str | None
    created_at: datetime
    documents: list[KnowledgeDocumentResponse]


class KnowledgeSearchRequest(KnowledgeSchema):
    """对一个当前用户可访问知识库执行检索。"""

    query: str = Field(min_length=1, max_length=10_000)
    limit: int = Field(default=8, ge=1, le=20)


class KnowledgeCitation(KnowledgeSchema):
    """可定位回源文档片段的检索结果与引用。"""

    knowledge_base_id: uuid.UUID
    source_id: uuid.UUID
    document_id: uuid.UUID
    source_name: str
    source_uri: str | None
    document_version: int
    chunk_index: int
    section: str | None
    char_start: int
    char_end: int
    content: str
    score: float
