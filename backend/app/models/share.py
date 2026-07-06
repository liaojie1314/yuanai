import uuid
from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ConversationShare(Base):
    """会话公开分享链接。

    生成后即可通过 `share_token` 匿名访问对应会话的只读快照。
    - `is_revoked=True` 表示分享者已撤销，前端拒绝访问。
    - `expires_at` 为 None 表示永不过期。
    - `password_hash` 非空表示访问需要口令（bcrypt hash）。
    """

    __tablename__ = "conversation_shares"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conv_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    share_token: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    title_snapshot: Mapped[str] = mapped_column(String(200), nullable=False, default="分享的对话")
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    password_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
