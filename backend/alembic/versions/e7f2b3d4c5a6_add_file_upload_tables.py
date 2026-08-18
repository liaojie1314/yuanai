"""add_file_upload_tables

Revision ID: e7f2b3d4c5a6
Revises: d5e8a1c2f3b4
Create Date: 2026-07-06 00:01:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "e7f2b3d4c5a6"
down_revision: str | None = "d5e8a1c2f3b4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # files 表增加 file_hash 列（秒传去重）
    op.add_column(
        "files",
        sa.Column("file_hash", sa.String(length=64), nullable=True),
    )
    op.create_index("ix_files_file_hash", "files", ["file_hash"])

    # 分片上传会话表 — 桥接前端切片与后端 S3 multipart 上传
    op.create_table(
        "file_upload_sessions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("total_chunks", sa.Integer(), nullable=False),
        sa.Column("uploaded_chunks", sa.JSON(), nullable=False),
        sa.Column("file_hash", sa.String(length=64), nullable=True),
        sa.Column("s3_upload_id", sa.String(length=255), nullable=True),
        sa.Column("s3_key", sa.String(length=500), nullable=True),
        sa.Column("s3_parts", sa.JSON(), nullable=False, server_default="[]"),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="pending"),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_file_upload_sessions_user_id", "file_upload_sessions", ["user_id"])
    # 幂等创建：同一用户 + 同一 hash + status 组合的复合索引，加速 find-or-create
    op.create_index(
        "ix_upload_sessions_user_hash_status",
        "file_upload_sessions",
        ["user_id", "file_hash", "status"],
    )


def downgrade() -> None:
    op.drop_index("ix_upload_sessions_user_hash_status", table_name="file_upload_sessions")
    op.drop_index("ix_file_upload_sessions_user_id", table_name="file_upload_sessions")
    op.drop_table("file_upload_sessions")
    op.drop_index("ix_files_file_hash", table_name="files")
    op.drop_column("files", "file_hash")
