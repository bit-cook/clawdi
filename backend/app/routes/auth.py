import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.api_key import ApiKey
from app.models.user import User
from app.schemas.api_key import ApiKeyCreate, ApiKeyCreated, ApiKeyResponse

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _generate_api_key() -> tuple[str, str, str]:
    """Generate a new API key. Returns (raw_key, key_hash, key_prefix)."""
    raw = "clawdi_" + secrets.token_urlsafe(32)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    key_prefix = raw[:16]
    return raw, key_hash, key_prefix


@router.post("/keys", response_model=ApiKeyCreated)
async def create_api_key(
    body: ApiKeyCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    raw_key, key_hash, key_prefix = _generate_api_key()

    api_key = ApiKey(
        user_id=auth.user_id,
        key_hash=key_hash,
        key_prefix=key_prefix,
        label=body.label,
    )
    db.add(api_key)
    await db.commit()
    await db.refresh(api_key)

    return ApiKeyCreated(
        id=str(api_key.id),
        label=api_key.label,
        key_prefix=api_key.key_prefix,
        created_at=api_key.created_at,
        last_used_at=api_key.last_used_at,
        expires_at=api_key.expires_at,
        revoked_at=api_key.revoked_at,
        raw_key=raw_key,
    )


@router.get("/keys", response_model=list[ApiKeyResponse])
async def list_api_keys(
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(
        select(ApiKey)
        .where(ApiKey.user_id == auth.user_id)
        .order_by(ApiKey.created_at.desc())
    )
    keys = result.scalars().all()
    return [
        ApiKeyResponse(
            id=str(k.id),
            label=k.label,
            key_prefix=k.key_prefix,
            created_at=k.created_at,
            last_used_at=k.last_used_at,
            expires_at=k.expires_at,
            revoked_at=k.revoked_at,
        )
        for k in keys
    ]


@router.delete("/keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    from datetime import datetime, timezone

    result = await db.execute(
        select(ApiKey).where(ApiKey.id == key_id, ApiKey.user_id == auth.user_id)
    )
    api_key = result.scalar_one_or_none()
    if not api_key:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API key not found")

    api_key.revoked_at = datetime.now(timezone.utc)
    await db.commit()
    return {"status": "revoked"}


@router.get("/me")
async def get_me(auth: AuthContext = Depends(get_auth)):
    return {
        "id": str(auth.user.id),
        "email": auth.user.email,
        "name": auth.user.name,
        "auth_type": "api_key" if auth.is_cli else "clerk",
    }


# ---------------------------------------------------------------------------
# User lookup for invitations
# ---------------------------------------------------------------------------

@router.get("/users/search")
async def search_user_by_email(
    email: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Exact-email lookup — used by scope owner to decide whether to add
    directly or send an invite link.

    Returns 404 for both "not registered" and "rate-limit exceeded" to minimize
    user enumeration (future: add an actual rate limiter; this is a stub).
    """
    normalized = email.lower().strip()
    if not normalized or "@" not in normalized:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid email")

    result = await db.execute(select(User).where(User.email == normalized))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "No user with that email")
    return {"id": str(user.id), "email": user.email}
