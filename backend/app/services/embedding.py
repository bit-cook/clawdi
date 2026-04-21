"""Embedding backends for the Builtin memory provider.

Two modes, chosen per-user via settings.memory_embedding:

- "local" — fastembed ONNX, ~1GB paraphrase-multilingual-mpnet-base-v2
  (768 dim, 50+ languages, symmetric). First call downloads the model;
  subsequent calls load from disk. No API key required; CPU-only
  inference via onnxruntime.

  (Why not intfloat/multilingual-e5-base? fastembed's curated list
  doesn't include it; mpnet-base-v2 is the strongest 768-dim multilingual
  option available without pulling sentence-transformers + PyTorch.)

- "api" — OpenAI-compatible embeddings. Default OpenAI
  `text-embedding-3-small` with `dimensions=768` (Matryoshka truncation)
  so the on-disk vector column is dimension-compatible with local mode.
  Override base_url for OpenRouter or any other OpenAI-compatible endpoint.

"off" — no embedder, search falls back to FTS + trigram only.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

log = logging.getLogger(__name__)

EMBEDDING_DIM = 768
LOCAL_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"


class Embedder(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class LocalEmbedder:
    """fastembed with paraphrase-multilingual-mpnet-base-v2 (768 dim, ~1GB ONNX).

    First call downloads the model to the fastembed cache dir. Subsequent
    calls load from disk. Runs on CPU via onnxruntime.
    """

    _instance: "LocalEmbedder | None" = None

    def __init__(self) -> None:
        from fastembed import TextEmbedding

        # Lazy-load the model. Blocks on first call while downloading (~1GB).
        self.model = TextEmbedding(LOCAL_MODEL_NAME)

    @classmethod
    def get(cls) -> "LocalEmbedder":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def embed(self, text: str) -> list[float]:
        def _embed_sync() -> list[float]:
            return list(next(iter(self.model.embed([text]))))

        return await asyncio.to_thread(_embed_sync)


class ApiEmbedder:
    """OpenAI-compatible embeddings (OpenAI, OpenRouter, any compat endpoint)."""

    def __init__(
        self,
        api_key: str,
        base_url: str | None = None,
        model: str = "text-embedding-3-small",
    ) -> None:
        from openai import AsyncOpenAI

        self.client = AsyncOpenAI(api_key=api_key, base_url=base_url or None)
        self.model = model

    async def embed(self, text: str) -> list[float]:
        # `dimensions=768` truncates via Matryoshka (supported by
        # text-embedding-3-*). Providers that don't support it will surface
        # an explicit error, which is preferable to silently mismatched dims.
        resp = await self.client.embeddings.create(
            input=text, model=self.model, dimensions=EMBEDDING_DIM,
        )
        return list(resp.data[0].embedding)


def resolve_embedder(settings: dict) -> Embedder | None:
    """Pick an Embedder based on user settings.

    Returns None when embedding is disabled or misconfigured. Callers
    should treat None as "fall back to FTS/trigram only".
    """
    mode = (settings or {}).get("memory_embedding", "off")
    if mode == "off":
        return None
    if mode == "local":
        try:
            return LocalEmbedder.get()
        except Exception as e:
            log.warning("memory_embedding=local failed to initialize: %s", e)
            return None
    if mode == "api":
        key = settings.get("memory_embedding_api_key", "")
        if not key:
            log.warning(
                "memory_embedding=api but memory_embedding_api_key is empty; "
                "search will fall back to FTS + trigram.",
            )
            return None
        return ApiEmbedder(
            api_key=key,
            base_url=settings.get("memory_embedding_base_url") or None,
            model=settings.get("memory_embedding_model") or "text-embedding-3-small",
        )
    log.warning("memory_embedding has unknown value %r; treating as off", mode)
    return None
