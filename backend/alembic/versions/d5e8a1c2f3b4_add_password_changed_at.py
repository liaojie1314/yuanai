"""add_password_changed_at

Revision ID: d5e8a1c2f3b4
Revises: c4d1f6a89e30
Create Date: 2026-07-06 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'd5e8a1c2f3b4'
down_revision: Union[str, None] = 'c4d1f6a89e30'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('password_changed_at', sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column('users', 'password_changed_at')
