"""allow music media generation tasks

Revision ID: h1b2c3d4e5f6
Revises: g0a1b2c3d4e5
Create Date: 2026-08-24 16:40:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "h1b2c3d4e5f6"
down_revision: str | None = "g0a1b2c3d4e5"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """允许媒体任务使用音乐类型。"""
    op.drop_constraint("ck_media_generation_kind", "media_generation_tasks", type_="check")
    op.create_check_constraint(
        "ck_media_generation_kind",
        "media_generation_tasks",
        "kind IN ('image', 'video', 'music')",
    )


def downgrade() -> None:
    """回滚音乐媒体任务类型约束。"""
    op.drop_constraint("ck_media_generation_kind", "media_generation_tasks", type_="check")
    op.create_check_constraint(
        "ck_media_generation_kind",
        "media_generation_tasks",
        "kind IN ('image', 'video')",
    )
