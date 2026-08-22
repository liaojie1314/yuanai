"""Agent Run、Step 和可重放事件 ORM 模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.approval import ApprovalRequest
    from app.models.assistant import Assistant


class AgentRunStatus(StrEnum):
    """Agent Run 生命周期状态。"""

    queued = "queued"
    running = "running"
    waiting_approval = "waiting_approval"
    waiting_input = "waiting_input"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


# 便于领域服务按协议名称引用 Run 状态。
RunStatus = AgentRunStatus


class AgentStepKind(StrEnum):
    """Agent Step 的执行类型。"""

    model = "model"
    tool = "tool"
    approval = "approval"
    user_input = "user_input"
    final = "final"


class AgentStepStatus(StrEnum):
    """Agent Step 生命周期状态。"""

    pending = "pending"
    running = "running"
    waiting = "waiting"
    succeeded = "succeeded"
    failed = "failed"
    cancelled = "cancelled"


class AgentRun(Base):
    """持久化 Agent 执行及其租户边界。"""

    __tablename__ = "agent_runs"
    __table_args__ = (
        UniqueConstraint("user_id", "idempotency_key", name="uq_agent_runs_user_idempotency"),
        Index("ix_agent_runs_user_status_created", "user_id", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    assistant_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("assistants.id", ondelete="CASCADE"), index=True, nullable=False
    )
    conversation_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("conversations.id", ondelete="SET NULL"), index=True, nullable=True
    )
    parent_run_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="SET NULL"), index=True, nullable=True
    )
    goal: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[AgentRunStatus] = mapped_column(
        Enum(AgentRunStatus, native_enum=False, length=20),
        nullable=False,
        default=AgentRunStatus.queued,
        index=True,
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    max_steps: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=12)
    current_step: Mapped[int] = mapped_column(SmallInteger, nullable=False, default=0)
    idempotency_key: Mapped[str | None] = mapped_column(String(100), nullable=True)
    input_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    output_tokens: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    estimated_cost_usd: Mapped[Decimal] = mapped_column(
        Numeric(12, 6), nullable=False, default=Decimal("0")
    )
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    queued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    assistant: Mapped[Assistant] = relationship(back_populates="runs")
    parent_run: Mapped[AgentRun | None] = relationship(
        remote_side=[id], back_populates="child_runs"
    )
    child_runs: Mapped[list[AgentRun]] = relationship(back_populates="parent_run")
    steps: Mapped[list[AgentStep]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentStep.sequence"
    )
    events: Mapped[list[AgentEvent]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="AgentEvent.sequence"
    )
    approval_requests: Mapped[list[ApprovalRequest]] = relationship(
        back_populates="run", cascade="all, delete-orphan"
    )


class AgentStep(Base):
    """Run 内单步模型、工具或用户交互执行记录。"""

    __tablename__ = "agent_steps"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_agent_steps_run_sequence"),
        Index("ix_agent_steps_run_status", "run_id", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[AgentStepKind] = mapped_column(
        Enum(AgentStepKind, native_enum=False, length=16), nullable=False
    )
    status: Mapped[AgentStepStatus] = mapped_column(
        Enum(AgentStepStatus, native_enum=False, length=16),
        nullable=False,
        default=AgentStepStatus.pending,
    )
    input_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    output_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    error_code: Mapped[str | None] = mapped_column(String(100), nullable=True)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped[AgentRun] = relationship(back_populates="steps")
    approval_requests: Mapped[list[ApprovalRequest]] = relationship(
        back_populates="step", cascade="all, delete-orphan"
    )


class AgentEvent(Base):
    """面向客户端的脱敏事件，sequence 用于 Last-Event-ID 重放。"""

    __tablename__ = "agent_events"
    __table_args__ = (
        UniqueConstraint("run_id", "sequence", name="uq_agent_events_run_sequence"),
        Index("ix_agent_events_run_created", "run_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence: Mapped[int] = mapped_column(Integer, nullable=False)
    event_type: Mapped[str] = mapped_column(String(60), nullable=False)
    payload: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    run: Mapped[AgentRun] = relationship(back_populates="events")
