"""Tracks whether the OpenRouter key can still pay for games (budget left, not disabled)."""

from __future__ import annotations

import logging
import time

import httpx

from app.config import DAILY_BUDGET_USD, MIN_KEY_BALANCE_USD, OPENROUTER_API_KEY

logger = logging.getLogger(__name__)

CHECK_TTL_SECONDS = 60
BUDGET_EXHAUSTED = "The arena's monthly LLM budget is used up. New games are paused until it resets."
DAILY_BUDGET_USED = "Today's LLM budget is used up. New games open again after midnight UTC."
KEY_DISABLED = "LLM games are paused by the operator. Please try again later."

_state: dict = {"checked": float("-inf"), "reason": None}


def mark_unavailable(status_code: int) -> None:
    """Record a 401/402 seen mid-game so new games are refused without a probe."""
    _state["reason"] = KEY_DISABLED if status_code == 401 else BUDGET_EXHAUSTED
    _state["checked"] = time.monotonic()
    logger.error("OpenRouter key unavailable (HTTP %d): %s", status_code, _state["reason"])


async def unavailable_reason() -> str | None:
    """Return a user-facing reason when LLM games cannot run, else None.

    Fails open: if OpenRouter's key endpoint itself is unreachable, games may start.
    """
    if time.monotonic() - _state["checked"] < CHECK_TTL_SECONDS:
        return _state["reason"]
    reason = None
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(
                "https://openrouter.ai/api/v1/key",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}"},
            )
        if resp.status_code == 401:
            reason = KEY_DISABLED
        elif resp.status_code == 402:
            reason = BUDGET_EXHAUSTED
        elif resp.is_success:
            data = resp.json().get("data", {})
            remaining = data.get("limit_remaining")
            if remaining is not None and remaining < MIN_KEY_BALANCE_USD:
                reason = BUDGET_EXHAUSTED
            elif DAILY_BUDGET_USD and (data.get("usage_daily") or 0) >= DAILY_BUDGET_USD:
                reason = DAILY_BUDGET_USED
        else:
            logger.warning("OpenRouter key check returned HTTP %d", resp.status_code)
    except (httpx.HTTPError, ValueError):
        logger.warning("OpenRouter key check failed", exc_info=True)
    _state.update(checked=time.monotonic(), reason=reason)
    return reason
