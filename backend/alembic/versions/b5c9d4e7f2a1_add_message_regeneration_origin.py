"""add_message_regeneration_origin

Revision ID: b5c9d4e7f2a1
Revises: b4f8c2d6e0a3
Create Date: 2026-08-15 18:40:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "b5c9d4e7f2a1"
down_revision: str | None = "b4f8c2d6e0a3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "messages",
        sa.Column("regenerated_from_message_id", sa.Uuid(), nullable=True),
    )
    op.create_foreign_key(
        "fk_messages_regenerated_from_message_id",
        "messages",
        "messages",
        ["regenerated_from_message_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_messages_regenerated_from_message_id",
        "messages",
        ["regenerated_from_message_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_messages_regenerated_from_message_id", table_name="messages")
    op.drop_constraint("fk_messages_regenerated_from_message_id", "messages", type_="foreignkey")
    op.drop_column("messages", "regenerated_from_message_id")
