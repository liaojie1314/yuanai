"""add_memory_local_node_text_constraint

Revision ID: t5e6f7a8b9c0
Revises: s4d5e6f7a8b9
"""

from collections.abc import Sequence

from alembic import op

revision: str = "t5e6f7a8b9c0"
down_revision: str | None = "s4d5e6f7a8b9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_CONSTRAINT_NAME = "ck_memories_local_node_keeps_no_cloud_text"
# 不能写 `structured_data IS NULL`：SQLAlchemy 的 JSON 类型把 Python None 存成
# JSON 字面量 null 而非 SQL NULL，那样写会把正常的本地记忆一并拒掉。
# 判空口径与应用层的真值判断一致，否则应用放行的写入会在库里炸成 500。
_CONDITION = (
    "storage_location <> 'local_node' OR ("
    " coalesce(content, '') = ''"
    " AND coalesce(source_excerpt, '') = ''"
    " AND coalesce(structured_data::jsonb, 'null'::jsonb) IN ('null'::jsonb, '{}'::jsonb))"
)


def upgrade() -> None:
    """把本地记忆的隐私不变量下沉成数据库约束。

    `local_node` 记忆的正文只写执行节点，云端不留副本。此前这条只靠应用层
    每个写入点各自判断：`content` 有判断，`source_excerpt` 与 `structured_data`
    没有，而 `structured_data` 是无大小上限的自由 JSON，整条正文都能塞进去。
    约束在库一级保证，将来新增写入点漏判时会直接写失败，而不是静默把正文存上云。
    """

    op.create_check_constraint(_CONSTRAINT_NAME, "memories", _CONDITION)


def downgrade() -> None:
    """撤销约束；已存的行不受影响。"""

    op.drop_constraint(_CONSTRAINT_NAME, "memories", type_="check")
