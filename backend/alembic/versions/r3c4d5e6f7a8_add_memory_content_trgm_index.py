"""add_memory_content_trgm_index

Revision ID: r3c4d5e6f7a8
Revises: q2b3c4d5e6f7
"""

from collections.abc import Sequence

from alembic import op

revision: str = "r3c4d5e6f7a8"
down_revision: str | None = "q2b3c4d5e6f7"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX_NAME = "ix_memories_content_trgm"


def upgrade() -> None:
    """安装 pg_trgm，并给 memories.content 建三元组 GIN 索引。

    中文查询在 simple 配置下永远只得到一个词元，关键词臂实际由 ILIKE 子串匹配承担；
    没有三元组索引它只能顺序扫描全表。同一个索引也支撑 similarity() 的相关度排序。
    """

    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.create_index(
        _INDEX_NAME,
        "memories",
        ["content"],
        postgresql_using="gin",
        postgresql_ops={"content": "gin_trgm_ops"},
    )


def downgrade() -> None:
    """先删索引再删扩展；扩展是本迁移装的，且只被这个索引使用，可以完整回退。"""

    op.drop_index(_INDEX_NAME, table_name="memories")
    op.execute("DROP EXTENSION IF EXISTS pg_trgm")
