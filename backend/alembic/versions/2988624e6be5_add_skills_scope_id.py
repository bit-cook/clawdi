"""add skills.scope_id

Revision ID: 2988624e6be5
Revises: db14af31fb6f
Create Date: 2026-04-21 17:27:02.152412

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2988624e6be5'
down_revision: Union[str, Sequence[str], None] = 'db14af31fb6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "skills",
        sa.Column("scope_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_skills_scope_id",
        "skills",
        "scopes",
        ["scope_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_skills_scope_id", "skills", ["scope_id"])


def downgrade() -> None:
    op.drop_index("ix_skills_scope_id", table_name="skills")
    op.drop_constraint("fk_skills_scope_id", "skills", type_="foreignkey")
    op.drop_column("skills", "scope_id")
