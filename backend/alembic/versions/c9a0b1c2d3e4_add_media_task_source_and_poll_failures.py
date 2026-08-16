"""add media task source and poll failures

Revision ID: c9a0b1c2d3e4
Revises: c8f9a0b1c2d3
Create Date: 2026-08-16 16:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c9a0b1c2d3e4"
down_revision: str | None = "c8f9a0b1c2d3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """为媒体任务补充来源消息关联及视频轮询失败计数。"""
    op.add_column(
        "media_generation_tasks",
        sa.Column("source_message_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_media_generation_tasks_source_message_id_messages",
        "media_generation_tasks",
        "messages",
        ["source_message_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_index(
        "ix_media_generation_tasks_source_message_id",
        "media_generation_tasks",
        ["source_message_id"],
    )
    op.execute(
        """
        UPDATE media_generation_tasks AS task
        SET source_message_id = (
            SELECT message.id
            FROM messages AS message
            JOIN messages AS assistant ON assistant.id = task.message_id
            WHERE message.conv_id = task.conversation_id
              AND message.role = 'user'
              AND message.content = task.prompt
              AND message.created_at <= assistant.created_at
            ORDER BY message.created_at DESC, message.id DESC
            LIMIT 1
        )
        WHERE task.source_message_id IS NULL
        """
    )
    op.add_column(
        "media_generation_tasks",
        sa.Column("poll_failure_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("media_generation_tasks", "poll_failure_count", server_default=None)


def downgrade() -> None:
    """移除来源关联和轮询重试计数。"""
    op.drop_column("media_generation_tasks", "poll_failure_count")
    op.drop_index(
        "ix_media_generation_tasks_source_message_id",
        table_name="media_generation_tasks",
    )
    op.drop_constraint(
        "fk_media_generation_tasks_source_message_id_messages",
        "media_generation_tasks",
        type_="foreignkey",
    )
    op.drop_column("media_generation_tasks", "source_message_id")
