import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.scope import Scope, ScopeMembership
from app.models.scope_invitation import ScopeInvitation

router = APIRouter(tags=["scope-invitations"])

INVITE_TTL_HOURS = 48


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


async def _require_owner(
    db: AsyncSession, scope_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == user_id,
        )
    )
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not a member of this scope")
    if m.role != "owner":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Only the owner can create invitations")


class InvitationCreate(BaseModel):
    role: Literal["writer", "reader"] = "writer"
    # If set, the invite is bound to this email address. Only a user whose
    # authenticated email matches can accept. Leave empty for anonymous links.
    invitee_email: str | None = None


class InvitationOut(BaseModel):
    id: str
    scope_id: str
    role: str
    expires_at: datetime
    accepted_at: datetime | None
    revoked_at: datetime | None
    invitee_email: str | None
    created_at: datetime


class InvitationCreatedResponse(BaseModel):
    """One-shot response — raw token only appears here."""
    id: str
    token: str
    role: str
    expires_at: datetime
    invitee_email: str | None = None


class InvitationPreview(BaseModel):
    """What the invitee sees before accepting."""
    scope_id: str
    scope_name: str
    role: str
    expires_at: datetime
    already_member: bool
    can_accept: bool
    reason: str | None = None
    invitee_email: str | None = None


@router.post(
    "/api/scopes/{scope_id}/invitations",
    response_model=InvitationCreatedResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_invitation(
    scope_id: uuid.UUID,
    body: InvitationCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)

    raw_token = "clawdi_inv_" + secrets.token_urlsafe(32)
    token_hash = _hash_token(raw_token)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=INVITE_TTL_HOURS)

    inv = ScopeInvitation(
        scope_id=scope_id,
        token_hash=token_hash,
        role=body.role,
        created_by_user_id=auth.user_id,
        expires_at=expires_at,
        invitee_email=body.invitee_email.lower().strip() if body.invitee_email else None,
    )
    db.add(inv)
    await db.commit()
    await db.refresh(inv)

    return InvitationCreatedResponse(
        id=str(inv.id),
        token=raw_token,
        role=inv.role,
        expires_at=inv.expires_at,
        invitee_email=inv.invitee_email,
    )


@router.get(
    "/api/scopes/{scope_id}/invitations",
    response_model=list[InvitationOut],
)
async def list_invitations(
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)
    result = await db.execute(
        select(ScopeInvitation)
        .where(ScopeInvitation.scope_id == scope_id)
        .order_by(ScopeInvitation.created_at.desc())
    )
    return [
        InvitationOut(
            id=str(i.id),
            scope_id=str(i.scope_id),
            role=i.role,
            expires_at=i.expires_at,
            accepted_at=i.accepted_at,
            revoked_at=i.revoked_at,
            invitee_email=i.invitee_email,
            created_at=i.created_at,
        )
        for i in result.scalars().all()
    ]


@router.delete(
    "/api/scopes/{scope_id}/invitations/{invitation_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_invitation(
    scope_id: uuid.UUID,
    invitation_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owner(db, scope_id, auth.user_id)
    result = await db.execute(
        select(ScopeInvitation).where(
            ScopeInvitation.id == invitation_id,
            ScopeInvitation.scope_id == scope_id,
        )
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    if inv.revoked_at:
        return  # already revoked, idempotent
    inv.revoked_at = datetime.now(timezone.utc)
    await db.commit()


@router.get(
    "/api/invitations/{token}",
    response_model=InvitationPreview,
)
async def preview_invitation(
    token: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Called by the join page to show what the invitee is about to join."""
    token_hash = _hash_token(token)
    result = await db.execute(
        select(ScopeInvitation).where(ScopeInvitation.token_hash == token_hash)
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")

    # Fetch scope name for display
    scope_row = await db.execute(select(Scope).where(Scope.id == inv.scope_id))
    scope = scope_row.scalar_one_or_none()
    if not scope:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Scope no longer exists")

    # Already a member?
    existing_sub = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == inv.scope_id,
            ScopeMembership.user_id == auth.user_id,
        )
    )
    already = existing_sub.scalar_one_or_none()

    # Can accept?
    reason = None
    if inv.accepted_at:
        reason = "This invitation has already been used."
    elif inv.revoked_at:
        reason = "This invitation has been revoked by the owner."
    elif inv.expires_at < datetime.now(timezone.utc):
        reason = "This invitation has expired."
    elif inv.invitee_email:
        # Email-bound invite; only matching email can accept
        caller_email = (auth.user.email or "").lower().strip()
        if caller_email != inv.invitee_email.lower().strip():
            reason = (
                f"This invitation is addressed to {inv.invitee_email}. "
                "Sign in with that account to accept."
            )

    return InvitationPreview(
        scope_id=str(inv.scope_id),
        scope_name=scope.name,
        role=inv.role,
        expires_at=inv.expires_at,
        already_member=bool(already),
        can_accept=reason is None and not already,
        reason=reason,
        invitee_email=inv.invitee_email,
    )


@router.post(
    "/api/invitations/{token}/accept",
    status_code=status.HTTP_201_CREATED,
)
async def accept_invitation(
    token: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    token_hash = _hash_token(token)
    result = await db.execute(
        select(ScopeInvitation).where(ScopeInvitation.token_hash == token_hash)
    )
    inv = result.scalar_one_or_none()
    if not inv:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Invitation not found")
    if inv.accepted_at:
        raise HTTPException(status.HTTP_409_CONFLICT, "Invitation already used")
    if inv.revoked_at:
        raise HTTPException(status.HTTP_410_GONE, "Invitation revoked")
    if inv.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_410_GONE, "Invitation expired")

    # Email-bound invite — require match
    if inv.invitee_email:
        caller_email = (auth.user.email or "").lower().strip()
        if caller_email != inv.invitee_email.lower().strip():
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"This invitation is addressed to {inv.invitee_email}. "
                "Sign in with that account to accept.",
            )

    # Already a member? (e.g. owner clicked their own link by mistake)
    existing = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == inv.scope_id,
            ScopeMembership.user_id == auth.user_id,
        )
    )
    if existing.scalar_one_or_none():
        # Mark invitation used so it can't be reused
        inv.accepted_at = datetime.now(timezone.utc)
        inv.accepted_by_user_id = auth.user_id
        await db.commit()
        return {"scope_id": str(inv.scope_id), "already_member": True}

    db.add(
        ScopeMembership(
            scope_id=inv.scope_id,
            user_id=auth.user_id,
            role=inv.role,
        )
    )
    inv.accepted_at = datetime.now(timezone.utc)
    inv.accepted_by_user_id = auth.user_id
    await db.commit()
    return {"scope_id": str(inv.scope_id), "already_member": False}
