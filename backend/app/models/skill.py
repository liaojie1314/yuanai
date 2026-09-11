"""版本化 Skill 声明及其用户安装范围。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Index, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base
from app.tools.contracts import ToolRisk

if TYPE_CHECKING:
    from app.models.assistant import Assistant


class SkillVersionStatus(StrEnum):
    """Skill 版本从草稿到可用的生命周期状态。"""

    draft = "draft"
    validating = "validating"
    validated = "validated"
    active = "active"
    rejected = "rejected"
    deprecated = "deprecated"


class SkillInstallationScope(StrEnum):
    """Skill 可用范围，只允许全局或单个助理。"""

    global_ = "global"
    assistant = "assistant"


class Skill(Base):
    """用户拥有的稳定 Skill 身份，不随版本内容变化。"""

    __tablename__ = "skills"
    __table_args__ = (
        UniqueConstraint("user_id", "slug", name="uq_skills_user_slug"),
        Index("ix_skills_user_updated", "user_id", "updated_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    slug: Mapped[str] = mapped_column(String(120), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False)
    current_version_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey(
            "skill_versions.id",
            ondelete="SET NULL",
            use_alter=True,
            name="fk_skills_current_version",
        ),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    versions: Mapped[list[SkillVersion]] = relationship(
        back_populates="skill",
        cascade="all, delete-orphan",
        foreign_keys="SkillVersion.skill_id",
        order_by="SkillVersion.created_at.desc()",
    )
    installations: Mapped[list[SkillInstallation]] = relationship(
        back_populates="skill", cascade="all, delete-orphan"
    )
    current_version: Mapped[SkillVersion | None] = relationship(
        foreign_keys=[current_version_id], post_update=True
    )


class SkillVersion(Base):
    """不可变的 Skill manifest 与声明性指令内容。"""

    __tablename__ = "skill_versions"
    __table_args__ = (
        UniqueConstraint("skill_id", "version", name="uq_skill_versions_skill_version"),
        Index("ix_skill_versions_skill_status", "skill_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version: Mapped[str] = mapped_column(String(30), nullable=False)
    manifest_text: Mapped[str] = mapped_column(Text, nullable=False)
    skill_md: Mapped[str] = mapped_column(Text, nullable=False)
    content_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    required_tools: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    risk_ceiling: Mapped[ToolRisk] = mapped_column(
        Enum(ToolRisk, native_enum=False, length=32), nullable=False
    )
    status: Mapped[SkillVersionStatus] = mapped_column(
        Enum(SkillVersionStatus, native_enum=False, length=16),
        nullable=False,
        default=SkillVersionStatus.draft,
    )
    validation_result: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    validation_errors: Mapped[list[str]] = mapped_column(JSON, nullable=False, default=list)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    validated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    skill: Mapped[Skill] = relationship(back_populates="versions", foreign_keys=[skill_id])


class SkillInstallation(Base):
    """用户为某个 Skill 显式选择的可用范围。"""

    __tablename__ = "skill_installations"
    __table_args__ = (
        UniqueConstraint("user_id", "skill_id", "scope_key", name="uq_skill_installations_scope"),
        Index("ix_skill_installations_user_scope", "user_id", "scope"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    scope: Mapped[SkillInstallationScope] = mapped_column(
        Enum(SkillInstallationScope, native_enum=False, length=16), nullable=False
    )
    scope_key: Mapped[str] = mapped_column(String(80), nullable=False)
    assistant_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    skill: Mapped[Skill] = relationship(back_populates="installations")
    assistant: Mapped[Assistant | None] = relationship()
