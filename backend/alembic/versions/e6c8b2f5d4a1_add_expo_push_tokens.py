"""add_expo_push_tokens

Revision ID: e6c8b2f5d4a1
Revises: b2d5f9a1c8e0
Create Date: 2026-07-21 10:00:00.000000

新增 expo_push_tokens 表：移动端 Expo Push token 落库，与 Web 的
push_subscriptions 并列作为第二条推送通道（Step 9）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "e6c8b2f5d4a1"
down_revision: Union[str, None] = "b2d5f9a1c8e0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "expo_push_tokens",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("token", sa.String(length=255), nullable=False),
        sa.Column("platform", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
    )
    op.create_index(
        op.f("ix_expo_push_tokens_user_id"), "expo_push_tokens", ["user_id"], unique=False
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_expo_push_tokens_user_id"), table_name="expo_push_tokens")
    op.drop_table("expo_push_tokens")
