# Pydantic AI: events, cache reuse, and move efficiency

Research decision: upgrade to a tested, pinned 2.43.0; instrument each request; then benchmark explicit instruction caching and routing independently.

Checked 2026-09-12. The preceding environment inspection found 2.31.0 locally and in production. The repository permits `pydantic-ai-slim[openrouter]>=2.5,<3`; this does not reproduce a specific installation. The latest stable version is [2.43.0 on PyPI](https://pypi.org/project/pydantic-ai-slim/2.43.0/). This report changes no application code, dependencies, or production settings. All experiments below used fake responses, with zero paid LLM calls.

| Priority | Change | Check that decides whether to ship |
|---|---|---|
| 1 | Typed OpenRouter settings and separate failure categories | Reasoning requests succeed; transport failures never become illegal moves |
| 2 | Per-request usage and latency accounting | Failed/rejected attempts appear in cost totals; missing telemetry stays identifiable |
| 3 | Filtered `@agent.on_event` progress | Concurrent games remain isolated; partial output never changes the board |
| 4 | Explicit static instruction cache boundary | Provider reports reused input; cost per accepted move decreases |
| 5 | Routing, prompt, and reasoning budget experiments | Lower end-to-end latency/cost without a measured legality or chess-quality regression |

## What the repository does today

`backend/app/services/chess_agent.py` has one shared Agent, static instructions, and per-run board dependencies. The instructions measured **4,207 characters / 684 whitespace-delimited words**, using the default narration cap of 128. These are not tokenizer measurements. The output schema adds more input, and the cacheable token count remains unmeasured.

`backend/app/services/game_engine.py::_get_llm_move` sends a fresh board snapshot each attempt. The changing side/move information comes near the start of the user message. Instructions and the output schema are therefore the useful shared prefix; previous board snapshots are not an append-only conversation.

| Current behavior | Consequence |
|---|---|
| Raw reasoning options in `extra_body` | SDK model-specific handling cannot reliably see those options |
| Root-level Anthropic `cache_control` | Enables automatic caching; does not specifically mark static instructions |
| `session_id = game_id:color` | Already provides a useful stable routing key |
| Usage returned only with an accepted move | Earlier rejected attempts disappear from persisted move cost |
| Cost taken from the last SDK response | Internal SDK retries can contribute tokens without corresponding total cost |

The same method counts most exceptions as illegal moves and immediately retries. The 120-second request setting and 300-second outer move deadline limit waiting, but neither separates transport failures from chess mistakes. The existing heartbeat gives no evidence of response activity.

## Event listeners: useful progress, with a strict commit boundary

`@agent.on_event` was introduced in [2.40.0](https://github.com/pydantic/pydantic-ai/releases/tag/v2.40.0). The API accepts event-type filters and supplies the run context. Register the listener once on the shared Agent; carry game, color, ply, and the status sink in per-run dependencies. The [hooks documentation](https://pydantic.dev/docs/ai/core-concepts/hooks/) also distinguishes model lifecycle hooks from event observers. Use lifecycle hooks for request start/completion/error accounting.

Our 2.43.0 FunctionModel experiment found:

| Probe | Observed result |
|---|---|
| `agent.run()` without listeners | Non-streaming model function called |
| Same call with filtered `PartStartEvent` / `PartEndEvent` listener | Streaming model function called automatically |
| Two simultaneous runs with separate dependency objects | Each received only its own phase updates |
| Structured output with a validator | `FinalResultEvent` preceded validation |

The last probe produced this sequence:

```text
PartStartEvent → FinalResultEvent → PartDeltaEvent → PartEndEvent
→ OUTPUT_VALIDATED → OutputToolCallEvent → OutputToolResultEvent → RUN_RETURNED
```

`FinalResultEvent` must not mean “move accepted.” Keep board mutation after the run returns and the chess rules accept the move. Chaos mode must retain its separate acceptance rules.

For the UI, use coarse transitions: request started, response started, retrying, and move accepted. The first two mean activity, not a known completion percentage. Keep the heartbeat during silent provider reasoning. Use the existing `status` event path and coalesce duplicates: subscriber queues hold 64 events, and new non-droppable event types can evict slow clients.

Do not register a closure on the global Agent for every game. Do not publish each token or raw internal reasoning. Keep the listener lightweight; isolate optional telemetry failures without swallowing cancellation. A stalled observer must not become another source of stuck games. These integration checks remain to be implemented; the probe only establishes SDK behavior.

## Cache reuse: put the boundary before the changing board

Correction to the earlier assessment: root-level `cache_control` is valid. OpenRouter now supports automatic caching through the last cacheable block. Our rolling board snapshots make an explicit static boundary the better hypothesis to test. Keep the existing `session_id`; OpenRouter uses it for sticky routing even when opening messages change. Neither setting guarantees a hit. See [OpenRouter prompt caching](https://openrouter.ai/docs/guides/best-practices/prompt-caching).

Use `OpenRouterModelSettings`, with `openrouter_reasoning`, `openrouter_cache_instructions`, and usage collection expressed as SDK fields. Retain `session_id` in `extra_body`. The SDK exposes instruction, message, and tool-definition cache controls; support differs by model family. See the [OpenRouter integration](https://pydantic.dev/docs/ai/models/openrouter/) and [2.43.0 implementation](https://github.com/pydantic/pydantic-ai/blob/v2.43.0/pydantic_ai_slim/pydantic_ai/models/openrouter.py).

Request capture used the real instructions, a minimal `move` output schema, and a mocked OpenAI client. It tested request construction, not provider acceptance:

| Model identifier | Raw settings | Typed settings |
|---|---|---|
| `anthropic/claude-sonnet-4.5:floor` | `tool_choice=required`; no explicit instruction marker | `tool_choice=auto`; instruction marker with `ttl=5m` |
| `deepseek/deepseek-v4-pro-0813:floor` | `tool_choice=required` | Still `required`; no instruction marker |
| `google/gemini-3.7-flash:floor` | `tool_choice=required` | Still `required`; instruction marker without TTL |

Typed reasoning activates the SDK's Claude compatibility handling. The DeepSeek capture gives no basis for removing our PromptedOutput fallback. The synthetic raw comparison supplied root cache control for all three models; the application currently supplies it only for Anthropic.

Proposed cache policy:

1. Keep instructions and output schema stable; place all board state in the user message. Check repeated requests for identical static content.
2. Start with the instruction boundary on supported routes. Check actual `cache_read_tokens` and `cache_write_tokens`, including warm requests.
3. Choose TTL from measured same-side request gaps. Check long reasoning turns and human pauses.
4. Preserve bounded history rather than accumulating old FEN snapshots. Check total input cost per accepted move, not cache percentage alone.

Anthropic caches the prefix in tools → system → messages order. Cache eligibility has model-specific minimum lengths. Its 5-minute cache lifetime runs from request start, so generation consumes part of that interval; one side also waits through the opponent's turn. A 1-hour cache costs more to write. The [Anthropic cache documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) and OpenRouter currently disagree on some model thresholds, so verify the routed provider's usage rather than hard-coding one universal minimum.

Do not pad prompts to meet a threshold. A shorter uncached prompt can cost less than a longer cached prompt. Likewise, caching input does not eliminate reasoning/output charges.

## Measure the whole attempt, not only the accepted response

Start with structured request logs; a new database table is not required for the initial benchmark. Record game/color/ply/attempt, requested model and returned provider, harness version, output mode, reasoning settings, request ID, timings, usage, reported cost, and result category. Categories must distinguish transport failure, malformed output, illegal move, cancellation, and acceptance.

Pydantic AI exposes cache reads/writes and aggregate run usage. Its input total already includes cached tokens: do not add those counts again. Its `usage.cost` is a best-effort price estimate, not the OpenRouter bill. Prefer provider-reported request cost and label estimates separately. Do not add request-level totals to their containing run total. See the [usage API](https://pydantic.dev/docs/ai/api/pydantic-ai/usage/).

| Metric | Definition |
|---|---|
| Cached input share | Sum of reported cache-read tokens / sum of corresponding input tokens |
| Request hit rate | Requests reporting cache reads above zero / requests with known cache telemetry |
| Cost per accepted ply | All attempt costs / accepted plies, including rejected attempts |
| Time to legal move | First attempt start through acceptance, including retries |
| Quality | First-attempt legality, forfeit rate, and Stockfish ACPL on fixed positions |

Report telemetry coverage alongside these metrics. Missing provider usage must not silently become “zero cost” or “cache miss.” Current persisted move totals cannot reconstruct historical cache hits. Interrupted streams may lack final usage; retain request IDs for later reconciliation.

## Efficiency beyond caching

| Candidate | Why it fits this harness | Validation |
|---|---|---|
| Separate transport and output retries | API failures currently spend the illegal-move allowance | Mock 429/5xx, invalid JSON, and illegal UCI independently |
| Move chess validation into an output validator | SDK can return structured correction feedback within one run | Preserve chaos rules and the total attempt/deadline budget |
| Explicit provider routing | `:floor` may favor cost over interactive latency | Compare p50/p95 time to accepted move and total cost |
| Model-aware reasoning settings | Proxy currently discards reasoning capability metadata | Test supported effort choices and mandatory reasoning |
| Smaller prompt/output budgets | Current completion limit is 16,384; actual use is unknown | Benchmark candidate caps and ACPL before changing defaults |

Use bounded transport backoff and respect `Retry-After`; avoid multiplying HTTP, SDK-output, and outer-loop retry budgets. Keep one total move deadline. SDK [retry facilities](https://pydantic.dev/docs/ai/core-concepts/retries/) and [output validators](https://pydantic.dev/docs/ai/core-concepts/output/#output-validators) can replace parts of the manual loop, but a migration must preserve game rules.

OpenRouter's `:floor` now enables flex-tier endpoints as well as price sorting. `:nitro` enables priority-tier endpoints as well as throughput sorting. These are broader than the code comments suggest. Benchmark a plain model ID with `openrouter_provider={"sort": "latency"}` separately from both variants; throughput does not itself establish time to a legal move. See [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection).

Preserve available reasoning capability metadata in `/api/openrouter/models`, including supported efforts and mandatory reasoning. Omitting a requested effort is not proof that reasoning is disabled. Hiding reasoning with `exclude` does not reduce its token bill. See [reasoning controls](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens). Treat 2,048/4,096/8,192 completion caps as experiment candidates, not universal safe defaults.

A smaller local optimization is to serialize only the history entries the prompt consumes; today the engine dumps the full history before selecting recent entries. This saves local work but has no demonstrated impact on provider latency. Prioritize request failures and paid tokens first.

## Staged evaluation and limits

1. Pin the SDK in an isolated candidate environment and reproduce mock probes. Check streaming, concurrent dependency isolation, validation order, cancellation, and fallback behavior before live calls.
2. Add request accounting with existing gameplay settings. Check that internal retries and rejected outer attempts reconcile to provider costs where usage is available.
3. Pilot typed settings plus explicit cache boundaries on fixed models and positions. Check sequential initial/warm requests and label pre-existing cache hits; a fresh session ID alone does not ensure a cold provider cache.
4. Test routing, then prompt/budget changes separately. Check cost, latency, and quality for each change against its immediate control.
5. Run unranked complete games and long-pause cases. Check no partial commits, no stuck status, and no dropped move events before any deployment.

A proposed pilot per comparison is 12 positions × 3 fixed models × 2 configurations × 2 passes = 144 move evaluations, plus bounded retries. This is a screening experiment, not enough to prove equal playing strength or an ELO improvement. Keep model identity fixed; fallback must not silently substitute a different contestant. Version any prompt or reasoning policy that changes rated behavior.

No live cache-hit rate, dollar saving, or latency improvement has been measured yet. Streaming progress is a QoL improvement; it does not by itself accelerate generation. The useful agentic features here are typed settings, observers, validators, and bounded execution. Multi-agent orchestration or a durable workflow platform would need a separate demonstrated requirement.

The accompanying `sdk_event_cache_probe.py` reproduces the mock observations with no API key. From the repository root, using the research environment created for this investigation:

```bash
PYDANTIC_AI_NO_BANNER=1 /tmp/llmchess-sdk-research/venv/bin/python docs/research/sdk_event_cache_probe.py
```

Check: it prints the request shapes and finishes with `All SDK probes passed`. The temporary environment may be removed by the operating system; recreate an isolated environment with `pydantic-ai-slim[openrouter]==2.43.0` if needed.
