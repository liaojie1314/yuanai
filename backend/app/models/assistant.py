"""Agent 助理配置模型。"""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text, func, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.agent_run import AgentRun


class AssistantAutonomyLevel(StrEnum):
    """助理允许的自主程度。"""

    conservative = "conservative"
    balanced = "balanced"
    autonomous = "autonomous"


class Assistant(Base):
    """用户拥有的 Agent 助理配置。"""

    __tablename__ = "assistants"
    __table_args__ = (
        Index(
            "uq_assistants_user_default",
            "user_id",
            unique=True,
            postgresql_where=text("is_default"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    instructions: Mapped[str] = mapped_column(Text, nullable=False, default="")
    default_model: Mapped[str] = mapped_column(String(100), nullable=False)
    autonomy_level: Mapped[AssistantAutonomyLevel] = mapped_column(
        Enum(AssistantAutonomyLevel, native_enum=False, length=16),
        nullable=False,
        default=AssistantAutonomyLevel.balanced,
    )
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    runs: Mapped[list[AgentRun]] = relationship(
        back_populates="assistant", cascade="all, delete-orphan"
    )
