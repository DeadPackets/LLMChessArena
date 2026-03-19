from __future__ import annotations

import logging
import time
from typing import Any

import httpx
from fastapi import APIRouter

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/openrouter", tags=["openrouter"])

# In-memory cache
_cache: dict[str, Any] = {"data": None, "fetched_at": 0.0}
_CACHE_TTL = 600  # 10 minutes


async def _fetch_models() -> list[dict]:
    """Fetch models from OpenRouter, filter, and slim down the payload."""
    now = time.time()
    if _cache["data"] is not None and (now - _cache["fetched_at"]) < _CACHE_TTL:
        return _cache["data"]

    async with httpx.AsyncClient(timeout=15.0) as client:
        resp = await client.get("https://openrouter.ai/api/v1/models")
        resp.raise_for_status()
        raw = resp.json()

    models = raw.get("data", [])

    # Filter: text-in, text-out, supports tools + reasoning
    filtered = []
    for m in models:
        arch = m.get("architecture") or {}
        inp = arch.get("input_modalities") or []
        out = arch.get("output_modalities") or []
        params = m.get("supported_parameters") or []
        if "text" not in inp or "text" not in out:
            continue
        if "reasoning" not in params:
            continue
        pricing = m.get("pricing") or {}
        filtered.append({
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "context_length": m.get("context_length", 0),
            "pricing_prompt": pricing.get("prompt", "0"),
            "pricing_completion": pricing.get("completion", "0"),
        })

    filtered.sort(key=lambda x: x["id"].lower())

    _cache["data"] = filtered
    _cache["fetched_at"] = now
    logger.info("Cached %d OpenRouter models (filtered from %d)", len(filtered), len(models))
    return filtered


@router.get("/models")
async def list_openrouter_models():
    """Return filtered, slimmed model list from OpenRouter."""
    try:
        return await _fetch_models()
    except httpx.HTTPError as e:
        logger.error("Failed to fetch OpenRouter models: %s", e)
        if _cache["data"] is not None:
            return _cache["data"]
        return []
