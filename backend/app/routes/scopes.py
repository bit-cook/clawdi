import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.scope import Scope, ScopeMembership
from app.schemas.scope import ScopeCreate, ScopeMemberAdd, ScopeMemberOut, ScopeOut, ScopeUpdate

router = APIRouter(prefix="/api/scopes", tags=["scopes"])


async def _require_membership(
    db: AsyncSession, scope_id: uuid.UUID, user_id: uuid.UUID
) -> ScopeMembership:
    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this scope")
    return membership


async def _require_owner(
    db: AsyncSession, scope_id: uuid.UUID, user_id: uuid.UUID
) -> ScopeMembership:
    membership = await _require_membership(db, scope_id, user_id)
    if membership.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only owner can perform this action")
    return membership


@router.post("", response_model=ScopeOut, status_code=status.HTTP_201_CREATED)
async def create_scope(
    body: ScopeCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    scope = Scope(name=body.name, owner_user_id=auth.user_id, visibility="shared")
    db.add(scope)
    await db.flush()
    membership = ScopeMembership(scope_id=scope.id, user_id=auth.user_id, role="owner")
    db.add(membership)
    await db.commit()
    await db.refresh(scope)
    return ScopeOut(
        id=scope.id,
        name=scope.name,
        owner_user_id=scope.owner_user_id,
        visibility=scope.visibility,
        created_at=scope.created_at,
        role="owner",
    )


@router.get("", response_model=list[ScopeOut])
async def list_scopes(
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(
        select(Scope, ScopeMembership.role)
        .join(ScopeMembership, ScopeMembership.scope_id == Scope.id)
        .where(ScopeMembership.user_id == auth.user_id)
        .order_by(Scope.is_personal.desc(), Scope.created_at.desc())
    )
    rows = result.all()
    return [
        ScopeOut(
            id=scope.id,
            name=scope.name,
            owner_user_id=scope.owner_user_id,
            visibility=scope.visibility,
            created_at=scope.created_at,
            role=role,
            is_personal=scope.is_personal,
        )
        for scope, role in rows
    ]


@router.get("/{scope_id}", response_model=ScopeOut)
async def get_scope(
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    membership = await _require_membership(db, scope_id, auth.user_id)
    result = await db.execute(select(Scope).where(Scope.id == scope_id))
    scope = result.scalar_one()
    return ScopeOut(
        id=scope.id,
        name=scope.name,
        owner_user_id=scope.owner_user_id,
        visibility=scope.visibility,
        created_at=scope.created_at,
        role=membership.role,
        is_personal=scope.is_personal,
    )


@router.patch("/{scope_id}", response_model=ScopeOut)
async def update_scope(
    scope_id: uuid.UUID,
    body: ScopeUpdate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    membership = await _require_owner(db, scope_id, auth.user_id)
    result = await db.execute(select(Scope).where(Scope.id == scope_id))
    scope = result.scalar_one()
    scope.name = body.name
    await db.commit()
    await db.refresh(scope)
    return ScopeOut(
        id=scope.id,
        name=scope.name,
        owner_user_id=scope.owner_user_id,
        visibility=scope.visibility,
        created_at=scope.created_at,
        role=membership.role,
        is_personal=scope.is_personal,
    )


@router.delete("/{scope_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_scope(
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)
    result = await db.execute(select(Scope).where(Scope.id == scope_id))
    scope = result.scalar_one()
    if scope.is_personal:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot delete the Personal scope. Rename it if you want a different name.",
        )
    await db.delete(scope)
    await db.commit()


@router.get("/{scope_id}/members", response_model=list[ScopeMemberOut])
async def list_members(
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_membership(db, scope_id, auth.user_id)
    result = await db.execute(
        select(ScopeMembership)
        .where(ScopeMembership.scope_id == scope_id)
        .order_by(ScopeMembership.created_at)
    )
    memberships = result.scalars().all()
    return [
        ScopeMemberOut(user_id=m.user_id, role=m.role, added_at=m.created_at)
        for m in memberships
    ]


class ScopeMemberRoleUpdate(BaseModel):
    role: Literal["owner", "writer", "reader"]


@router.patch(
    "/{scope_id}/members/{user_id}",
    response_model=ScopeMemberOut,
)
async def update_member_role(
    scope_id: uuid.UUID,
    user_id: uuid.UUID,
    body: ScopeMemberRoleUpdate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Change a member's role (owner-only).

    Demoting the last owner is rejected — must leave at least one owner.
    """
    await _require_owner(db, scope_id, auth.user_id)
    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")

    # If demoting an owner, ensure at least one owner remains
    if membership.role == "owner" and body.role != "owner":
        owner_count_result = await db.execute(
            select(ScopeMembership).where(
                ScopeMembership.scope_id == scope_id,
                ScopeMembership.role == "owner",
            )
        )
        remaining = len(owner_count_result.scalars().all())
        if remaining <= 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "Can't demote the last owner. Promote another member first.",
            )

    membership.role = body.role
    await db.commit()
    await db.refresh(membership)
    return ScopeMemberOut(
        user_id=membership.user_id,
        role=membership.role,
        added_at=membership.created_at,
    )


@router.post(
    "/{scope_id}/members",
    response_model=ScopeMemberOut,
    status_code=status.HTTP_201_CREATED,
)
async def add_member(
    scope_id: uuid.UUID,
    body: ScopeMemberAdd,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)
    existing = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == body.user_id,
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status.HTTP_409_CONFLICT, "User is already a member")
    membership = ScopeMembership(
        scope_id=scope_id, user_id=body.user_id, role=body.role
    )
    db.add(membership)
    await db.commit()
    await db.refresh(membership)
    return ScopeMemberOut(
        user_id=membership.user_id, role=membership.role, added_at=membership.created_at
    )


@router.delete(
    "/{scope_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def remove_member(
    scope_id: uuid.UUID,
    user_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)
    if user_id == auth.user_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Owner cannot remove themselves — use Leave scope instead")
    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membership not found")
    await db.delete(membership)
    await db.commit()


@router.post("/{scope_id}/leave", status_code=status.HTTP_204_NO_CONTENT)
async def leave_scope(
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Current user leaves this scope.

    Guards:
    - If caller is the last owner → reject (must transfer ownership first)
    - If any of caller's envs has default_write_scope_id = this scope → reject
      (must change default_write first)
    - Personal scope → reject (can't leave your own Personal)
    """
    membership = await _require_membership(db, scope_id, auth.user_id)

    # Can't leave Personal
    result = await db.execute(select(Scope).where(Scope.id == scope_id))
    scope = result.scalar_one()
    if scope.is_personal and scope.owner_user_id == auth.user_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Cannot leave your own Personal scope",
        )

    # Last owner check
    if membership.role == "owner":
        owner_count_result = await db.execute(
            select(ScopeMembership).where(
                ScopeMembership.scope_id == scope_id,
                ScopeMembership.role == "owner",
            )
        )
        owner_count = len(owner_count_result.scalars().all())
        if owner_count <= 1:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "You're the last owner. Promote another member to owner first, or delete the scope.",
            )

    # default_write guard
    from app.models.session import AgentEnvironment
    ref_result = await db.execute(
        select(AgentEnvironment).where(
            AgentEnvironment.user_id == auth.user_id,
            AgentEnvironment.default_write_scope_id == scope_id,
        )
    )
    referencing_envs = ref_result.scalars().all()
    if referencing_envs:
        names = ", ".join(e.machine_name or e.agent_type for e in referencing_envs[:3])
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Your agent(s) {names} use this scope as default write target. "
            f"Change their default first (Agents page → Default location).",
        )

    # Clean up any env subscriptions this user has pointing at this scope
    from app.models.env_scope import AgentEnvironmentScope
    envs_result = await db.execute(
        select(AgentEnvironment.id).where(AgentEnvironment.user_id == auth.user_id)
    )
    env_ids = [r[0] for r in envs_result.all()]
    if env_ids:
        await db.execute(
            AgentEnvironmentScope.__table__.delete().where(
                AgentEnvironmentScope.environment_id.in_(env_ids),
                AgentEnvironmentScope.scope_id == scope_id,
            )
        )

    await db.delete(membership)
    await db.commit()
