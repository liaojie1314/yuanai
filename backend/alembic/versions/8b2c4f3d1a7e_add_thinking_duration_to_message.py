"""add_thinking_duration_to_message

Revision ID: 8b2c4f3d1a7e
Revises: 0e5e89b7b1d8
Create Date: 2026-07-02 20:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8b2c4f3d1a7e'
down_revision: Union[str, None] = '0e5e89b7b1d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('messages', sa.Column('thinking_duration_ms', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('messages', 'thinking_duration_ms')
