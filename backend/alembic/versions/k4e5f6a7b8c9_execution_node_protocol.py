"""add execution node protocol state"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "k4e5f6a7b8c9"
down_revision: str | None = "j3d4e5f6a7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("tool_executions", sa.Column("arguments_encrypted", sa.Text(), nullable=True))
    op.add_column(
        "tool_executions", sa.Column("node_delivery_status", sa.String(20), nullable=True)
    )
    op.add_column(
        "tool_executions",
        sa.Column("node_last_delivered_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column(
        "tool_executions",
        sa.Column("node_acknowledged_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.add_column("tool_executions", sa.Column("node_progress", sa.Integer(), nullable=True))
    op.add_column(
        "execution_nodes",
        sa.Column("token_version", sa.Integer(), nullable=False, server_default="0"),
    )


def downgrade() -> None:
    op.drop_column("execution_nodes", "token_version")
    op.drop_column("tool_executions", "node_progress")
    op.drop_column("tool_executions", "node_acknowledged_at")
    op.drop_column("tool_executions", "node_last_delivered_at")
    op.drop_column("tool_executions", "node_delivery_status")
    op.drop_column("tool_executions", "arguments_encrypted")
