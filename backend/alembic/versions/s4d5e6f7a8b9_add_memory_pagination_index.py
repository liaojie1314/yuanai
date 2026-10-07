"""add_memory_pagination_index

Revision ID: s4d5e6f7a8b9
Revises: r3c4d5e6f7a8
"""

from collections.abc import Sequence

from alembic import op

revision: str = "s4d5e6f7a8b9"
down_revision: str | None = "r3c4d5e6f7a8"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_INDEX_NAME = "ix_memories_user_created_id"


def upgrade() -> None:
    """给记忆列表的游标分页建 (user_id, created_at, id) 复合索引。

    列序与查询一致：user_id 等值、created_at DESC、id DESC 兜底。
    btree 支持反向扫描，所以升序索引就能喂饱降序排序，不必再建降序副本；
    没有它每翻一页都要把该用户的全部记忆排一遍。
    """

    op.create_index(_INDEX_NAME, "memories", ["user_id", "created_at", "id"])


def downgrade() -> None:
    """删掉分页索引，其余列上的索引不受影响。"""

    op.drop_index(_INDEX_NAME, table_name="memories")
