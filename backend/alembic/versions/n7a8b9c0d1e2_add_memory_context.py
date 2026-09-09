"""add_memory_context

Revision ID: n7a8b9c0d1e2
Revises: m6f7a8b9c0d1
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "n7a8b9c0d1e2"
down_revision: str | None = "m6f7a8b9c0d1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, values: list[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False)


def upgrade() -> None:
    op.create_table(
        "memories",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("assistant_id", sa.Uuid(), nullable=False),
        sa.Column("workspace_id", sa.Uuid(), nullable=True),
        sa.Column(
            "memory_type",
            _enum("memory_type", ["profile", "preference", "semantic", "episodic"]),
            nullable=False,
        ),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("structured_data", sa.JSON(), nullable=True),
        sa.Column("source_type", sa.String(40), nullable=False),
        sa.Column("source_id", sa.String(100), nullable=True),
        sa.Column("source_excerpt", sa.Text(), nullable=True),
        sa.Column("confidence", sa.Float(), nullable=False, server_default=sa.text("0")),
        sa.Column(
            "sensitivity",
            _enum("memory_sensitivity", ["public", "personal", "sensitive", "restricted"]),
            nullable=False,
            server_default=sa.text("'personal'"),
        ),
        sa.Column(
            "storage_location",
            _enum("memory_storage_location", ["cloud", "local_node"]),
            nullable=False,
            server_default=sa.text("'cloud'"),
        ),
        sa.Column(
            "status",
            _enum("memory_status", ["candidate", "active", "rejected", "superseded", "expired"]),
            nullable=False,
            server_default=sa.text("'candidate'"),
        ),
        sa.Column("valid_from", sa.DateTime(timezone=True), nullable=True),
        sa.Column("valid_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("embedding", sa.JSON(), nullable=True),
        sa.Column(
            "search_vector",
            postgresql.TSVECTOR(),
            sa.Computed("to_tsvector('simple', content)", persisted=True),
            nullable=False,
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
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["assistant_id"], ["assistants.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_memories_user_id", "memories", ["user_id"])
    op.create_index("ix_memories_assistant_id", "memories", ["assistant_id"])
    op.create_index("ix_memories_workspace_id", "memories", ["workspace_id"])
    op.create_index(
        "ix_memories_user_assistant_status", "memories", ["user_id", "assistant_id", "status"]
    )
    op.create_index(
        "ix_memories_user_workspace_status", "memories", ["user_id", "workspace_id", "status"]
    )
    op.create_index(
        "ix_memories_search_vector", "memories", ["search_vector"], postgresql_using="gin"
    )
    op.create_table(
        "memory_relations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("memory_id", sa.Uuid(), nullable=False),
        sa.Column("subject", sa.String(200), nullable=False),
        sa.Column("predicate", sa.String(100), nullable=False),
        sa.Column("object_value", sa.String(500), nullable=False),
        sa.Column("properties", sa.JSON(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_memory_relations_memory", "memory_relations", ["memory_id"])


def downgrade() -> None:
    op.drop_index("ix_memory_relations_memory", table_name="memory_relations")
    op.drop_table("memory_relations")
    op.drop_index("ix_memories_search_vector", table_name="memories")
    op.drop_index("ix_memories_user_workspace_status", table_name="memories")
    op.drop_index("ix_memories_user_assistant_status", table_name="memories")
    op.drop_index("ix_memories_workspace_id", table_name="memories")
    op.drop_index("ix_memories_assistant_id", table_name="memories")
    op.drop_index("ix_memories_user_id", table_name="memories")
    op.drop_table("memories")
