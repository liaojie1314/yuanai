"""add encrypted secret records"""

from collections.abc import Sequence

import sqlalchemy as sa

from alembic import op

revision: str = "l5f6a7b8c9d0"
down_revision: str | None = "k4e5f6a7b8c9"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "secret_records",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("owner_id", sa.Uuid(), nullable=False),
        sa.Column("ciphertext", sa.Text(), nullable=False),
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
    op.create_index("ix_secret_records_owner_id", "secret_records", ["owner_id"])
    op.create_index("ix_secret_records_owner_created", "secret_records", ["owner_id", "created_at"])


def downgrade() -> None:
    op.drop_index("ix_secret_records_owner_created", table_name="secret_records")
    op.drop_index("ix_secret_records_owner_id", table_name="secret_records")
    op.drop_table("secret_records")
