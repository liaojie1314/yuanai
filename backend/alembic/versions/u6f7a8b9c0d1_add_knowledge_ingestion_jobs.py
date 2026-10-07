"""add_knowledge_ingestion_jobs

Revision ID: u6f7a8b9c0d1
Revises: t5e6f7a8b9c0
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "u6f7a8b9c0d1"
down_revision: str | None = "t5e6f7a8b9c0"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """落地入库流水线的作业表，并记录每个文档版本由哪个解析器产出。

    文档版本只记录最终文本，解析失败、OCR 缺失、质量不达标这些过程信息此前
    无处可存，用户只能看到"没有新版本"。`ingestion_jobs` 把阶段、解析器、
    降级原因和质量告警持久化，失败的文档不进入检索但失败原因可查。
    """

    op.add_column(
        "knowledge_documents",
        sa.Column("parser", sa.String(length=40), nullable=False, server_default="text"),
    )
    op.create_table(
        "ingestion_jobs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("knowledge_base_id", sa.Uuid(), nullable=False),
        sa.Column("source_id", sa.Uuid(), nullable=True),
        sa.Column("document_id", sa.Uuid(), nullable=True),
        sa.Column("file_id", sa.Uuid(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "pending",
                "running",
                "completed",
                "degraded",
                "failed",
                name="ingestion_job_status",
                native_enum=False,
                length=16,
            ),
            nullable=False,
        ),
        sa.Column(
            "stage",
            sa.Enum(
                "fetch",
                "parse",
                "quality_check",
                "chunk",
                "embed",
                name="ingestion_job_stage",
                native_enum=False,
                length=20,
            ),
            nullable=False,
        ),
        sa.Column("parser", sa.String(length=40), nullable=True),
        sa.Column("ocr_used", sa.Boolean(), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("error_detail", sa.Text(), nullable=True),
        sa.Column("warnings", sa.JSON(), nullable=False),
        sa.Column("chunk_count", sa.Integer(), nullable=False),
        sa.Column("char_count", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["knowledge_base_id"], ["knowledge_bases.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["source_id"], ["knowledge_sources.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["document_id"], ["knowledge_documents.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["file_id"], ["files.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_ingestion_jobs_base_created", "ingestion_jobs", ["knowledge_base_id", "created_at"]
    )
    op.create_index("ix_ingestion_jobs_status", "ingestion_jobs", ["status"])


def downgrade() -> None:
    """删除作业表与解析器列；已入库的文档内容不受影响。"""

    op.drop_index("ix_ingestion_jobs_status", table_name="ingestion_jobs")
    op.drop_index("ix_ingestion_jobs_base_created", table_name="ingestion_jobs")
    op.drop_table("ingestion_jobs")
    op.drop_column("knowledge_documents", "parser")
