"""add_user_preferences_and_bio

Revision ID: b8e2a5f4c917
Revises: a3f7c9d21b45
Create Date: 2026-07-05 10:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'b8e2a5f4c917'
down_revision: Union[str, None] = 'a3f7c9d21b45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('users', sa.Column('bio', sa.String(length=200), nullable=True))
    op.add_column('users', sa.Column('theme', sa.String(length=10), nullable=False, server_default='auto'))
    op.add_column('users', sa.Column('font_size', sa.String(length=10), nullable=False, server_default='medium'))
    op.add_column('users', sa.Column('density', sa.String(length=10), nullable=False, server_default='standard'))
    op.add_column('users', sa.Column('time_format', sa.String(length=5), nullable=False, server_default='24h'))
    op.add_column('users', sa.Column('date_format', sa.String(length=5), nullable=False, server_default='ymd'))
    op.add_column('users', sa.Column('language', sa.String(length=10), nullable=False, server_default='zh-CN'))


def downgrade() -> None:
    op.drop_column('users', 'language')
    op.drop_column('users', 'date_format')
    op.drop_column('users', 'time_format')
    op.drop_column('users', 'density')
    op.drop_column('users', 'font_size')
    op.drop_column('users', 'theme')
    op.drop_column('users', 'bio')
