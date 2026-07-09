import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class PushSubscription(Base):
    """Web Push 订阅（浏览器 PushSubscription 序列化后落库）。

    一个用户可在多设备/多浏览器订阅，故与 users 是多对一；`endpoint` 是推送服务
    分配的唯一地址，用它做唯一约束以支持「同一订阅重复上报即幂等更新」。
    用户删除时级联清理（ondelete=CASCADE）。
    """

    __tablename__ = "push_subscriptions"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    # 推送服务端点 URL（FCM/Mozilla/WNS 等），可长达数百字符
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True, nullable=False)
    # 客户端 ECDH 公钥（base64url，约 88 字符）
    p256dh: Mapped[str] = mapped_column(String(255), nullable=False)
    # 客户端 auth secret（base64url，约 24 字符）
    auth: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
