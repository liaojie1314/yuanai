"""add media task poster

Revision ID: cb0c1d2e3f4a
Revises: ca0b1c2d3e4f
Create Date: 2026-08-16 17:15:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "cb0c1d2e3f4a"
down_revision: str | None = "ca0b1c2d3e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """保存已完成视频的对象存储首帧封面。"""
    op.add_column(
        "media_generation_tasks",
        sa.Column("result_poster_s3_key", sa.String(length=500), nullable=True),
    )


def downgrade() -> None:
    """移除视频封面对象键。"""
    op.drop_column("media_generation_tasks", "result_poster_s3_key")
