"""skill_scopes and memory_scopes m2m

Revision ID: e5cb994425a4
Revises: 78eeade62ac3
Create Date: 2026-04-21 18:59:28.116717

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'e5cb994425a4'
down_revision: Union[str, Sequence[str], None] = '78eeade62ac3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # skill_scopes (m2m)
    op.create_table(
        "skill_scopes",
        sa.Column("skill_id", sa.UUID(), nullable=False),
        sa.Column("scope_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["skill_id"], ["skills.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scope_id"], ["scopes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("skill_id", "scope_id"),
    )
    # memory_scopes (m2m)
    op.create_table(
        "memory_scopes",
        sa.Column("memory_id", sa.UUID(), nullable=False),
        sa.Column("scope_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["memory_id"], ["memories.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scope_id"], ["scopes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("memory_id", "scope_id"),
    )

    # Backfill from existing single scope_id columns
    op.execute(
        "INSERT INTO skill_scopes (skill_id, scope_id) "
        "SELECT id, scope_id FROM skills WHERE scope_id IS NOT NULL"
    )
    op.execute(
        "INSERT INTO memory_scopes (memory_id, scope_id) "
        "SELECT id, scope_id FROM memories WHERE scope_id IS NOT NULL"
    )

    # Drop the legacy single-scope columns
    op.drop_index("ix_skills_scope_id", table_name="skills")
    op.drop_constraint("fk_skills_scope_id", "skills", type_="foreignkey")
    op.drop_column("skills", "scope_id")

    op.drop_index("ix_memories_scope_id", table_name="memories")
    op.drop_constraint("fk_memories_scope_id", "memories", type_="foreignkey")
    op.drop_column("memories", "scope_id")


def downgrade() -> None:
    # Re-add single scope_id column (data loss — we keep only one scope per resource)
    op.add_column("memories", sa.Column("scope_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_memories_scope_id", "memories", "scopes",
        ["scope_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_memories_scope_id", "memories", ["scope_id"])

    op.add_column("skills", sa.Column("scope_id", sa.UUID(), nullable=True))
    op.create_foreign_key(
        "fk_skills_scope_id", "skills", "scopes",
        ["scope_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("ix_skills_scope_id", "skills", ["scope_id"])

    # Best-effort backfill: one scope per resource (the lexicographically first)
    op.execute(
        "UPDATE skills SET scope_id = (SELECT scope_id FROM skill_scopes "
        "WHERE skill_id = skills.id ORDER BY scope_id LIMIT 1)"
    )
    op.execute(
        "UPDATE memories SET scope_id = (SELECT scope_id FROM memory_scopes "
        "WHERE memory_id = memories.id ORDER BY scope_id LIMIT 1)"
    )

    op.drop_table("memory_scopes")
    op.drop_table("skill_scopes")
