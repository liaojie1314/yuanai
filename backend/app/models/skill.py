"""版本化 Skill 声明及其用户安装范围。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
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


class SkillEvaluationStatus(StrEnum):
    """一次评测的终态；评测是同步静态检查，没有排队中间态。"""

    passed = "passed"
    failed = "failed"


class SkillEvaluationMode(StrEnum):
    """评测取样方式；决定成本与步数指标是否有数据源。

    `static_contract` 不执行 Skill，只重放契约检查，因此没有成本和步数；
    `executed` 预留给未来真实执行面，届时才允许写入这两个指标。读取方必须按
    这一列判断指标是否可信，而不是看到 `NULL` 自行猜测。
    """

    static_contract = "static_contract"
    executed = "executed"


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
    evaluations: Mapped[list[SkillEvaluation]] = relationship(
        back_populates="version",
        cascade="all, delete-orphan",
        order_by="SkillEvaluation.created_at.desc()",
    )

    @property
    def latest_evaluation(self) -> SkillEvaluation | None:
        """最近一次评测，门禁与界面都以它为准。

        按 `created_at` 取最大值而不是取列表首项：关系声明的倒序只在从库加载时生效，
        同一会话里刚追加的记录会排在列表末尾，取首项会拿到最旧的一条。读取方必须保证
        `evaluations` 已预加载，异步会话下惰性加载会直接抛错。
        """

        return max(self.evaluations, key=lambda item: item.created_at, default=None)


class SkillEvaluation(Base):
    """一个 Skill 版本的评测记录；替换 active 版本的门禁依据。

    `estimated_cost_usd` 与 `avg_steps` 允许为空：当前评测是静态契约检查，
    Skill 还没有运行时执行面，没有真实成本与步数可测。**这两列必须留 NULL 而不是
    填 0** —— 恒为 0 的指标看起来像真实数据，比空值更有害。
    """

    __tablename__ = "skill_evaluations"
    __table_args__ = (
        Index("ix_skill_evaluations_version_created", "version_id", "created_at"),
        Index("ix_skill_evaluations_skill_created", "skill_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    skill_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skills.id", ondelete="CASCADE"), nullable=False, index=True
    )
    version_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("skill_versions.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[SkillEvaluationStatus] = mapped_column(
        Enum(SkillEvaluationStatus, native_enum=False, length=16), nullable=False
    )
    mode: Mapped[SkillEvaluationMode] = mapped_column(
        Enum(SkillEvaluationMode, native_enum=False, length=20),
        nullable=False,
        default=SkillEvaluationMode.static_contract,
    )
    case_results: Mapped[list[dict[str, str]]] = mapped_column(JSON, nullable=False, default=list)
    total_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    passed_cases: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    pass_rate: Mapped[Decimal] = mapped_column(Numeric(5, 4), nullable=False, default=Decimal("0"))
    estimated_cost_usd: Mapped[Decimal | None] = mapped_column(Numeric(12, 6), nullable=True)
    avg_steps: Mapped[Decimal | None] = mapped_column(Numeric(6, 2), nullable=True)
    duration_ms: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    version: Mapped[SkillVersion] = relationship(back_populates="evaluations")


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
