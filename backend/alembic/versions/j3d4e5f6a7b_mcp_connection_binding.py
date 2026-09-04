"""bind MCP servers and executions to their connection records"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "j3d4e5f6a7b"
down_revision: str | None = "i2c3d4e5f6a7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.alter_column("approval_requests", "run_id", existing_type=sa.Uuid(), nullable=True)
    op.alter_column("approval_requests", "step_id", existing_type=sa.Uuid(), nullable=True)
    op.add_column("approval_requests", sa.Column("tool_execution_id", sa.Uuid(), nullable=True))
    op.create_index(
        "ix_approval_requests_tool_execution_id", "approval_requests", ["tool_execution_id"]
    )
    op.create_foreign_key(
        "fk_approval_requests_tool_execution_id",
        "approval_requests",
        "tool_executions",
        ["tool_execution_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column("mcp_servers", sa.Column("connection_id", sa.Uuid(), nullable=True))
    op.create_index("ix_mcp_servers_connection_id", "mcp_servers", ["connection_id"])
    op.create_foreign_key(
        "fk_mcp_servers_connection_id",
        "mcp_servers",
        "tool_connections",
        ["connection_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.add_column("tool_executions", sa.Column("mcp_server_id", sa.Uuid(), nullable=True))
    op.create_index("ix_tool_executions_mcp_server_id", "tool_executions", ["mcp_server_id"])
    op.create_foreign_key(
        "fk_tool_executions_mcp_server_id",
        "tool_executions",
        "mcp_servers",
        ["mcp_server_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.execute(sa.text("UPDATE mcp_servers SET status = 'revoked' WHERE connection_id IS NULL"))


def downgrade() -> None:
    op.drop_constraint("fk_tool_executions_mcp_server_id", "tool_executions", type_="foreignkey")
    op.drop_index("ix_tool_executions_mcp_server_id", table_name="tool_executions")
    op.drop_column("tool_executions", "mcp_server_id")
    op.drop_constraint("fk_mcp_servers_connection_id", "mcp_servers", type_="foreignkey")
    op.drop_index("ix_mcp_servers_connection_id", table_name="mcp_servers")
    op.drop_column("mcp_servers", "connection_id")
    op.drop_constraint(
        "fk_approval_requests_tool_execution_id", "approval_requests", type_="foreignkey"
    )
    op.drop_index("ix_approval_requests_tool_execution_id", table_name="approval_requests")
    op.drop_column("approval_requests", "tool_execution_id")
    op.alter_column("approval_requests", "step_id", existing_type=sa.Uuid(), nullable=False)
    op.alter_column("approval_requests", "run_id", existing_type=sa.Uuid(), nullable=False)
