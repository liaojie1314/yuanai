"""add_webhook_endpoints

Revision ID: v7a8b9c0d1e2
Revises: u6f7a8b9c0d1
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "v7a8b9c0d1e2"
down_revision: str | None = "u6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """让自动化支持 webhook 触发，并落地公网入口表。

    `automation_triggers.trigger_type` 在库里的宽度是按当时的枚举字面量算出来的
    `varchar(4)`（只放得下 once/cron），而模型声明的是 `length=16`。测试库走
    `create_all` 用模型的宽度，所以这个差异只在迁移链上可见。这里按模型对齐到 16，
    既放得下 webhook，也让迁移库和测试库的描述一致。
    """

    op.alter_column(
        "automation_triggers",
        "trigger_type",
        existing_type=sa.String(length=4),
        type_=sa.String(length=16),
        existing_nullable=False,
    )

    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("automation_id", sa.Uuid(), nullable=False),
        sa.Column("public_id", sa.String(length=64), nullable=False),
        sa.Column("secret_ref", sa.String(length=200), nullable=False),
        sa.Column("secret_prefix", sa.String(length=12), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "rate_limit_per_minute", sa.Integer(), nullable=False, server_default=sa.text("60")
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("rotated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["automation_id"], ["automations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("automation_id", name="uq_webhook_endpoints_automation"),
        sa.UniqueConstraint("public_id", name="uq_webhook_endpoints_public_id"),
    )
    op.create_index("ix_webhook_endpoints_automation_id", "webhook_endpoints", ["automation_id"])
    op.create_index("ix_webhook_endpoints_public_id", "webhook_endpoints", ["public_id"])


def downgrade() -> None:
    """删除 Webhook 入口表并把触发类型宽度还原。

    库里可能已经有 `trigger_type = 'webhook'` 的行；把它们改成 `cron` 并清空
    `next_run_at`，否则还原到 varchar(4) 会因为超长而失败，且残留的行永远
    不会被调度器选中。清空后这些自动化停止工作，与入口被删除的语义一致。
    """

    op.drop_index("ix_webhook_endpoints_public_id", table_name="webhook_endpoints")
    op.drop_index("ix_webhook_endpoints_automation_id", table_name="webhook_endpoints")
    op.drop_table("webhook_endpoints")

    op.execute(
        "UPDATE automation_triggers SET trigger_type = 'cron', next_run_at = NULL "
        "WHERE trigger_type = 'webhook'"
    )
    op.alter_column(
        "automation_triggers",
        "trigger_type",
        existing_type=sa.String(length=16),
        type_=sa.String(length=4),
        existing_nullable=False,
    )
