"""Agent 工具审批请求模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.agent_run import AgentRun, AgentStep


class ApprovalRiskLevel(StrEnum):
    """审批风险等级。"""

    low = "low"
    medium = "medium"
    high = "high"
    critical = "critical"


class ApprovalStatus(StrEnum):
    """审批请求生命周期状态。"""

    pending = "pending"
    approved = "approved"
    denied = "denied"
    expired = "expired"
    cancelled = "cancelled"


class ApprovalRequest(Base):
    """绑定工具参数哈希和执行位置的单次审批请求。"""

    __tablename__ = "approval_requests"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_runs.id", ondelete="CASCADE"), index=True, nullable=False
    )
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("agent_steps.id", ondelete="CASCADE"), index=True, nullable=False
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    tool_name: Mapped[str] = mapped_column(String(100), nullable=False)
    execution_location: Mapped[str] = mapped_column(String(100), nullable=False)
    risk_level: Mapped[ApprovalRiskLevel] = mapped_column(
        Enum(ApprovalRiskLevel, native_enum=False, length=10), nullable=False
    )
    action_summary: Mapped[str] = mapped_column(String(500), nullable=False)
    arguments_preview: Mapped[dict[str, object]] = mapped_column(JSON, nullable=False, default=dict)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    status: Mapped[ApprovalStatus] = mapped_column(
        Enum(ApprovalStatus, native_enum=False, length=10),
        nullable=False,
        default=ApprovalStatus.pending,
        index=True,
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    run: Mapped[AgentRun] = relationship(back_populates="approval_requests")
    step: Mapped[AgentStep] = relationship(back_populates="approval_requests")
