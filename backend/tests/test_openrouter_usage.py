import asyncio
import json

import httpx
import pytest
from openai import AsyncOpenAI
from pydantic_ai.providers.openrouter import OpenRouterProvider

from app.models.chess_models import GameConfig
from app.services.game_engine import GameEngine
from app.services.openrouter_model import ArenaOpenRouterModel


@pytest.mark.parametrize("provider_only_in_final_chunk", [False, True])
def test_streamed_retry_usage_and_zero_cost_are_preserved(monkeypatch, provider_only_in_final_chunk):
    async def scenario():
        requests = []

        def handler(request):
            body = json.loads(request.content)
            requests.append(body)
            move = "e2e5" if len(requests) == 1 else "e2e4"
            tool_name = body["tools"][0]["function"]["name"]
            base = {"id": f"request-{len(requests)}", "object": "chat.completion.chunk", "created": 1, "model": "anthropic/claude-sonnet-4.5", "provider": None if provider_only_in_final_chunk else "Anthropic"}
            chunks = [
                {**base, "choices": [{"index": 0, "finish_reason": None, "delta": {"role": "assistant", "tool_calls": [{"index": 0, "id": "move", "type": "function", "function": {"name": tool_name, "arguments": json.dumps({"move": move, "narration": "A move", "table_talk": "Your turn"})}}]}}]},
                {**base, "choices": [{"index": 0, "finish_reason": "tool_calls", "delta": {}}]},
                {**base, "choices": [], "usage": {"prompt_tokens": 1200, "completion_tokens": 20, "total_tokens": 1220, "cost": 0.003 if len(requests) == 1 else 0, "prompt_tokens_details": {"cached_tokens": 0 if len(requests) == 1 else 1024, "cache_write_tokens": 1024 if len(requests) == 1 else 0}}},
            ]
            chunks[-1]["provider"] = "Anthropic"
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content="".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncOpenAI(api_key="fake", base_url="https://example.invalid/v1", http_client=http, max_retries=0)
            model = ArenaOpenRouterModel("anthropic/claude-sonnet-4.5", provider=OpenRouterProvider(openai_client=client))
            monkeypatch.setattr("app.services.game_engine.arena_model", lambda name: model)
            engine = GameEngine(GameConfig(white_model="anthropic/claude-sonnet-4.5", black_model="test", white_reasoning_effort="high"), game_id="game")
            result = await engine._get_llm_move("anthropic/claude-sonnet-4.5", "white")
        assert result is not None
        assert result[4] == {"input_tokens": 2400, "output_tokens": 40, "cost_usd": 0.003}
        assert [(r.cache_read_tokens, r.cache_write_tokens, r.cost_usd) for r in engine.request_records] == [(0, 1024, 0.003), (1024, 0, 0)]
        assert [r.status for r in engine.request_records] == ["illegal_move", "accepted"]
        assert [r.provider for r in engine.request_records] == ["Anthropic", "Anthropic"]
        assert engine._build_result("draw", "max_moves").total_cost_usd == 0.003
        assert requests[0]["tool_choice"] == "auto"
        assert requests[0]["messages"][0]["content"][0]["cache_control"]["ttl"] == "5m"
        assert requests[0]["session_id"] == "game:white"

    asyncio.run(scenario())


def test_tool_choice_rejection_uses_one_prompted_fallback(monkeypatch):
    async def scenario():
        requests = []

        def handler(request):
            body = json.loads(request.content)
            requests.append(body)
            if len(requests) == 1:
                return httpx.Response(400, json={"error": {"code": 400, "message": "tool_choice required is unsupported"}})
            base = {"id": "fallback", "object": "chat.completion.chunk", "created": 1, "model": "deepseek/deepseek-v4-pro-0813", "provider": "Fixture"}
            chunks = [
                {**base, "choices": [{"index": 0, "finish_reason": None, "delta": {"role": "assistant", "content": '{"move":"e2e4","narration":"A move","table_talk":"Your turn"}'}}]},
                {**base, "choices": [{"index": 0, "finish_reason": "stop", "delta": {}}]},
            ]
            return httpx.Response(200, headers={"content-type": "text/event-stream"}, content="".join("data: " + json.dumps(c) + "\n\n" for c in chunks) + "data: [DONE]\n\n")

        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as http:
            client = AsyncOpenAI(api_key="fake", base_url="https://example.invalid/v1", http_client=http, max_retries=0)
            model = ArenaOpenRouterModel("deepseek/deepseek-v4-pro-0813", provider=OpenRouterProvider(openai_client=client))
            monkeypatch.setattr("app.services.game_engine.arena_model", lambda name: model)
            engine = GameEngine(GameConfig(white_model="test", black_model="test", white_reasoning_effort="high"))
            result = await engine._get_llm_move("test", "white")
        assert result[0].uci() == "e2e4"
        assert len(requests) == 2
        assert "tools" not in requests[1]
        assert [r.output_mode for r in engine.request_records] == ["tool", "prompted"]
        assert [r.status for r in engine.request_records] == ["provider_error", "accepted"]
        assert result[4]["cost_usd"] is None
        assert all(r.cache_read_tokens is None for r in engine.request_records)
        assert engine._consecutive_illegal_moves == 0
        summary = engine._build_result("draw", "max_moves")
        assert summary.total_cost_usd is None
        assert summary.known_cost_usd == 0

    asyncio.run(scenario())
