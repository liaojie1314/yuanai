"""知识库、来源版本与可检索文本片段的持久化模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    Computed,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import TSVECTOR
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class KnowledgeBaseMemberRole(StrEnum):
    """空间成员在知识库内的最小权限集合。"""

    viewer = "viewer"
    editor = "editor"


class KnowledgeDocumentStatus(StrEnum):
    """来源版本从构建到公开的状态。"""

    staged = "staged"
    published = "published"
    superseded = "superseded"
    failed = "failed"


class KnowledgeBase(Base):
    """由租户拥有、可选归入空间的资料集合。"""

    __tablename__ = "knowledge_bases"
    __table_args__ = (Index("ix_knowledge_bases_owner_space", "owner_id", "space_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    owner_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    space_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class KnowledgeBaseMember(Base):
    """知识库空间 ACL，成员权限不跨越所属租户。"""

    __tablename__ = "knowledge_base_members"
    __table_args__ = (
        UniqueConstraint("knowledge_base_id", "user_id", name="uq_knowledge_base_members_user"),
        Index("ix_knowledge_base_members_user", "user_id", "knowledge_base_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[KnowledgeBaseMemberRole] = mapped_column(
        Enum(KnowledgeBaseMemberRole, native_enum=False, length=16), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class KnowledgeSource(Base):
    """一个可保留多个文档版本的外部资料来源。"""

    __tablename__ = "knowledge_sources"
    __table_args__ = (Index("ix_knowledge_sources_base", "knowledge_base_id"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    knowledge_base_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_bases.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    source_type: Mapped[str] = mapped_column(String(40), nullable=False, default="text")
    source_uri: Mapped[str | None] = mapped_column(String(2_000), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    documents: Mapped[list[KnowledgeDocument]] = relationship(
        back_populates="source",
        cascade="all, delete-orphan",
        order_by="KnowledgeDocument.version.desc()",
    )


class KnowledgeDocument(Base):
    """来源的不可变文本版本，只有已发布版本可被检索。"""

    __tablename__ = "knowledge_documents"
    __table_args__ = (
        UniqueConstraint("source_id", "version", name="uq_knowledge_documents_source_version"),
        Index("ix_knowledge_documents_source_status", "source_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    source_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_sources.id", ondelete="CASCADE"), nullable=False
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    normalized_content: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[KnowledgeDocumentStatus] = mapped_column(
        Enum(KnowledgeDocumentStatus, native_enum=False, length=16),
        nullable=False,
        default=KnowledgeDocumentStatus.staged,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    source: Mapped[KnowledgeSource] = relationship(back_populates="documents")


class KnowledgeChunk(Base):
    """文档的定位片段，保存 FTS、可选 embedding 与引用范围。"""

    __tablename__ = "knowledge_chunks"
    __table_args__ = (
        UniqueConstraint("document_id", "chunk_index", name="uq_knowledge_chunks_document_index"),
        Index("ix_knowledge_chunks_document", "document_id"),
        Index("ix_knowledge_chunks_search_vector", "search_vector", postgresql_using="gin"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("knowledge_documents.id", ondelete="CASCADE"), nullable=False
    )
    chunk_index: Mapped[int] = mapped_column(Integer, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    section: Mapped[str | None] = mapped_column(String(500), nullable=True)
    char_start: Mapped[int] = mapped_column(Integer, nullable=False)
    char_end: Mapped[int] = mapped_column(Integer, nullable=False)
    embedding: Mapped[list[float] | None] = mapped_column(JSON, nullable=True)
    search_vector: Mapped[str] = mapped_column(
        TSVECTOR,
        Computed("to_tsvector('simple', content)", persisted=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
