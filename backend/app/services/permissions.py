"""Centralized permission helpers for scope-based ACL.

Semantics (per Codex design):
- Object edit/delete: any writer+ scope membership is enough
- Scope association add/remove: writer+ in the SPECIFIC target scope
- 0 scopes = private, only creator can see/edit
"""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.memory_scope import MemoryScope
from app.models.scope import ScopeMembership
from app.models.skill_scope import SkillScope


async def scopes_of_skill(db: AsyncSession, skill_id: uuid.UUID) -> list[uuid.UUID]:
    """Return scope ids this skill is attached to."""
    result = await db.execute(
        select(SkillScope.scope_id).where(SkillScope.skill_id == skill_id)
    )
    return [row[0] for row in result.all()]


async def scopes_of_memory(db: AsyncSession, memory_id: uuid.UUID) -> list[uuid.UUID]:
    result = await db.execute(
        select(MemoryScope.scope_id).where(MemoryScope.memory_id == memory_id)
    )
    return [row[0] for row in result.all()]


async def user_member_scopes(db: AsyncSession, user_id: uuid.UUID) -> list[uuid.UUID]:
    """Return every scope the user is a member of."""
    result = await db.execute(
        select(ScopeMembership.scope_id).where(ScopeMembership.user_id == user_id)
    )
    return [row[0] for row in result.all()]


async def user_role_in_scope(
    db: AsyncSession, user_id: uuid.UUID, scope_id: uuid.UUID
) -> str | None:
    result = await db.execute(
        select(ScopeMembership.role).where(
            ScopeMembership.user_id == user_id,
            ScopeMembership.scope_id == scope_id,
        )
    )
    row = result.first()
    return row[0] if row else None


async def can_write_scope(
    db: AsyncSession, user_id: uuid.UUID, scope_id: uuid.UUID
) -> bool:
    """Writer or owner in the given scope."""
    role = await user_role_in_scope(db, user_id, scope_id)
    return role in ("writer", "owner")


async def can_edit_shared_object(
    db: AsyncSession,
    user_id: uuid.UUID,
    creator_id: uuid.UUID,
    object_scope_ids: list[uuid.UUID],
) -> bool:
    """Can this user edit/delete a multi-scope object?

    Rules:
    - 0 scopes (private): only creator can edit
    - 1+ scopes: writer/owner in ANY of them is enough
    """
    if not object_scope_ids:
        return user_id == creator_id

    result = await db.execute(
        select(ScopeMembership.role).where(
            ScopeMembership.user_id == user_id,
            ScopeMembership.scope_id.in_(object_scope_ids),
        )
    )
    roles = {row[0] for row in result.all()}
    return bool(roles & {"writer", "owner"})


async def can_view_shared_object(
    db: AsyncSession,
    user_id: uuid.UUID,
    creator_id: uuid.UUID,
    object_scope_ids: list[uuid.UUID],
) -> bool:
    """Visibility: membership in ANY of the object's scopes, or creator if private."""
    if not object_scope_ids:
        return user_id == creator_id

    result = await db.execute(
        select(ScopeMembership.scope_id).where(
            ScopeMembership.user_id == user_id,
            ScopeMembership.scope_id.in_(object_scope_ids),
        )
    )
    return result.first() is not None
