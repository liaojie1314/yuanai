"""长期记忆及其来源关系的持久化模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, Computed, DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MemoryType(StrEnum):
    """记忆表达的领域类别。"""

    profile = "profile"
    preference = "preference"
    semantic = "semantic"
    episodic = "episodic"


class MemorySensitivity(StrEnum):
    """记忆内容的访问敏感度。"""

    public = "public"
    personal = "personal"
    sensitive = "sensitive"
    restricted = "restricted"


class MemoryStorageLocation(StrEnum):
    """记忆内容的存储位置。"""

    cloud = "cloud"
    local_node = "local_node"


class MemoryStatus(StrEnum):
    """记忆从候选到失效的生命周期状态。"""

    candidate = "candidate"
    active = "active"
    rejected = "rejected"
    superseded = "superseded"
    expired = "expired"


class Memory(Base):
    """归属于单个用户与助理的、可追溯的长期记忆。"""

    __tablename__ = "memories"
    __table_args__ = (
        Index("ix_memories_user_assistant_status", "user_id", "assistant_id", "status"),
        Index("ix_memories_user_workspace_status", "user_id", "workspace_id", "status"),
        Index("ix_memories_search_vector", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    workspace_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    memory_type: Mapped[MemoryType] = mapped_column(
        Enum(MemoryType, native_enum=False, length=16), nullable=False
    )
    content: Mapped[str] = mapped_column(Text, nullable=False)
    structured_data: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False)
    source_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    source_excerpt: Mapped[str | None] = mapped_column(Text, nullable=True)
    confidence: Mapped[float] = mapped_column(nullable=False, default=0.0)
    sensitivity: Mapped[MemorySensitivity] = mapped_column(
        Enum(MemorySensitivity, native_enum=False, length=16),
        nullable=False,
        default=MemorySensitivity.personal,
    )
    storage_location: Mapped[MemoryStorageLocation] = mapped_column(
        Enum(MemoryStorageLocation, native_enum=False, length=16),
        nullable=False,
        default=MemoryStorageLocation.cloud,
    )
    status: Mapped[MemoryStatus] = mapped_column(
        Enum(MemoryStatus, native_enum=False, length=16),
        nullable=False,
        default=MemoryStatus.candidate,
    )
    valid_from: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    valid_until: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', content)", persisted=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class MemoryRelation(Base):
    """记录记忆内实体之间、且保留来源的关系。"""

    __tablename__ = "memory_relations"
    __table_args__ = (Index("ix_memory_relations_memory", "memory_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    memory_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("memories.id", ondelete="CASCADE"), nullable=False
    )
    subject: Mapped[str] = mapped_column(String(200), nullable=False)
    predicate: Mapped[str] = mapped_column(String(100), nullable=False)
    object_value: Mapped[str] = mapped_column(String(500), nullable=False)
    properties: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
