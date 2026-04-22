"""add invitee_email to scope_invitations

Revision ID: d236d6dedde8
Revises: e5cb994425a4
Create Date: 2026-04-21 19:17:17.027512

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd236d6dedde8'
down_revision: Union[str, Sequence[str], None] = 'e5cb994425a4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "scope_invitations",
        sa.Column("invitee_email", sa.String(length=320), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("scope_invitations", "invitee_email")
