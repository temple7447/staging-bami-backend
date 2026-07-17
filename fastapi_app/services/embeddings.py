"""Text embeddings for the knowledge index — Gemini embeddings via REST.

Matches the codebase's existing Gemini usage (utils/image_gen.py): direct REST
calls with the API key, no SDK. Similarity is cosine, computed with numpy.
The model is settings.EMBED_MODEL (gemini-embedding-001); every request pins
outputDimensionality to settings.EMBED_DIM so vector sizes never drift.
"""
from __future__ import annotations

import logging

import httpx
import numpy as np

from core.config import settings

logger = logging.getLogger(__name__)

_BASE = "https://generativelanguage.googleapis.com/v1beta"
# Gemini caps batch embed requests; keep batches modest.
_BATCH = 90


def is_configured() -> bool:
    return bool(settings.GEMINI_API_KEY)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed many texts, returning one vector per input (order preserved).

    Empty/failed inputs get a zero vector so indexing never crashes on one bad
    document. Batches are chunked to stay within Gemini's request limits.
    """
    if not texts:
        return []
    if not settings.GEMINI_API_KEY:
        logger.warning("[EMBED] GEMINI_API_KEY not set — cannot embed")
        return [[0.0] * settings.EMBED_DIM for _ in texts]

    model = settings.EMBED_MODEL if settings.EMBED_MODEL.startswith("models/") else f"models/{settings.EMBED_MODEL}"
    url = f"{_BASE}/{model}:batchEmbedContents"
    out: list[list[float]] = []
    async with httpx.AsyncClient(timeout=60) as client:
        for i in range(0, len(texts), _BATCH):
            batch = texts[i:i + _BATCH]
            payload = {"requests": [
                {"model": model,
                 "content": {"parts": [{"text": (t or " ")[:8000]}]},
                 "outputDimensionality": settings.EMBED_DIM}
                for t in batch
            ]}
            try:
                r = await client.post(url, params={"key": settings.GEMINI_API_KEY}, json=payload)
                r.raise_for_status()
                embs = r.json().get("embeddings", [])
                for e in embs:
                    out.append(e.get("values", []) or [0.0] * settings.EMBED_DIM)
                # Pad if Google returned fewer than requested (shouldn't happen).
                while len(out) < i + len(batch):
                    out.append([0.0] * settings.EMBED_DIM)
            except Exception as e:
                logger.error("[EMBED] batch %d failed: %s", i // _BATCH, e)
                out.extend([[0.0] * settings.EMBED_DIM for _ in batch])
    return out


async def embed_query(text: str) -> list[float]:
    vecs = await embed_texts([text])
    return vecs[0] if vecs else [0.0] * settings.EMBED_DIM


def top_k(query_vec: list[float], candidates: list[tuple[str, list[float]]],
          k: int = 8) -> list[tuple[str, float]]:
    """Return the k (id, score) pairs most cosine-similar to query_vec.

    `candidates` is [(id, embedding), …]. Rows with a zero/empty embedding are
    skipped. Scores are cosine similarity in [-1, 1].
    """
    q = np.asarray(query_vec, dtype=np.float32)
    qn = float(np.linalg.norm(q))
    if qn == 0.0:
        return []
    scored: list[tuple[str, float]] = []
    for cid, vec in candidates:
        if not vec:
            continue
        v = np.asarray(vec, dtype=np.float32)
        vn = float(np.linalg.norm(v))
        if vn == 0.0:
            continue
        scored.append((cid, float(np.dot(q, v) / (qn * vn))))
    scored.sort(key=lambda kv: kv[1], reverse=True)
    return scored[:k]
