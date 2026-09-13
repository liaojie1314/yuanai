"""主动自动化及其标准 Agent Run 映射模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
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
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.agent_run import AgentRun
    from app.models.assistant import Assistant


class AutomationStatus(StrEnum):
    """自动化定义的生命周期状态。"""

    active = "active"
    paused = "paused"
    completed = "completed"


class AutomationTriggerType(StrEnum):
    """首版支持的一次性和 cron 触发器。"""

    once = "once"
    cron = "cron"


class AutomationRunStatus(StrEnum):
    """自动化发生记录与 Agent Run 的同步状态。"""

    queued = "queued"
    running = "running"
    waiting_approval = "waiting_approval"
    waiting_input = "waiting_input"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class Automation(Base):
    """用户拥有的自动化定义。"""

    __tablename__ = "automations"
    __table_args__ = (Index("ix_automations_user_status", "user_id", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    model: Mapped[str | None] = mapped_column(String(100), nullable=True)
    max_steps: Mapped[int] = mapped_column(Integer, nullable=False, default=12)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[AutomationStatus] = mapped_column(
        Enum(AutomationStatus, native_enum=False, length=16),
        nullable=False,
        default=AutomationStatus.active,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    assistant: Mapped[Assistant] = relationship()
    trigger: Mapped[AutomationTrigger] = relationship(
        back_populates="automation", uselist=False, cascade="all, delete-orphan"
    )
    runs: Mapped[list[AutomationRun]] = relationship(
        back_populates="automation",
        cascade="all, delete-orphan",
        order_by="AutomationRun.created_at.desc()",
    )


class AutomationTrigger(Base):
    """自动化下一次触发时间及用户时区规则。"""

    __tablename__ = "automation_triggers"
    __table_args__ = (UniqueConstraint("automation_id", name="uq_automation_triggers_automation"),)

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    trigger_type: Mapped[AutomationTriggerType] = mapped_column(
        Enum(AutomationTriggerType, native_enum=False, length=10), nullable=False
    )
    cron_expression: Mapped[str | None] = mapped_column(String(120), nullable=True)
    scheduled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    next_run_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True, index=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    occurrence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    automation: Mapped[Automation] = relationship(back_populates="trigger")


class AutomationRun(Base):
    """一次触发的持久化记录，唯一映射到标准 Agent Run。"""

    __tablename__ = "automation_runs"
    __table_args__ = (
        UniqueConstraint("automation_id", "occurrence_key", name="uq_automation_runs_occurrence"),
        UniqueConstraint("agent_run_id", name="uq_automation_runs_agent_run"),
        Index("ix_automation_runs_user_created", "user_id", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    automation_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("automations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    agent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL"), nullable=True
    )
    occurrence_key: Mapped[str] = mapped_column(String(120), nullable=False)
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[AutomationRunStatus] = mapped_column(
        Enum(AutomationRunStatus, native_enum=False, length=20),
        nullable=False,
        default=AutomationRunStatus.queued,
    )
    wait_deadline: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    wait_reason: Mapped[str | None] = mapped_column(String(200), nullable=True)
    wait_notified_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    automation: Mapped[Automation] = relationship(back_populates="runs")
    agent_run: Mapped[AgentRun | None] = relationship()
