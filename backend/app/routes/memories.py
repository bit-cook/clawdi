import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import exists, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.memory import Memory
from app.models.memory_scope import MemoryScope
from app.models.scope import ScopeMembership
from app.services.embedding import resolve_embedder
from app.services.memory_provider import get_memory_provider
from app.services.permissions import (
    can_edit_shared_object,
    can_write_scope,
    scopes_of_memory,
)

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memories", tags=["memories"])


class MemoryCreate(BaseModel):
    content: str
    category: str = "fact"
    source: str = "manual"
    tags: list[str] | None = None
    scope_id: str | None = None


class MemoryBatchRequest(BaseModel):
    memories: list[MemoryCreate]


class ScopeListBody(BaseModel):
    scope_ids: list[str]


async def _resolve_target_scope(
    db: AsyncSession,
    scope_id_str: str | None,
    user_id: uuid.UUID,
    fallback_default: uuid.UUID | None = None,
) -> uuid.UUID | None:
    if scope_id_str is None:
        sid = fallback_default
        if sid is None:
            return None
    elif scope_id_str in ("", "private", "none"):
        return None
    else:
        try:
            sid = uuid.UUID(scope_id_str)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope_id")

    if not await can_write_scope(db, user_id, sid):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Need writer or owner role on this scope"
        )
    return sid


async def _bulk_scope_ids_for_memories(
    db: AsyncSession, memory_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[uuid.UUID]]:
    if not memory_ids:
        return {}
    result = await db.execute(
        select(MemoryScope).where(MemoryScope.memory_id.in_(memory_ids))
    )
    out: dict[uuid.UUID, list[uuid.UUID]] = {mid: [] for mid in memory_ids}
    for row in result.scalars().all():
        out.setdefault(row.memory_id, []).append(row.scope_id)
    return out


def _serialize_memory(m: Memory, scope_ids: list[uuid.UUID]) -> dict:
    return {
        "id": str(m.id),
        "content": m.content,
        "category": m.category,
        "source": m.source,
        "tags": m.tags,
        "creator_user_id": str(m.user_id),
        "scope_ids": [str(s) for s in scope_ids],
        "created_at": m.created_at.isoformat(),
    }


@router.get("")
async def list_memories(
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
    scope_id: str | None = Query(default=None),
):
    # Resolve which memories the caller can see: own private + scoped via membership.
    member_scope_ids_result = await db.execute(
        select(ScopeMembership.scope_id).where(ScopeMembership.user_id == auth.user_id)
    )
    member_scope_ids = [r[0] for r in member_scope_ids_result.all()]

    scoped_ids_result = await db.execute(
        select(MemoryScope.memory_id)
        .where(MemoryScope.scope_id.in_(member_scope_ids))
        .distinct()
    )
    scoped_ids = {r[0] for r in scoped_ids_result.all()}

    private_ids_result = await db.execute(
        select(Memory.id).where(
            Memory.user_id == auth.user_id,
            ~exists().where(MemoryScope.memory_id == Memory.id),
        )
    )
    private_ids = {r[0] for r in private_ids_result.all()}

    visible_ids = scoped_ids | private_ids

    # Explicit scope filter shortcut: only memories in that specific scope (caller-visible).
    if scope_id:
        try:
            sid = uuid.UUID(scope_id)
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid scope_id")
        if sid not in member_scope_ids:
            return []  # not a member → can't see its memories
        in_scope_result = await db.execute(
            select(MemoryScope.memory_id).where(MemoryScope.scope_id == sid)
        )
        visible_ids = visible_ids & {r[0] for r in in_scope_result.all()}

    if q:
        # Delegate to hybrid search provider (it runs over the full user's
        # memory set); then filter by visibility afterwards.
        provider = await get_memory_provider(str(auth.user_id), db)
        results = await provider.search(
            str(auth.user_id), q, limit=limit, category=category
        )
        filtered = [r for r in results if uuid.UUID(r["id"]) in visible_ids]
        # Fetch scope_ids for each result
        ids = [uuid.UUID(r["id"]) for r in filtered]
        scope_map = await _bulk_scope_ids_for_memories(db, ids)
        for r in filtered:
            r["scope_ids"] = [str(s) for s in scope_map.get(uuid.UUID(r["id"]), [])]
            r.pop("scope_id", None)
        # env subscription narrowing if env header present
        if auth.environment_id:
            if auth.subscribed_scope_ids:
                env_subs = set(auth.subscribed_scope_ids)
                def env_ok(r):
                    sids = [uuid.UUID(s) for s in r["scope_ids"]]
                    if not sids:
                        return True  # private owned by caller
                    return bool(set(sids) & env_subs)
                filtered = [r for r in filtered if env_ok(r)]
            else:
                filtered = [r for r in filtered if not r["scope_ids"]]
        return filtered

    if not visible_ids:
        return []

    query = select(Memory).where(Memory.id.in_(visible_ids))
    if category:
        query = query.where(Memory.category == category)

    if auth.environment_id:
        if auth.subscribed_scope_ids:
            subscribed = set(auth.subscribed_scope_ids)
            env_scoped_ids_result = await db.execute(
                select(MemoryScope.memory_id)
                .where(MemoryScope.scope_id.in_(subscribed))
                .distinct()
            )
            env_scoped_ids = {r[0] for r in env_scoped_ids_result.all()}
            query = query.where(Memory.id.in_(env_scoped_ids | private_ids))
        else:
            query = query.where(Memory.id.in_(private_ids))

    query = query.order_by(Memory.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(query)
    memories = list(result.scalars().all())
    scope_map = await _bulk_scope_ids_for_memories(db, [m.id for m in memories])
    return [_serialize_memory(m, scope_map.get(m.id, [])) for m in memories]


@router.post("")
async def create_memory(
    body: MemoryCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    scope_uuid = await _resolve_target_scope(
        db, body.scope_id, auth.user_id, fallback_default=auth.default_write_scope_id
    )
    provider = await get_memory_provider(str(auth.user_id), db)
    saved = await provider.add(
        str(auth.user_id), body.content,
        category=body.category, source=body.source, tags=body.tags,
    )
    if scope_uuid:
        db.add(MemoryScope(memory_id=uuid.UUID(saved["id"]), scope_id=scope_uuid))
        await db.commit()

    scope_ids = await scopes_of_memory(db, uuid.UUID(saved["id"]))
    saved["scope_ids"] = [str(s) for s in scope_ids]
    saved.pop("scope_id", None)
    return saved


@router.post("/batch")
async def batch_create_memories(
    body: MemoryBatchRequest,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    provider = await get_memory_provider(str(auth.user_id), db)
    synced = 0
    for m in body.memories:
        scope_uuid = await _resolve_target_scope(
            db, m.scope_id, auth.user_id, fallback_default=auth.default_write_scope_id
        )
        saved = await provider.add(
            str(auth.user_id), m.content,
            category=m.category, source=m.source, tags=m.tags,
        )
        if scope_uuid:
            db.add(MemoryScope(memory_id=uuid.UUID(saved["id"]), scope_id=scope_uuid))
            await db.commit()
        synced += 1
    return {"synced": synced}


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    mid = uuid.UUID(memory_id)
    result = await db.execute(select(Memory).where(Memory.id == mid))
    mem = result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")

    scope_ids = await scopes_of_memory(db, mid)
    if not await can_edit_shared_object(db, auth.user_id, mem.user_id, scope_ids):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Not allowed to delete this memory")

    provider = await get_memory_provider(str(auth.user_id), db)
    await provider.delete(str(auth.user_id), memory_id)
    return {"status": "deleted"}


@router.put("/{memory_id}/scopes")
async def replace_memory_scopes(
    memory_id: str,
    body: ScopeListBody,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    mid = uuid.UUID(memory_id)
    result = await db.execute(select(Memory).where(Memory.id == mid))
    mem = result.scalar_one_or_none()
    if not mem:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")

    current_ids = set(await scopes_of_memory(db, mid))
    if not await can_edit_shared_object(db, auth.user_id, mem.user_id, list(current_ids)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Cannot edit this memory")

    new_ids: set[uuid.UUID] = set()
    for s in body.scope_ids:
        try:
            new_ids.add(uuid.UUID(s))
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Invalid scope id: {s}")

    to_add = new_ids - current_ids
    to_remove = current_ids - new_ids

    for sid in to_add | to_remove:
        if not await can_write_scope(db, auth.user_id, sid):
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"You need writer/owner on scope {sid} to change this assignment",
            )

    for sid in to_add:
        db.add(MemoryScope(memory_id=mid, scope_id=sid))
    if to_remove:
        await db.execute(
            MemoryScope.__table__.delete().where(
                MemoryScope.memory_id == mid,
                MemoryScope.scope_id.in_(to_remove),
            )
        )
    await db.commit()
    return {
        "memory_id": memory_id,
        "scope_ids": [str(x) for x in new_ids],
        "added": [str(x) for x in to_add],
        "removed": [str(x) for x in to_remove],
    }


@router.post("/embed-backfill")
async def embed_backfill(
    force: bool = Query(default=False, description="Re-embed rows that already have an embedding."),
    batch_size: int = Query(default=32, ge=1, le=200),
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    embedder = resolve_embedder()
    if embedder is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="No embedding provider available.",
        )

    id_query = select(Memory.id).where(Memory.user_id == auth.user_id)
    if not force:
        id_query = id_query.where(Memory.embedding.is_(None))
    id_query = id_query.order_by(Memory.created_at.asc())
    target_ids = (await db.execute(id_query)).scalars().all()

    processed = 0
    failed = 0
    for i in range(0, len(target_ids), batch_size):
        chunk_ids = target_ids[i:i + batch_size]
        chunk = (
            await db.execute(select(Memory).where(Memory.id.in_(chunk_ids)))
        ).scalars().all()
        for mem in chunk:
            try:
                vec = await embedder.embed(mem.content)
                mem.embedding = vec
                processed += 1
            except Exception as e:
                log.warning("backfill embed failed for %s: %s", mem.id, e)
                failed += 1
        await db.commit()
    return {"processed": processed, "failed": failed}
