"""add_media_task_attempt_count

Revision ID: c7e8f9a0b1c2
Revises: c6d7e8f9a0b1
Create Date: 2026-08-16 12:45:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c7e8f9a0b1c2"
down_revision: str | None = "c6d7e8f9a0b1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """为崩溃恢复提供有限重试计数器。"""
    op.add_column(
        "media_generation_tasks",
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.alter_column("media_generation_tasks", "attempt_count", server_default=None)


def downgrade() -> None:
    """移除媒体任务恢复计数器。"""
    op.drop_column("media_generation_tasks", "attempt_count")
