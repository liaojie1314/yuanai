"""add_github_oauth_to_user

Revision ID: f9a3b7c214e5
Revises: e7f2b3d4c5a6
Create Date: 2026-07-09 14:00:00.000000

新增 users.github_id 用于关联 GitHub 三方账号；同时把 hashed_password 改为可空，
以便纯 GitHub 注册的用户无本地密码。
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'f9a3b7c214e5'
down_revision: Union[str, None] = 'e7f2b3d4c5a6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column('github_id', sa.String(length=64), nullable=True),
    )
    op.create_unique_constraint('uq_users_github_id', 'users', ['github_id'])
    op.alter_column('users', 'hashed_password', existing_type=sa.String(length=255), nullable=True)


def downgrade() -> None:
    # 回滚前需要保证 hashed_password 都非空（迁移后新增的 OAuth-only 用户会破坏该约束）
    op.alter_column('users', 'hashed_password', existing_type=sa.String(length=255), nullable=False)
    op.drop_constraint('uq_users_github_id', 'users', type_='unique')
    op.drop_column('users', 'github_id')
