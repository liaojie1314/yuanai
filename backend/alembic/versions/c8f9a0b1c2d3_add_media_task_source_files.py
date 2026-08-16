"""add_media_task_source_files

Revision ID: c8f9a0b1c2d3
Revises: c7e8f9a0b1c2
Create Date: 2026-08-16 15:30:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "c8f9a0b1c2d3"
down_revision: str | None = "c7e8f9a0b1c2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """为可恢复的图像参考输入存储无路径 UUID 列表。"""
    op.add_column(
        "media_generation_tasks",
        sa.Column("source_file_ids", sa.JSON(), nullable=False, server_default="[]"),
    )
    op.alter_column("media_generation_tasks", "source_file_ids", server_default=None)


def downgrade() -> None:
    """移除任务中的参考文件标识。"""
    op.drop_column("media_generation_tasks", "source_file_ids")
