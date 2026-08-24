"""add_agent_runtime_domain

Revision ID: g0a1b2c3d4e5
Revises: cc1d2e3f4a5b, f9a3b7c214e5
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "g0a1b2c3d4e5"
down_revision: tuple[str, str] = ("cc1d2e3f4a5b", "f9a3b7c214e5")
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "assistants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("instructions", sa.Text(), nullable=False),
        sa.Column("default_model", sa.String(length=100), nullable=False),
        sa.Column("autonomy_level", sa.String(length=16), nullable=False),
        sa.Column("is_default", sa.Boolean(), nullable=False),
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
    op.create_index("ix_assistants_user_id", "assistants", ["user_id"])
    op.create_index(
        "uq_assistants_user_default",
        "assistants",
        ["user_id"],
        unique=True,
        postgresql_where=sa.text("is_default"),
    )

    op.create_table(
        "agent_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("conversation_id", sa.Uuid(), nullable=True),
        sa.Column("parent_run_id", sa.Uuid(), nullable=True),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("max_steps", sa.SmallInteger(), nullable=False),
        sa.Column("current_step", sa.SmallInteger(), nullable=False),
        sa.Column("idempotency_key", sa.String(length=100), nullable=True),
        sa.Column("input_tokens", sa.Integer(), nullable=False),
        sa.Column("output_tokens", sa.Integer(), nullable=False),
        sa.Column("estimated_cost_usd", sa.Numeric(precision=12, scale=6), nullable=False),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column(
            "queued_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False
        ),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["conversation_id"], ["conversations.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["parent_run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "idempotency_key", name="uq_agent_runs_user_idempotency"),
    )
    for name, columns in (
        ("ix_agent_runs_user_id", ["user_id"]),
        ("ix_agent_runs_assistant_id", ["assistant_id"]),
        ("ix_agent_runs_conversation_id", ["conversation_id"]),
        ("ix_agent_runs_parent_run_id", ["parent_run_id"]),
        ("ix_agent_runs_status", ["status"]),
        ("ix_agent_runs_user_status_created", ["user_id", "status", "created_at"]),
    ):
        op.create_index(name, "agent_runs", columns)

    op.create_table(
        "agent_steps",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("input_json", sa.JSON(), nullable=True),
        sa.Column("output_json", sa.JSON(), nullable=True),
        sa.Column("error_code", sa.String(length=100), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_agent_steps_run_sequence"),
    )
    op.create_index("ix_agent_steps_run_id", "agent_steps", ["run_id"])
    op.create_index("ix_agent_steps_run_status", "agent_steps", ["run_id", "status"])

    op.create_table(
        "agent_events",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=60), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_agent_events_run_sequence"),
    )
    op.create_index("ix_agent_events_run_id", "agent_events", ["run_id"])
    op.create_index("ix_agent_events_run_created", "agent_events", ["run_id", "created_at"])

    op.create_table(
        "approval_requests",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("step_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("tool_name", sa.String(length=100), nullable=False),
        sa.Column("execution_location", sa.String(length=100), nullable=False),
        sa.Column("risk_level", sa.String(length=10), nullable=False),
        sa.Column("action_summary", sa.String(length=500), nullable=False),
        sa.Column("arguments_preview", sa.JSON(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("status", sa.String(length=10), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("decision_note", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["run_id"], ["agent_runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["step_id"], ["agent_steps.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    for name, columns in (
        ("ix_approval_requests_run_id", ["run_id"]),
        ("ix_approval_requests_step_id", ["step_id"]),
        ("ix_approval_requests_user_id", ["user_id"]),
        ("ix_approval_requests_payload_hash", ["payload_hash"]),
        ("ix_approval_requests_status", ["status"]),
    ):
        op.create_index(name, "approval_requests", columns)


def downgrade() -> None:
    for name in (
        "ix_approval_requests_status",
        "ix_approval_requests_payload_hash",
        "ix_approval_requests_user_id",
        "ix_approval_requests_step_id",
        "ix_approval_requests_run_id",
    ):
        op.drop_index(name, table_name="approval_requests")
    op.drop_table("approval_requests")
    op.drop_index("ix_agent_events_run_created", table_name="agent_events")
    op.drop_index("ix_agent_events_run_id", table_name="agent_events")
    op.drop_table("agent_events")
    op.drop_index("ix_agent_steps_run_status", table_name="agent_steps")
    op.drop_index("ix_agent_steps_run_id", table_name="agent_steps")
    op.drop_table("agent_steps")
    for name in (
        "ix_agent_runs_user_status_created",
        "ix_agent_runs_status",
        "ix_agent_runs_parent_run_id",
        "ix_agent_runs_conversation_id",
        "ix_agent_runs_assistant_id",
        "ix_agent_runs_user_id",
    ):
        op.drop_index(name, table_name="agent_runs")
    op.drop_table("agent_runs")
    op.drop_index("uq_assistants_user_default", table_name="assistants")
    op.drop_index("ix_assistants_user_id", table_name="assistants")
    op.drop_table("assistants")
