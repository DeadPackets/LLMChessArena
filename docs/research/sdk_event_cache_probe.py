import ast
import asyncio
import json
from dataclasses import dataclass, field
from importlib.metadata import version
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

from openai import AsyncOpenAI
from openai.types.chat import ChatCompletion
from pydantic import BaseModel
from pydantic_ai import Agent, PartEndEvent, PartStartEvent, RunContext
from pydantic_ai.messages import ModelResponse, TextPart
from pydantic_ai.models.function import DeltaToolCall, FunctionModel
from pydantic_ai.models.openrouter import OpenRouterModel
from pydantic_ai.providers.openrouter import OpenRouterProvider


@dataclass
class Context:
    game_id: str
    phases: list[str] = field(default_factory=list)


class Move(BaseModel):
    move: str


async def probe_events():
    calls = []

    def full(messages, info):
        calls.append("full")
        return ModelResponse(parts=[TextPart("hello")])

    async def stream(messages, info):
        calls.append("stream")
        yield "hel"
        yield "lo"

    agent = Agent(FunctionModel(function=full, stream_function=stream), deps_type=Context)
    await agent.run("hello", deps=Context("baseline"))
    assert calls == ["full"], calls
    calls.clear()

    @agent.on_event(PartStartEvent, PartEndEvent)
    async def phase(ctx: RunContext[Context], event):
        ctx.deps.phases.append(type(event).__name__)

    a, b = Context("a"), Context("b")
    await asyncio.gather(agent.run("hello", deps=a), agent.run("hello", deps=b))
    assert calls == ["stream", "stream"], calls
    assert a.phases == b.phases == ["PartStartEvent", "PartEndEvent"]
    assert a.phases is not b.phases
    print("Filtered listeners: automatic streaming; separate concurrent contexts")

    events = []

    async def tool_stream(messages, info):
        yield {0: DeltaToolCall(name=info.output_tools[0].name, json_args='{"move":')}
        yield {0: DeltaToolCall(json_args='"e2e4"}')}

    structured = Agent(FunctionModel(stream_function=tool_stream), output_type=Move)

    @structured.on_event
    async def record(ctx, event):
        events.append(type(event).__name__)

    @structured.output_validator
    def validate(ctx, output):
        events.append("OUTPUT_VALIDATED")
        return output

    result = await structured.run("move")
    events.append("RUN_RETURNED")
    assert result.output.move == "e2e4"
    assert events.index("FinalResultEvent") < events.index("OUTPUT_VALIDATED")
    assert events.index("OUTPUT_VALIDATED") < events.index("RUN_RETURNED")
    print("Structured event order:", " -> ".join(events))


async def probe_requests():
    repo = Path(__file__).resolve().parents[2]
    tree = ast.parse((repo / "backend/app/services/chess_agent.py").read_text())
    prompt = next(
        ast.literal_eval(node.value)
        for node in tree.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "SYSTEM_PROMPT" for target in node.targets)
    ) % {"narration_cap": 128}
    print(f"Static instructions: {len(prompt)} characters, {len(prompt.split())} words (not tokens)")
    requests = []

    async def create(**kwargs):
        requests.append(kwargs)
        return ChatCompletion.model_validate({
            "id": "fake", "object": "chat.completion", "created": 1,
            "model": kwargs["model"],
            "choices": [{
                "index": 0, "finish_reason": "tool_calls",
                "message": {"role": "assistant", "content": None, "tool_calls": [{
                    "id": "fake-call", "type": "function",
                    "function": {
                        "name": kwargs["tools"][0]["function"]["name"],
                        "arguments": '{"move":"e2e4"}',
                    },
                }]},
            }],
            "usage": {"prompt_tokens": 1500, "completion_tokens": 10, "total_tokens": 1510},
            "cost": 0, "provider": "MockProvider",
        })

    client = MagicMock(spec=AsyncOpenAI)
    client.chat.completions.create = AsyncMock(side_effect=create)
    client.base_url = "https://openrouter.ai/api/v1/"
    provider = OpenRouterProvider(openai_client=client)
    cases = [
        ("anthropic/claude-sonnet-4.5:floor", "auto", [{"type": "ephemeral", "ttl": "5m"}]),
        ("deepseek/deepseek-v4-pro-0813:floor", "required", []),
        ("google/gemini-3.7-flash:floor", "required", [{"type": "ephemeral"}]),
    ]
    for model, typed_choice, typed_markers in cases:
        for mode in ("raw", "typed"):
            settings = {"extra_body": {"session_id": "example:white"}}
            if mode == "raw":
                settings["extra_body"].update({
                    "reasoning": {"effort": "high"},
                    "cache_control": {"type": "ephemeral"},
                })
            else:
                settings.update({
                    "openrouter_reasoning": {"effort": "high"},
                    "openrouter_cache_instructions": "5m",
                })
            agent = Agent(OpenRouterModel(model, provider=provider), instructions=prompt, output_type=Move)
            await agent.run("You are White. FEN changes here.", model_settings=settings)
            request = requests[-1]
            content = request["messages"][0]["content"]
            markers = [part["cache_control"] for part in content if isinstance(part, dict) and "cache_control" in part]
            assert request["tool_choice"] == (typed_choice if mode == "typed" else "required")
            assert markers == (typed_markers if mode == "typed" else [])
            print(json.dumps({
                "model": model, "mode": mode, "tool_choice": request["tool_choice"],
                "instruction_cache_markers": markers, "extra_body": request["extra_body"],
            }))
    assert client.chat.completions.create.await_count == 6


async def main():
    assert version("pydantic-ai-slim") == "2.43.0", "Use the isolated SDK 2.43.0 environment"
    await probe_events()
    await probe_requests()
    print("All SDK probes passed")


if __name__ == "__main__":
    asyncio.run(main())
