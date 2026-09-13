# SDK reliability and efficiency implementation plan

Approved scope: actions 1–9 from the conversation. Challenge mode (10) is deferred.

Architecture: retain the engine → callbacks → manager boundary. The shared SDK Agent validates outputs and reports request lifecycle through per-run dependencies. Persist request records separately from accepted moves, and expose an efficiency endpoint for the viewer. Keep the current prompt, output cap, and Economy default; Responsive is opt-in.

## Decisions

- Pin `pydantic-ai-slim[openrouter]==2.43.0`.
- Use SDK output retries for malformed/illegal responses, bounded transport retries for transient failures, and the existing total move deadline. Infrastructure failures do not become rated chess losses.
- Keep per-request nullable usage and cost. Record interrupted requests as unknown; never claim unknown usage is zero. Store no raw reasoning or API errors in public telemetry.
- Existing `use_nitro` clients remain supported; new `routing_mode` accepts economy/responsive. Persist the effective routing choice for rematches. Use plain model + explicit latency sort for Responsive.
- Reuse existing UI styles and status events. The efficiency panel reads a summary endpoint; token deltas do not enter subscriber queues.
- Use static instruction caching with configurable 5m/1h TTL. Verify SDK request construction locally; live gains require a separately measured pilot and are not promised by this implementation.

## Work and checks

- [x] SDK and engine: first add regression tests for transient errors, illegal output retries, chaos acceptance, concurrent event context, cancellation, and all-attempt usage. Implement typed settings, hooks, validators, and bounded transport retries. Check with isolated pytest + fake SDK models.
- [x] Persistence/API: add an idempotent request table, request callback, summary endpoint, routing persistence, and model-aware reasoning validation. Check temporary SQLite migrations, request aggregation including unknown values, and request validation tests.
- [x] Frontend: model-aware effort choices, Economy/Responsive controls, rematch preservation, and efficiency panel with loading/error/unknown states. Check `npm run build` and browser flows with fixture data.
- [x] Integration: run the complete backend suite and frontend build, review the full diff for dropped cancellation/usage and rating changes, and fix findings.
- [x] Record outcomes and live-measurement limits. Leave production deployment and paid benchmarking untouched.

## Coordination

Main worker owns `chess_agent.py`, `game_engine.py`, `config.py`, dependency pins, and engine tests. A backend worker owns database, API/model contracts, manager wiring, and their tests. A frontend worker owns `frontend/`. These disjoint tasks are executed with the subagent-driven-development skill; the main worker reviews their integration.

## Deviations

The research proposed starting with logs before adding persistence. Approved item 9 needs a panel that survives reloads and completed games, so this implementation stores request records immediately. A summary endpoint avoids adding high-volume WebSocket event types.

The SDK prohibits a run-level output-type override when an Agent has output validators. Legality validation therefore uses the SDK's `after_output_validate` hook, with a partial-output guard. This preserves the existing PromptedOutput fallback on the same Agent.

The SDK normalizes missing cache counts to zero and drops zero-dollar cost. A small adapter, covered by mocked HTTP/SSE tests, preserves the reported fields and provider attribution from usage-only final chunks. Re-check this private SDK boundary when changing the pinned version.

Game result/detail/WebSocket totals are nullable when any request lacks usage. Separate `known_*` fields preserve reported subtotals. The CLI accepts this contract, and the platform dashboard uses request records for tracked games with legacy move fallback. SQLite's existing game cost column remains a known subtotal.

## Verified outcome — 2026-09-13

| Check | Result |
|---|---|
| Backend, Python 3.12.13 (same minor as production image) | 65 passed |
| Frontend Node regression tests | 9 passed |
| Frontend TypeScript + Vite build | Passed, 759 modules |
| Chrome fixtures at desktop/mobile sizes | Passed |
| Review regressions | Cancellation batch recovery, nullable totals, final-chunk provider identity, and prompted fallback covered |
| Whitespace check | `git diff --check` clean |

Browser checks cover routing and reasoning changes, temperature clearing, rematches including legacy Nitro, partial/unknown cost, polling after completion, retry, and stale-game cleanup. Screenshots are generated under `frontend/node_modules/.cache/sdk-efficiency-browser/`.

Local `backend/.venv` was upgraded to 2.43.0. Tests use fake models/HTTP and temporary SQLite databases. Production was not restarted or migrated; no paid LLM calls were made. Actual cache-hit, cost, and latency gains still need a live comparison. Challenge mode remains deferred.

## Usage UI follow-up

The game header now contains a collapsed Usage control with spend. Its breakdown opens inside the same panel, with existing colors and typography. Enter/Space toggles the details; Escape closes them and restores focus. The control has a minimum 40px height.

Refreshes preserve the last values and open state. Failed refreshes label the header value as stale and offer retry in the details; retry stays disabled while pending. Hidden tabs pause polling and refresh on return. Completed games stop scheduled polling.

Verified with 9 Node tests, TypeScript/Vite build (759 modules), Chrome fixtures, and `git diff --check`. Browser coverage includes collapsed/expanded layouts, keyboard focus, a 320px error layout, hidden-tab polling, completion during a held request, retry with preserved data, and stale-game cleanup. Desktop and mobile screenshots were inspected. This follow-up changes the frontend only; no production deployment was run.
