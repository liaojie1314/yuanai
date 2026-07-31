import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class ExpoPushToken(Base):
    """移动端 Expo Push token（与 Web 的 push_subscriptions 并列的另一条推送通道）。

    一个用户可有多台设备，与 users 多对一；`token` 形如
    `ExponentPushToken[xxxx]`，由 Expo Push Service 分配、全局唯一，用它做唯一
    约束以支持「同一设备重复上报即幂等更新归属」。用户删除时级联清理。
    """

    __tablename__ = "expo_push_tokens"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    # 'ios' | 'android'（Platform.OS 原样上报，用于排查与统计）
    platform: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
