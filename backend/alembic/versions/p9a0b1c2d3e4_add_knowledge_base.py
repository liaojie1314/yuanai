"""add_knowledge_base

Revision ID: p9a0b1c2d3e4
Revises: o8a9b0c1d2e3
"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "p9a0b1c2d3e4"
down_revision: str | None = "o8a9b0c1d2e3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _enum(name: str, values: list[str]) -> sa.Enum:
    return sa.Enum(*values, name=name, native_enum=False)


def upgrade() -> None:
    op.create_table(
        "knowledge_bases",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("space_id", sa.Uuid(), nullable=True),
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
        sa.ForeignKeyConstraint(["owner_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_bases_owner_id", "knowledge_bases", ["owner_id"])
    op.create_index("ix_knowledge_bases_space_id", "knowledge_bases", ["space_id"])
    op.create_index("ix_knowledge_bases_owner_space", "knowledge_bases", ["owner_id", "space_id"])
    op.create_table(
        "knowledge_base_members",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "role", _enum("knowledge_base_member_role", ["viewer", "editor"]), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["knowledge_base_id"], ["knowledge_bases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("knowledge_base_id", "user_id", name="uq_knowledge_base_members_user"),
    )
    op.create_index(
        "ix_knowledge_base_members_user", "knowledge_base_members", ["user_id", "knowledge_base_id"]
    )
    op.create_table(
        "knowledge_sources",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=300), nullable=False),
        sa.Column("source_type", sa.String(length=40), nullable=False),
        sa.Column("source_uri", sa.String(length=2000), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["knowledge_base_id"], ["knowledge_bases.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_knowledge_sources_base", "knowledge_sources", ["knowledge_base_id"])
    op.create_table(
        "knowledge_documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("normalized_content", sa.Text(), nullable=False),
        sa.Column(
            "status",
            _enum("knowledge_document_status", ["staged", "published", "superseded", "failed"]),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["source_id"], ["knowledge_sources.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("source_id", "version", name="uq_knowledge_documents_source_version"),
    )
    op.create_index(
        "ix_knowledge_documents_source_status", "knowledge_documents", ["source_id", "status"]
    )
    op.create_table(
        "knowledge_chunks",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("document_id", sa.Uuid(), nullable=False),
        sa.Column("chunk_index", sa.Integer(), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("section", sa.String(length=500), nullable=True),
        sa.Column("char_start", sa.Integer(), nullable=False),
        sa.Column("char_end", sa.Integer(), nullable=False),
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
        sa.ForeignKeyConstraint(["document_id"], ["knowledge_documents.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "document_id", "chunk_index", name="uq_knowledge_chunks_document_index"
        ),
    )
    op.create_index("ix_knowledge_chunks_document", "knowledge_chunks", ["document_id"])
    op.create_index(
        "ix_knowledge_chunks_search_vector",
        "knowledge_chunks",
        ["search_vector"],
        postgresql_using="gin",
    )


def downgrade() -> None:
    op.drop_index("ix_knowledge_chunks_search_vector", table_name="knowledge_chunks")
    op.drop_index("ix_knowledge_chunks_document", table_name="knowledge_chunks")
    op.drop_table("knowledge_chunks")
    op.drop_index("ix_knowledge_documents_source_status", table_name="knowledge_documents")
    op.drop_table("knowledge_documents")
    op.drop_index("ix_knowledge_sources_base", table_name="knowledge_sources")
    op.drop_table("knowledge_sources")
    op.drop_index("ix_knowledge_base_members_user", table_name="knowledge_base_members")
    op.drop_table("knowledge_base_members")
    op.drop_index("ix_knowledge_bases_owner_space", table_name="knowledge_bases")
    op.drop_index("ix_knowledge_bases_space_id", table_name="knowledge_bases")
    op.drop_index("ix_knowledge_bases_owner_id", table_name="knowledge_bases")
    op.drop_table("knowledge_bases")
