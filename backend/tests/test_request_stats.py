import asyncio

import pytest
from sqlalchemy import text
from sqlmodel import select

from app import database
from app.database import Game, LLMRequest
from app.models.chess_models import LLMRequestRecord
from app.services.game_manager import GameManager
from app.services.request_stats import summarize_requests


def record(**changes):
    fields = dict(move_number=1, color="white", model="test/model", attempt=1,
                  output_mode="tool", routing_mode="economy", harness_version="test",
                  status="accepted", elapsed_ms=100, input_tokens=100,
                  output_tokens=10, cache_read_tokens=50, cache_write_tokens=0,
                  cost_usd=0.01)
    return LLMRequestRecord(**(fields | changes))


def test_legacy_telemetry_is_unknown():
    stats = summarize_requests([])
    assert stats.request_count == stats.retry_count == 0
    for field in ("input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens",
                  "cache_hit_ratio", "total_cost_usd", "retry_cost_usd", "avg_move_ms"):
        assert getattr(stats, field) is None
    assert stats.known_cost_usd == 0


def test_partial_totals_and_retry_latency():
    stats = summarize_requests([
        record(status="illegal_move", provider="a"),
        record(attempt=2, elapsed_ms=200, cost_usd=None, input_tokens=None,
               cache_read_tokens=None, provider="b"),
        record(color="black", status="cancelled", cost_usd=0.02,
               cache_read_tokens=0, elapsed_ms=900),
    ])
    assert stats.request_count == 3
    assert stats.retry_count == 1
    assert stats.input_tokens is None
    assert stats.output_tokens == 30
    assert stats.known_cost_usd == pytest.approx(0.03)
    assert stats.total_cost_usd is None
    assert stats.retry_cost_usd is None
    assert stats.cost_known_requests == 2
    assert stats.cache_known_requests == 2
    assert stats.cache_hit_ratio == 0.25
    assert stats.avg_move_ms == 300
    assert stats.providers == ["a", "b"]


def test_all_known_totals_and_zero_cache():
    stats = summarize_requests([record(cache_read_tokens=0), record(attempt=2, cache_read_tokens=0)])
    assert stats.total_cost_usd == 0.02
    assert stats.retry_cost_usd == 0.01
    assert stats.cache_hit_ratio == 0
    assert stats.input_tokens == 200


def test_persistence_idempotent_and_terminal_totals(tmp_path):
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/test.db")
        try:
            async with database.get_session_factory()() as session:
                session.add(Game(id="game", white_model="a", black_model="b", status="stopped"))
                await session.commit()
            manager = GameManager(None)
            req = record(status="illegal_move")
            await manager._persist_request("game", req)
            await manager._persist_request("game", req)
            await manager._persist_request("game", record(attempt=2, status="cancelled", cost_usd=None))
            async with database.get_session_factory()() as session:
                assert len((await session.exec(select(LLMRequest))).all()) == 2
                game = await session.get(Game, "game")
                assert game.status == "stopped"
                assert game.total_cost_usd == 0.01
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_migration_keeps_old_routing_unknown(tmp_path):
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/old.db")
        try:
            async with engine.begin() as conn:
                await conn.execute(text("ALTER TABLE games DROP COLUMN routing_mode"))
                await conn.execute(text("ALTER TABLE games DROP COLUMN harness_version"))
                await conn.execute(text("INSERT INTO games (id, white_model, black_model, status, total_moves, rated, white_illegal_moves, black_illegal_moves, total_cost_usd) VALUES ('old','a','b','completed',0,0,0,0,0)"))
                await database._migrate_add_columns(conn)
                await database._migrate_add_columns(conn)
            async with database.get_session_factory()() as session:
                game = await session.get(Game, "old")
                assert game.routing_mode is None
                assert game.harness_version is None
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_zero_cost_is_known_and_move_latency_includes_backoff():
    from app.database import Move
    req = record(cost_usd=0.0)
    move = Move(game_id="g", move_number=1, color="white", uci="e2e4", san="e4",
                fen_after="", response_time_ms=900)
    stats = summarize_requests([req], [move])
    assert stats.known_cost_usd == stats.total_cost_usd == 0
    assert stats.cost_known_requests == 1
    assert stats.avg_move_ms == 900


def test_result_uses_all_attempts_not_accepted_move_cost(tmp_path):
    from app.models.chess_models import GameResult
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/result.db")
        try:
            async with database.get_session_factory()() as session:
                session.add(Game(id="game", white_model="a", black_model="b", status="active", harness_version="test"))
                await session.commit()
            manager = GameManager(None)
            await manager._persist_request("game", record(status="illegal_move", cost_usd=0.02))
            await manager._persist_request("game", record(attempt=2, status="invalid_output", cost_usd=None, input_tokens=None))
            result = GameResult(outcome="black_wins", termination="illegal_moves", moves=[],
                                pgn="", total_moves=0, white_model="a", black_model="b",
                                total_input_tokens=None, total_cost_usd=None,
                                known_input_tokens=100, known_cost_usd=0.02)
            assert await manager._persist_result("game", result)
            assert not await manager._persist_result("game", result)
            assert result.total_input_tokens is None
            assert result.total_cost_usd is None
            assert result.known_input_tokens == 100
            assert result.known_cost_usd == 0.02
            async with database.get_session_factory()() as session:
                assert (await session.get(Game, "game")).total_cost_usd == 0.02
                from app.routers.games import get_game
                detail = await get_game("game", session)
                assert detail.total_cost_usd is None
                assert detail.total_input_tokens is None
                assert detail.known_cost_usd == 0.02
                assert detail.known_input_tokens == 100
        finally:
            await engine.dispose()
    asyncio.run(run())


@pytest.mark.parametrize("cost", [0.07, None])
def test_stop_flushes_final_records_before_websocket_closes(tmp_path, monkeypatch, cost):
    from app.models.chess_models import GameConfig
    from app.services import game_manager

    ready = None
    class FakeEngine:
        def __init__(self, *args, **kwargs):
            self.request_callbacks = []
            self.request_records = []
            self.move_callbacks = []
            self.illegal_move_callbacks = []
            self.chaos_move_callbacks = []

        async def play_game(self):
            ready.set()
            try:
                await asyncio.Future()
            finally:
                # The manager must recover a finalized record whose callback never ran.
                self.request_records.append(record(status="cancelled", cost_usd=cost, input_tokens=None, output_tokens=None))

    monkeypatch.setattr(game_manager, "GameEngine", FakeEngine)
    async def run():
        nonlocal ready
        ready = asyncio.Event()
        db_engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/stop.db")
        try:
            manager = GameManager(None)
            game_id, _ = await manager.start_game(GameConfig(white_model="a", black_model="b"))
            queue = manager.subscribe(game_id)
            await ready.wait()
            assert await manager.stop_game(game_id)
            async with database.get_session_factory()() as session:
                game = await session.get(Game, game_id)
                assert game.status == "stopped"
                assert game.total_cost_usd == (cost if cost is not None else 0)
                assert len((await session.exec(select(LLMRequest))).all()) == 1
            events = []
            while not queue.empty():
                events.append(queue.get_nowait())
            over = [e for e in events if e and e["type"] == "game_over"]
            assert over[-1]["data"]["total_cost_usd"] == cost
            assert over[-1]["data"]["known_cost_usd"] == (cost if cost is not None else 0)
            assert over[-1]["data"]["total_input_tokens"] is None
            assert over[-1]["data"]["known_input_tokens"] == 0
            assert events[-1] is None
        finally:
            await db_engine.dispose()
    asyncio.run(run())


def test_efficiency_endpoint_and_routing_catchup(tmp_path):
    from app.routers.games import get_game_efficiency, get_game, list_games
    from fastapi import HTTPException
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/api.db")
        try:
            async with database.get_session_factory()() as session:
                session.add(Game(id="game", white_model="a", black_model="b", status="active",
                                 routing_mode="responsive", harness_version="test", use_nitro=False))
                await session.commit()
                assert (await get_game_efficiency("game", session)).total_cost_usd is None
                with pytest.raises(HTTPException) as exc:
                    await get_game_efficiency("missing", session)
                assert exc.value.status_code == 404
                detail = await get_game("game", session)
                listing = await list_games(session=session)
                assert detail.routing_mode == listing.games[0].routing_mode == "responsive"
                assert detail.harness_version == "test"
            catchup = await GameManager(None).get_catch_up_state("game")
            assert catchup["data"]["routing_mode"] == "responsive"
            assert catchup["data"]["harness_version"] == "test"
            assert catchup["data"]["use_nitro"] is False
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_delete_removes_requests_and_moves_without_touching_other_games(tmp_path):
    from app.database import Move
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/delete.db")
        try:
            async with database.get_session_factory()() as session:
                for game_id in ("delete", "keep"):
                    session.add(Game(id=game_id, white_model="a", black_model="b", status="completed"))
                    session.add(Move(game_id=game_id, move_number=1, color="white", uci="e2e4",
                                     san="e4", fen_after=""))
                await session.commit()
            manager = GameManager(None)
            await manager._persist_request("delete", record())
            await manager._persist_request("keep", record())
            assert await manager.delete_game("delete")
            assert not await manager.delete_game("delete")
            async with database.get_session_factory()() as session:
                assert (await session.get(Game, "delete")) is None
                assert [r.game_id for r in (await session.exec(select(LLMRequest))).all()] == ["keep"]
                assert [r.game_id for r in (await session.exec(select(Move))).all()] == ["keep"]
        finally:
            await engine.dispose()
    asyncio.run(run())


@pytest.mark.parametrize("costs,complete,known", [([None], None, 0), ([0.0], 0.0, 0.0), ([0.03, None], None, 0.03)])
def test_public_totals_preserve_unknown_and_known_subtotal(tmp_path, costs, complete, known):
    from app.models.chess_models import GameResult
    from app.routers.games import get_game
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/unknown.db")
        try:
            manager = GameManager(None)
            async with database.get_session_factory()() as session:
                session.add(Game(id="game", white_model="a", black_model="b", status="active", harness_version="test"))
                await session.commit()
            for attempt, cost in enumerate(costs, 1):
                await manager._persist_request("game", record(attempt=attempt, status="cancelled",
                    cost_usd=cost, input_tokens=None, output_tokens=None))
            result = GameResult(outcome="*", termination="api_error", moves=[], pgn="", total_moves=0,
                                white_model="a", black_model="b", total_cost_usd=complete, known_cost_usd=known)
            before = result.model_dump()
            assert await manager._persist_result("game", result)
            assert result.model_dump() == before
            async with database.get_session_factory()() as session:
                assert (await session.get(Game, "game")).total_cost_usd == known
                detail = (await get_game("game", session)).model_dump(mode="json")
            catchup = (await manager.get_catch_up_state("game"))["data"]
            for payload in (detail, catchup):
                assert payload["total_cost_usd"] == complete
                assert payload["known_cost_usd"] == known
                assert payload["total_input_tokens"] is None
                assert payload["total_output_tokens"] is None
                assert payload["known_input_tokens"] == 0
                assert payload["known_output_tokens"] == 0
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_legacy_detail_cost_stays_numeric(tmp_path):
    from app.routers.games import get_game
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/legacy.db")
        try:
            async with database.get_session_factory()() as session:
                session.add(Game(id="legacy", white_model="a", black_model="b", total_cost_usd=0.12))
                await session.commit()
                detail = await get_game("legacy", session)
                assert detail.total_cost_usd == detail.known_cost_usd == 0.12
                assert detail.total_input_tokens is None
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_late_request_replay_does_not_double_count_result_subtotal(tmp_path):
    from app.models.chess_models import GameResult
    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/replay.db")
        try:
            async with database.get_session_factory()() as session:
                session.add(Game(id="game", white_model="a", black_model="b", status="active", harness_version="test"))
                await session.commit()
            manager = GameManager(None)
            await manager._persist_request("game", record(status="illegal_move", cost_usd=0.02))
            result = GameResult(outcome="*", termination="api_error", moves=[], pgn="", total_moves=0,
                                white_model="a", black_model="b", known_cost_usd=0.03)
            await manager._persist_result("game", result)
            delayed = record(attempt=2, status="provider_error", cost_usd=0.01)
            await manager._persist_request("game", delayed)
            await manager._persist_request("game", delayed)
            async with database.get_session_factory()() as session:
                assert (await session.get(Game, "game")).total_cost_usd == pytest.approx(0.03)
        finally:
            await engine.dispose()
    asyncio.run(run())


def test_platform_overview_uses_requests_with_legacy_move_fallback(tmp_path):
    from app.database import Move
    from app.services.stats_service import compute_platform_overview

    async def run():
        engine = await database.init_db(f"sqlite+aiosqlite:///{tmp_path}/platform.db")
        try:
            async with database.get_session_factory()() as session:
                for game_id, cost, harness in (("legacy", 0.03, None), ("played", 0.04, "test"), ("forfeit", 0.03, "test")):
                    session.add(Game(id=game_id, white_model="a", black_model="b", status="completed",
                                     total_cost_usd=cost, harness_version=harness,
                                     termination="illegal_moves" if game_id == "forfeit" else "max_moves"))
                for game_id, color, cost, inp, out, elapsed in (
                    ("legacy", "white", 0.02, 30, 3, 400),
                    ("legacy", "black", 0.01, 20, 2, 600),
                    ("played", "white", None, 999, 999, 800),
                ):
                    session.add(Move(game_id=game_id, move_number=1, color=color, uci="e2e4", san="e4",
                                     fen_after="", cost_usd=cost, input_tokens=inp, output_tokens=out,
                                     response_time_ms=elapsed))
                for game_id, values in (
                    ("played", dict(cost_usd=0.04, input_tokens=400, output_tokens=40)),
                    ("played", dict(color="black", cost_usd=0, input_tokens=50, output_tokens=5)),
                    ("forfeit", dict(status="illegal_move", cost_usd=0.01, input_tokens=100, output_tokens=10)),
                    ("forfeit", dict(attempt=2, status="invalid_output", cost_usd=0.02, input_tokens=200, output_tokens=20)),
                    ("forfeit", dict(attempt=3, status="provider_error", cost_usd=None, input_tokens=None, output_tokens=None)),
                ):
                    session.add(LLMRequest(game_id=game_id, **record(**values).model_dump()))
                await session.commit()
                overview = await compute_platform_overview(session)
                models = {m.model_id: m for m in overview.model_breakdowns}
                assert overview.total_cost_usd == pytest.approx(0.10)
                assert sum(m.total_cost_usd for m in models.values()) == pytest.approx(overview.total_cost_usd)
                assert overview.total_input_tokens == 800
                assert overview.total_output_tokens == 80
                assert models["a::none"].total_cost_usd == pytest.approx(0.09)
                assert models["a::none"].total_input_tokens == 730
                assert models["a::none"].total_output_tokens == 73
                assert models["a::none"].avg_response_ms == 600
                assert models["b::none"].total_cost_usd == pytest.approx(0.01)
                assert models["b::none"].avg_response_ms == 600
        finally:
            await engine.dispose()
    asyncio.run(run())
