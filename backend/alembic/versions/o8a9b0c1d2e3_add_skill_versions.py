"""add_skill_versions

Revision ID: o8a9b0c1d2e3
Revises: n7a8b9c0d1e2
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "o8a9b0c1d2e3"
down_revision: str | None = "n7a8b9c0d1e2"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, values: list[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False)


def upgrade() -> None:
    op.create_table(
        "skills",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("slug", sa.String(length=120), nullable=False),
        sa.Column("name", sa.String(length=120), nullable=False),
        sa.Column("description", sa.String(length=500), nullable=False),
        sa.Column("current_version_id", sa.Uuid(), nullable=True),
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
        sa.UniqueConstraint("user_id", "slug", name="uq_skills_user_slug"),
    )
    op.create_index("ix_skills_user_id", "skills", ["user_id"])
    op.create_index("ix_skills_user_updated", "skills", ["user_id", "updated_at"])
    op.create_table(
        "skill_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.String(length=30), nullable=False),
        sa.Column("manifest_text", sa.Text(), nullable=False),
        sa.Column("skill_md", sa.Text(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("required_tools", sa.JSON(), nullable=False),
        sa.Column(
            "risk_ceiling",
            _enum(
                "tool_risk",
                [
                    "read",
                    "local_write",
                    "reversible_write",
                    "external_side_effect",
                    "destructive",
                    "financial",
                    "privileged",
                ],
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            _enum(
                "skill_version_status",
                ["draft", "validating", "validated", "active", "rejected", "deprecated"],
            ),
            nullable=False,
            server_default=sa.text("'draft'"),
        ),
        sa.Column("validation_result", sa.JSON(), nullable=True),
        sa.Column(
            "validation_errors", sa.JSON(), nullable=False, server_default=sa.text("'[]'::json")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("validated_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("skill_id", "version", name="uq_skill_versions_skill_version"),
    )
    op.create_index("ix_skill_versions_skill_id", "skill_versions", ["skill_id"])
    op.create_index("ix_skill_versions_skill_status", "skill_versions", ["skill_id", "status"])
    op.create_foreign_key(
        "fk_skills_current_version",
        "skills",
        "skill_versions",
        ["current_version_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_table(
        "skill_installations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("skill_id", sa.Uuid(), nullable=False),
        sa.Column(
            "scope", _enum("skill_installation_scope", ["global", "assistant"]), nullable=False
        ),
        sa.Column("scope_key", sa.String(length=80), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "user_id", "skill_id", "scope_key", name="uq_skill_installations_scope"
        ),
    )
    op.create_index("ix_skill_installations_user_id", "skill_installations", ["user_id"])
    op.create_index("ix_skill_installations_skill_id", "skill_installations", ["skill_id"])
    op.create_index("ix_skill_installations_assistant_id", "skill_installations", ["assistant_id"])
    op.create_index(
        "ix_skill_installations_user_scope", "skill_installations", ["user_id", "scope"]
    )


def downgrade() -> None:
    op.drop_index("ix_skill_installations_user_scope", table_name="skill_installations")
    op.drop_index("ix_skill_installations_assistant_id", table_name="skill_installations")
    op.drop_index("ix_skill_installations_skill_id", table_name="skill_installations")
    op.drop_index("ix_skill_installations_user_id", table_name="skill_installations")
    op.drop_table("skill_installations")
    op.drop_constraint("fk_skills_current_version", "skills", type_="foreignkey")
    op.drop_index("ix_skill_versions_skill_status", table_name="skill_versions")
    op.drop_index("ix_skill_versions_skill_id", table_name="skill_versions")
    op.drop_table("skill_versions")
    op.drop_index("ix_skills_user_updated", table_name="skills")
    op.drop_index("ix_skills_user_id", table_name="skills")
    op.drop_table("skills")
