"""add_conversation_title_metadata

Revision ID: b3e7d9a4c1f2
Revises: a2d4e6f8b0c1
Create Date: 2026-08-15 18:10:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b3e7d9a4c1f2"
down_revision: str | None = "a2d4e6f8b0c1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "conversations",
        sa.Column(
            "title_source",
            sa.String(length=16),
            nullable=False,
            server_default="default",
        ),
    )
    op.add_column(
        "conversations",
        sa.Column("title_generated_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.alter_column("conversations", "title_source", server_default=None)


def downgrade() -> None:
    op.drop_column("conversations", "title_generated_at")
    op.drop_column("conversations", "title_source")
