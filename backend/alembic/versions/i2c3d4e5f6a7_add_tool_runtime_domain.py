"""add_tool_runtime_domain

Revision ID: i2c3d4e5f6a7
Revises: h1b2c3d4e5f6
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "i2c3d4e5f6a7"
down_revision: str | None = "h1b2c3d4e5f6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, values: list[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False)


def upgrade() -> None:
    op.create_table(
        "tool_connections",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            _enum("tool_connection_kind", ["oauth", "api_key", "mcp_http", "desktop_local"]),
            nullable=False,
        ),
        sa.Column("provider", sa.String(100), nullable=False),
        sa.Column("display_name", sa.String(120), nullable=False),
        sa.Column("secret_ref", sa.String(200), nullable=True),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            _enum("tool_connection_status", ["active", "expired", "revoked", "error"]),
            nullable=False,
        ),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tool_connections_user_id", "tool_connections", ["user_id"])
    op.create_index("ix_tool_connections_user_status", "tool_connections", ["user_id", "status"])

    op.create_table(
        "execution_nodes",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("platform", sa.String(40), nullable=False),
        sa.Column("app_version", sa.String(40), nullable=False),
        sa.Column("public_key", sa.Text(), nullable=True),
        sa.Column("capabilities", sa.JSON(), nullable=False),
        sa.Column(
            "status",
            _enum("execution_node_status", ["offline", "online", "revoked", "update_required"]),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("policy", sa.JSON(), nullable=False),
        sa.Column("pairing_code_hash", sa.String(64), nullable=True),
        sa.Column("pairing_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("pairing_code_hash"),
    )
    op.create_index("ix_execution_nodes_user_id", "execution_nodes", ["user_id"])
    op.create_index("ix_execution_nodes_user_status", "execution_nodes", ["user_id", "status"])

    op.create_table(
        "tool_executions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("step_id", sa.Uuid(), nullable=True),
        sa.Column("tool_name", sa.String(100), nullable=False),
        sa.Column("tool_version", sa.String(30), nullable=False),
        sa.Column("connection_id", sa.Uuid(), nullable=True),
        sa.Column("execution_location", sa.String(20), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=True),
        sa.Column("risk_level", sa.String(30), nullable=False),
        sa.Column("side_effect", sa.String(30), nullable=False),
        sa.Column("arguments_preview", sa.JSON(), nullable=False),
        sa.Column("arguments_hash", sa.String(64), nullable=False),
        sa.Column("idempotency_key", sa.String(120), nullable=True),
        sa.Column(
            "status",
            _enum(
                "tool_execution_status",
                ["queued", "running", "waiting", "succeeded", "failed", "cancelled"],
            ),
            nullable=False,
        ),
        sa.Column("result_summary", sa.String(1000), nullable=True),
        sa.Column("result_json", sa.JSON(), nullable=True),
        sa.Column("artifact_ids", sa.JSON(), nullable=False),
        sa.Column("error_code", sa.String(100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["agent_steps.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["connection_id"], ["tool_connections.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["node_id"], ["execution_nodes.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_tool_executions_user_id", ["user_id"]),
        ("ix_tool_executions_run_id", ["run_id"]),
        ("ix_tool_executions_step_id", ["step_id"]),
        ("ix_tool_executions_connection_id", ["connection_id"]),
        ("ix_tool_executions_node_id", ["node_id"]),
        ("ix_tool_executions_user_status", ["user_id", "status"]),
        ("ix_tool_executions_run_created", ["run_id", "created_at"]),
    ):
        op.create_index(name, "tool_executions", columns)

    op.create_table(
        "resource_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("node_id", sa.Uuid(), nullable=False),
        sa.Column(
            "kind",
            _enum("resource_grant_kind", ["file", "directory", "browser_profile", "application"]),
            nullable=False,
        ),
        sa.Column("resource_id", sa.String(200), nullable=False),
        sa.Column("display_name", sa.String(200), nullable=False),
        sa.Column("scopes", sa.JSON(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["node_id"], ["execution_nodes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_resource_grants_user_id", "resource_grants", ["user_id"])
    op.create_index("ix_resource_grants_user_node", "resource_grants", ["user_id", "node_id"])

    op.create_table(
        "artifacts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=True),
        sa.Column("tool_execution_id", sa.Uuid(), nullable=True),
        sa.Column(
            "kind",
            _enum(
                "artifact_kind",
                [
                    "document",
                    "spreadsheet",
                    "image",
                    "code",
                    "archive",
                    "browser_snapshot",
                    "log",
                    "audio",
                    "video",
                ],
            ),
            nullable=False,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("storage_key", sa.String(500), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("sensitivity", sa.String(20), nullable=False),
        sa.Column("retention_policy", sa.String(40), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("preview_json", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tool_execution_id"], ["tool_executions.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("storage_key"),
    )
    op.create_index("ix_artifacts_user_id", "artifacts", ["user_id"])
    op.create_index("ix_artifacts_run_id", "artifacts", ["run_id"])
    op.create_index(
        "ix_artifacts_user_run_created", "artifacts", ["user_id", "run_id", "created_at"]
    )

    op.create_table(
        "mcp_servers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("endpoint_url", sa.String(500), nullable=False),
        sa.Column("transport", sa.String(20), nullable=False),
        sa.Column(
            "status",
            _enum("mcp_server_status", ["pending", "active", "paused", "error", "revoked"]),
            nullable=False,
        ),
        sa.Column("schema_snapshot", sa.JSON(), nullable=True),
        sa.Column("schema_hash", sa.String(64), nullable=True),
        sa.Column("enabled_tools", sa.JSON(), nullable=False),
        sa.Column("metadata_json", sa.JSON(), nullable=False),
        sa.Column("last_verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_mcp_servers_user_id", "mcp_servers", ["user_id"])
    op.create_index("ix_mcp_servers_user_status", "mcp_servers", ["user_id", "status"])


def downgrade() -> None:
    for name, table in (
        ("ix_mcp_servers_user_status", "mcp_servers"),
        ("ix_mcp_servers_user_id", "mcp_servers"),
    ):
        op.drop_index(name, table_name=table)
    op.drop_table("mcp_servers")
    for name in ("ix_artifacts_user_run_created", "ix_artifacts_run_id", "ix_artifacts_user_id"):
        op.drop_index(name, table_name="artifacts")
    op.drop_table("artifacts")
    for name in ("ix_resource_grants_user_node", "ix_resource_grants_user_id"):
        op.drop_index(name, table_name="resource_grants")
    op.drop_table("resource_grants")
    for name in (
        "ix_tool_executions_run_created",
        "ix_tool_executions_user_status",
        "ix_tool_executions_node_id",
        "ix_tool_executions_connection_id",
        "ix_tool_executions_step_id",
        "ix_tool_executions_run_id",
        "ix_tool_executions_user_id",
    ):
        op.drop_index(name, table_name="tool_executions")
    op.drop_table("tool_executions")
    for name in ("ix_execution_nodes_user_status", "ix_execution_nodes_user_id"):
        op.drop_index(name, table_name="execution_nodes")
    op.drop_table("execution_nodes")
    for name in ("ix_tool_connections_user_status", "ix_tool_connections_user_id"):
        op.drop_index(name, table_name="tool_connections")
    op.drop_table("tool_connections")
