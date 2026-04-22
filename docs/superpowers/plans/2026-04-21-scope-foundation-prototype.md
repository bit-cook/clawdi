# Scope Foundation Prototype Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the new Scope-as-entity + environment-binding ACL model end-to-end in a runnable prototype. Single user, 2 envs, 2 scopes — prove resources don't cross scope and don't cross user.

**Architecture:** Add `Scope` and `ScopeMembership` tables to the existing FastAPI backend. Extend `AuthContext` to carry `environment_id` and `subscribed_scope_ids`, parsed from an `X-Clawdi-Environment-Id` header. Apply a nullable `scope_id` column to `skills` and filter list/upload endpoints by membership. CLI gets `clawdi scope` commands and a `--scope` flag on `clawdi skill add`. Keep Clerk auth unchanged — auth rework is out of scope. Postgres + pgvector run in Docker; backend and web run natively.

**Tech Stack:** Python 3.12 + FastAPI + SQLAlchemy 2.0 async + Alembic + asyncpg + pgvector (`pgvector/pgvector:pg16` image); TypeScript + Bun + Commander for CLI; curl for verification (no pytest setup — prototype pragmatism).

**Out of scope for this plan:**
- BasicAuthProvider (Clerk stays)
- Invite / email / SMTP flows
- RAG session search
- Profile + Bootstrap
- Daemon long-connection
- Dashboard UI changes
- Full pytest test suite
- Audit events table (V2)

---

## File Structure

**New files:**
- `docker-compose.yml` — Postgres + pgvector
- `apps/web/.env.example` — web env template (was missing)
- `backend/app/models/scope.py` — `Scope`, `ScopeMembership` models
- `backend/app/models/env_scope.py` — `AgentEnvironmentScope` association
- `backend/app/schemas/scope.py` — Pydantic schemas for scope CRUD
- `backend/app/routes/scopes.py` — scope CRUD + membership
- `backend/app/routes/environment_scopes.py` — env subscribe/unsubscribe
- `backend/alembic/versions/2026_04_21_0000_scopes.py` — scope tables
- `backend/alembic/versions/2026_04_21_0001_skill_scope_id.py` — skills.scope_id
- `packages/cli/src/commands/scope.ts` — CLI scope commands
- `packages/cli/src/lib/env-state.ts` — read/write `~/.clawdi/environments/<agent>.json`
- `scripts/verify-scope-acl.sh` — end-to-end verification bash script
- `docs/prototype-scope-foundation.md` — how to run + demo walkthrough

**Modified files:**
- `backend/app/core/auth.py` — parse `X-Clawdi-Environment-Id`, extend `AuthContext`
- `backend/app/models/skill.py` — add `scope_id` column
- `backend/app/routes/skills.py` — filter list by scope, validate scope on upload
- `backend/app/schemas/skill.py` — accept `scope_id` on upload
- `backend/app/main.py` — register new routers
- `packages/cli/src/lib/api-client.ts` — include `X-Clawdi-Environment-Id` header when available
- `packages/cli/src/commands/skills.ts` — `--scope` flag on `add`
- `packages/cli/src/index.ts` — register `clawdi scope` command + `--scope` option
- `backend/.env.example` — confirm DATABASE_URL matches docker-compose port

---

## Task 1: Docker infrastructure + env templates

**Files:**
- Create: `docker-compose.yml`
- Create: `apps/web/.env.example`
- Modify: `backend/.env.example` (only if port/default differs)

- [ ] **Step 1: Write `docker-compose.yml`**

```yaml
services:
  postgres:
    image: pgvector/pgvector:pg16
    container_name: clawdi_postgres
    environment:
      POSTGRES_USER: clawdi
      POSTGRES_PASSWORD: clawdi_dev
      POSTGRES_DB: clawdi_cloud
    ports:
      - "5433:5432"
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U clawdi -d clawdi_cloud"]
      interval: 5s
      timeout: 3s
      retries: 10
```

Note: host port `5433` matches existing default `database_url` in `backend/app/core/config.py:11`. No backend config change needed.

- [ ] **Step 2: Write `apps/web/.env.example`**

```
# Clerk (Dashboard auth — OSS users need free tier keys; auth rework is separate phase)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_replace_me
CLERK_SECRET_KEY=sk_test_replace_me

# Backend API
NEXT_PUBLIC_API_URL=http://localhost:8000
```

- [ ] **Step 3: Start docker PG**

Run: `docker compose up -d postgres`

Expected: `docker compose ps` shows `clawdi_postgres` with status `(healthy)` within ~10s.

- [ ] **Step 4: Verify pgvector + pg_trgm availability**

Run:
```bash
docker compose exec postgres psql -U clawdi -d clawdi_cloud -c \
  "SELECT name FROM pg_available_extensions WHERE name IN ('vector', 'pg_trgm');"
```

Expected output contains both `vector` and `pg_trgm` rows.

- [ ] **Step 5: Run backend migration against docker PG**

```bash
cd backend
pdm install
pdm migrate
```

Expected: `alembic upgrade head` completes with "Target database is up to date." or shows recent heads applied without errors.

- [ ] **Step 6: Start backend dev server**

```bash
pdm dev
```

Expected: uvicorn listens on `:8000`, no errors in startup logs.

- [ ] **Step 7: Verify backend health**

Run: `curl -s http://localhost:8000/health`

Expected: `{"status":"ok"}`

- [ ] **Step 8: Commit**

```bash
git add docker-compose.yml apps/web/.env.example
git commit -m "chore(infra): docker-compose for Postgres+pgvector; add web .env.example"
```

---

## Task 2: Scope model + membership

**Files:**
- Create: `backend/app/models/scope.py`

- [ ] **Step 1: Write `backend/app/models/scope.py`**

```python
import uuid

from sqlalchemy import ForeignKey, String
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
    # "private" = only owner can see via membership; MVP demo uses shared only
    # between owner's own envs (not cross-user sharing — that's Phase 2).
    visibility: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="shared"
    )


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
```

- [ ] **Step 2: Verify it imports cleanly**

```bash
cd backend
pdm run python -c "from app.models.scope import Scope, ScopeMembership; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/scope.py
git commit -m "feat(backend): Scope and ScopeMembership models"
```

---

## Task 3: AgentEnvironmentScope association

**Files:**
- Create: `backend/app/models/env_scope.py`

- [ ] **Step 1: Write `backend/app/models/env_scope.py`**

```python
import uuid

from sqlalchemy import ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class AgentEnvironmentScope(Base, TimestampMixin):
    """Multi-subscription: one env can subscribe to many scopes."""

    __tablename__ = "agent_environment_scopes"

    environment_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("agent_environments.id", ondelete="CASCADE"),
        primary_key=True,
    )
    scope_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scopes.id", ondelete="CASCADE"),
        primary_key=True,
    )
```

- [ ] **Step 2: Verify import**

```bash
cd backend
pdm run python -c "from app.models.env_scope import AgentEnvironmentScope; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/models/env_scope.py
git commit -m "feat(backend): AgentEnvironmentScope association table"
```

---

## Task 4: Alembic migration for scope tables

**Files:**
- Create: `backend/alembic/versions/2026_04_21_0000_scopes.py`

- [ ] **Step 1: Find current head**

```bash
cd backend
pdm run alembic heads
```

Note the revision ID(s). Use as `down_revision` in next step.

- [ ] **Step 2: Generate an empty migration file**

```bash
pdm run alembic revision -m "add scopes, scope_memberships, agent_environment_scopes"
```

This creates a new file under `backend/alembic/versions/`. Note its path.

- [ ] **Step 3: Replace generated `upgrade()` / `downgrade()` with the following**

(Edit the generated file. Keep the `revision` / `down_revision` identifiers Alembic generated.)

```python
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
```

- [ ] **Step 4: Run migration**

```bash
cd backend
pdm migrate
```

Expected: migration applies without error, `alembic current` shows new revision as head.

- [ ] **Step 5: Verify tables exist**

```bash
docker compose exec postgres psql -U clawdi -d clawdi_cloud -c "\dt scopes scope_memberships agent_environment_scopes"
```

Expected: all three table names listed.

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/
git commit -m "feat(backend): migration for scopes, memberships, env associations"
```

---

## Task 5: Scope Pydantic schemas

**Files:**
- Create: `backend/app/schemas/scope.py`

- [ ] **Step 1: Write `backend/app/schemas/scope.py`**

```python
import uuid
from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ScopeCreate(BaseModel):
    name: str = Field(min_length=1, max_length=200)


class ScopeOut(BaseModel):
    id: uuid.UUID
    name: str
    owner_user_id: uuid.UUID
    visibility: Literal["private", "shared"]
    created_at: datetime
    role: Literal["owner", "writer", "reader"] | None = None


class ScopeMemberOut(BaseModel):
    user_id: uuid.UUID
    role: Literal["owner", "writer", "reader"]
    added_at: datetime


class ScopeMemberAdd(BaseModel):
    user_id: uuid.UUID
    role: Literal["writer", "reader"] = "writer"
```

- [ ] **Step 2: Verify import**

```bash
pdm run python -c "from app.schemas.scope import ScopeCreate, ScopeOut; print('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add backend/app/schemas/scope.py
git commit -m "feat(backend): Pydantic schemas for scope API"
```

---

## Task 6: Scope CRUD + membership routes

**Files:**
- Create: `backend/app/routes/scopes.py`
- Modify: `backend/app/main.py` (register router)

- [ ] **Step 1: Write `backend/app/routes/scopes.py`**

```python
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.scope import Scope, ScopeMembership
from app.schemas.scope import ScopeCreate, ScopeMemberAdd, ScopeMemberOut, ScopeOut

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
        .order_by(Scope.created_at.desc())
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
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Owner cannot remove themselves")
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
```

- [ ] **Step 2: Register router in `backend/app/main.py`**

Add to imports:
```python
from app.routes.scopes import router as scopes_router
```

Add to router includes (after `app.include_router(vault_router)`):
```python
app.include_router(scopes_router)
```

- [ ] **Step 3: Restart backend**

```bash
# If pdm dev is running, it should auto-reload. Otherwise:
cd backend && pdm dev
```

- [ ] **Step 4: Verify — need an API key first**

The existing `clawdi login` flow requires Clerk. For prototype, create an API key directly via SQL.

```bash
# Generate a random token + hash
TOKEN=$(python3 -c "import secrets; print('clawdi_' + secrets.token_urlsafe(32))")
HASH=$(python3 -c "import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$TOKEN")
echo "TOKEN=$TOKEN"

# You need a user first. If none exist, create one:
docker compose exec postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO users (id, clerk_id, email, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'prototype-user-1', 'demo@clawdi.local', 'Demo', now(), now())
ON CONFLICT (clerk_id) DO NOTHING;
SQL

# Grab user id
USER_ID=$(docker compose exec -T postgres psql -U clawdi -d clawdi_cloud -At -c \
  "SELECT id FROM users WHERE clerk_id='prototype-user-1';")
echo "USER_ID=$USER_ID"

# Insert api key
docker compose exec -T postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO api_keys (id, user_id, key_hash, name, created_at, last_used_at)
VALUES (gen_random_uuid(), '$USER_ID', '$HASH', 'prototype', now(), NULL);
SQL

export CLAWDI_TOKEN="$TOKEN"
```

Save `$CLAWDI_TOKEN` — you'll need it for all subsequent curl calls.

- [ ] **Step 5: Verify scope create works**

```bash
curl -sS -X POST http://localhost:8000/api/scopes \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "work"}'
```

Expected: `201` with JSON containing `id`, `name: "work"`, `role: "owner"`.

- [ ] **Step 6: Verify list works**

```bash
curl -sS http://localhost:8000/api/scopes \
  -H "Authorization: Bearer $CLAWDI_TOKEN"
```

Expected: array containing the scope just created.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/scopes.py backend/app/main.py
git commit -m "feat(backend): scope CRUD + membership API"
```

---

## Task 7: Environment scope subscription routes

**Files:**
- Create: `backend/app/routes/environment_scopes.py`
- Modify: `backend/app/main.py`

- [ ] **Step 1: Write `backend/app/routes/environment_scopes.py`**

```python
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
    await _require_owned_env(db, env_id, auth.user_id)
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
```

- [ ] **Step 2: Register in `backend/app/main.py`**

Add import:
```python
from app.routes.environment_scopes import router as env_scopes_router
```

Add include:
```python
app.include_router(env_scopes_router)
```

- [ ] **Step 3: Verify subscription flow with curl**

```bash
# Create an environment (existing endpoint)
ENV_A_ID=$(curl -sS -X POST http://localhost:8000/api/environments \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"machine_id":"laptop-A","machine_name":"Laptop A","agent_type":"claude_code","os":"darwin"}' \
  | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
echo "ENV_A=$ENV_A_ID"

# Grab existing scope id from previous task
SCOPE_WORK=$(curl -sS http://localhost:8000/api/scopes \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  | python3 -c "import sys, json; print(json.load(sys.stdin)[0]['id'])")

# Subscribe env to scope
curl -sS -X POST "http://localhost:8000/api/environments/$ENV_A_ID/scopes/$SCOPE_WORK" \
  -H "Authorization: Bearer $CLAWDI_TOKEN"
```

Expected: `{"status":"subscribed"}`

```bash
# List env subscriptions
curl -sS "http://localhost:8000/api/environments/$ENV_A_ID/scopes" \
  -H "Authorization: Bearer $CLAWDI_TOKEN"
```

Expected: array containing `$SCOPE_WORK`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/routes/environment_scopes.py backend/app/main.py
git commit -m "feat(backend): environment scope subscription routes"
```

---

## Task 8: Environment binding middleware (AuthContext extension)

**Files:**
- Modify: `backend/app/core/auth.py`

- [ ] **Step 1: Update `AuthContext` class and `get_auth` function**

Replace the current `AuthContext` and `get_auth` with:

```python
class AuthContext:
    def __init__(
        self,
        user: User,
        api_key: ApiKey | None = None,
        environment_id: uuid.UUID | None = None,
        subscribed_scope_ids: list[uuid.UUID] | None = None,
    ):
        self.user = user
        self.api_key = api_key
        self.is_cli = api_key is not None
        self.environment_id = environment_id
        self.subscribed_scope_ids = subscribed_scope_ids or []

    @property
    def user_id(self):
        return self.user.id
```

Add `uuid` import at top of file if not present.

Replace `get_auth` with a version that also reads the header and loads subscriptions:

```python
async def get_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_session),
) -> AuthContext:
    token = credentials.credentials

    ctx = await _auth_via_api_key(token, db)
    if not ctx:
        ctx = await _auth_via_clerk_jwt(token, db)
    if not ctx:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid credentials")

    # Optional env binding via header
    env_header = request.headers.get("X-Clawdi-Environment-Id")
    if env_header:
        try:
            env_id = uuid.UUID(env_header)
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Invalid X-Clawdi-Environment-Id"
            )
        # Validate env ownership
        from app.models.session import AgentEnvironment
        from app.models.env_scope import AgentEnvironmentScope

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
        # Load subscriptions
        sub_result = await db.execute(
            select(AgentEnvironmentScope.scope_id).where(
                AgentEnvironmentScope.environment_id == env_id
            )
        )
        ctx.subscribed_scope_ids = [row[0] for row in sub_result.all()]

    return ctx
```

- [ ] **Step 2: Verify existing endpoints still work (no env header)**

```bash
curl -sS http://localhost:8000/api/skills \
  -H "Authorization: Bearer $CLAWDI_TOKEN"
```

Expected: `[]` (empty array) — existing behavior unchanged.

- [ ] **Step 3: Verify env header works**

```bash
curl -sS http://localhost:8000/api/skills \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -H "X-Clawdi-Environment-Id: $ENV_A_ID"
```

Expected: `[]` still, no error.

- [ ] **Step 4: Verify wrong env is rejected**

```bash
# Try a random UUID not owned by user
curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:8000/api/skills \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -H "X-Clawdi-Environment-Id: 00000000-0000-0000-0000-000000000000"
```

Expected: `403`

- [ ] **Step 5: Commit**

```bash
git add backend/app/core/auth.py
git commit -m "feat(backend): env binding via X-Clawdi-Environment-Id header"
```

---

## Task 9: Skill.scope_id column + migration

**Files:**
- Modify: `backend/app/models/skill.py`
- Create: `backend/alembic/versions/2026_04_21_0001_skill_scope_id.py`

- [ ] **Step 1: Update `backend/app/models/skill.py`**

Add to imports at top:
```python
from sqlalchemy import ForeignKey
```

Add column to `Skill` class (after `is_active`):
```python
    scope_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("scopes.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
```

- [ ] **Step 2: Generate migration**

```bash
cd backend
pdm run alembic revision -m "add skills.scope_id"
```

- [ ] **Step 3: Fill in `upgrade()` / `downgrade()`**

Replace generated body:

```python
def upgrade() -> None:
    op.add_column(
        "skills",
        sa.Column("scope_id", sa.UUID(), nullable=True),
    )
    op.create_foreign_key(
        "fk_skills_scope_id",
        "skills",
        "scopes",
        ["scope_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("ix_skills_scope_id", "skills", ["scope_id"])


def downgrade() -> None:
    op.drop_index("ix_skills_scope_id", table_name="skills")
    op.drop_constraint("fk_skills_scope_id", "skills", type_="foreignkey")
    op.drop_column("skills", "scope_id")
```

- [ ] **Step 4: Apply migration**

```bash
pdm migrate
```

Verify:
```bash
docker compose exec postgres psql -U clawdi -d clawdi_cloud -c "\d skills" | grep scope_id
```

Expected: row showing `scope_id | uuid |` (nullable).

- [ ] **Step 5: Commit**

```bash
git add backend/app/models/skill.py backend/alembic/versions/
git commit -m "feat(backend): add scope_id to skills (nullable = private)"
```

---

## Task 10: Skill endpoints enforce scope ACL

**Files:**
- Modify: `backend/app/routes/skills.py`

Upload is `POST /api/skills/upload` with `Form(skill_key=..., file=...)`. Install-from-github is `POST /api/skills/install` (body `{repo, path}`). Both paths funnel through `_upsert_skill()`. We thread `scope_id` through both.

- [ ] **Step 1: Add imports at top of `backend/app/routes/skills.py`**

Add to the existing import block near the top (before `from app.core.auth import ...`):

```python
import uuid

from sqlalchemy import or_

from app.models.scope import ScopeMembership
```

- [ ] **Step 2: Update `list_skills` query**

Replace the current `result = await db.execute(...)` block (around line 46-50) with:

```python
query = select(Skill).where(Skill.user_id == auth.user_id, Skill.is_active == True)

if auth.environment_id:
    # Env-bound call: private skills + skills in subscribed scopes
    if auth.subscribed_scope_ids:
        query = query.where(
            or_(
                Skill.scope_id.is_(None),
                Skill.scope_id.in_(auth.subscribed_scope_ids),
            )
        )
    else:
        query = query.where(Skill.scope_id.is_(None))
# else: no env header → return all user skills (Dashboard / unscoped call)

query = query.order_by(Skill.skill_key)
result = await db.execute(query)
skills = result.scalars().all()
```

Add `"scope_id": str(s.scope_id) if s.scope_id else None` to the `item` dict inside the loop.

- [ ] **Step 3: Update upload endpoint**

Replace the current `upload_skill` function (around line 126-171) with:

```python
@router.post("/upload")
async def upload_skill(
    skill_key: str = Form(...),
    file: UploadFile = File(...),
    scope_id: str | None = Form(default=None),
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Upload a skill as a tar.gz archive."""
    scope_uuid = await _validate_scope_write(db, scope_id, auth.user_id)

    data = await file.read()

    try:
        file_count = validate_tar(data)
    except TarValidationError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e))

    skill_md = extract_skill_md(data)
    if not skill_md:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Archive must contain a SKILL.md")

    fm = parse_frontmatter(skill_md)
    name = fm.get("name", skill_key)
    description = fm.get("description", "")

    content_hash = _content_hash(data)
    fk = _file_key(auth.user_id, skill_key)
    await file_store.put(fk, data)

    skill = await _upsert_skill(
        db,
        user_id=auth.user_id,
        skill_key=skill_key,
        name=name,
        description=description,
        content_hash=content_hash,
        file_key=fk,
        file_count=file_count,
        source="local",
        source_repo=None,
        scope_id=scope_uuid,
    )

    return {
        "skill_key": skill.skill_key,
        "name": skill.name,
        "version": skill.version,
        "file_count": file_count,
        "scope_id": str(skill.scope_id) if skill.scope_id else None,
    }
```

- [ ] **Step 4: Add `_validate_scope_write` helper and update `_upsert_skill`**

Add new helper near the existing `_content_hash` / `_file_key` helpers (around line 27-32):

```python
async def _validate_scope_write(
    db: AsyncSession, scope_id_str: str | None, user_id: uuid.UUID
) -> uuid.UUID | None:
    """Validate caller can write to the requested scope. Returns UUID or None."""
    if not scope_id_str:
        return None
    try:
        sid = uuid.UUID(scope_id_str)
    except ValueError:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope_id")

    result = await db.execute(
        select(ScopeMembership).where(
            ScopeMembership.scope_id == sid,
            ScopeMembership.user_id == user_id,
        )
    )
    membership = result.scalar_one_or_none()
    if not membership or membership.role == "reader":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Need writer or owner role on this scope",
        )
    return sid
```

Update `_upsert_skill` signature and body (around line 290):

Add `scope_id: uuid.UUID | None = None` to kwargs. In the `if skill:` branch, add `skill.scope_id = scope_id`. In the `else:` (create new) branch, include `scope_id=scope_id` when instantiating `Skill(...)`.

Full replacement for `_upsert_skill`:

```python
async def _upsert_skill(
    db: AsyncSession,
    *,
    user_id,
    skill_key: str,
    name: str,
    description: str,
    content_hash: str,
    file_key: str,
    file_count: int,
    source: str,
    source_repo: str | None,
    scope_id: uuid.UUID | None = None,
) -> Skill:
    result = await db.execute(
        select(Skill).where(Skill.user_id == user_id, Skill.skill_key == skill_key)
    )
    skill = result.scalar_one_or_none()

    if skill:
        skill.name = name
        skill.description = description
        skill.content_hash = content_hash
        skill.file_key = file_key
        skill.file_count = file_count
        skill.source = source
        if source_repo is not None:
            skill.source_repo = source_repo
        skill.scope_id = scope_id
        skill.is_active = True
        skill.version = skill.version + 1
    else:
        skill = Skill(
            user_id=user_id,
            skill_key=skill_key,
            name=name,
            description=description,
            content_hash=content_hash,
            file_key=file_key,
            file_count=file_count,
            source=source,
            source_repo=source_repo,
            scope_id=scope_id,
        )
        db.add(skill)

    await db.commit()
    await db.refresh(skill)
    return skill
```

- [ ] **Step 5: Also update `install_skill` endpoint**

Install-from-GitHub should also accept an optional scope. Modify `SkillInstallRequest` schema first:

Edit `backend/app/schemas/skill.py`:

```python
from pydantic import BaseModel


class SkillInstallRequest(BaseModel):
    repo: str
    path: str | None = None
    scope_id: str | None = None
```

Then in `install_skill` (around line 244), after `fetched = await fetch_skill_from_github(...)` add:

```python
    scope_uuid = await _validate_scope_write(db, body.scope_id, auth.user_id)
```

And in the `_upsert_skill(...)` call at end of `install_skill`, add `scope_id=scope_uuid`.

- [ ] **Step 6: Verify upload + listing filter with curl**

First upload a private skill (no scope):

```bash
TMP=$(mktemp -d)
echo "# Private Skill" > "$TMP/SKILL.md"
tar -czf "$TMP/skill.tar.gz" -C "$TMP" SKILL.md

curl -sS -X POST http://localhost:8000/api/skills/upload \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -F "skill_key=private-skill" \
  -F "file=@$TMP/skill.tar.gz"
```

Expected: 200, `{"skill_key":"private-skill", ..., "scope_id": null}`.

List with env header (should see it since it's private):

```bash
curl -sS http://localhost:8000/api/skills \
  -H "Authorization: Bearer $CLAWDI_TOKEN" \
  -H "X-Clawdi-Environment-Id: $ENV_A_ID" \
  | python3 -m json.tool
```

Expected: list contains `private-skill` with `scope_id: null`.

- [ ] **Step 7: Commit**

```bash
git add backend/app/routes/skills.py backend/app/schemas/skill.py
git commit -m "feat(backend): skill ACL via scope_id; validate writer/owner on upload"
```

---

## Task 11: CLI — env state helper

**Files:**
- Create: `packages/cli/src/lib/env-state.ts`

- [ ] **Step 1: Write `env-state.ts`**

```typescript
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { getClawdiDir } from "./config";

export interface EnvRecord {
	environmentId: string;
	agentType: string;
	machineId: string;
	machineName: string;
}

/** Read the first environment record found under ~/.clawdi/environments/ */
export function readFirstEnv(): EnvRecord | null {
	const dir = join(getClawdiDir(), "environments");
	if (!existsSync(dir)) return null;
	for (const file of readdirSync(dir)) {
		if (!file.endsWith(".json")) continue;
		const raw = readFileSync(join(dir, file), "utf-8");
		try {
			const data = JSON.parse(raw);
			if (data.environmentId || data.id) {
				return {
					environmentId: data.environmentId ?? data.id,
					agentType: data.agentType ?? file.replace(".json", ""),
					machineId: data.machineId ?? "",
					machineName: data.machineName ?? "",
				};
			}
		} catch {
			continue;
		}
	}
	return null;
}

/** Pick env by agent type (claude_code, codex, etc.) */
export function readEnvByAgent(agentType: string): EnvRecord | null {
	const path = join(getClawdiDir(), "environments", `${agentType}.json`);
	if (!existsSync(path)) return null;
	try {
		const data = JSON.parse(readFileSync(path, "utf-8"));
		return {
			environmentId: data.environmentId ?? data.id,
			agentType,
			machineId: data.machineId ?? "",
			machineName: data.machineName ?? "",
		};
	} catch {
		return null;
	}
}
```

- [ ] **Step 2: Verify it imports**

```bash
cd packages/cli
bun build --target=node --outfile=/tmp/envstate.js src/lib/env-state.ts 2>&1 | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/lib/env-state.ts
git commit -m "feat(cli): env-state helper reads ~/.clawdi/environments/*.json"
```

---

## Task 12: ApiClient carries env header

**Files:**
- Modify: `packages/cli/src/lib/api-client.ts`

- [ ] **Step 1: Replace the whole `ApiClient` class**

Replace the entire class body in `packages/cli/src/lib/api-client.ts` with:

```typescript
import { readFirstEnv } from "./env-state";
import { getAuth, getConfig } from "./config";

export class ApiClient {
	private baseUrl: string;
	private apiKey: string;
	private envId: string | null;

	constructor(opts?: { envId?: string | null }) {
		const config = getConfig();
		const auth = getAuth();
		if (!auth) {
			throw new Error("Not logged in. Run `clawdi login` first.");
		}
		this.baseUrl = config.apiUrl;
		this.apiKey = auth.apiKey;
		if (opts?.envId !== undefined) {
			this.envId = opts.envId;
		} else {
			const env = readFirstEnv();
			this.envId = env?.environmentId ?? null;
		}
	}

	private envHeader(): Record<string, string> {
		return this.envId ? { "X-Clawdi-Environment-Id": this.envId } : {};
	}

	async request<T>(path: string, options: RequestInit = {}): Promise<T> {
		const url = `${this.baseUrl}${path}`;
		const headers: Record<string, string> = {
			Authorization: `Bearer ${this.apiKey}`,
			"Content-Type": "application/json",
			...this.envHeader(),
			...(options.headers as Record<string, string>),
		};
		const res = await fetch(url, { ...options, headers });

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return res.json();
	}

	async get<T>(path: string): Promise<T> {
		return this.request<T>(path);
	}

	async post<T>(path: string, body?: unknown): Promise<T> {
		return this.request<T>(path, {
			method: "POST",
			body: body ? JSON.stringify(body) : undefined,
		});
	}

	async delete<T>(path: string): Promise<T> {
		return this.request<T>(path, { method: "DELETE" });
	}

	async uploadFile<T>(
		path: string,
		fields: Record<string, string>,
		file: Buffer,
		filename: string,
	): Promise<T> {
		const formData = new FormData();
		for (const [k, v] of Object.entries(fields)) {
			formData.append(k, v);
		}
		formData.append("file", new Blob([new Uint8Array(file)]), filename);

		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				...this.envHeader(),
			},
			body: formData,
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return res.json();
	}

	async getBytes(path: string): Promise<Buffer> {
		const url = `${this.baseUrl}${path}`;
		const res = await fetch(url, {
			headers: {
				Authorization: `Bearer ${this.apiKey}`,
				...this.envHeader(),
			},
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`API error ${res.status}: ${text}`);
		}

		return Buffer.from(await res.arrayBuffer());
	}
}
```

- [ ] **Step 2: Verify compile**

```bash
cd packages/cli
bun build src/index.ts --target=node --outfile=/tmp/cli.js 2>&1 | head -20
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/lib/api-client.ts
git commit -m "feat(cli): ApiClient includes X-Clawdi-Environment-Id header"
```

---

## Task 13: CLI `clawdi scope` commands

**Files:**
- Create: `packages/cli/src/commands/scope.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Write `packages/cli/src/commands/scope.ts`**

```typescript
import chalk from "chalk";
import { ApiClient } from "../lib/api-client";
import { readEnvByAgent, readFirstEnv } from "../lib/env-state";

interface Scope {
	id: string;
	name: string;
	owner_user_id: string;
	visibility: string;
	role: string | null;
	created_at: string;
}

export async function scopeCreate(name: string) {
	const api = new ApiClient();
	const scope = await api.post<Scope>("/api/scopes", { name });
	console.log(chalk.green(`Created scope ${chalk.bold(scope.name)} (${scope.id.slice(0, 8)}...)`));
}

export async function scopeList() {
	const api = new ApiClient();
	const scopes = await api.get<Scope[]>("/api/scopes");
	if (scopes.length === 0) {
		console.log(chalk.gray("No scopes yet. Create one with: clawdi scope create <name>"));
		return;
	}
	for (const s of scopes) {
		const role = s.role ? chalk.gray(`[${s.role}]`) : "";
		console.log(`  ${chalk.white(s.name)} ${chalk.gray(s.id.slice(0, 8))} ${role}`);
	}
}

export async function scopeMembers(scopeId: string) {
	const api = new ApiClient();
	const members = await api.get<Array<{ user_id: string; role: string; added_at: string }>>(
		`/api/scopes/${scopeId}/members`,
	);
	if (members.length === 0) {
		console.log(chalk.gray("No members."));
		return;
	}
	for (const m of members) {
		console.log(`  ${m.user_id.slice(0, 8)}  ${chalk.gray(m.role)}`);
	}
}

export async function scopeSubscribe(scopeId: string, agentType?: string) {
	const env = agentType ? readEnvByAgent(agentType) : readFirstEnv();
	if (!env) {
		console.log(
			chalk.red(
				`No registered environment${agentType ? ` for ${agentType}` : ""}. Run \`clawdi setup\` first.`,
			),
		);
		process.exit(1);
	}
	const api = new ApiClient({ envId: env.environmentId });
	const result = await api.post<{ status: string }>(
		`/api/environments/${env.environmentId}/scopes/${scopeId}`,
	);
	console.log(
		chalk.green(
			`✓ ${env.agentType} ${result.status === "already_subscribed" ? "already subscribed" : "subscribed"} to scope ${scopeId.slice(0, 8)}`,
		),
	);
}

export async function scopeUnsubscribe(scopeId: string, agentType?: string) {
	const env = agentType ? readEnvByAgent(agentType) : readFirstEnv();
	if (!env) {
		console.log(chalk.red(`No registered environment${agentType ? ` for ${agentType}` : ""}.`));
		process.exit(1);
	}
	const api = new ApiClient({ envId: env.environmentId });
	await api.delete(`/api/environments/${env.environmentId}/scopes/${scopeId}`);
	console.log(chalk.green(`✓ ${env.agentType} unsubscribed from scope ${scopeId.slice(0, 8)}`));
}
```

- [ ] **Step 2: Register commands in `packages/cli/src/index.ts`**

After the existing `skillsCmd` block (around line 165), insert:

```typescript
const scopeCmd = program.command("scope").description("Manage Scopes");

scopeCmd
	.command("create <name>")
	.description("Create a new Scope (you become owner)")
	.action(async (name) => {
		const { scopeCreate } = await import("./commands/scope.js");
		await scopeCreate(name);
	});

scopeCmd
	.command("list")
	.description("List Scopes you own or are a member of")
	.action(async () => {
		const { scopeList } = await import("./commands/scope.js");
		await scopeList();
	});

scopeCmd
	.command("members <scope_id>")
	.description("List members of a Scope")
	.action(async (id) => {
		const { scopeMembers } = await import("./commands/scope.js");
		await scopeMembers(id);
	});

scopeCmd
	.command("subscribe <scope_id>")
	.description("Subscribe current environment to a Scope")
	.option("--agent <type>", "Target agent (claude_code, codex, hermes, openclaw)")
	.action(async (id, opts) => {
		const { scopeSubscribe } = await import("./commands/scope.js");
		await scopeSubscribe(id, opts.agent);
	});

scopeCmd
	.command("unsubscribe <scope_id>")
	.description("Unsubscribe current environment from a Scope")
	.option("--agent <type>", "Target agent")
	.action(async (id, opts) => {
		const { scopeUnsubscribe } = await import("./commands/scope.js");
		await scopeUnsubscribe(id, opts.agent);
	});
```

- [ ] **Step 3: Build CLI**

```bash
cd packages/cli
bun install
bun run build   # or equivalent; check package.json for build script
```

Or link for dev:
```bash
bun link
```

- [ ] **Step 4: Verify CLI commands**

(Assuming `clawdi login` works and an env is registered — if not, create the env JSON file manually in `~/.clawdi/environments/claude_code.json` with `{"environmentId":"<env_a_id>","agentType":"claude_code"}`.)

```bash
clawdi scope create prototype-demo
clawdi scope list
```

Expected: create shows id, list shows the new scope with `[owner]` tag.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/commands/scope.ts packages/cli/src/index.ts
git commit -m "feat(cli): clawdi scope create/list/members/subscribe/unsubscribe"
```

---

## Task 14: CLI `--scope` flag on skill add

**Files:**
- Modify: `packages/cli/src/commands/skills.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Update `skillsAdd` signature and upload fields**

In `packages/cli/src/commands/skills.ts`, change the function signature:

```typescript
export async function skillsAdd(path: string, opts: { scope?: string } = {}) {
```

Then replace the `api.uploadFile(...)` call block (currently around line 76-81) with:

```typescript
	const fields: Record<string, string> = { skill_key: skillKey };
	if (opts.scope) fields.scope_id = opts.scope;

	const result = await api.uploadFile<{
		skill_key: string;
		version: number;
		file_count: number;
		scope_id: string | null;
	}>("/api/skills/upload", fields, tarBytes, `${skillKey}.tar.gz`);

	const scopeTag = result.scope_id ? chalk.cyan(` scope=${result.scope_id.slice(0, 8)}`) : "";
	console.log(
		chalk.green(
			`✓ Uploaded ${result.skill_key} (v${result.version}, ${result.file_count} files)${scopeTag}`,
		),
	);
}
```

- [ ] **Step 2: Wire the option in `packages/cli/src/index.ts`**

Find:
```typescript
skillsCmd
	.command("add <path>")
	.description("Upload a skill file")
	.action(async (path) => {
		const { skillsAdd } = await import("./commands/skills.js");
		await skillsAdd(path);
	});
```

Change to:

```typescript
skillsCmd
	.command("add <path>")
	.description("Upload a skill file")
	.option("--scope <scope_id>", "Attach this skill to a Scope (default: private)")
	.action(async (path, opts) => {
		const { skillsAdd } = await import("./commands/skills.js");
		await skillsAdd(path, { scope: opts.scope });
	});
```

- [ ] **Step 3: Rebuild and verify**

```bash
cd packages/cli
bun install && bun link   # re-link
clawdi skill add --help
```

Expected: help shows `--scope <scope_id>` option.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/commands/skills.ts packages/cli/src/index.ts
git commit -m "feat(cli): clawdi skill add --scope flag"
```

---

## Task 15: End-to-end verification script

**Files:**
- Create: `scripts/verify-scope-acl.sh`

- [ ] **Step 1: Write the script**

```bash
#!/usr/bin/env bash
# verify-scope-acl.sh
# Demonstrates: single user, 2 envs, 2 scopes, skill only visible to subscribed env.
#
# Prereqs:
#   - docker compose up -d postgres
#   - backend running: cd backend && pdm dev
#   - $CLAWDI_TOKEN env var is a valid API key for a user

set -euo pipefail

API="${API:-http://localhost:8000}"

if [[ -z "${CLAWDI_TOKEN:-}" ]]; then
	echo "Set CLAWDI_TOKEN to a valid API key (see Task 6 Step 4)"
	exit 1
fi

AUTH="-H \"Authorization: Bearer $CLAWDI_TOKEN\""

jqfield() {
	python3 -c "import sys, json; print(json.load(sys.stdin)[sys.argv[1]])" "$1"
}

echo "== Creating env_A (claude_code on laptop-A) =="
ENV_A=$(curl -sS -X POST "$API/api/environments" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"machine_id":"laptop-A","machine_name":"Laptop A","agent_type":"claude_code","os":"darwin"}' \
	| jqfield id)
echo "ENV_A=$ENV_A"

echo "== Creating env_B (codex on laptop-B) =="
ENV_B=$(curl -sS -X POST "$API/api/environments" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"machine_id":"laptop-B","machine_name":"Laptop B","agent_type":"codex","os":"darwin"}' \
	| jqfield id)
echo "ENV_B=$ENV_B"

echo "== Creating scope 'work' =="
SCOPE_WORK=$(curl -sS -X POST "$API/api/scopes" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"name":"work"}' | jqfield id)
echo "SCOPE_WORK=$SCOPE_WORK"

echo "== Creating scope 'personal' =="
SCOPE_PERSONAL=$(curl -sS -X POST "$API/api/scopes" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "Content-Type: application/json" \
	-d '{"name":"personal"}' | jqfield id)
echo "SCOPE_PERSONAL=$SCOPE_PERSONAL"

echo "== Subscribing env_A to 'work' =="
curl -sS -X POST "$API/api/environments/$ENV_A/scopes/$SCOPE_WORK" \
	-H "Authorization: Bearer $CLAWDI_TOKEN"
echo

echo "== Subscribing env_B to 'personal' =="
curl -sS -X POST "$API/api/environments/$ENV_B/scopes/$SCOPE_PERSONAL" \
	-H "Authorization: Bearer $CLAWDI_TOKEN"
echo

echo "== Uploading skill 'python-style' in scope 'work' =="
TMP=$(mktemp -d)
cat > "$TMP/SKILL.md" <<MD
---
name: python-style
description: Sample Python style skill for prototype
---
# Python Style
MD
tar -czf "$TMP/skill.tar.gz" -C "$TMP" SKILL.md

curl -sS -X POST "$API/api/skills/upload" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-F "skill_key=python-style" \
	-F "scope_id=$SCOPE_WORK" \
	-F "file=@$TMP/skill.tar.gz"
echo

echo ""
echo "== TEST 1: env_A (subscribed to work) should SEE the skill =="
LIST_A=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_A")
echo "$LIST_A"
if echo "$LIST_A" | grep -q "python-style"; then
	echo "PASS"
else
	echo "FAIL: env_A should see python-style"
	exit 1
fi

echo ""
echo "== TEST 2: env_B (NOT subscribed to work) should NOT SEE the skill =="
LIST_B=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_B")
echo "$LIST_B"
if echo "$LIST_B" | grep -q "python-style"; then
	echo "FAIL: env_B should NOT see python-style"
	exit 1
else
	echo "PASS"
fi

echo ""
echo "== TEST 3: subscribing env_B to work now makes it visible =="
curl -sS -X POST "$API/api/environments/$ENV_B/scopes/$SCOPE_WORK" \
	-H "Authorization: Bearer $CLAWDI_TOKEN"
echo

LIST_B2=$(curl -sS "$API/api/skills" \
	-H "Authorization: Bearer $CLAWDI_TOKEN" \
	-H "X-Clawdi-Environment-Id: $ENV_B")
if echo "$LIST_B2" | grep -q "python-style"; then
	echo "PASS"
else
	echo "FAIL: after subscribing, env_B should see python-style"
	exit 1
fi

echo ""
echo "ALL TESTS PASSED"
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x scripts/verify-scope-acl.sh
```

- [ ] **Step 3: Run the script**

```bash
./scripts/verify-scope-acl.sh
```

Expected: "ALL TESTS PASSED" at the end.

- [ ] **Step 4: Fix any failures**

If any test fails, iterate — the script is the acceptance test for this prototype. Commit fixes as separate commits.

- [ ] **Step 5: Commit the script**

```bash
git add scripts/verify-scope-acl.sh
git commit -m "test: end-to-end verification script for scope ACL"
```

---

## Task 16: Prototype README

**Files:**
- Create: `docs/prototype-scope-foundation.md`

- [ ] **Step 1: Write the doc**

```markdown
# Prototype: Scope Foundation

Demonstrates the new Scope model + environment-binding ACL from
`docs/superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md`.

## Prerequisites

- Docker + Docker Compose
- Python 3.12 + `pdm`
- Bun (for CLI)
- (Optional for Web dashboard) Clerk test account

## Bring up infrastructure

```bash
docker compose up -d postgres
```

Verify: `docker compose ps` shows `clawdi_postgres` (healthy).

## Bring up backend

```bash
cd backend
pdm install
pdm migrate
pdm dev        # runs on :8000
```

## Create a user + API key for demo

(Clerk not wired for prototype — use SQL shortcut.)

```bash
TOKEN=$(python3 -c "import secrets; print('clawdi_' + secrets.token_urlsafe(32))")
HASH=$(python3 -c "import hashlib, sys; print(hashlib.sha256(sys.argv[1].encode()).hexdigest())" "$TOKEN")

docker compose exec -T postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO users (id, clerk_id, email, name, created_at, updated_at)
VALUES (gen_random_uuid(), 'prototype-user-1', 'demo@clawdi.local', 'Demo', now(), now())
ON CONFLICT (clerk_id) DO NOTHING;
SQL

USER_ID=$(docker compose exec -T postgres psql -U clawdi -d clawdi_cloud -At -c \
  "SELECT id FROM users WHERE clerk_id='prototype-user-1';")

docker compose exec -T postgres psql -U clawdi -d clawdi_cloud <<SQL
INSERT INTO api_keys (id, user_id, key_hash, name, created_at, last_used_at)
VALUES (gen_random_uuid(), '$USER_ID', '$HASH', 'prototype', now(), NULL);
SQL

export CLAWDI_TOKEN="$TOKEN"
echo "CLAWDI_TOKEN=$CLAWDI_TOKEN"
```

## Run the ACL verification script

```bash
./scripts/verify-scope-acl.sh
```

Expected output ends with `ALL TESTS PASSED`.

## Try the CLI

```bash
cd packages/cli && bun install && bun link

# Configure the CLI to use this backend + token
mkdir -p ~/.clawdi
cat > ~/.clawdi/config.json <<EOF
{ "apiUrl": "http://localhost:8000" }
EOF
cat > ~/.clawdi/auth.json <<EOF
{ "apiKey": "$CLAWDI_TOKEN" }
EOF

# Create an env record manually (skipping Clerk-dependent setup flow)
mkdir -p ~/.clawdi/environments
cat > ~/.clawdi/environments/claude_code.json <<EOF
{ "environmentId": "$ENV_A_ID", "agentType": "claude_code" }
EOF

clawdi scope create demo
clawdi scope list
```

## What this prototype validates

- Scope table + memberships exist and enforce role-based writes
- `X-Clawdi-Environment-Id` header binds requests to an env; backend validates ownership
- Skills filtered by env's subscribed scopes (+ private fallback)
- Creating scope auto-adds creator as owner
- Non-owners can't add/remove members (writer/reader restrictions)
- Env cannot be bound to another user's env (403)

## What this prototype intentionally does NOT include

- BasicAuthProvider (Clerk stays)
- Invite flow / SMTP / sharing across users
- RAG session search
- Profile + Bootstrap
- Daemon / WebSocket sync
- Dashboard UI changes

See `docs/superpowers/specs/2026-04-21-cloud-first-oss-redesign-design.md` for the full design.
```

- [ ] **Step 2: Commit**

```bash
git add docs/prototype-scope-foundation.md
git commit -m "docs: prototype scope-foundation README"
```

---

## Self-Review Checklist

Run this after implementing all 16 tasks:

- [ ] `docker compose up -d postgres` → healthy within 10s
- [ ] `pdm migrate` applies cleanly on fresh DB (both new migrations)
- [ ] `pdm dev` starts without errors
- [ ] `curl /health` returns `{"status":"ok"}`
- [ ] Scope CRUD works: create / list / get / delete
- [ ] Membership: list / add / remove (owner-only guard)
- [ ] Env subscription: list / subscribe / unsubscribe
- [ ] Wrong-user env → 403; unknown env → 403
- [ ] `X-Clawdi-Environment-Id` header sets `ctx.subscribed_scope_ids`
- [ ] Skill listing filters by `(scope_id IS NULL) OR scope_id IN subscribed`
- [ ] Uploading skill to scope requires writer/owner role
- [ ] CLI `clawdi scope create/list/members/subscribe` all work
- [ ] CLI `clawdi skill add --scope <id>` attaches the scope
- [ ] `scripts/verify-scope-acl.sh` ends with `ALL TESTS PASSED`

If any check fails, do NOT mark the prototype complete — iterate until all pass.

---

## Next Steps After Prototype

Once this validates, the natural follow-ups (not in this plan):

1. **Session RAG**: `session_chunks` table + async chunking + `session_search` MCP tool
2. **BasicAuthProvider**: email/password + optional SMTP magic link; `auth_identities` table; remove Clerk hard dep in web
3. **Agent Profile + Bootstrap**: one-command agent onboarding
4. **Scope invite flow**: SMTP + pending-invite dashboard views (makes cross-user sharing actually usable)
5. **audit_events table + minimum record set**
6. **Daemon long-connection**: WS/SSE/poll fallback, replacing `sync up/down` one-shots

Each is a separate spec + plan iteration.
