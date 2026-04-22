"""add scopes, scope_memberships, agent_environment_scopes

Revision ID: db14af31fb6f
Revises: e81a04e870b4
Create Date: 2026-04-21 17:22:57.067494

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'db14af31fb6f'
down_revision: Union[str, Sequence[str], None] = 'e81a04e870b4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "scopes",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("owner_user_id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("visibility", sa.String(length=20), server_default="shared", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_scopes_owner_user_id", "scopes", ["owner_user_id"])

    op.create_table(
        "scope_memberships",
        sa.Column("scope_id", sa.UUID(), nullable=False),
        sa.Column("user_id", sa.UUID(), nullable=False),
        sa.Column("role", sa.String(length=20), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["scope_id"], ["scopes.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("scope_id", "user_id"),
    )
    op.create_index("ix_scope_memberships_user_id", "scope_memberships", ["user_id"])

    op.create_table(
        "agent_environment_scopes",
        sa.Column("environment_id", sa.UUID(), nullable=False),
        sa.Column("scope_id", sa.UUID(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()"), nullable=False),
        sa.ForeignKeyConstraint(["environment_id"], ["agent_environments.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["scope_id"], ["scopes.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("environment_id", "scope_id"),
    )


def downgrade() -> None:
    op.drop_table("agent_environment_scopes")
    op.drop_index("ix_scope_memberships_user_id", table_name="scope_memberships")
    op.drop_table("scope_memberships")
    op.drop_index("ix_scopes_owner_user_id", table_name="scopes")
    op.drop_table("scopes")
