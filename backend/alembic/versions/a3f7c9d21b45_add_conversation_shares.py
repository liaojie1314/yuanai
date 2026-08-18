"""add_conversation_shares

Revision ID: a3f7c9d21b45
Revises: 8b2c4f3d1a7e
Create Date: 2026-07-05 10:00:00.000000

"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "a3f7c9d21b45"
down_revision: str | None = "8b2c4f3d1a7e"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "conversation_shares",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("conv_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("share_token", sa.String(length=64), nullable=False),
        sa.Column(
            "title_snapshot", sa.String(length=200), nullable=False, server_default="分享的对话"
        ),
        sa.Column("is_revoked", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["conv_id"], ["conversations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_conversation_shares_conv_id", "conversation_shares", ["conv_id"])
    op.create_index(
        "ix_conversation_shares_share_token", "conversation_shares", ["share_token"], unique=True
    )


def downgrade() -> None:
    op.drop_index("ix_conversation_shares_share_token", table_name="conversation_shares")
    op.drop_index("ix_conversation_shares_conv_id", table_name="conversation_shares")
    op.drop_table("conversation_shares")
