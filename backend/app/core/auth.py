import hashlib
import logging
import uuid
from datetime import datetime, timezone

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_session
from app.models.api_key import ApiKey
from app.models.env_scope import AgentEnvironmentScope
from app.models.scope import Scope, ScopeMembership
from app.models.session import AgentEnvironment
from app.models.user import User


async def ensure_personal_scope(db: AsyncSession, user: User) -> None:
    """Idempotent: every user must have a Personal scope + be its owner
    + have user.default_scope_id pointing to it. Called on every auth so
    existing users migrate transparently."""
    if user.default_scope_id:
        # Verify it still exists (could have been deleted via some edge path)
        existing = await db.execute(select(Scope).where(Scope.id == user.default_scope_id))
        if existing.scalar_one_or_none():
            return
        user.default_scope_id = None  # fall through to recreate

    # Find existing Personal scope for this user, if any
    result = await db.execute(
        select(Scope).where(
            Scope.owner_user_id == user.id,
            Scope.is_personal == True,  # noqa: E712
        )
    )
    personal = result.scalar_one_or_none()

    if not personal:
        personal = Scope(
            name="Personal",
            owner_user_id=user.id,
            visibility="shared",
            is_personal=True,
        )
        db.add(personal)
        await db.flush()
        db.add(
            ScopeMembership(
                scope_id=personal.id,
                user_id=user.id,
                role="owner",
            )
        )

    user.default_scope_id = personal.id
    await db.commit()

bearer_scheme = HTTPBearer()
logger = logging.getLogger(__name__)

API_KEY_PREFIX = "clawdi_"


class AuthContext:
    def __init__(
        self,
        user: User,
        api_key: ApiKey | None = None,
        environment_id: uuid.UUID | None = None,
        subscribed_scope_ids: list[uuid.UUID] | None = None,
        default_write_scope_id: uuid.UUID | None = None,
    ):
        self.user = user
        self.api_key = api_key
        self.is_cli = api_key is not None
        self.environment_id = environment_id
        self.subscribed_scope_ids = subscribed_scope_ids or []
        self.default_write_scope_id = default_write_scope_id

    @property
    def user_id(self):
        return self.user.id


async def _auth_via_api_key(
    token: str, db: AsyncSession
) -> AuthContext | None:
    if not token.startswith(API_KEY_PREFIX):
        return None

    key_hash = hashlib.sha256(token.encode()).hexdigest()
    result = await db.execute(select(ApiKey).where(ApiKey.key_hash == key_hash))
    api_key = result.scalar_one_or_none()

    if not api_key:
        return None
    if api_key.revoked_at:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API key has been revoked")
    if api_key.expires_at and api_key.expires_at < datetime.now(timezone.utc):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "API key has expired")

    # Update last_used_at
    api_key.last_used_at = datetime.now(timezone.utc)
    await db.commit()

    result = await db.execute(select(User).where(User.id == api_key.user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found")

    return AuthContext(user=user, api_key=api_key)


async def _auth_via_clerk_jwt(
    token: str, db: AsyncSession
) -> AuthContext | None:
    if not settings.clerk_pem_public_key:
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Clerk public key not configured")

    try:
        payload = jwt.decode(
            token,
            settings.clerk_pem_public_key,
            algorithms=["RS256"],
            options={"verify_aud": False},
        )
    except jwt.InvalidTokenError:
        return None

    clerk_id = payload.get("sub")
    if not clerk_id:
        return None

    result = await db.execute(select(User).where(User.clerk_id == clerk_id))
    user = result.scalar_one_or_none()

    if not user:
        # Auto-create user on first login
        user = User(
            clerk_id=clerk_id,
            email=payload.get("email") or payload.get("email_address"),
            name=payload.get("name"),
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)

    return AuthContext(user=user)


async def get_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_session),
) -> AuthContext:
    token = credentials.credentials

    # Try ApiKey first (fast path, prefix check)
    ctx = await _auth_via_api_key(token, db)
    if not ctx:
        # Fall through to Clerk JWT
        ctx = await _auth_via_clerk_jwt(token, db)
    if not ctx:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # Lazy-init: every user must have a Personal scope backing default_scope_id.
    # Idempotent; noop after first run per user.
    await ensure_personal_scope(db, ctx.user)

    # Optional env binding via header — required for scope-filtered endpoints
    env_header = request.headers.get("X-Clawdi-Environment-Id")
    if env_header:
        try:
            env_id = uuid.UUID(env_header)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Invalid X-Clawdi-Environment-Id"
            )
        # Validate env ownership
        result = await db.execute(
            select(AgentEnvironment).where(AgentEnvironment.id == env_id)
        )
        env = result.scalar_one_or_none()
        if not env or env.user_id != ctx.user_id:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Environment does not belong to authenticated user",
            )
        ctx.environment_id = env_id
        ctx.default_write_scope_id = env.default_write_scope_id
        # Load subscriptions
        sub_result = await db.execute(
            select(AgentEnvironmentScope.scope_id).where(
                AgentEnvironmentScope.environment_id == env_id
            )
        )
        ctx.subscribed_scope_ids = [row[0] for row in sub_result.all()]

    return ctx


async def require_cli_auth(auth: AuthContext = Depends(get_auth)) -> AuthContext:
    """Require CLI authentication (ApiKey only, not Clerk JWT)."""
    if not auth.is_cli:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This endpoint requires CLI authentication")
    return auth
