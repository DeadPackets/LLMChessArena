# Prod Bugfixes + Gamification + pydantic-ai v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the five production bugs found in the 2026-08-14 log analysis (stuck games, stopped-game data loss, thinking-model 400s, ws noise, API-error forfeits), add the approved gamification set (watchdog status, h2h streaks, ELO sparklines, badges), and migrate pydantic-ai 1.104.0 → 2.x.

**Architecture:** Backend-first. The pydantic-ai migration lands first because the structured-output fallback (bug 3) uses v2 output modes. Engine changes stay callback-pure (no DB/socket knowledge). New leaderboard data (sparklines, badges) is computed lazily server-side from existing tables — no schema change, no migration row needed.

**Tech Stack:** FastAPI, pydantic-ai-slim 2.x (OpenRouter), SQLModel/aiosqlite, React/Vite/TS. New: pytest (dev-only, pure-logic tests).

**Spec:** The findings + scope decisions in this conversation (2026-08-14/15). Key approvals: LLM HTTP timeout 120 s, default LLM move timeout 300 s, gamification = watchdog + stopped-game counts + h2h streaks + sparklines + badges.

## Global Constraints

- `pydantic-ai-slim[openrouter]>=2.5,<3` — pin the major.
- No Alembic: any new persisted field needs a `_migrate_add_columns` row (none planned — verify none sneaks in).
- Engine must not import DB or WebSocket code.
- New config values go in `config.py`, read from env with defaults.
- `npm run build` (tsc) is the only frontend gate; backend verified by running a real game.
- Frontend WS event changes need: engine callback → manager broadcast → reducer case → `types/websocket.ts`. (None planned — watchdog reuses the existing `status` event.)
- Surgical diffs; comments only for non-obvious constraints, max 2 lines.

---

### Task 1: pydantic-ai v2 migration

**Files:**
- Modify: `backend/requirements.txt:3`
- Modify: `backend/app/services/chess_agent.py:96-101`
- Modify: `backend/app/services/game_engine.py:634` (usage property) and the `provider_details` access at 635 if renamed

**Interfaces:**
- Produces: working `chess_agent` on v2; `from pydantic_ai import PromptedOutput` importable (used by Task 3); `agent.run(..., output_type=...)` run-time override confirmed working.

- [ ] **Step 1: Bump the pin and install**

```
pydantic-ai-slim[openrouter]>=2.5,<3
```

Run: `cd backend && ./.venv/bin/pip install -U 'pydantic-ai-slim[openrouter]>=2.5,<3'`
Expected: installs 2.5.x.

- [ ] **Step 2: Introspect the installed v2 API before editing**

Run in `.venv`: check `Agent.__init__` signature (`instructions` vs `system_prompt`), `AgentRunResult.usage` (property?), `result.response.provider_details` existence, `PromptedOutput` import path, `run()`'s `output_type` kwarg, `ModelSettings` fields (`timeout`, `extra_body`).
Expected: written-down mapping of every rename that affects `chess_agent.py` / `game_engine.py`. Do not guess — adapt Steps 3-4 to what introspection shows.

- [ ] **Step 3: Update `chess_agent.py`**

```python
chess_agent = Agent(
    model=None,  # Set at call time per player
    output_type=ChessMove,
    instructions=SYSTEM_PROMPT % {"narration_cap": NARRATION_CHAR_CAP},
    deps_type=ChessGameContext,
)
```

(Use whatever Step 2 showed is the v2 name; `instructions` per the upgrade guide.)

- [ ] **Step 4: Update `game_engine.py` result access**

```python
usage = result.usage  # v2: property, not method
```

Keep `provider_details.get("cost")` if it survives; otherwise use the v2 equivalent found in Step 2.

- [ ] **Step 5: Smoke test one live agent call**

Write `scratchpad/smoke_agent.py`: load `backend/.env`, run `chess_agent.run()` once with `model="openrouter:google/gemini-3.7-flash:floor"`, starting-position prompt, print `output.move`, `usage`, cost.
Run it. Expected: a legal UCI move printed, usage populated, no deprecation warnings.

- [ ] **Step 6: Commit**

```bash
git add backend/requirements.txt backend/app/services/chess_agent.py backend/app/services/game_engine.py
git commit -m "feat: migrate to pydantic-ai v2"
```

---

### Task 2: LLM request + move timeouts (bug 1 — stuck games)

**Files:**
- Modify: `backend/app/config.py` (two new knobs)
- Modify: `backend/app/services/game_engine.py:159-184` (effective limit), `:565` (settings)

**Interfaces:**
- Produces: `LLM_REQUEST_TIMEOUT: float` (120), `LLM_MOVE_TIMEOUT_DEFAULT: float` (300) in config.

- [ ] **Step 1: Add config knobs**

```python
# Hard HTTP timeout per LLM request; a hung provider fails the attempt instead of
# stalling the game (the engine's retry loop then counts it as a failure).
LLM_REQUEST_TIMEOUT = float(os.getenv("LLM_REQUEST_TIMEOUT", "120"))
# Default whole-move ceiling (incl. retries) for LLM/Stockfish sides when the game
# has no explicit move_time_limit. Never applied to humans.
LLM_MOVE_TIMEOUT_DEFAULT = float(os.getenv("LLM_MOVE_TIMEOUT_DEFAULT", "300"))
```

- [ ] **Step 2: Pass request timeout in ModelSettings**

`game_engine.py:565`:
```python
settings: ModelSettings = {"max_tokens": LLM_MAX_TOKENS, "timeout": LLM_REQUEST_TIMEOUT}
```

- [ ] **Step 3: Apply default move ceiling to non-human sides**

Replace the `wait_for` block (`:160-167`):
```python
effective_limit = self.config.move_time_limit
if effective_limit is None and not is_human:
    effective_limit = LLM_MOVE_TIMEOUT_DEFAULT
try:
    if effective_limit is not None:
        move_result = await asyncio.wait_for(move_coro, timeout=effective_limit)
    else:
        move_result = await move_coro
```
Update the timeout log/message at `:173-178` to use `effective_limit` (the `%.1fs` arg).

- [ ] **Step 4: Verify by import + unit sanity**

Run: `./.venv/bin/python -c "from app.services import game_engine"` (from `backend/`). Expected: clean import. Full behavior verified in Task 11's live game.

- [ ] **Step 5: Commit** — `fix(engine): hard timeouts for LLM moves so games can't hang`

---

### Task 3: Structured-output fallback for thinking models (bug 3)

**Files:**
- Modify: `backend/app/services/game_engine.py` (`__init__` ~:76, `_get_llm_move` :601-629)

**Interfaces:**
- Consumes: `PromptedOutput` from Task 1.

- [ ] **Step 1: Add sticky per-color fallback state in `__init__`**

```python
self._prompted_output_colors: set[str] = set()
```

- [ ] **Step 2: Use it at the call site**

```python
run_kwargs: dict = {}
if color in self._prompted_output_colors:
    run_kwargs["output_type"] = PromptedOutput(ChessMove)
result = await chess_agent.run(
    user_prompt, deps=ctx,
    model=f"openrouter:{model_name}:{variant}",
    model_settings=settings, **run_kwargs,
)
```

- [ ] **Step 3: Detect the incompatibility and retry without penalty**

At the top of the `except Exception as e:` branch (before the counter increment):
```python
msg = str(e).lower()
if "tool_choice" in msg or "tool choice" in msg:
    if color not in self._prompted_output_colors:
        # Provider rejects forced tool_choice (thinking mode); fall back to
        # prompted JSON output for this side for the rest of the game.
        self._prompted_output_colors.add(color)
        logger.info(
            "Structured-output fallback: model=%s switched to PromptedOutput", model_name
        )
        continue
```

- [ ] **Step 4: Verify**

Smoke script from Task 1 adapted: run once with `output_type=PromptedOutput(ChessMove)` explicitly against a cheap model. Expected: legal move parsed.

- [ ] **Step 5: Commit** — `fix(engine): PromptedOutput fallback when provider rejects tool_choice`

---

### Task 4: `api_error` termination + ELO skip (bug 5)

**Files:**
- Modify: `backend/app/services/game_engine.py` (`__init__`, API-error branch, post-loop forfeit :186-219, :713-719)
- Modify: `backend/app/services/game_manager.py:706-719` (skip_elo)

**Interfaces:**
- Produces: termination value `"api_error"` (string flows through DB + WS untouched; frontend renders termination as free text).

- [ ] **Step 1: Track API-error-only forfeits in the engine**

`__init__`: `self._forfeit_was_api_error = False`.
In `_get_llm_move`'s API-error branch: `self._api_error_count_this_move` — simplest correct rule: add a local `api_errors = 0` at the top of `_get_llm_move`, increment in the `except` branch; after the `while` loop (forfeit path), set `self._forfeit_was_api_error = (api_errors >= MAX_CONSECUTIVE_ILLEGAL_MOVES)` before `return None`. (All 10 consecutive failures were API errors ⇒ the model never got a word in — that's an infra failure, not chess.)
Reset `self._forfeit_was_api_error = False` at the start of `_get_llm_move`.

- [ ] **Step 2: Use it in the forfeit result (`play_game` :208-219)**

```python
else:
    termination = "api_error" if self._forfeit_was_api_error else "illegal_moves"
    logger.warning(
        "Move %d: %s (%s) forfeited after %d consecutive %s",
        self.board.fullmove_number, model_name, current_color,
        self._consecutive_illegal_moves,
        "API errors" if termination == "api_error" else "illegal moves",
    )
    return self._build_result(outcome=f"{winner}_wins", termination=termination)
```

- [ ] **Step 3: Skip ELO in the manager**

`game_manager.py:706`: add `or result.termination == "api_error"` to `skip_elo`, and `"API errors"` to the reason chain.

- [ ] **Step 4: Verify** — clean import; behavior covered by Task 11 notes (hard to force live; logic reviewed).

- [ ] **Step 5: Commit** — `fix(engine): distinct api_error termination, never rated`

---

### Task 5: Stopped games keep moves + PGN (bug 2) — includes pytest bootstrap

**Files:**
- Create: `backend/requirements-dev.txt`, `backend/tests/__init__.py`, `backend/tests/test_pgn_helper.py`
- Modify: `backend/app/services/game_manager.py` (`stop_game` :274-312, error path :753-772, new helper)

**Interfaces:**
- Produces: `pgn_from_sans(white: str, black: str, sans: list[str]) -> str` (module-level in game_manager.py, pure, testable).

- [ ] **Step 1: pytest bootstrap**

`backend/requirements-dev.txt`:
```
pytest>=8.0
```
Install: `./.venv/bin/pip install -r requirements-dev.txt`

- [ ] **Step 2: Write the failing test**

`backend/tests/test_pgn_helper.py`:
```python
from app.services.game_manager import pgn_from_sans

def test_pgn_from_sans_basic():
    pgn = pgn_from_sans("modelA", "modelB", ["e4", "e5", "Nf3"])
    assert "1. e4 e5 2. Nf3" in pgn
    assert '[White "modelA"]' in pgn
    assert '[Result "*"]' in pgn

def test_pgn_from_sans_stops_on_unparseable():
    pgn = pgn_from_sans("a", "b", ["e4", "Qh5xh8"])  # illegal continuation
    assert "1. e4" in pgn  # keeps the valid prefix, doesn't raise
```

Run: `cd backend && ./.venv/bin/pytest tests/ -v` → FAIL (import error).

- [ ] **Step 3: Implement the helper**

In `game_manager.py` (module level, `import chess, chess.pgn` needed):
```python
def pgn_from_sans(white: str, black: str, sans: list[str]) -> str:
    """Rebuild a partial PGN from persisted SANs (stopped/errored games)."""
    game = chess.pgn.Game()
    game.headers["Event"] = "LLM Chess Arena"
    game.headers["White"] = white
    game.headers["Black"] = black
    game.headers["Result"] = "*"
    node: chess.pgn.GameNode = game
    board = chess.Board()
    for san in sans:
        try:
            move = board.push_san(san)
        except ValueError:
            break  # chaos-mode SANs can be unreplayable; keep the valid prefix
        node = node.add_variation(move)
    return str(game)
```

Run tests → PASS.

- [ ] **Step 4: Persist real counts + PGN in `stop_game`**

Inside the `else:` branch (game not already terminal), before commit:
```python
moves_res = await session.exec(
    select(Move).where(Move.game_id == game_id).order_by(Move.id)
)
move_rows = list(moves_res.all())
game.total_moves = len(move_rows)
if move_rows:
    game.pgn = pgn_from_sans(
        game.white_model, game.black_model, [m.san for m in move_rows]
    )
```
Then `total_moves = game.total_moves or 0` (existing line) broadcasts the real count. Verify the `Move` model's SAN column name (`san`) and PK ordering against `database.py` before writing — adjust `order_by` to the actual monotonic column (e.g. `Move.id`).

- [ ] **Step 5: Same fix in the crash path (`:753-772`)**

In the `except Exception:` handler, after setting `termination="error"`, add the same count+pgn block and broadcast `"total_moves": game.total_moves or 0` instead of the hard-coded `0` (restructure so the count is available to the broadcast).

- [ ] **Step 6: Backfill the four existing prod rows** — handled at deploy time (Task 11) with a one-off script run on the server; note it, don't code it here.

- [ ] **Step 7: Commit** — `fix(manager): stopped/errored games persist move count and PGN`

---

### Task 6: Retrieve done-task exceptions in ws.py (bug 4)

**Files:**
- Modify: `backend/app/routers/ws.py:159-169`

- [ ] **Step 1: Consume exceptions from `done`**

```python
done, pending = await asyncio.wait(
    {send_task, receive_task},
    return_when=asyncio.FIRST_COMPLETED,
)
for t in done:
    exc = t.exception()
    if exc is not None and not isinstance(exc, WebSocketDisconnect):
        logger.warning("WebSocket task error: game=%s", game_id, exc_info=exc)
for t in pending:
    ...
```

- [ ] **Step 2: Verify** — Task 11: connect/refresh a spectator tab mid-game; log must show no `Task exception was never retrieved`.

- [ ] **Step 3: Commit** — `fix(ws): retrieve receive-task exceptions on disconnect`

---

### Task 7: Watchdog "still waiting" status

**Files:**
- Modify: `backend/app/config.py` (one knob), `backend/app/services/game_engine.py` (wrap the move await)

- [ ] **Step 1: Config**

```python
# Heartbeat while a side is thinking, so a slow/hung provider is visible in the UI.
MOVE_WATCHDOG_INTERVAL = float(os.getenv("MOVE_WATCHDOG_INTERVAL", "30"))
```

- [ ] **Step 2: Emit heartbeats while awaiting the move**

Add method:
```python
async def _still_waiting_heartbeat(self, label: str, color: str) -> None:
    waited = 0.0
    while True:
        await asyncio.sleep(MOVE_WATCHDOG_INTERVAL)
        waited += MOVE_WATCHDOG_INTERVAL
        await self._emit_status(
            f"Still waiting on {label} ({color}) — {waited:.0f}s..."
        )
```
Wrap the existing await (after Task 2's edit) for non-human sides:
```python
heartbeat: asyncio.Task | None = None
if not is_human:
    label = "Stockfish" if is_stockfish else model_name
    heartbeat = asyncio.create_task(self._still_waiting_heartbeat(label, current_color))
try:
    ...  # the wait_for / await from Task 2
finally:
    if heartbeat:
        heartbeat.cancel()
```
(Keep the existing `except asyncio.TimeoutError` structure intact inside the try.)

- [ ] **Step 3: Verify** — Task 11: set `MOVE_WATCHDOG_INTERVAL=5` locally, run a game with a slow reasoning model, see "Still waiting on …" in the UI status line / WS events.

- [ ] **Step 4: Commit** — `feat(engine): heartbeat status while waiting on a move`

---

### Task 8: Head-to-head streak banner

**Files:**
- Modify: `backend/app/models/api_models.py:213-228` (2 fields), `backend/app/routers/models_router.py:114-161`, `backend/tests/test_streak.py` (create), `frontend/src/types/api.ts` (HeadToHeadComparison), `frontend/src/pages/HeadToHeadPage.tsx:129` (after score-total)

**Interfaces:**
- Produces: `compute_h2h_streak(outcomes: list[str]) -> tuple[str | None, int]` in `models_router.py` where `outcomes` is newest-first, each `"a" | "b" | "draw"`; returns `("a"|"b"|None, count)`. API fields `streak_model: str | None`, `streak_count: int`.

- [ ] **Step 1: Failing test**

`backend/tests/test_streak.py`:
```python
from app.routers.models_router import compute_h2h_streak

def test_streak_counts_consecutive_wins_from_most_recent():
    assert compute_h2h_streak(["a", "a", "b", "a"]) == ("a", 2)

def test_draw_breaks_streak():
    assert compute_h2h_streak(["draw", "a", "a"]) == (None, 0)

def test_empty():
    assert compute_h2h_streak([]) == (None, 0)
```

- [ ] **Step 2: Implement**

```python
def compute_h2h_streak(outcomes: list[str]) -> tuple[str | None, int]:
    """outcomes newest-first as 'a'/'b'/'draw'. Current win streak of the leader."""
    if not outcomes or outcomes[0] == "draw":
        return None, 0
    leader = outcomes[0]
    count = 0
    for o in outcomes:
        if o != leader:
            break
        count += 1
    return leader, count
```
Run tests → PASS.

- [ ] **Step 3: Wire into `compare_models`**

Inside the existing win-count loop (games are already newest-first), also build `outcomes: list[str]` with `"a"`/`"b"`/`"draw"` per game. After the loop:
```python
streak_model_key, streak_count = compute_h2h_streak(outcomes)
streak_model = model_a if streak_model_key == "a" else model_b if streak_model_key == "b" else None
```
Add to the returned `HeadToHeadComparison(..., streak_model=streak_model, streak_count=streak_count)` and to the pydantic model:
```python
streak_model: str | None = None
streak_count: int = 0
```

- [ ] **Step 4: Frontend**

`types/api.ts` `HeadToHeadComparison`: add `streak_model: string | null; streak_count: number;`.
`HeadToHeadPage.tsx`, after the `h2h-page__score-total` div:
```tsx
{comparison.streak_count >= 2 && comparison.streak_model && (
  <div className="h2h-page__streak">
    {formatModelName(
      comparison.streak_model,
      comparison.streak_model === comparison.model_a
        ? comparison.model_a_display
        : comparison.model_b_display,
    )}{" "}
    has won {comparison.streak_count} in a row
  </div>
)}
```
Style: add `.h2h-page__streak` (small, accent color) next to the other h2h styles in the stylesheet that defines `h2h-page__score-total` (find it by grep).

- [ ] **Step 5: Verify** — `npm run build` passes; `curl '/api/models/compare?...'` on local DB shows the fields.

- [ ] **Step 6: Commit** — `feat(h2h): current win-streak banner`

---

### Task 9: Leaderboard ELO sparklines

**Files:**
- Modify: `backend/app/services/stats_service.py` (new `compute_elo_sparklines`, refactor shared replay), `backend/app/models/api_models.py:165-170`, `backend/app/routers/models_router.py:56-79`
- Create: `frontend/src/components/shared/Sparkline.tsx`
- Modify: `frontend/src/types/api.ts` (EnhancedModelStats), `frontend/src/pages/LeaderboardPage.tsx:168-171`

**Interfaces:**
- Produces: `compute_elo_sparklines(session, last_n: int = 20) -> dict[str, list[float]]` keyed by composite model key (same `_white_key`/`_black_key` identity as `compute_elo_history`); `EnhancedModelStats.elo_history: list[float]`.

- [ ] **Step 1: Backend — single-pass replay for all models**

In `stats_service.py`, next to `compute_elo_history` (reuse its exact query/ordering — same `Game.rated` set, `completed_at` then `id` ascending, same `calculate_elo_change` / `score_white_from_outcome` calls; a comment already demands lock-step with `recompute_all_elo`):
```python
async def compute_elo_sparklines(
    session: AsyncSession, last_n: int = 20
) -> dict[str, list[float]]:
    """Post-game rating series per model, one replay pass. Same game set/order
    as compute_elo_history — keep all three replays in lock-step."""
    result = await session.exec(
        select(Game).where(Game.rated == True)  # noqa: E712
        .order_by(Game.completed_at.asc(), Game.id.asc())  # type: ignore[union-attr]
    )
    running: dict[str, float] = {}
    series: dict[str, list[float]] = {}
    for g in result.all():
        w_id, b_id = _white_key(g), _black_key(g)
        w_elo = running.get(w_id, DEFAULT_MODEL_ELO)
        b_elo = running.get(b_id, DEFAULT_MODEL_ELO)
        new_w, new_b = calculate_elo_change(w_elo, b_elo, score_white_from_outcome(g.outcome))
        running[w_id], running[b_id] = new_w, new_b
        series.setdefault(w_id, []).append(round(new_w, 1))
        series.setdefault(b_id, []).append(round(new_b, 1))
    return {k: v[-last_n:] for k, v in series.items()}
```

- [ ] **Step 2: API model + endpoint**

`EnhancedModelStats`: add `elo_history: list[float] = []`.
`leaderboard()` in `models_router.py`: before the loop, `sparks = await compute_elo_sparklines(session)`; in the constructor add `elo_history=sparks.get(r.id, [])`. (Model row PK `r.id` is the composite key — confirm it matches `_white_key` output by checking one row; `compute_elo_history` is keyed the same way and already matches leaderboard rows.)

- [ ] **Step 3: Frontend Sparkline component**

`frontend/src/components/shared/Sparkline.tsx`:
```tsx
interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
}

export default function Sparkline({ points, width = 72, height = 20 }: SparklineProps) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - 2 - ((p - min) / range) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <polyline
        points={coords}
        fill="none"
        stroke={up ? "var(--color-success, #4ade80)" : "var(--color-danger, #f87171)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
```
Check the project stylesheet for the real success/danger CSS variable names and use those.

- [ ] **Step 4: Render in the ELO cell**

`types/api.ts` `EnhancedModelStats`: `elo_history: number[];`.
`LeaderboardPage.tsx` ELO `<td>`: after the elo-bar span:
```tsx
<Sparkline points={model.elo_history} />
```
Import at top. Keep it out of the mobile-collapsed columns if the table CSS hides columns on mobile (check `leaderboard-table--enhanced` styles; if cramped, wrap in a `leaderboard__spark` span styled `display:none` under the existing mobile breakpoint).

- [ ] **Step 5: Verify** — `npm run build`; local leaderboard shows sparklines for models with ≥2 rated games.

- [ ] **Step 6: Commit** — `feat(leaderboard): ELO sparklines`

---

### Task 10: Model badges

**Files:**
- Create: `backend/tests/test_badges.py`
- Modify: `backend/app/services/stats_service.py` (pure `compute_badges` + async wrapper), `backend/app/models/api_models.py` (Badge model + fields), `backend/app/routers/models_router.py` (leaderboard + model_detail), `frontend/src/types/api.ts`, `frontend/src/pages/LeaderboardPage.tsx`, `frontend/src/pages/ModelDetailPage.tsx`

**Interfaces:**
- Produces:
```python
class ModelBadge(BaseModel):
    id: str
    label: str
    icon: str      # emoji
    description: str
```
```python
def compute_badges(
    *,
    games_played: int,
    total_illegal_moves: int,
    avg_accuracy: float | None,
    outcomes_newest_first: list[str],   # "win" | "loss" | "draw" for this model
    won_checkmate_min_plies: int | None,  # fewest plies among won-by-checkmate games
    won_max_plies: int | None,            # most plies among won games
    upset_wins: int,                      # wins vs opponent rated >=150 higher at game time
) -> list[ModelBadge]
```
- `EnhancedModelStats.badges: list[ModelBadge] = []` (inherited by `ModelDetailStats`).

- [ ] **Step 1: Failing tests**

`backend/tests/test_badges.py`:
```python
from app.services.stats_service import compute_badges

BASE = dict(
    games_played=5, total_illegal_moves=1, avg_accuracy=70.0,
    outcomes_newest_first=["loss"], won_checkmate_min_plies=None,
    won_max_plies=None, upset_wins=0,
)

def ids(**over):
    return {b.id for b in compute_badges(**{**BASE, **over})}

def test_speedrunner():
    assert "speedrunner" in ids(won_checkmate_min_plies=38)
    assert "speedrunner" not in ids(won_checkmate_min_plies=41)

def test_marathoner():
    assert "marathoner" in ids(won_max_plies=120)

def test_clean_sheet_needs_three_games():
    assert "clean_sheet" in ids(total_illegal_moves=0, games_played=3)
    assert "clean_sheet" not in ids(total_illegal_moves=0, games_played=2)

def test_on_fire():
    assert "on_fire" in ids(outcomes_newest_first=["win", "win", "win", "loss"])
    assert "on_fire" not in ids(outcomes_newest_first=["win", "win", "loss"])

def test_sharpshooter():
    assert "sharpshooter" in ids(avg_accuracy=85.0, games_played=3)
    assert "sharpshooter" not in ids(avg_accuracy=84.9)

def test_giant_slayer():
    assert "giant_slayer" in ids(upset_wins=1)
```

Run → FAIL (no function).

- [ ] **Step 2: Implement pure `compute_badges` in stats_service.py**

```python
def compute_badges(
    *, games_played, total_illegal_moves, avg_accuracy,
    outcomes_newest_first, won_checkmate_min_plies, won_max_plies, upset_wins,
) -> list[ModelBadge]:
    badges: list[ModelBadge] = []
    if won_checkmate_min_plies is not None and won_checkmate_min_plies <= 40:
        badges.append(ModelBadge(
            id="speedrunner", label="Speedrunner", icon="⚡",
            description="Won by checkmate in 20 moves or fewer",
        ))
    if won_max_plies is not None and won_max_plies >= 120:
        badges.append(ModelBadge(
            id="marathoner", label="Marathoner", icon="🏃",
            description="Won a game lasting 60+ moves",
        ))
    if upset_wins > 0:
        badges.append(ModelBadge(
            id="giant_slayer", label="Giant Slayer", icon="🗡️",
            description="Beat an opponent rated 150+ ELO higher",
        ))
    if games_played >= 3 and total_illegal_moves == 0:
        badges.append(ModelBadge(
            id="clean_sheet", label="Clean Sheet", icon="✨",
            description="Never attempted an illegal move (3+ games)",
        ))
    streak = 0
    for o in outcomes_newest_first:
        if o != "win":
            break
        streak += 1
    if streak >= 3:
        badges.append(ModelBadge(
            id="on_fire", label=f"On Fire ×{streak}", icon="🔥",
            description=f"Current win streak of {streak}",
        ))
    if avg_accuracy is not None and avg_accuracy >= 85 and games_played >= 3:
        badges.append(ModelBadge(
            id="sharpshooter", label="Sharpshooter", icon="🎯",
            description="Average accuracy 85%+ (3+ games)",
        ))
    return badges
```
Import `ModelBadge` from `app.models.api_models` (define it there first, near `ModelStats`). Run tests → PASS.

- [ ] **Step 3: Async gatherer**

In `stats_service.py`:
```python
async def compute_model_badge_inputs(
    session: AsyncSession, model_id: str
) -> dict:
    """Collect per-model badge inputs from completed non-chaos games."""
```
Query completed, non-chaos games where the model played (same prefilter+composite-key match pattern as `compute_head_to_head` — copy that pattern). Sort newest-first by `completed_at`. Derive:
- `outcomes_newest_first` via win/loss/draw from outcome + color.
- `won_checkmate_min_plies`: min `total_moves` over games won by this model with `termination == "checkmate"`.
- `won_max_plies`: max `total_moves` over won games.
- `upset_wins`: replay ratings with the same loop as `compute_elo_sparklines` but track pre-game ratings; count games where this model won and opponent's pre-game rating ≥ own + 150. (Add this inside the sparkline replay as an optional accumulator, or a sibling function `compute_upset_wins(session) -> dict[str, int]` sharing the loop — pick the sibling: one replay returning `dict[model_key, upset_wins]`, called once per leaderboard request.)

- [ ] **Step 4: Wire into endpoints**

`EnhancedModelStats`: `badges: list[ModelBadge] = []`.
`leaderboard()`: fetch `upsets = await compute_upset_wins(session)` once; per row call `compute_model_badge_inputs` + `compute_badges(..., upset_wins=upsets.get(r.id, 0), games_played=r.games_played or 0, total_illegal_moves=r.total_illegal_moves or 0, avg_accuracy=agg["avg_accuracy"])`.
`model_detail()`: same additions so `ModelDetailStats` (inherits) carries badges.

- [ ] **Step 5: Frontend**

`types/api.ts`:
```ts
export interface ModelBadge {
  id: string;
  label: string;
  icon: string;
  description: string;
}
```
Add `badges: ModelBadge[];` to `EnhancedModelStats`.
`LeaderboardPage.tsx` model cell, after the model link:
```tsx
{model.badges.length > 0 && (
  <span className="leaderboard__badges">
    {model.badges.map((b) => (
      <span key={b.id} className="leaderboard__badge" title={`${b.label} — ${b.description}`}>
        {b.icon}
      </span>
    ))}
  </span>
)}
```
`ModelDetailPage.tsx`: render full chips (`icon + label`, `title={description}`) near the header — read the page first and match its existing markup/classes.
CSS: add `.leaderboard__badges`/`.leaderboard__badge` (inline-flex, small font, slight left margin) in the stylesheet that owns `leaderboard__model-link`.

- [ ] **Step 6: Verify** — pytest green; `npm run build`; local leaderboard shows badges.

- [ ] **Step 7: Commit** — `feat(stats): model achievement badges on leaderboard and detail`

---

### Task 11: End-to-end verification + prod deploy

**Files:** none (verification + ops)

- [ ] **Step 1: Full local gate**

```bash
cd backend && ./.venv/bin/pytest tests/ -v          # all green
cd frontend && npm run build                        # tsc + build green
```

- [ ] **Step 2: Live game**

Start backend from `backend/` (cwd-relative DB). Run a cheap LLM vs LLM game via CLI (`python -m app.cli --white google/gemini-3.7-flash --black google/gemini-3.7-flash` — self-play is fine, it's unrated). With `MOVE_WATCHDOG_INTERVAL=5`, confirm:
- moves stream, game completes, no deprecation warnings, no unretrieved-exception errors;
- watchdog status lines appear in the WS stream;
- stop a second game mid-way → DB row has real `total_moves` + `pgn`.

- [ ] **Step 3: Check leaderboard/h2h/badges endpoints against the local DB** (`curl` each).

- [ ] **Step 4: Ask the user before push + deploy** (outward-facing). Then on deadbox: locate the compose dir, `git pull`, check `/api/games/queue-status` is idle, `docker compose up --build -d backend frontend`, tail logs, backfill the 4 stopped rows' `total_moves`/`pgn` with a one-off script using `pgn_from_sans`.

---

## Deviations log

- Executed on an in-place branch (`fix/prod-bugs-gamification-v2`) instead of a worktree: the backend `.venv`, `node_modules`, and local DB don't travel to a fresh worktree and were needed for live verification.
- Task 4 needed one edit the plan missed: `game_eligible_for_elo` (the predicate shared with `recompute_all_elo`) also excludes `termination == "api_error"`, or an admin recompute would re-rate those games.
- Deploy time: prod model rows still used pre-reasoning-split identities (no `::tier` suffix), so sparklines/badges keyed by `rating_key` missed every LLM row. Ran the documented one-time `recompute_all_elo` inside the prod container, which migrated identities and fixed it.
- Backfill covered 5 stopped rows, not 4 — one (`abe3d6953c70`) had zero persisted moves and only its count was normalized.

## Self-review notes

- Spec coverage: bugs 1-5 → Tasks 2,5,3,6,4; watchdog → 7; stopped counts → 5; h2h streaks → 8; sparklines → 9; badges → 10; pydantic v2 → 1. Trio item "head-to-head page" pre-existed; reduced to streaks per findings.
- Types consistent: `PromptedOutput(ChessMove)` (T1→T3), `pgn_from_sans` (T5→T11), `compute_h2h_streak` (T8), `compute_badges`/`ModelBadge` (T10), `elo_history` naming matches API↔TS.
- Placeholder scan: Task 1 Step 2 intentionally defers exact v2 names to introspection (API facts unverifiable offline — the step defines how to resolve them, not "TBD" work). Task 10 Step 5 requires reading ModelDetailPage before editing — same category.
