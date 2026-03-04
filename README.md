<div align="center">

# LLM Chess Arena

**Watch AI models battle it out on the chessboard — against each other, against humans, or against Stockfish — with real-time evaluation, table talk, and deep post-game analysis.**

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-d4a843?style=for-the-badge)](LICENSE)
[![Live](https://img.shields.io/badge/Live-llmchess.deadpackets.pw-00c853?style=for-the-badge)](https://llmchess.deadpackets.pw)

<br />

<img src="docs/screenshots/game-viewer.png" alt="LLM Chess Arena - Game Viewer" width="800" />

</div>

---

## Overview

LLM Chess Arena is a full-stack web application that pits large language models against each other (or against Stockfish or a human player) in chess. Games are played in real-time via [OpenRouter](https://openrouter.ai/), evaluated move-by-move with [Stockfish](https://stockfishchess.org/), and accompanied by AI-generated table talk — all streamed live to a dark-themed war room UI.

### Highlights

- **Any LLM vs Any LLM** — Supports any model on OpenRouter (GPT-4o, Claude, Gemini, Llama, etc.)
- **Human vs LLM** — Play against any AI model with drag-and-drop, click-to-move, legal move highlighting, and promotion dialogs
- **Stockfish as opponent** — Benchmark LLM chess ability against the strongest classical engine with configurable ELO (1320–3190)
- **Chaos Mode** — Illegal LLM moves are force-pushed to the board instead of retried, creating wild and impossible positions
- **Real-time streaming** — WebSocket-powered live updates for moves, evaluations, table talk, and spectator counts
- **Deep analysis** — Stockfish-powered accuracy scores, ACPL, win probability graphs, move classifications, and critical moments
- **Table talk** — LLMs provide honest, natural reactions to each position — confident when ahead, frustrated when behind
- **ELO ratings** — Unified leaderboard ranking all LLMs, Human, and Stockfish together
- **Embeddable replays** — Share finished games on any site with `<iframe src="/embed/:gameId">`
- **Per-move time controls** — Configurable 5–600s time limit with forfeit on timeout
- **Cost tracking** — Per-move and per-game token usage and API cost tracking
- **Rate limiting** — Per-IP sliding-window rate limiter with game queueing and configurable concurrency
- **10 board themes + 14 piece styles** — Persisted to localStorage
- **Sound effects + move animations** — Audio feedback for moves, captures, checks, and game-over
- **Docker-ready** — One command to deploy the entire stack

---

## Game Modes

| Mode | Description |
|------|-------------|
| **LLM vs LLM** | Two AI models play each other. Both provide table talk and narration. |
| **Human vs LLM** | You play against an AI model with an interactive board — legal move highlights, click-to-move, drag-and-drop, and pawn promotion. |
| **LLM vs Stockfish** | An AI model plays against the Stockfish engine at configurable strength. A pure chess skill benchmark. |
| **Chaos Mode** | Any game mode with at least one LLM. Illegal LLM moves are force-pushed to the board — creating impossible positions. Excluded from ELO. |

> **Note:** Every game must have at least one LLM. Human vs Stockfish games are not allowed — this is an LLM arena, not a chess website.

---

## Screenshots

<details>
<summary><b>Live Game Viewer</b></summary>
<br />
<img src="docs/screenshots/game-viewer.png" alt="Game Viewer" width="800" />
<p>Interactive chessboard with eval bar, win probability graph, classified move list, playback controls, table talk, and AI commentary.</p>
</details>

<details>
<summary><b>Post-Game Analysis</b></summary>
<br />
<img src="docs/screenshots/analysis-panel.png" alt="Analysis Panel" width="800" />
<p>Accuracy comparison, ACPL, classification breakdown, critical moments, token usage per move, and cost analysis.</p>
</details>

<details>
<summary><b>Games List</b></summary>
<br />
<img src="docs/screenshots/games-page.png" alt="Games Page" width="800" />
<p>Browse active and completed games with search, filtering by outcome/opening, and URL-synced state.</p>
</details>

<details>
<summary><b>New Game Dialog</b></summary>
<br />
<img src="docs/screenshots/new-game-dialog.png" alt="New Game Dialog" width="800" />
<p>Three-way player type toggle (LLM / Human / Stockfish) per side with a searchable model dropdown from OpenRouter. Supports temperature, reasoning effort, time controls, Stockfish ELO, and chaos mode.</p>
</details>

<details>
<summary><b>Leaderboard</b></summary>
<br />
<img src="docs/screenshots/leaderboard.png" alt="Leaderboard" width="800" />
<p>Unified ELO rankings for LLMs, Human, and Stockfish — with accuracy, ACPL, average cost, and response time stats.</p>
</details>

<details>
<summary><b>Model Detail</b></summary>
<br />
<img src="docs/screenshots/model-detail.png" alt="Model Detail" width="800" />
<p>Deep dive into any model's performance: ELO history graph, win rates, head-to-head records, classification distribution, and recent games.</p>
</details>

<details>
<summary><b>Cost & Performance Dashboard</b></summary>
<br />
<img src="docs/screenshots/cost-dashboard.png" alt="Cost Dashboard" width="800" />
<p>Platform-wide cost tracking with per-model breakdowns, token usage analysis, and response time comparisons.</p>
</details>

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | [FastAPI](https://fastapi.tiangolo.com) + [SQLModel](https://sqlmodel.tiangolo.com) + [aiosqlite](https://github.com/omnilib/aiosqlite) |
| **LLM Orchestration** | [pydantic-ai](https://ai.pydantic.dev) via [OpenRouter](https://openrouter.ai) |
| **Chess Engine** | [Stockfish](https://stockfishchess.org) (depth 18 live, depth 22 post-game) |
| **Chess Logic** | [python-chess](https://python-chess.readthedocs.io) |
| **Real-time** | WebSocket (FastAPI to React) |
| **Frontend** | [React 19](https://react.dev) + [TypeScript](https://typescriptlang.org) + [Vite](https://vitejs.dev) |
| **Board UI** | [react-chessboard](https://github.com/Clariity/react-chessboard) + [chess.js](https://github.com/jhlywa/chess.js) |
| **Charts** | [Recharts](https://recharts.org) |
| **Deployment** | [Docker Compose](https://docs.docker.com/compose/) (nginx + uvicorn) |

---

## Getting Started

### Prerequisites

- **Docker** and **Docker Compose** (recommended), or:
- **Python 3.12+**, **Node.js 20+**, and **Stockfish** (`apt install stockfish`)
- **OpenRouter API key** — [openrouter.ai](https://openrouter.ai)

### Quick Start with Docker

```bash
git clone https://github.com/DeadPackets/LLMChessArena.git
cd LLMChessArena

cp .env.example .env
# Edit .env and set OPENROUTER_API_KEY

docker compose up --build -d
```

The app will be available at **http://localhost**. The backend waits for a health check before the frontend starts.

### Local Development

**Backend:**

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp ../.env.example .env   # edit with your API key
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev
```

Dev server at **http://localhost:5173** — proxies `/api` and `/ws` to the backend.

---

## Production Deployment

The Docker Compose setup is production-ready and designed to sit behind a reverse proxy like Cloudflare.

### Architecture

```
Internet -> Cloudflare (TLS, DDoS, HSTS) -> nginx (port 80) -> backend (port 8000)
                                                             -> static assets
```

### What's built in

- **CORS** locked to `ALLOWED_ORIGINS` (default: `https://llmchess.deadpackets.pw`)
- **Rate limiting** — per-IP sliding window with 4 tiers (game creation, API reads, game stop, WebSocket). Returns `429` with `Retry-After` and `X-RateLimit-*` headers
- **Game queueing** — `MAX_CONCURRENT_GAMES` enforced by asyncio semaphore. Excess games queue with position tracking
- **Cloudflare IP detection** — rate limiter reads `CF-Connecting-IP` for real client IPs
- **Security headers** — `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy` via nginx
- **SQLite WAL mode** — enabled at startup for concurrent read/write performance
- **Health checks** — Docker health checks on both services; frontend waits for backend to be healthy
- **Global exception handler** — unhandled errors return `{"detail": "Internal server error"}` instead of stack traces
- **Proxy headers** — uvicorn runs with `--proxy-headers --forwarded-allow-ips=*`

### Cloudflare settings

If deploying behind Cloudflare with proxy enabled:
- **SSL/TLS**: Full (strict) if you have an origin cert, or Flexible for HTTP-only origins
- **HSTS**: Enable in Cloudflare dashboard (edge-level, no nginx config needed)
- **WebSockets**: Enabled by default on all Cloudflare plans
- **Caching**: Static assets get 30-day `Cache-Control: public, immutable` from nginx

---

## Embedding Games

Share finished game replays on any website:

```html
<iframe
  src="https://llmchess.deadpackets.pw/embed/GAME_ID"
  width="800" height="500"
  style="border: none; border-radius: 8px;"
></iframe>
```

The embed viewer includes a chessboard, move list, playback controls, and a "View full game" link back to the main site. Supports `?move=N` to start at a specific position.

Active games show a "Watch Live" link instead of the replay viewer.

---

## Configuration

All settings are configurable via environment variables with sensible defaults.

### Required

| Variable | Description |
|----------|-------------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key |

### Optional

| Variable | Default | Description |
|----------|---------|-------------|
| `STOCKFISH_PATH` | `/usr/games/stockfish` | Path to Stockfish binary |
| `MAX_MOVES_PER_SIDE` | `200` | Maximum moves per side before forced draw |
| `MAX_CONSECUTIVE_ILLEGAL_MOVES` | `10` | Illegal moves before forfeit |
| `MAX_CONCURRENT_GAMES` | `3` | Simultaneous games allowed (excess queued) |
| `ELO_K_FACTOR` | `32` | ELO rating K-factor |
| `DEFAULT_MODEL_ELO` | `1500.0` | Starting ELO for new models |
| `STOCKFISH_THREADS` | `2` | Stockfish eval engine threads |
| `STOCKFISH_HASH_MB` | `128` | Stockfish eval engine hash table (MB) |
| `STOCKFISH_DEPTH_LIVE` | `18` | Stockfish search depth during live games |
| `STOCKFISH_DEPTH_DEEP` | `22` | Stockfish search depth for post-game analysis |
| `STOCKFISH_PLAYER_THREADS` | `1` | Stockfish player engine threads |
| `STOCKFISH_PLAYER_HASH_MB` | `64` | Stockfish player engine hash table (MB) |
| `STOCKFISH_PLAYER_MOVE_TIME` | `1.0` | Stockfish player time per move (seconds) |
| `STOCKFISH_MIN_ELO` | `1320` | Minimum selectable Stockfish ELO |
| `STOCKFISH_MAX_ELO` | `3190` | Maximum selectable Stockfish ELO |
| `DRAW_ADJUDICATION_CP` | `20` | Centipawn threshold for draw adjudication |
| `DRAW_ADJUDICATION_MOVES` | `30` | Consecutive moves within threshold to declare draw |
| `NARRATION_CHAR_CAP` | `128` | Maximum characters for LLM narration/table talk |
| `RATE_LIMIT_GAME_CREATE` | `5` | Game creation requests per minute per IP |
| `RATE_LIMIT_API_READ` | `60` | API read requests per minute per IP |
| `RATE_LIMIT_GAME_STOP` | `10` | Game stop requests per minute per IP |
| `RATE_LIMIT_WS_CONNECT` | `20` | WebSocket connections per minute per IP |
| `ALLOWED_ORIGINS` | `https://llmchess.deadpackets.pw` | Comma-separated CORS origins |
| `LOG_LEVEL` | `INFO` | Python logging level (`DEBUG`, `INFO`, `WARNING`, `ERROR`) |

---

## API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/games` | List games (filter by status, outcome, model, opening, search) |
| `POST` | `/api/games` | Create a new game |
| `GET` | `/api/games/queue-status` | Active/queued game counts |
| `GET` | `/api/games/:id` | Game detail with moves and analysis |
| `GET` | `/api/games/:id/pgn` | Download PGN |
| `POST` | `/api/games/:id/stop` | Stop an active game (requires player secret) |
| `GET` | `/api/models` | List all models |
| `GET` | `/api/models/leaderboard` | ELO leaderboard with accuracy, ACPL, cost, response time |
| `GET` | `/api/models/compare` | Head-to-head comparison (`?model_a=...&model_b=...`) |
| `GET` | `/api/models/:id` | Model detail with stats and recent games |
| `GET` | `/api/models/:id/elo-history` | ELO rating progression |
| `GET` | `/api/models/:id/head-to-head` | Head-to-head records vs all opponents |
| `GET` | `/api/stats/overview` | Platform-wide cost and token overview |
| `GET` | `/api/stats/openings` | Opening statistics across all games |
| `GET` | `/api/openrouter/models` | Cached OpenRouter model list |
| `GET` | `/health` | Service health check |
| `WS` | `/ws/game/:id` | Real-time game stream (moves, eval, table talk, spectators) |

All API responses include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers.

---

## Project Structure

```
LLMChessArena/
├── backend/
│   ├── app/
│   │   ├── main.py                # FastAPI app, lifespan, exception handler
│   │   ├── config.py              # All env-var-driven configuration
│   │   ├── database.py            # SQLModel tables + WAL init
│   │   ├── middleware/
│   │   │   └── rate_limiter.py    # Per-IP sliding-window rate limiter
│   │   ├── models/
│   │   │   ├── api_models.py      # Pydantic request/response schemas
│   │   │   └── chess_models.py    # GameConfig, ChessMove, MoveRecord, GameResult
│   │   ├── routers/
│   │   │   ├── games.py           # Game CRUD, stop, queue status
│   │   │   ├── models_router.py   # Leaderboard, model detail, H2H, ELO history
│   │   │   ├── stats_router.py    # Platform overview, opening stats
│   │   │   ├── ws.py              # WebSocket game streaming + human moves
│   │   │   └── openrouter_proxy.py
│   │   └── services/
│   │       ├── chess_agent.py     # pydantic-ai LLM agent (structured output)
│   │       ├── game_engine.py     # Game loop (LLM, Human, Stockfish, Chaos)
│   │       ├── game_manager.py    # Concurrency, queueing, ELO updates
│   │       ├── stockfish_service.py       # Async Stockfish UCI (eval)
│   │       ├── stockfish_player_service.py # Strength-limited Stockfish player
│   │       ├── move_classifier.py  # Move classification (best/good/inaccuracy/mistake/blunder)
│   │       ├── elo_service.py      # ELO calculation
│   │       ├── stats_service.py    # ACPL, accuracy, aggregates, H2H
│   │       └── opening_detector.py # ECO opening book (3600+ positions)
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/                 # GameList, GameViewer, GameEmbed, Leaderboard,
│   │   │                          # ModelDetail, CostDashboard, HeadToHead, OpeningExplorer
│   │   ├── components/            # ChessboardPanel, EvalBar, MoveList, WinProbGraph,
│   │   │                          # TableTalkPanel, AnalysisPanel, GameControls, etc.
│   │   ├── hooks/                 # useGameWebSocket, useReplayControls, useBoardTheme,
│   │   │                          # useOpenRouterModels, useSoundEffects
│   │   ├── utils/                 # formatModel (shared), sound helpers
│   │   ├── api/client.ts          # REST API client with timeout
│   │   └── types/                 # TypeScript interfaces (API + WebSocket)
│   ├── Dockerfile                 # Multi-stage: npm build -> nginx
│   ├── nginx.conf                 # Reverse proxy + security headers
│   └── package.json
├── docker-compose.yml             # Backend + frontend with health checks
└── .env.example
```

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with [Claude Code](https://claude.ai/claude-code)**

</div>
