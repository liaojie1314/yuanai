"""settle_stale_fallback_title_source

Revision ID: x9c0d1e2f3a4
Revises: w8b9c0d1e2f3
"""

from collections.abc import Sequence

from alembic import op

revision: str = "x9c0d1e2f3a4"
down_revision: str | None = "w8b9c0d1e2f3"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """把残留的 `fallback` 落定为 `fallback_final`。

    客户端把 `fallback` 读作「AI 标题仍在生成」并据此转圈。生成任务活在应用进程里，
    迁移执行时那些进程早已结束，所以此刻还停在 `fallback` 的行不可能有任务在跑 ——
    不落定它们，升级后这些历史会话会永久转圈。

    只动 `fallback`：`manual` 是用户改过的名字，`ai` 已经生成成功，都不能碰。
    """

    op.execute(
        "UPDATE conversations SET title_source = 'fallback_final' WHERE title_source = 'fallback'"
    )


def downgrade() -> None:
    """回退到 `fallback`。

    无法区分「本来就是 fallback」和「本次落定的」，一律写回 fallback：
    旧客户端只认得 fallback，留着 fallback_final 会让它们读到未知值。
    """

    op.execute(
        "UPDATE conversations SET title_source = 'fallback' WHERE title_source = 'fallback_final'"
    )
