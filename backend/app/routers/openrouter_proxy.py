from __future__ import annotations

import logging
import time
from typing import Any, get_args

import httpx
from fastapi import APIRouter

from app.models.chess_models import ReasoningEffort

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

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get("https://openrouter.ai/api/v1/models")
            resp.raise_for_status()
            raw = resp.json()
    except (httpx.HTTPError, ValueError):
        logger.warning("Model catalog unavailable; using cached capabilities", exc_info=True)
        return _cache["data"] if _cache["data"] is not None else []

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
        if "tools" not in params or "reasoning" not in params:
            continue
        # Batch variants only work on the async batch API, never chat/completions.
        if m.get("id", "").endswith(":batch"):
            continue
        pricing = m.get("pricing") or {}
        filtered.append({
            "id": m["id"],
            "name": m.get("name", m["id"]),
            "context_length": m.get("context_length", 0),
            "pricing_prompt": pricing.get("prompt", "0"),
            "pricing_completion": pricing.get("completion", "0"),
            "reasoning": m.get("reasoning") if isinstance(m.get("reasoning"), dict) else None,
        })

    filtered.sort(key=lambda x: x["id"].lower())

    _cache["data"] = filtered
    _cache["fetched_at"] = now
    logger.info("Cached %d OpenRouter models (filtered from %d)", len(filtered), len(models))
    return filtered


def normalize_reasoning_effort(model: dict | None, effort: str | None) -> str:
    metadata = (model or {}).get("reasoning")
    metadata = metadata if isinstance(metadata, dict) else {}
    supported = metadata.get("supported_efforts")
    supported = supported if isinstance(supported, list) else []
    mandatory = metadata.get("mandatory") is True
    if effort is None:
        if metadata.get("default_enabled") is False:
            return "none" if not mandatory and "none" in supported else "provider_default"
        default = metadata.get("default_effort")
        if (default in get_args(ReasoningEffort)
                and (not supported or default in supported)
                and not (default == "none" and (mandatory or metadata.get("default_enabled") is True))):
            return default
        return "provider_default"
    if effort not in supported or (effort == "none" and mandatory):
        detail = "Reasoning is mandatory" if effort == "none" and mandatory else "Unsupported reasoning effort"
        raise ValueError(f"{detail}: {effort}. Choose provider default or a supported effort.")
    return effort


@router.get("/models")
async def list_openrouter_models():
    """Return filtered, slimmed model list from OpenRouter."""
    return await _fetch_models()
