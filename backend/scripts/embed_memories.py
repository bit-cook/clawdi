"""Backfill memory embeddings for users who have embedding enabled.

Usage:
    # One user:
    pdm run python -m scripts.embed_memories --user-id <uuid>

    # All users with `memory_embedding` != "off":
    pdm run python -m scripts.embed_memories --all

    # Re-embed even rows that already have an embedding (after switching model):
    pdm run python -m scripts.embed_memories --all --force

Skips users whose `memory_embedding` is "off" or who have no valid embedder.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.database import engine
from app.models.memory import Memory
from app.models.user import UserSetting
from app.services.embedding import resolve_embedder

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("embed-memories")


async def embed_for_user(user_id: uuid.UUID, force: bool, batch_size: int) -> None:
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as db:
        setting_row = (
            await db.execute(select(UserSetting).where(UserSetting.user_id == user_id))
        ).scalar_one_or_none()
        embedder = resolve_embedder((setting_row.settings if setting_row else {}) or {})
        if embedder is None:
            log.info("skip %s: no embedder configured", user_id)
            return

        base = select(Memory).where(Memory.user_id == user_id)
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
                    log.warning("embed failed for %s: %s", mem.id, e)
                    failed += 1
            await db.commit()
            if force:
                offset += batch_size
        log.info("user %s: processed=%d failed=%d", user_id, processed, failed)


async def embed_all(force: bool, batch_size: int) -> None:
    SessionLocal = async_sessionmaker(engine, expire_on_commit=False)
    async with SessionLocal() as db:
        user_ids = (
            await db.execute(select(UserSetting.user_id))
        ).scalars().all()
    for uid in user_ids:
        await embed_for_user(uid, force=force, batch_size=batch_size)


def main() -> None:
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--user-id", type=str, help="Backfill a single user by UUID.")
    g.add_argument("--all", action="store_true", help="Backfill every user with settings.")
    ap.add_argument("--force", action="store_true", help="Re-embed rows that already have embeddings.")
    ap.add_argument("--batch-size", type=int, default=32)
    args = ap.parse_args()

    if args.all:
        asyncio.run(embed_all(force=args.force, batch_size=args.batch_size))
    else:
        asyncio.run(
            embed_for_user(uuid.UUID(args.user_id), force=args.force, batch_size=args.batch_size)
        )


if __name__ == "__main__":
    main()
