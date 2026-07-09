import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    username: Mapped[str] = mapped_column(String(50), unique=True, nullable=False)
    # 纯 OAuth 注册的用户没有密码，允许 NULL；本地登录路径依旧要求非空（服务层校验）
    hashed_password: Mapped[str | None] = mapped_column(String(255), nullable=True)
    avatar_url: Mapped[str | None] = mapped_column(String(500))
    bio: Mapped[str | None] = mapped_column(String(200), nullable=True)
    # 三方登录：GitHub 用户 id（字符串化）。同一 GitHub 账号只能关联一个本地账户
    github_id: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    password_changed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    # ── 用户偏好设置 ───────────────────────────────────
    theme: Mapped[str] = mapped_column(String(10), nullable=False, default="auto")
    font_size: Mapped[str] = mapped_column(String(10), nullable=False, default="medium")
    density: Mapped[str] = mapped_column(String(10), nullable=False, default="standard")
    time_format: Mapped[str] = mapped_column(String(5), nullable=False, default="24h")
    date_format: Mapped[str] = mapped_column(String(5), nullable=False, default="ymd")
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="zh-CN")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
