"""add_last_message_at_to_conversation

Revision ID: f1a2b3c4d5e6
Revises: e6c8b2f5d4a1
Create Date: 2026-07-31 23:15:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, None] = 'e6c8b2f5d4a1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        'conversations',
        sa.Column('last_message_at', sa.DateTime(timezone=True), nullable=True),
    )
    # 回填历史会话：取该会话最新一条消息的 created_at；无消息的保持 NULL
    op.execute(
        """
        UPDATE conversations c
        SET last_message_at = m.max_created_at
        FROM (
            SELECT conv_id, MAX(created_at) AS max_created_at
            FROM messages
            GROUP BY conv_id
        ) m
        WHERE m.conv_id = c.id
        """
    )


def downgrade() -> None:
    op.drop_column('conversations', 'last_message_at')
