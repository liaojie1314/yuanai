"""add_pgvector_columns

Revision ID: q1a2b3c4d5e6
Revises: p9b1c2d3e4f
"""

from collections.abc import Sequence

from alembic import op

revision: str = "q1a2b3c4d5e6"
down_revision: str | None = "p9b1c2d3e4f"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_TABLES = ("memories", "knowledge_chunks")
_DIMENSIONS = 1536


def upgrade() -> None:
    """安装 vector 扩展，把两张表的 embedding 列转成向量列并建 HNSW 索引。

    维度不是 1536 的历史数据会让本次迁移失败，这是刻意的：静默丢弃用户数据
    比迁移中断更糟，遇到失败应先检查这些行再决定处理方式。
    """

    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    for table in _TABLES:
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN embedding TYPE vector({_DIMENSIONS}) "
            f"USING CASE WHEN embedding IS NULL THEN NULL "
            f"ELSE (embedding #>> '{{}}')::vector({_DIMENSIONS}) END"
        )
        op.execute(
            f"CREATE INDEX ix_{table}_embedding_hnsw ON {table} "
            f"USING hnsw (embedding vector_cosine_ops)"
        )


def downgrade() -> None:
    """回退为 JSON 列；扩展本身保留，因为其他对象可能仍在使用它。"""

    for table in _TABLES:
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_embedding_hnsw")
        op.execute(
            f"ALTER TABLE {table} ALTER COLUMN embedding TYPE json "
            f"USING CASE WHEN embedding IS NULL THEN NULL "
            f"ELSE to_json(embedding::real[]) END"
        )
