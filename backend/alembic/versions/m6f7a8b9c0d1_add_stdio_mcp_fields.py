"""add MCP stdio server configuration fields"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "m6f7a8b9c0d1"
down_revision: str | None = "l5f6a7b8c9d0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("mcp_servers", "endpoint_url", existing_type=sa.String(500), nullable=True)
    op.add_column("mcp_servers", sa.Column("command", sa.String(255), nullable=True))
    op.add_column(
        "mcp_servers",
        sa.Column("command_args", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
    )
    op.alter_column("mcp_servers", "command_args", server_default=None)


def downgrade() -> None:
    op.drop_column("mcp_servers", "command_args")
    op.drop_column("mcp_servers", "command")
    op.alter_column("mcp_servers", "endpoint_url", existing_type=sa.String(500), nullable=False)
