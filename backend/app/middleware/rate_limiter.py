"""In-memory sliding-window rate limiter for HTTP and WebSocket endpoints."""

from __future__ import annotations

import asyncio
import ipaddress
import logging
import time
from collections import defaultdict, deque

from fastapi import WebSocket
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from app.config import (
    RATE_LIMIT_API_READ,
    RATE_LIMIT_GAME_CREATE,
    RATE_LIMIT_GAME_STOP,
    RATE_LIMIT_WS_CONNECT,
)

logger = logging.getLogger(__name__)

WINDOW_SECONDS = 60


class RateLimiter:
    """Sliding-window rate limiter keyed by arbitrary string (typically client IP)."""

    def __init__(self) -> None:
        self.windows: dict[str, deque[float]] = defaultdict(deque)

    def check(
        self, key: str, limit: int, window_seconds: int = WINDOW_SECONDS
    ) -> tuple[bool, int, float]:
        """Check if a request is allowed.

        Returns (allowed, remaining, reset_timestamp).
        """
        now = time.time()
        window = self.windows[key]
        cutoff = now - window_seconds
        # Trim expired entries
        while window and window[0] < cutoff:
            window.popleft()
        if len(window) >= limit:
            reset_at = window[0] + window_seconds
            return False, 0, reset_at
        window.append(now)
        return True, limit - len(window), now + window_seconds

    def cleanup(self, max_age: float = 300.0) -> int:
        """Remove entries older than max_age seconds. Returns number of keys pruned."""
        now = time.time()
        stale_keys = []
        for key, window in self.windows.items():
            if not window or (now - window[-1]) > max_age:
                stale_keys.append(key)
        for key in stale_keys:
            del self.windows[key]
        return len(stale_keys)


# Singleton instance shared across middleware and WS guard
rate_limiter = RateLimiter()

_TRUSTED_PROXY_NETWORKS = (
    ipaddress.ip_network("127.0.0.1/32"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
)


def _is_trusted_proxy(host: str | None) -> bool:
    if not host:
        return False
    try:
        ip = ipaddress.ip_address(host)
    except ValueError:
        return False
    return any(ip in network for network in _TRUSTED_PROXY_NETWORKS)


def _forwarded_client_ip(headers, peer_host: str | None) -> str | None:
    if not _is_trusted_proxy(peer_host):
        return None

    real_ip = headers.get("x-real-ip")
    if real_ip:
        return real_ip.strip()

    forwarded = headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[-1].strip()

    return None


def _get_client_ip(request: Request) -> str:
    """Extract the client IP, trusting proxy headers only from known peers."""
    peer_host = request.client.host if request.client else None
    forwarded_ip = _forwarded_client_ip(request.headers, peer_host)
    if forwarded_ip:
        return forwarded_ip
    if request.client:
        return request.client.host
    return "unknown"


def _classify_request(method: str, path: str) -> tuple[str, int]:
    """Classify an HTTP request into a rate limit tier.

    Returns (tier_name, limit_per_window).
    """
    if method == "POST" and path == "/api/games":
        return "game_create", RATE_LIMIT_GAME_CREATE
    if method == "POST" and path.endswith("/stop"):
        return "game_stop", RATE_LIMIT_GAME_STOP
    if path.startswith("/api/"):
        return "api_read", RATE_LIMIT_API_READ
    # No rate limit for non-API paths (health, static, etc.)
    return "", 0


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Starlette middleware that applies per-IP rate limiting to HTTP requests."""

    async def dispatch(self, request: Request, call_next):
        tier, limit = _classify_request(request.method, request.url.path)
        if not tier:
            return await call_next(request)

        ip = _get_client_ip(request)
        key = f"{tier}:{ip}"
        allowed, remaining, reset_at = rate_limiter.check(key, limit)

        if not allowed:
            retry_after = max(1, int(reset_at - time.time()))
            logger.warning(
                "Rate limited: ip=%s tier=%s limit=%d retry_after=%ds",
                ip,
                tier,
                limit,
                retry_after,
            )
            return JSONResponse(
                status_code=429,
                content={"detail": "Too many requests. Please try again later."},
                headers={
                    "X-RateLimit-Limit": str(limit),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(reset_at)),
                    "Retry-After": str(retry_after),
                },
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        response.headers["X-RateLimit-Reset"] = str(int(reset_at))
        return response


async def check_ws_rate_limit(websocket: WebSocket) -> bool:
    """Check WebSocket connection rate limit. Returns True if allowed."""
    peer_host = websocket.client.host if websocket.client else None
    ip = _forwarded_client_ip(websocket.headers, peer_host) or peer_host or "unknown"

    key = f"ws_connect:{ip}"
    allowed, _, _ = rate_limiter.check(key, RATE_LIMIT_WS_CONNECT)
    if not allowed:
        logger.warning("WebSocket rate limited: ip=%s", ip)
    return allowed


async def periodic_cleanup(interval: float = 300.0) -> None:
    """Background task that prunes stale rate limiter entries every `interval` seconds."""
    while True:
        await asyncio.sleep(interval)
        pruned = rate_limiter.cleanup()
        if pruned:
            logger.debug("Rate limiter cleanup: pruned %d stale keys", pruned)
