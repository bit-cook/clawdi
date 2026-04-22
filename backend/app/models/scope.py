import uuid

from sqlalchemy import Boolean, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class Scope(Base, TimestampMixin):
    __tablename__ = "scopes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    owner_user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # MVP: private | shared
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="shared"
    )
    # The auto-created "Personal" scope per user. Flagged so we protect it
    # from deletion and pin user.default_scope_id to it on first creation.
    is_personal: Mapped[bool] = mapped_column(Boolean, server_default="false", nullable=False)


class ScopeMembership(Base, TimestampMixin):
    __tablename__ = "scope_memberships"

    scope_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scopes.id", ondelete="CASCADE"),
        primary_key=True,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id"), primary_key=True
    )
    # owner | writer | reader
    role: Mapped[str] = mapped_column(String(20), nullable=False)
