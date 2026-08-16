import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class Conversation(Base):
    __tablename__ = "conversations"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="新对话")
    # default: 尚未发送首问；fallback: 已写入首问截断标题；ai/manual: 最终标题来源。
    title_source: Mapped[str] = mapped_column(String(16), nullable=False, default="default")
    title_generated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    model: Mapped[str] = mapped_column(String(100), nullable=False)
    is_pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    # 最新消息时间：前端「今天/昨天/本周」分组与列表排序的依据。
    # 新建且未发消息时为 NULL（前端回退 createdAt）。
    last_message_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
