"""add personal scope flag and default_write_scope

Revision ID: b1c152248aa6
Revises: affdc1ac78ec
Create Date: 2026-04-21 18:23:23.703561

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b1c152248aa6'
down_revision: Union[str, Sequence[str], None] = 'affdc1ac78ec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scopes",
        sa.Column("is_personal", sa.Boolean(), server_default=sa.text("false"), nullable=False),
    )
    op.add_column("users", sa.Column("default_scope_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_users_default_scope_id",
        "users", "scopes",
        ["default_scope_id"], ["id"],
        ondelete="SET NULL",
    )
    op.add_column(
        "agent_environments",
        sa.Column("default_write_scope_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_envs_default_write_scope_id",
        "agent_environments", "scopes",
        ["default_write_scope_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_envs_default_write_scope_id", "agent_environments", type_="foreignkey")
    op.drop_column("agent_environments", "default_write_scope_id")
    op.drop_constraint("fk_users_default_scope_id", "users", type_="foreignkey")
    op.drop_column("users", "default_scope_id")
    op.drop_column("scopes", "is_personal")
