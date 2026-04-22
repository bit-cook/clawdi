import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.env_scope import AgentEnvironmentScope
from app.models.scope import ScopeMembership
from app.models.session import AgentEnvironment

router = APIRouter(prefix="/api/environments", tags=["environment-scopes"])


async def _require_owned_env(
    db: AsyncSession, env_id: uuid.UUID, user_id: uuid.UUID
) -> AgentEnvironment:
    result = await db.execute(
        select(AgentEnvironment).where(AgentEnvironment.id == env_id)
    )
    env = result.scalar_one_or_none()
    if not env:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Environment not found")
    if env.user_id != user_id:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not your environment")
    return env


async def _require_scope_member(
    db: AsyncSession, scope_id: uuid.UUID, user_id: uuid.UUID
) -> None:
    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == scope_id,
            ScopeMembership.user_id == user_id,
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Not a member of this scope"
        )


@router.get("/{env_id}/scopes")
async def list_env_scopes(
    env_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owned_env(db, env_id, auth.user_id)
    result = await db.execute(
        select(AgentEnvironmentScope.scope_id).where(
            AgentEnvironmentScope.environment_id == env_id
        )
    )
    return [str(row[0]) for row in result.all()]


@router.post("/{env_id}/scopes/{scope_id}", status_code=status.HTTP_201_CREATED)
async def subscribe_env_scope(
    env_id: uuid.UUID,
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    await _require_owned_env(db, env_id, auth.user_id)
    await _require_scope_member(db, scope_id, auth.user_id)

    result = await db.execute(
        select(AgentEnvironmentScope).where(
            AgentEnvironmentScope.environment_id == env_id,
            AgentEnvironmentScope.scope_id == scope_id,
        )
    )
    if result.scalar_one_or_none():
        return {"status": "already_subscribed"}

    sub = AgentEnvironmentScope(environment_id=env_id, scope_id=scope_id)
    db.add(sub)
    await db.commit()
    return {"status": "subscribed"}


@router.delete(
    "/{env_id}/scopes/{scope_id}", status_code=status.HTTP_204_NO_CONTENT
)
async def unsubscribe_env_scope(
    env_id: uuid.UUID,
    scope_id: uuid.UUID,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    env = await _require_owned_env(db, env_id, auth.user_id)

    # Hard invariant: cannot unsubscribe from a scope that's this env's
    # default write target — writes would land where reads can't see them.
    # Caller must change default_write first.
    if env.default_write_scope_id == scope_id:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Cannot unsubscribe: this scope is the agent's default write target. "
            "Change the agent's default write scope first, then unsubscribe.",
        )

    result = await db.execute(
        select(AgentEnvironmentScope).where(
            AgentEnvironmentScope.environment_id == env_id,
            AgentEnvironmentScope.scope_id == scope_id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not subscribed")
    await db.delete(sub)
    await db.commit()


from pydantic import BaseModel


class _DefaultWritePayload(BaseModel):
    # Accept either a scope id string, "private" literal, or null to clear.
    scope_id: str | None = None


@router.patch("/{env_id}/default-write-scope")
async def set_default_write_scope(
    env_id: uuid.UUID,
    body: _DefaultWritePayload,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Set the env's default write scope.

    - body.scope_id = None or "private" → clear (writes default to private)
    - body.scope_id = <uuid>            → validate membership, auto-subscribe
      if not already, then set default.
    """
    env = await _require_owned_env(db, env_id, auth.user_id)

    raw = body.scope_id
    if raw is None or raw == "" or raw == "private":
        env.default_write_scope_id = None
        await db.commit()
        return {"default_write_scope_id": None, "auto_subscribed": False}

    try:
        new_scope_id = uuid.UUID(raw)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope_id")

    # Must be a member of the target scope
    from app.models.scope import ScopeMembership
    member = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == new_scope_id,
            ScopeMembership.user_id == auth.user_id,
        )
    )
    if not member.scalar_one_or_none():
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "You're not a member of that scope",
        )

    # Auto-subscribe env if not already
    existing_sub = await db.execute(
        select(AgentEnvironmentScope).where(
            AgentEnvironmentScope.environment_id == env_id,
            AgentEnvironmentScope.scope_id == new_scope_id,
        )
    )
    auto_subscribed = False
    if not existing_sub.scalar_one_or_none():
        db.add(AgentEnvironmentScope(environment_id=env_id, scope_id=new_scope_id))
        auto_subscribed = True

    env.default_write_scope_id = new_scope_id
    await db.commit()
    return {
        "default_write_scope_id": str(new_scope_id),
        "auto_subscribed": auto_subscribed,
    }
