"""add_memory_locality_columns

Revision ID: q2b3c4d5e6f7
Revises: q1a2b3c4d5e6
"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "q2b3c4d5e6f7"
down_revision: str | None = "q1a2b3c4d5e6"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """放开 content 非空约束，登记归属节点与助理的记忆类型开关。"""

    op.alter_column("memories", "content", existing_type=sa.Text(), nullable=True)
    op.execute(
        "ALTER TABLE memories DROP COLUMN search_vector, "
        "ADD COLUMN search_vector tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple', coalesce(content, ''))) STORED"
    )
    op.create_index(
        "ix_memories_search_vector", "memories", ["search_vector"], postgresql_using="gin"
    )
    op.add_column("memories", sa.Column("node_id", sa.Uuid(), nullable=True))
    op.create_foreign_key(
        "fk_memories_node_id",
        "memories",
        "execution_nodes",
        ["node_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_memories_node_id", "memories", ["node_id"])
    op.add_column("assistants", sa.Column("disabled_memory_types", sa.JSON(), nullable=True))


def downgrade() -> None:
    """恢复非空约束前先确认没有仅存元数据的本地记忆。"""

    remaining = op.get_bind().scalar(sa.text("SELECT count(*) FROM memories WHERE content IS NULL"))
    if remaining:
        raise RuntimeError(
            f"{remaining} 条本地记忆没有云端 content，回滚会丢数据；请先导出或改为 cloud 存储"
        )
    op.drop_column("assistants", "disabled_memory_types")
    op.drop_index("ix_memories_node_id", table_name="memories")
    op.drop_constraint("fk_memories_node_id", "memories", type_="foreignkey")
    op.drop_column("memories", "node_id")
    op.execute(
        "ALTER TABLE memories DROP COLUMN search_vector, "
        "ADD COLUMN search_vector tsvector "
        "GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED"
    )
    op.create_index(
        "ix_memories_search_vector", "memories", ["search_vector"], postgresql_using="gin"
    )
    op.alter_column("memories", "content", existing_type=sa.Text(), nullable=False)
