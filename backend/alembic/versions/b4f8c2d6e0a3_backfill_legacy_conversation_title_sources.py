"""backfill_legacy_conversation_title_sources

Revision ID: b4f8c2d6e0a3
Revises: b3e7d9a4c1f2
Create Date: 2026-08-15 16:42:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b4f8c2d6e0a3"
down_revision: str | None = "b3e7d9a4c1f2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """将历史已有用户消息的会话标记为既有标题，避免误显示生成状态。"""
    op.execute(
        sa.text(
            """
            UPDATE conversations
            SET title_source = 'manual', title_generated_at = created_at
            WHERE title_source = 'default'
              AND EXISTS (
                SELECT 1
                FROM messages
                WHERE messages.conv_id = conversations.id
                  AND messages.role = 'user'
              )
            """
        )
    )


def downgrade() -> None:
    """不恢复历史来源，以免将用户改名过的会话重新标记为待生成。"""
