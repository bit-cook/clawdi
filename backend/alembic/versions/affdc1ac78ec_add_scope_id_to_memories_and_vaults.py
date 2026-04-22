"""add scope_id to memories and vaults

Revision ID: affdc1ac78ec
Revises: 2988624e6be5
Create Date: 2026-04-21 17:57:40.314599

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'affdc1ac78ec'
down_revision: Union[str, Sequence[str], None] = '2988624e6be5'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for table in ("memories", "vaults"):
        op.add_column(table, sa.Column("scope_id", sa.UUID(), nullable=True))
        op.create_foreign_key(
            f"fk_{table}_scope_id",
            table,
            "scopes",
            ["scope_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(f"ix_{table}_scope_id", table, ["scope_id"])


def downgrade() -> None:
    for table in ("memories", "vaults"):
        op.drop_index(f"ix_{table}_scope_id", table_name=table)
        op.drop_constraint(f"fk_{table}_scope_id", table, type_="foreignkey")
        op.drop_column(table, "scope_id")
