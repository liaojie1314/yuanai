"""add_share_password

Revision ID: c4d1f6a89e30
Revises: b8e2a5f4c917
Create Date: 2026-07-05 19:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'c4d1f6a89e30'
down_revision: Union[str, None] = 'b8e2a5f4c917'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'conversation_shares',
        sa.Column('password_hash', sa.String(length=255), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('conversation_shares', 'password_hash')
