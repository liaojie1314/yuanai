"""backfill orphan media source messages

Revision ID: ca0b1c2d3e4f
Revises: c9a0b1c2d3e4
Create Date: 2026-08-16 16:45:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "ca0b1c2d3e4f"
down_revision: str | None = "c9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """为无法从历史记录匹配的媒体卡补建用户提问并建立来源关联。"""
    op.execute(
        """
        WITH orphaned AS (
            SELECT
                task.id AS task_id,
                task.conversation_id,
                task.prompt,
                assistant.created_at - INTERVAL '1 microsecond' AS created_at,
                gen_random_uuid() AS source_message_id
            FROM media_generation_tasks AS task
            JOIN messages AS assistant ON assistant.id = task.message_id
            WHERE task.source_message_id IS NULL
        ), inserted AS (
            INSERT INTO messages (id, conv_id, role, content, created_at)
            SELECT source_message_id, conversation_id, 'user', prompt, created_at
            FROM orphaned
            RETURNING id
        )
        UPDATE media_generation_tasks AS task
        SET source_message_id = orphaned.source_message_id
        FROM orphaned
        WHERE task.id = orphaned.task_id
        """
    )


def downgrade() -> None:
    """历史回填不安全删除，降级时保留已补建的用户消息。"""
