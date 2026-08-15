"""add_qr_login_challenges

Revision ID: a2d4e6f8b0c1
Revises: f1a2b3c4d5e6
Create Date: 2026-08-15 11:40:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a2d4e6f8b0c1"
down_revision: Union[str, None] = "f1a2b3c4d5e6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "qr_login_challenges",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("challenge_hash", sa.String(length=64), nullable=False),
        sa.Column("poll_secret_hash", sa.String(length=64), nullable=False),
        sa.Column("authorization_code_hash", sa.String(length=64), nullable=True),
        sa.Column("target_platform", sa.String(length=16), nullable=False),
        sa.Column("device_name", sa.String(length=120), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("approved_user_id", sa.Uuid(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["approved_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("challenge_hash"),
        sa.UniqueConstraint("poll_secret_hash"),
    )
    op.create_index("ix_qr_login_challenges_challenge_hash", "qr_login_challenges", ["challenge_hash"])
    op.create_index("ix_qr_login_challenges_poll_secret_hash", "qr_login_challenges", ["poll_secret_hash"])
    op.create_index("ix_qr_login_challenges_approved_user_id", "qr_login_challenges", ["approved_user_id"])
    op.create_index("ix_qr_login_challenges_expires_at", "qr_login_challenges", ["expires_at"])

    op.create_table(
        "qr_login_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("challenge_id", sa.Uuid(), nullable=False),
        sa.Column("actor_user_id", sa.Uuid(), nullable=True),
        sa.Column("action", sa.String(length=16), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.ForeignKeyConstraint(["challenge_id"], ["qr_login_challenges.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["actor_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_qr_login_events_challenge_id", "qr_login_events", ["challenge_id"])
    op.create_index("ix_qr_login_events_actor_user_id", "qr_login_events", ["actor_user_id"])


def downgrade() -> None:
    op.drop_index("ix_qr_login_events_actor_user_id", table_name="qr_login_events")
    op.drop_index("ix_qr_login_events_challenge_id", table_name="qr_login_events")
    op.drop_table("qr_login_events")
    op.drop_index("ix_qr_login_challenges_expires_at", table_name="qr_login_challenges")
    op.drop_index("ix_qr_login_challenges_approved_user_id", table_name="qr_login_challenges")
    op.drop_index("ix_qr_login_challenges_poll_secret_hash", table_name="qr_login_challenges")
    op.drop_index("ix_qr_login_challenges_challenge_hash", table_name="qr_login_challenges")
    op.drop_table("qr_login_challenges")
