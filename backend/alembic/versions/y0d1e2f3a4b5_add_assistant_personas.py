"""add_assistant_personas

Revision ID: y0d1e2f3a4b5
Revises: x9c0d1e2f3a4
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "y0d1e2f3a4b5"
down_revision: str | None = "x9c0d1e2f3a4"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """落地人格、人格版本快照与人格候选项三张表，并打通两级记忆范围。

    `conversations.assistant_id` 用 `SET NULL`：助理被删时会话必须留下来，
    下一次聊天再退回用户的默认助理。
    `memories.assistant_id` 放开为可空，`NULL` 即「用户级共享记忆」（phase-7 §8.5.3）；
    它的外键本就是 `CASCADE`，而 `NULL` 行不受级联影响，
    所以「删助理时私有记忆一并删除、用户级留存」无需额外代码。
    """

    op.create_table(
        "assistant_personas",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("address_user", sa.String(length=40), nullable=False, server_default=""),
        sa.Column("self_name", sa.String(length=40), nullable=False, server_default=""),
        sa.Column(
            "tone", sa.String(length=16), nullable=False, server_default=sa.text("'concise'")
        ),
        sa.Column(
            "verbosity",
            sa.String(length=16),
            nullable=False,
            server_default=sa.text("'balanced'"),
        ),
        sa.Column("greeting", sa.Text(), nullable=False, server_default=""),
        sa.Column("refusal_style", sa.Text(), nullable=False, server_default=""),
        sa.Column("forbidden_topics", sa.JSON(), nullable=False, server_default=sa.text("'[]'")),
        sa.Column("language", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("version", sa.Integer(), nullable=False, server_default=sa.text("1")),
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
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assistant_id", name="uq_assistant_personas_assistant_id"),
    )
    op.create_index("ix_assistant_personas_assistant_id", "assistant_personas", ["assistant_id"])

    op.create_table(
        "assistant_persona_versions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column(
            "change_reason",
            sa.String(length=64),
            nullable=False,
            server_default=sa.text("'manual'"),
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("assistant_id", "version", name="uq_persona_version"),
    )
    op.create_index(
        "ix_assistant_persona_versions_assistant_id",
        "assistant_persona_versions",
        ["assistant_id"],
    )

    op.create_table(
        "persona_candidates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("field", sa.String(length=32), nullable=False),
        sa.Column("suggested_value", sa.Text(), nullable=False),
        sa.Column("evidence", sa.Text(), nullable=False, server_default=""),
        sa.Column("source_type", sa.String(length=8), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status", sa.String(length=16), nullable=False, server_default=sa.text("'pending'")
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_persona_candidates_user_id", "persona_candidates", ["user_id"])
    op.create_index("ix_persona_candidates_assistant_id", "persona_candidates", ["assistant_id"])

    op.add_column("conversations", sa.Column("assistant_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_conversations_assistant_id",
        "conversations",
        "assistants",
        ["assistant_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_conversations_assistant_id", "conversations", ["assistant_id"])

    op.alter_column("memories", "assistant_id", existing_type=sa.Uuid(), nullable=True)


def downgrade() -> None:
    """撤回人格三张表与两处列变更。

    回退前必须先把用户级记忆（`assistant_id IS NULL`）删掉：列要收回 `NOT NULL`，
    留着它们只会让 `ALTER` 失败，而它们本就是本次迁移才可能产生的数据。
    """

    op.execute("DELETE FROM memories WHERE assistant_id IS NULL")
    op.alter_column("memories", "assistant_id", existing_type=sa.Uuid(), nullable=False)

    op.drop_index("ix_conversations_assistant_id", table_name="conversations")
    op.drop_constraint("fk_conversations_assistant_id", "conversations", type_="foreignkey")
    op.drop_column("conversations", "assistant_id")

    op.drop_index("ix_persona_candidates_assistant_id", table_name="persona_candidates")
    op.drop_index("ix_persona_candidates_user_id", table_name="persona_candidates")
    op.drop_table("persona_candidates")

    op.drop_index(
        "ix_assistant_persona_versions_assistant_id", table_name="assistant_persona_versions"
    )
    op.drop_table("assistant_persona_versions")

    op.drop_index("ix_assistant_personas_assistant_id", table_name="assistant_personas")
    op.drop_table("assistant_personas")
