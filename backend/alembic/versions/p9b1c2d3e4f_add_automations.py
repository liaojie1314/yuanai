"""add_automations

Revision ID: p9b1c2d3e4f
Revises: p9a0b1c2d3e4
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "p9b1c2d3e4f"
down_revision: str | None = "p9a0b1c2d3e4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, values: list[str]) -> sa.Enum:
    """Create a portable string-backed enum for the automation tables."""

    return sa.Enum(*values, name=name, native_enum=False)


def upgrade() -> None:
    """Create automation definitions, triggers, and run mappings."""

    op.create_table(
        "automations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("goal", sa.Text(), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=True),
        sa.Column("max_steps", sa.Integer(), nullable=False, server_default=sa.text("12")),
        sa.Column("timezone", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            _enum("automation_status", ["active", "paused", "completed"]),
            nullable=False,
            server_default=sa.text("'active'"),
        ),
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
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_automations_user_id", "automations", ["user_id"])
    op.create_index("ix_automations_assistant_id", "automations", ["assistant_id"])
    op.create_index("ix_automations_user_status", "automations", ["user_id", "status"])

    op.create_table(
        "automation_triggers",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("automation_id", sa.Uuid(), nullable=False),
        sa.Column(
            "trigger_type",
            _enum("automation_trigger_type", ["once", "cron"]),
            nullable=False,
        ),
        sa.Column("cron_expression", sa.String(length=120), nullable=True),
        sa.Column("scheduled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("next_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("occurrence", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.ForeignKeyConstraint(["automation_id"], ["automations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("automation_id", name="uq_automation_triggers_automation"),
    )
    op.create_index(
        "ix_automation_triggers_automation_id", "automation_triggers", ["automation_id"]
    )
    op.create_index("ix_automation_triggers_next_run_at", "automation_triggers", ["next_run_at"])

    op.create_table(
        "automation_runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("automation_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("agent_run_id", sa.Uuid(), nullable=True),
        sa.Column("occurrence_key", sa.String(length=120), nullable=False),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "status",
            _enum(
                "automation_run_status",
                [
                    "queued",
                    "running",
                    "waiting_approval",
                    "waiting_input",
                    "succeeded",
                    "failed",
                    "cancelled",
                ],
            ),
            nullable=False,
            server_default=sa.text("'queued'"),
        ),
        sa.Column("wait_deadline", sa.DateTime(timezone=True), nullable=True),
        sa.Column("wait_reason", sa.String(length=200), nullable=True),
        sa.Column("wait_notified_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["agent_run_id"], ["agent_runs.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["automation_id"], ["automations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "automation_id", "occurrence_key", name="uq_automation_runs_occurrence"
        ),
        sa.UniqueConstraint("agent_run_id", name="uq_automation_runs_agent_run"),
    )
    op.create_index("ix_automation_runs_automation_id", "automation_runs", ["automation_id"])
    op.create_index("ix_automation_runs_user_id", "automation_runs", ["user_id"])
    op.create_index("ix_automation_runs_user_created", "automation_runs", ["user_id", "created_at"])


def downgrade() -> None:
    """Drop automation tables in dependency order."""

    op.drop_index("ix_automation_runs_user_created", table_name="automation_runs")
    op.drop_index("ix_automation_runs_user_id", table_name="automation_runs")
    op.drop_index("ix_automation_runs_automation_id", table_name="automation_runs")
    op.drop_table("automation_runs")
    op.drop_index("ix_automation_triggers_next_run_at", table_name="automation_triggers")
    op.drop_index("ix_automation_triggers_automation_id", table_name="automation_triggers")
    op.drop_table("automation_triggers")
    op.drop_index("ix_automations_user_status", table_name="automations")
    op.drop_index("ix_automations_assistant_id", table_name="automations")
    op.drop_index("ix_automations_user_id", table_name="automations")
    op.drop_table("automations")
