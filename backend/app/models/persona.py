"""专属助手人格、人格版本快照与人格候选项模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PersonaTone(StrEnum):
    """人格语气。"""

    concise = "concise"
    patient = "patient"
    lively = "lively"
    rigorous = "rigorous"


class PersonaVerbosity(StrEnum):
    """回答长度偏好。"""

    brief = "brief"
    balanced = "balanced"
    detailed = "detailed"


class PersonaCandidateStatus(StrEnum):
    """人格候选项的处理状态。"""

    pending = "pending"
    accepted = "accepted"
    rejected = "rejected"


class PersonaCandidateSource(StrEnum):
    """人格候选项的来源链路。"""

    run = "run"
    chat = "chat"


class AssistantPersona(Base):
    """助理当前生效的人格，一对一于 assistants。"""

    __tablename__ = "assistant_personas"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=False, unique=True, index=True
    )
    address_user: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    self_name: Mapped[str] = mapped_column(String(40), nullable=False, default="")
    tone: Mapped[PersonaTone] = mapped_column(
        Enum(PersonaTone, native_enum=False, length=16),
        nullable=False,
        default=PersonaTone.concise,
    )
    verbosity: Mapped[PersonaVerbosity] = mapped_column(
        Enum(PersonaVerbosity, native_enum=False, length=16),
        nullable=False,
        default=PersonaVerbosity.balanced,
    )
    greeting: Mapped[str] = mapped_column(Text, nullable=False, default="")
    refusal_style: Mapped[str] = mapped_column(Text, nullable=False, default="")
    forbidden_topics: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    language: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class AssistantPersonaVersion(Base):
    """人格快照：回滚与「它为什么这么说」的追溯依据。"""

    __tablename__ = "assistant_persona_versions"
    __table_args__ = (UniqueConstraint("assistant_id", "version", name="uq_persona_version"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[int] = mapped_column(Integer, nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False)
    change_reason: Mapped[str] = mapped_column(String(64), nullable=False, default="manual")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class PersonaCandidate(Base):
    """从使用中归纳出的人格修改建议，必须用户确认才生效。"""

    __tablename__ = "persona_candidates"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    field: Mapped[str] = mapped_column(String(32), nullable=False)
    suggested_value: Mapped[str] = mapped_column(Text, nullable=False)
    evidence: Mapped[str] = mapped_column(Text, nullable=False, default="")
    source_type: Mapped[PersonaCandidateSource] = mapped_column(
        Enum(PersonaCandidateSource, native_enum=False, length=8), nullable=False
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(nullable=True)
    status: Mapped[PersonaCandidateStatus] = mapped_column(
        Enum(PersonaCandidateStatus, native_enum=False, length=16),
        nullable=False,
        default=PersonaCandidateStatus.pending,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
