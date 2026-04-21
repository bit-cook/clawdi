import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.memory import Memory
from app.models.user import UserSetting
from app.services.embedding import resolve_embedder
from app.services.memory_provider import get_memory_provider

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api/memories", tags=["memories"])


class MemoryCreate(BaseModel):
    content: str
    category: str = "fact"
    source: str = "manual"
    tags: list[str] | None = None


class MemoryBatchRequest(BaseModel):
    memories: list[MemoryCreate]


@router.get("")
async def list_memories(
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0),
    category: str | None = Query(default=None),
    q: str | None = Query(default=None),
):
    provider = await get_memory_provider(str(auth.user_id), db)

    if q:
        return await provider.search(str(auth.user_id), q, limit=limit, category=category)

    return await provider.list_all(str(auth.user_id), limit=limit, offset=offset, category=category)


@router.post("")
async def create_memory(
    body: MemoryCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    provider = await get_memory_provider(str(auth.user_id), db)
    return await provider.add(
        str(auth.user_id), body.content,
        category=body.category, source=body.source, tags=body.tags,
    )


@router.post("/batch")
async def batch_create_memories(
    body: MemoryBatchRequest,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    provider = await get_memory_provider(str(auth.user_id), db)
    synced = 0
    for m in body.memories:
        await provider.add(
            str(auth.user_id), m.content,
            category=m.category, source=m.source, tags=m.tags,
        )
        synced += 1
    return {"synced": synced}


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    provider = await get_memory_provider(str(auth.user_id), db)
    await provider.delete(str(auth.user_id), memory_id)
    return {"status": "deleted"}


@router.post("/embed-backfill")
async def embed_backfill(
    force: bool = Query(default=False, description="Re-embed rows that already have an embedding."),
    batch_size: int = Query(default=32, ge=1, le=200),
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    """Compute embeddings for the caller's memories that lack one.

    Used after the user enables a semantic-search mode (local / api) or
    switches embedding providers. Uses the embedder chosen by the user's
    current settings.

    With `force=true`, re-embeds rows that already have embeddings too
    (useful after changing the embedding model).
    """
    result = await db.execute(
        select(UserSetting).where(UserSetting.user_id == auth.user_id)
    )
    setting = result.scalar_one_or_none()
    embedder = resolve_embedder((setting.settings if setting else {}) or {})
    if embedder is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No embedding provider configured. Set memory_embedding to 'local' or 'api' in settings.",
        )

    # Pull rows missing (or all, if force) for this user. Stream in batches
    # so we don't load thousands of rows into memory at once.
    base = select(Memory).where(Memory.user_id == auth.user_id)
    if not force:
        base = base.where(Memory.embedding.is_(None))

    processed = 0
    failed = 0
    offset = 0
    while True:
        chunk = (
            await db.execute(base.order_by(Memory.created_at.asc()).limit(batch_size).offset(offset))
        ).scalars().all()
        if not chunk:
            break
        for mem in chunk:
            try:
                vec = await embedder.embed(mem.content)
                mem.embedding = vec
                processed += 1
            except Exception as e:
                log.warning("backfill embed failed for %s: %s", mem.id, e)
                failed += 1
        await db.commit()
        # When `force=false`, we mutated rows so their `embedding IS NOT NULL`
        # and they'd leave the predicate. Don't increment offset — the next
        # query already excludes them. When `force=true`, every row matches
        # so we must advance.
        if force:
            offset += batch_size
    return {"processed": processed, "failed": failed}
