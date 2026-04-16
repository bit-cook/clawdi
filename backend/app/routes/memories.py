from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import AuthContext, get_auth
from app.core.database import get_session
from app.models.memory import Memory

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
    query = select(Memory).where(Memory.user_id == auth.user_id)

    if category:
        query = query.where(Memory.category == category)

    if q:
        query = query.where(Memory.content.ilike(f"%{q}%"))

    query = query.order_by(Memory.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(query)
    memories = result.scalars().all()

    return [
        {
            "id": str(m.id),
            "content": m.content,
            "category": m.category,
            "source": m.source,
            "tags": m.tags,
            "access_count": m.access_count,
            "created_at": m.created_at.isoformat(),
        }
        for m in memories
    ]


@router.post("")
async def create_memory(
    body: MemoryCreate,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    memory = Memory(
        user_id=auth.user_id,
        content=body.content,
        category=body.category,
        source=body.source,
        tags=body.tags,
    )
    db.add(memory)
    await db.commit()
    await db.refresh(memory)
    return {"id": str(memory.id)}


@router.post("/batch")
async def batch_create_memories(
    body: MemoryBatchRequest,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    synced = 0
    for m in body.memories:
        memory = Memory(
            user_id=auth.user_id,
            content=m.content,
            category=m.category,
            source=m.source,
            tags=m.tags,
        )
        db.add(memory)
        synced += 1

    await db.commit()
    return {"synced": synced}


@router.delete("/{memory_id}")
async def delete_memory(
    memory_id: str,
    auth: AuthContext = Depends(get_auth),
    db: AsyncSession = Depends(get_session),
):
    result = await db.execute(
        select(Memory).where(Memory.id == memory_id, Memory.user_id == auth.user_id)
    )
    memory = result.scalar_one_or_none()
    if not memory:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Memory not found")

    await db.delete(memory)
    await db.commit()
    return {"status": "deleted"}
