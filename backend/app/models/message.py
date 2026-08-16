import uuid
from datetime import datetime
from enum import StrEnum

from sqlalchemy import JSON, DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class MessageRole(StrEnum):
    user = "user"
    assistant = "assistant"
    system = "system"


class Message(Base):
    __tablename__ = "messages"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    conv_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("conversations.id", ondelete="CASCADE"), index=True
    )
    role: Mapped[MessageRole] = mapped_column(Enum(MessageRole), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    # 显式记录重新生成来自哪条用户问题；普通重复提问必须保持 None。
    regenerated_from_message_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("messages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # 思考/推理过程文字（仅 assistant 消息，模型不支持时为 None）
    thinking_content: Mapped[str | None] = mapped_column(Text, nullable=True)
    # 思考耗时（毫秒）：首个 reasoning token 到首个 content token 的间隔。
    # None 表示未开启或未产生思考。
    thinking_duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 已完成工具调用的安全摘要，用于会话重载后恢复来源链接和执行状态。
    tool_calls: Mapped[list[dict[str, object]] | None] = mapped_column(JSON, nullable=True)
    model: Mapped[str | None] = mapped_column(String(100))
    tokens_used: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), index=True
    )
