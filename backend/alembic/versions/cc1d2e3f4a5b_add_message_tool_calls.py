"""add_message_tool_calls

Revision ID: cc1d2e3f4a5b
Revises: cb0c1d2e3f4a
Create Date: 2026-08-16 16:20:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "cc1d2e3f4a5b"
down_revision: str | None = "cb0c1d2e3f4a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("tool_calls", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "tool_calls")
