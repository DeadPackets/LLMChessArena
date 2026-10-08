import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pydantic import ValidationError

from app.models.api_models import CreateGameRequest
from app.models.chess_models import GameConfig
from app.routers import games, openrouter_proxy
from app.services.elo_service import rating_key


def test_reasoning_identity_preserves_old_none():
    assert rating_key("m", None, False, False) == "m::none"
    for effort in ("minimal", "xhigh", "provider_default"):
        assert rating_key("m", effort, False, False) == f"m::{effort}"
    with pytest.raises(ValidationError):
        CreateGameRequest(white_reasoning_effort="max")
    with pytest.raises(ValidationError):
        CreateGameRequest(white_reasoning_effort="provider_default")
    assert GameConfig(white_model="a", black_model="b", white_reasoning_effort="provider_default")


@pytest.mark.parametrize("requested,metadata,status,normalized", [
    (None, None, 200, "provider_default"),
    (None, {"supported_efforts": ["low", "high"], "default_effort": "high", "mandatory": True}, 200, "high"),
    (None, {"supported_efforts": ["none", "high"], "default_effort": "high", "default_enabled": False, "mandatory": False}, 200, "none"),
    (None, {"supported_efforts": ["high"], "default_effort": "high", "default_enabled": False, "mandatory": False}, 200, "provider_default"),
    (None, {"supported_efforts": ["none", "high"], "default_effort": "high", "default_enabled": False, "mandatory": True}, 200, "provider_default"),
    (None, {"default_effort": "high", "default_enabled": False, "mandatory": False}, 200, "provider_default"),
    ("high", {"supported_efforts": ["low", "high"]}, 200, "high"),
    ("none", {"supported_efforts": ["none", "high"], "mandatory": True}, 400, None),
    ("none", {"supported_efforts": ["none", "high"], "mandatory": False}, 200, "none"),
    ("low", None, 400, None),
    ("xhigh", {"supported_efforts": ["low", "high"]}, 400, None),
])
def test_create_validates_and_normalizes(monkeypatch, requested, metadata, status, normalized):
    manager = SimpleNamespace(queue_status=lambda: {"active": 0, "max": 1},
                              can_accept_new_game=lambda: True,
                              start_game=AsyncMock(return_value=("test", "active")))
    monkeypatch.setattr(openrouter_proxy, "_fetch_models", AsyncMock(return_value=[{"id": "m", "reasoning": metadata}]))
    monkeypatch.setattr(games, "_quota_retry_after", AsyncMock(return_value=None))
    monkeypatch.setattr(games.openrouter_key, "unavailable_reason", AsyncMock(return_value=None))
    app = FastAPI()
    app.include_router(games.router)
    app.state.game_manager = manager
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
            resp = await client.post("/api/games", json={"white_model": "m", "black_is_human": True,
                                                        "white_reasoning_effort": requested})
        assert resp.status_code == status, resp.text
        if status == 200:
            config = manager.start_game.call_args.args[0]
            assert config.white_reasoning_effort == normalized
            assert config.black_reasoning_effort is None
    asyncio.run(run())


def test_catalog_preserves_metadata_and_stale_fallback(monkeypatch):
    metadata = {"supported_efforts": ["none", "minimal", "xhigh"], "default_effort": "minimal",
                "mandatory": False, "future_provider_field": "preserved"}
    row = {"id": "m", "architecture": {"input_modalities": ["text"], "output_modalities": ["text"]},
           "supported_parameters": ["tools", "reasoning"], "reasoning": metadata}
    client = AsyncMock()
    client.__aenter__.return_value = client
    client.get.return_value = httpx.Response(200, json={"data": [row]}, request=httpx.Request("GET", "http://test"))
    monkeypatch.setattr(openrouter_proxy.httpx, "AsyncClient", lambda **kwargs: client)
    monkeypatch.setattr(openrouter_proxy, "_cache", {"data": None, "fetched_at": 0})
    async def run():
        models = await openrouter_proxy._fetch_models()
        assert models[0]["reasoning"] == metadata
        openrouter_proxy._cache["fetched_at"] = 0
        client.get.side_effect = httpx.ConnectError("offline")
        assert await openrouter_proxy._fetch_models() == models
        openrouter_proxy._cache["data"] = None
        assert await openrouter_proxy._fetch_models() == []
    asyncio.run(run())


@pytest.mark.parametrize("routing,nitro,stored,legacy", [
    (None, False, "economy", False),
    (None, True, None, True),
    ("economy", True, "economy", False),
    ("responsive", False, "responsive", False),
])
def test_routing_persistence(tmp_path, monkeypatch, routing, nitro, stored, legacy):
    from app import database
    from app.database import Game
    from app.services.game_manager import GameManager
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/routing.db")
        try:
            manager = GameManager(None)
            monkeypatch.setattr(manager, "_run_game", AsyncMock())
            config = GameConfig(white_model="a", black_model="b", routing_mode=routing, use_nitro=nitro)
            game_id, _ = await manager.start_game(config)
            await manager.active_games[game_id]
            async with database.get_session_factory()() as session:
                game = await session.get(Game, game_id)
                assert game.routing_mode == stored
                assert game.use_nitro is legacy
                assert game.white_reasoning_effort == "provider_default"
                assert game.harness_version == "pydantic-ai-2.43-v1"
        finally:
            await engine.dispose()
    asyncio.run(run())
