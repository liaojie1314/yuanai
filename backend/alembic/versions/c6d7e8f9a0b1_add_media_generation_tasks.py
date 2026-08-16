"""add_media_generation_tasks

Revision ID: c6d7e8f9a0b1
Revises: b5c9d4e7f2a1
Create Date: 2026-08-16 12:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c6d7e8f9a0b1"
down_revision: str | None = "b5c9d4e7f2a1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """创建可恢复媒体任务表及其热路径索引。"""
    op.create_table(
        "media_generation_tasks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=False),
        sa.Column("message_id", sa.Uuid(), nullable=False),
        sa.Column("kind", sa.String(length=8), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("prompt", sa.Text(), nullable=False),
        sa.Column("request_options", sa.JSON(), nullable=False, server_default=sa.text("'{}'")),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("progress", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("provider_task_id", sa.String(length=200), nullable=True),
        sa.Column("provider_video_id", sa.String(length=200), nullable=True),
        sa.Column("result_s3_key", sa.String(length=500), nullable=True),
        sa.Column("result_mime_type", sa.String(length=100), nullable=True),
        sa.Column("result_width", sa.Integer(), nullable=True),
        sa.Column("result_height", sa.Integer(), nullable=True),
        sa.Column("result_duration_seconds", sa.Float(), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.String(length=500), nullable=True),
        sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()
        ),
        sa.CheckConstraint("kind IN ('image', 'video')", name="ck_media_generation_kind"),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'succeeded', 'failed', 'canceled')",
            name="ck_media_generation_status",
        ),
        sa.CheckConstraint(
            "progress >= 0 AND progress <= 100",
            name="ck_media_generation_progress",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["message_id"], ["messages.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("message_id"),
    )
    op.create_index(
        "ix_media_generation_tasks_conversation_id",
        "media_generation_tasks",
        ["conversation_id"],
    )
    op.create_index(
        "ix_media_generation_tasks_user_id_status", "media_generation_tasks", ["user_id", "status"]
    )
    op.create_index(
        "ix_media_generation_tasks_status_lease",
        "media_generation_tasks",
        ["status", "lease_expires_at"],
    )


def downgrade() -> None:
    """移除媒体任务表及其索引。"""
    op.drop_index("ix_media_generation_tasks_status_lease", table_name="media_generation_tasks")
    op.drop_index("ix_media_generation_tasks_user_id_status", table_name="media_generation_tasks")
    op.drop_index("ix_media_generation_tasks_conversation_id", table_name="media_generation_tasks")
    op.drop_table("media_generation_tasks")
