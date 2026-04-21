"""Embedding backends for the Builtin memory provider.

Two modes, chosen per-user via settings.memory_embedding:

- "local" — fastembed ONNX, ~130MB BAAI/bge-small-en-v1.5 (384 dim).
  First call downloads the model; subsequent calls load from disk.
  No API key required; CPU-only inference via onnxruntime.

- "api" — OpenAI-compatible embeddings. Default OpenAI
  `text-embedding-3-small` with `dimensions=384` (Matryoshka truncation)
  so the on-disk vector column is dimension-compatible with local mode.
  Override base_url for OpenRouter or any other OpenAI-compatible endpoint.

"off" — no embedder, search falls back to FTS + trigram only.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Protocol

log = logging.getLogger(__name__)

EMBEDDING_DIM = 384


class Embedder(Protocol):
    async def embed(self, text: str) -> list[float]: ...


class LocalEmbedder:
    """fastembed with BAAI/bge-small-en-v1.5 (384 dim, ~130MB ONNX).

    First call downloads the model to the fastembed cache dir
    (FASTEMBED_CACHE_DIR or a sensible default). Subsequent calls load
    from disk. Runs on CPU via onnxruntime — no GPU setup needed.
    """

    _instance: "LocalEmbedder | None" = None

    def __init__(self) -> None:
        from fastembed import TextEmbedding

        # Lazy-load the model. Blocks on first call while downloading.
        self.model = TextEmbedding("BAAI/bge-small-en-v1.5")

    @classmethod
    def get(cls) -> "LocalEmbedder":
        if cls._instance is None:
            cls._instance = cls()
        return cls._instance

    async def embed(self, text: str) -> list[float]:
        # fastembed.embed is a blocking generator; dispatch to a thread
        # so we don't stall the event loop.
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
        # `dimensions=384` truncates via Matryoshka (supported by
        # text-embedding-3-*). For providers that don't support it, the
        # call will fail; consider the 384-dim guarantee a supported-model
        # contract.
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
