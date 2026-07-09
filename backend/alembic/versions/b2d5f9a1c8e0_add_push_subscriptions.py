"""add_push_subscriptions

Revision ID: b2d5f9a1c8e0
Revises: a1c4e8f0b2d6
Create Date: 2026-07-09 16:50:00.000000

新增 push_subscriptions 表，保存浏览器 Web Push 订阅（endpoint + p256dh + auth），
供 AI 回复结束时服务端主动推送。endpoint 唯一（同一订阅重复上报幂等），
user_id 外键级联删除。
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b2d5f9a1c8e0"
down_revision: Union[str, None] = "a1c4e8f0b2d6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "push_subscriptions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("endpoint", sa.String(length=1000), nullable=False),
        sa.Column("p256dh", sa.String(length=255), nullable=False),
        sa.Column("auth", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("endpoint", name="uq_push_subscriptions_endpoint"),
    )
    op.create_index("ix_push_subscriptions_user_id", "push_subscriptions", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_push_subscriptions_user_id", table_name="push_subscriptions")
    op.drop_table("push_subscriptions")
