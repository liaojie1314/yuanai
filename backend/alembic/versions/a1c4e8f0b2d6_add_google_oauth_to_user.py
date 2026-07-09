"""add_google_oauth_to_user

Revision ID: a1c4e8f0b2d6
Revises: f9a3b7c214e5
Create Date: 2026-07-09 15:40:00.000000

新增 users.google_id 用于关联 Google 三方账号（OpenID Connect subject），
与 github_id 平行；同一 Google 账号仅能绑定一个本地用户（唯一约束）。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'a1c4e8f0b2d6'
down_revision: Union[str, None] = 'f9a3b7c214e5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('google_id', sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint('uq_users_google_id', 'users', ['google_id'])


def downgrade() -> None:
    op.drop_constraint('uq_users_google_id', 'users', type_='unique')
    op.drop_column('users', 'google_id')
