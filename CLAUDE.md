# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

LLM Chess Arena pits LLMs (via OpenRouter), humans, and Stockfish against each other in chess, with live Stockfish evaluation, AI "table talk", and post-game analysis. FastAPI backend + React/Vite frontend, streamed over WebSocket. See `README.md` for the user-facing feature list and full env-var reference.

## Commands

Run the backend from inside `backend/` — the SQLite path is **cwd-relative** (`./data/llmchessarena.db` in `database.py`). Starting uvicorn from the repo root writes the DB to the wrong place.

```bash
# Backend dev (from backend/, with venv activated, .env containing OPENROUTER_API_KEY)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# Frontend dev (from frontend/) — proxies /api and /ws to :8000, serves on :5173
npm run dev

# Frontend build — this is also the ONLY typecheck/lint gate (tsc -b runs first)
npm run build

# Terminal CLI client: start or watch a game against a running server
python -m app.cli --white anthropic/claude-sonnet-4-5 --black google/gemini-2.5-flash
python -m app.cli --watch <game_id>

# Full stack
docker compose up --build -d   # frontend on :80, waits for backend healthcheck
```

There is **no test suite, no linter, and no formatter** configured (no pytest, ruff, eslint, prettier, pyproject.toml, or uv.lock — the CLI docstring's `uv run` examples are aspirational; use pip + venv per the README). The frontend `tsc -b` in `npm run build` is the only automated correctness check in the repo. Verify backend changes by running a game.

## Architecture

### Backend request → game lifecycle

1. **`main.py` lifespan** constructs the long-lived singletons — `StockfishService` (evaluation engine), `OpeningDetector` (ECO book from `app/data/openings/*.tsv`), and `GameManager` — and stashes them on `app.state`. Routers reach them via `request.app.state.game_manager`, never by importing globals.
2. **`POST /api/games`** (`routers/games.py`) validates the config (at least one side must be an LLM; a side can't be both human and Stockfish), mints a `player_secret`, and calls `GameManager.start_game`, which returns the secret to the creator **once**.
3. **`GameManager`** (`services/game_manager.py`) runs each game as a detached `asyncio.Task`. Concurrency is gated by an `asyncio.Semaphore(MAX_CONCURRENT_GAMES)`; excess games sit in a `deque` and broadcast `queued` position updates until a slot frees.
4. **`GameEngine.play_game`** (`services/game_engine.py`) is the core loop. Each ply it: evals the position (before), dispatches to the LLM / human / Stockfish path for the side to move, evals again (after), classifies the move, detects the opening, builds a `MoveRecord`, and fires callbacks.
5. The engine exposes **callback lists** (`move_callbacks`, `illegal_move_callbacks`, `chaos_move_callbacks`, `status_callback`, `awaiting_human_move_callback`). `GameManager._run_game_inner` wires these to (a) persist to SQLite and (b) broadcast WebSocket events. The engine itself knows nothing about the DB or sockets — keep it that way.

### Real-time streaming (in-memory pub/sub)

`GameManager` keeps `event_queues: dict[game_id, list[asyncio.Queue]]`. Each WebSocket subscriber gets its own bounded queue (`MAX_WS_EVENT_QUEUE_SIZE`). `_broadcast` fan-outs to all queues; on a full queue, `status`/`spectator_count` events are dropped but any other event type **evicts** that slow subscriber. This is purely in-process — there is no Redis/broker, so it does not survive a restart and does not work across multiple backend processes.

**Game state is never persisted mid-game** (only completed moves/results are). On startup `recover_orphaned_games` marks any DB game still `active`/`queued` as completed with termination `server_restart` — a restart kills in-flight games rather than resuming them.

### LLM moves

`services/chess_agent.py` defines a single `pydantic-ai` `Agent` with `output_type=ChessMove` (move + narration + table_talk) and a long strategic system prompt. The model is **not** set on the agent; the engine passes `model=f"openrouter:{model_name}:nitro"` and per-color `ModelSettings` (temperature, reasoning effort) at call time. Illegal/invalid moves increment a game-wide consecutive counter: after 3 the prompt is augmented with the full legal-move list, after `MAX_CONSECUTIVE_ILLEGAL_MOVES` the side forfeits. **Chaos mode** instead force-pushes a structurally-valid-but-illegal move (own piece on the source square) onto the board, which can lead to king captures and impossible positions.

### Two Stockfish services

- `StockfishService` — the shared full-strength **evaluation** engine (eval bar, win probability, best move, move classification). One instance for the whole app.
- `StockfishPlayerService` — a per-game, **strength-limited** opponent (UCI_Elo). Created fresh per Stockfish-side game and stopped in the `finally` block.

### ELO and pseudo-models

`Human` and `Stockfish` are stored as rows in the `models` table alongside real OpenRouter model IDs, so the leaderboard ranks everyone together. ELO updates are **skipped** for chaos-mode games and for games involving a strength-limited Stockfish (`*_stockfish_elo` set) — see the `skip_elo` logic in `_run_game_inner`.

### Database

SQLite + `aiosqlite`, WAL mode enabled at init. Three tables in `database.py`: `Game`, `Move`, `LLMModel`. **There is no Alembic.** Schema evolution is done by appending to the `migrations` list in `_migrate_add_columns` (idempotent `ALTER TABLE ADD COLUMN`). When you add a field: update the SQLModel class **and** add a migration row, or existing databases will break.

### Post-game analysis

`services/stats_service.py` computes accuracy/ACPL/critical-moments lazily from the per-move evals already stored in the DB (Lichess-style accuracy formula), surfaced via `GameDetail.analysis` only when a game is `completed`. It does not re-run Stockfish.

## Frontend

- **`hooks/useGameWebSocket.ts` is the heart of the app.** A single `useReducer` turns every WebSocket event into game state. Note the two normalizers: `normalizeCatchUpMove` (flat snake_case fields from the DB-backed `catch_up`) vs `normalizeLiveMove` (nested `eval_before`/`eval_after` objects from a live `move_played`). Moves are de-duplicated by `(moveNumber, color)` to handle the catch-up/live race.
- The WebSocket route is **`/ws/games/{id}`** (plural — the README's API table showing `/ws/game/:id` is wrong; trust `routers/ws.py`, the CLI, and this hook).
- `player_secret` is returned at game creation and stored in `localStorage` as `chess_player_secret_<gameId>`; it authorizes `human_move`, `resign`, and stop. Anyone without it is a spectator.
- Routing (`App.tsx`) lazy-loads every page. `/embed/:gameId` renders without the `Layout` chrome. `GameViewerPage` is force-remounted via a `key={gameId}` wrapper so a rematch resets all state.
- Vite (`vite.config.ts`) manually chunks vendor bundles (charts/board/router/export) and proxies `/api` + `/ws` to `localhost:8000` in dev.

## Adding things — where the seams are

- **A new config knob** → add to `config.py` (read from env with a default). Nothing else reads `os.getenv` directly.
- **A new WebSocket event** → emit from a `GameEngine` callback → broadcast in `GameManager` → add a `case` in the `useGameWebSocket` reducer and a type in `frontend/src/types/websocket.ts`.
- **A new persisted field** → SQLModel class in `database.py` **and** a `_migrate_add_columns` entry, then thread it through `MoveRecord`/`GameConfig` (`models/chess_models.py`), the persist/catch-up methods, and the API response models (`models/api_models.py`).
