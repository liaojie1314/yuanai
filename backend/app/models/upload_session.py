import uuid
from datetime import datetime

from sqlalchemy import (
    JSON,
    BigInteger,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class FileUploadSession(Base):
    """分片上传会话 — 桥接前端 chunk 上传与后端 S3 多段上传。

    生命周期：
    - ``pending``     首次创建，前端在上传分片
    - ``completed``   合并成功，对应 File 已入库；此后可清理
    - ``aborted``     用户取消或过期
    """

    __tablename__ = "file_upload_sessions"
    __table_args__ = (
        # 秒传恢复 & 幂等创建：同一用户对同一文件哈希只保留一个活跃会话
        Index(
            "ix_upload_sessions_user_hash_status",
            "user_id",
            "file_hash",
            "status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    filename: Mapped[str] = mapped_column(String(255))
    mime_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    total_chunks: Mapped[int] = mapped_column(Integer)
    # 已上传分片索引（从 0 开始，对应前端切片顺序）
    uploaded_chunks: Mapped[list[int]] = mapped_column(JSON, default=list)
    file_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # S3 侧多段上传的 upload_id（LocalStorage 也复用同一字段）
    s3_upload_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # 目标对象 key（用户 id 前缀 + 会话 id + 扩展名）
    s3_key: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # 已上传分片的 S3 ETag 记录：[{"PartNumber": 1, "ETag": "..."}]
    s3_parts: Mapped[list[dict[str, object]]] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="pending")
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
