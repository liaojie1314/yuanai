"""add_skill_evaluations

Revision ID: w8b9c0d1e2f3
Revises: v7a8b9c0d1e2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "w8b9c0d1e2f3"
down_revision: str | None = "v7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """落地 Skill 版本评测记录表，作为替换 active 版本的门禁依据。

    `estimated_cost_usd` 与 `avg_steps` 可空：静态契约评测不执行 Skill，没有真实
    成本与步数可测，留空比写 0 诚实。`mode` 区分这两类数据来源，读取方据此判断
    指标是否可信。
    """

    op.create_table(
        "skill_evaluations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("version_id", sa.Uuid(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column(
            "mode",
            sa.String(length=20),
            nullable=False,
            server_default=sa.text("'static_contract'"),
        ),
        sa.Column("case_results", sa.JSON(), nullable=False),
        sa.Column("total_cases", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("passed_cases", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column("pass_rate", sa.Numeric(precision=5, scale=4), nullable=False),
        sa.Column("estimated_cost_usd", sa.Numeric(precision=12, scale=6), nullable=True),
        sa.Column("avg_steps", sa.Numeric(precision=6, scale=2), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["version_id"], ["skill_versions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_skill_evaluations_skill_id", "skill_evaluations", ["skill_id"])
    op.create_index("ix_skill_evaluations_version_id", "skill_evaluations", ["version_id"])
    op.create_index(
        "ix_skill_evaluations_version_created", "skill_evaluations", ["version_id", "created_at"]
    )
    op.create_index(
        "ix_skill_evaluations_skill_created", "skill_evaluations", ["skill_id", "created_at"]
    )


def downgrade() -> None:
    """删除评测记录表；门禁随之失效，已激活版本不受影响。"""

    op.drop_index("ix_skill_evaluations_skill_created", table_name="skill_evaluations")
    op.drop_index("ix_skill_evaluations_version_created", table_name="skill_evaluations")
    op.drop_index("ix_skill_evaluations_version_id", table_name="skill_evaluations")
    op.drop_index("ix_skill_evaluations_skill_id", table_name="skill_evaluations")
    op.drop_table("skill_evaluations")
