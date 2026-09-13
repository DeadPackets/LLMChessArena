import asyncio
import io
import json

import chess
import pytest
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.models.function import DeltaToolCall, FunctionModel

from app.models.chess_models import GameConfig
from app.services.chess_agent import chess_agent
from app.services.game_engine import GameEngine


@pytest.fixture(autouse=True)
def no_network(monkeypatch):
    monkeypatch.setattr("app.services.game_engine.arena_model", lambda name: None)


def run(coro):
    return asyncio.run(coro)


def fake_stream(moves, fail_first=False):
    calls = []

    async def stream(messages, info):
        index = len(calls)
        calls.append(messages)
        if fail_first and index == 0:
            raise ModelHTTPError(429, "test", headers={"retry-after": "0"})
        move = moves[min(index, len(moves) - 1)]
        yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args=json.dumps({
            "move": move, "narration": "A move", "table_talk": "Your turn",
        }))}

    return FunctionModel(stream_function=stream), calls


def test_transient_error_does_not_consume_illegal_allowance(monkeypatch):
    model, calls = fake_stream(["e2e4", "e2e4"], fail_first=True)
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    illegal = []

    async def on_illegal(event):
        illegal.append(event)

    engine.illegal_move_callbacks.append(on_illegal)
    with chess_agent.override(model=model):
        result = run(engine._get_llm_move("test", "white"))
    assert result is not None
    assert illegal == []
    assert [r.status for r in engine.request_records] == ["transport_error", "accepted"]
    assert len(calls) == 2


def test_illegal_response_retries_inside_same_sdk_run():
    model, calls = fake_stream(["e2e5", "e2e4"])
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    with chess_agent.override(model=model):
        result = run(engine._get_llm_move("test", "white"))
    assert result[0].uci() == "e2e4"
    assert len(calls[1]) > len(calls[0])
    assert [r.status for r in engine.request_records] == ["illegal_move", "accepted"]
    assert engine.board.fen() == chess.Board().fen()


def test_chaos_accepts_own_piece_without_retry():
    model, calls = fake_stream(["e2e5"])
    engine = GameEngine(GameConfig(white_model="test", black_model="test", chaos_mode=True))
    with chess_agent.override(model=model):
        result = run(engine._get_llm_move("test", "white"))
    assert result[0].uci() == "e2e5"
    assert engine._last_move_was_chaos
    assert len(calls) == 1


def test_api_exhaustion_is_not_an_illegal_move_forfeit(monkeypatch):
    async def unavailable(messages, info):
        raise ModelHTTPError(503, "test")
        yield ""

    monkeypatch.setattr("app.services.game_engine.LLM_RETRY_BASE_DELAY", 0, raising=False)
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    with chess_agent.override(model=FunctionModel(stream_function=unavailable)):
        result = run(engine.play_game())
    assert result.termination == "api_error"
    assert engine._consecutive_illegal_moves == 0
    assert len(engine.request_records) == 3


def test_cancellation_records_request_without_committing_move():
    async def scenario():
        started = asyncio.Event()

        async def stalled(messages, info):
            started.set()
            await asyncio.Event().wait()
            yield ""

        engine = GameEngine(GameConfig(white_model="test", black_model="test"))
        persisted = []

        async def save(record):
            persisted.append(record)

        engine.request_callbacks.append(save)
        with chess_agent.override(model=FunctionModel(stream_function=stalled)):
            task = asyncio.create_task(engine._get_llm_move("test", "white"))
            await started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert engine.move_history == []
        assert len(persisted) == 1
        assert persisted[0].status == "cancelled"
        assert persisted[0].cost_usd is None

    run(scenario())


def test_concurrent_games_keep_progress_separate():
    async def scenario():
        white = GameEngine(GameConfig(white_model="test", black_model="test"))
        black = GameEngine(GameConfig(white_model="test", black_model="test"))
        black.board.push_uci("e2e4")
        phases = [[], []]

        async def record_white(message):
            phases[0].append(message)

        async def record_black(message):
            phases[1].append(message)

        white.status_callback, black.status_callback = record_white, record_black

        async def stream(messages, info):
            await asyncio.sleep(0)
            move = "e7e5" if "as Black" in str(messages) else "e2e4"
            yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args=json.dumps({
                "move": move, "narration": "A move", "table_talk": "Your turn",
            }))}

        with chess_agent.override(model=FunctionModel(stream_function=stream)):
            results = await asyncio.gather(white._get_llm_move("test", "white"), black._get_llm_move("test", "black"))
        assert all(results)
        assert all(p.startswith("White:") for p in phases[0])
        assert all(p.startswith("Black:") for p in phases[1])
        assert any("receiving response" in p for p in phases[0])

    run(scenario())


def test_invalid_output_budget_is_ten_requests():
    model, calls = fake_stream(["e2e5"])
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    with chess_agent.override(model=model):
        result = run(engine.play_game())
    assert result.termination == "illegal_moves"
    assert len(calls) == 10
    assert all(r.status == "illegal_move" for r in engine.request_records)


def test_silent_llm_default_deadline_is_infrastructure_failure(monkeypatch):
    monkeypatch.setattr("app.services.game_engine.LLM_MOVE_TIMEOUT_DEFAULT", 0.01)

    async def stream(messages, info):
        await asyncio.sleep(10)
        yield ""

    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    with chess_agent.override(model=FunctionModel(stream_function=stream)):
        result = run(engine.play_game())
    assert result.termination == "api_error"
    assert engine.request_records[0].status == "cancelled"


def test_malformed_output_counts_once_per_request():
    async def stream(messages, info):
        yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args='{"move":"e2e4"}')}

    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    illegal = []

    async def rejected(event):
        illegal.append(event)

    engine.illegal_move_callbacks.append(rejected)
    with chess_agent.override(model=FunctionModel(stream_function=stream)):
        result = run(engine.play_game())
    assert result.termination == "illegal_moves"
    assert len(engine.request_records) == len(illegal) == 10


def test_connection_failure_is_retried(monkeypatch):
    from openai import APIConnectionError
    import httpx

    attempts = []

    async def stream(messages, info):
        attempts.append(1)
        raise APIConnectionError(request=httpx.Request("POST", "https://example.invalid"))
        yield ""

    monkeypatch.setattr("app.services.game_engine.LLM_RETRY_BASE_DELAY", 0)
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))
    with chess_agent.override(model=FunctionModel(stream_function=stream)):
        result = run(engine.play_game())
    assert result.termination == "api_error"
    assert len(attempts) == 3


def test_cancellation_during_persistence_keeps_entire_batch_recoverable():
    async def scenario():
        callback_started = asyncio.Event()
        model, _ = fake_stream(["e2e5", "e2e4"])
        engine = GameEngine(GameConfig(white_model="test", black_model="test"))

        async def stalled_callback(record):
            callback_started.set()
            await asyncio.Event().wait()

        engine.request_callbacks.append(stalled_callback)
        with chess_agent.override(model=model):
            task = asyncio.create_task(engine._get_llm_move("test", "white"))
            await callback_started.wait()
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task
        assert [r.status for r in engine.request_records] == ["illegal_move", "accepted"]

    run(scenario())


def test_complete_game_commits_validated_moves_and_preserves_unknown_cost():
    model, calls = fake_stream(["e2e4", "e7e5"])
    engine = GameEngine(GameConfig(white_model="test", black_model="test", max_moves=1))
    with chess_agent.override(model=model):
        result = run(engine.play_game())
    assert result.termination == "max_moves"
    assert [m.uci for m in result.moves] == ["e2e4", "e7e5"]
    assert [r.color for r in engine.request_records] == ["white", "black"]
    pgn = chess.pgn.read_game(io.StringIO(result.pgn))
    assert [m.uci() for m in pgn.mainline_moves()] == ["e2e4", "e7e5"]
    assert result.total_cost_usd is None
    assert result.known_cost_usd == 0


def test_broken_progress_observer_does_not_fail_game():
    model, _ = fake_stream(["e2e4", "e7e5"])
    engine = GameEngine(GameConfig(white_model="test", black_model="test"))

    async def broken_status(message):
        raise RuntimeError("UI disconnected")

    engine.status_callback = broken_status
    with chess_agent.override(model=model):
        result = run(engine._get_llm_move("test", "white"))
    assert result[0].uci() == "e2e4"
