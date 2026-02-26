<div align="center">

# ♞ LLM Chess Arena

**Watch AI models battle it out on the chessboard with real-time evaluation, live commentary, and deep post-game analysis.**

[![Python](https://img.shields.io/badge/Python-3.12+-3776AB?style=for-the-badge&logo=python&logoColor=white)](https://python.org)
[![FastAPI](https://img.shields.io/badge/FastAPI-0.115+-009688?style=for-the-badge&logo=fastapi&logoColor=white)](https://fastapi.tiangolo.com)
[![React](https://img.shields.io/badge/React-19-61DAFB?style=for-the-badge&logo=react&logoColor=black)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?style=for-the-badge&logo=typescript&logoColor=white)](https://typescriptlang.org)
[![Docker](https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![License: MIT](https://img.shields.io/badge/License-MIT-d4a843?style=for-the-badge)](LICENSE)

<br />

<img src="docs/screenshots/game-viewer.png" alt="LLM Chess Arena - Game Viewer" width="800" />

</div>

---

## Overview

LLM Chess Arena is a full-stack web application that pits large language models against each other in chess. Games are played in real-time via [OpenRouter](https://openrouter.ai/), evaluated move-by-move with [Stockfish](https://stockfishchess.org/), and narrated by an AI commentator — all streamed live to a sleek dark-themed UI.

### Highlights

- **Any LLM vs Any LLM** — Supports any model available on OpenRouter (GPT-4o, Claude, Gemini, Llama, etc.)
- **Real-time WebSocket streaming** — Watch moves, evaluations, and commentary appear live
- **Stockfish-powered analysis** — Every move gets engine evaluation, win probability, and classification (brilliant, great, best, good, inaccuracy, mistake, blunder)
- **AI narration** — A separate LLM provides color commentary for each move
- **Post-game analysis** — Accuracy scores, ACPL, critical moments, classification breakdowns
- **ELO rating system** — Models accumulate ratings across games
- **Cost tracking** — Per-move and per-game token usage and API cost tracking
- **Docker-ready** — One command to deploy the entire stack

---

## Screenshots

<details>
<summary><b>🎮 Live Game Viewer</b></summary>
<br />
<img src="docs/screenshots/game-viewer.png" alt="Game Viewer" width="800" />
<p>Interactive chessboard with eval bar, win probability graph, classified move list, playback controls, and AI commentary.</p>
</details>

<details>
<summary><b>📊 Post-Game Analysis</b></summary>
<br />
<img src="docs/screenshots/analysis-panel.png" alt="Analysis Panel" width="800" />
<p>Accuracy comparison, ACPL, classification breakdown, critical moments, token usage per move, and cost analysis.</p>
</details>

<details>
<summary><b>🏠 Games List</b></summary>
<br />
<img src="docs/screenshots/games-page.png" alt="Games Page" width="800" />
<p>Browse active and completed games with filtering. Start new matches between any two models.</p>
</details>

<details>
<summary><b>🏆 Leaderboard</b></summary>
<br />
<img src="docs/screenshots/leaderboard.png" alt="Leaderboard" width="800" />
<p>ELO rankings with accuracy, ACPL, average cost, and response time stats.</p>
</details>

<details>
<summary><b>🤖 Model Detail</b></summary>
<br />
<img src="docs/screenshots/model-detail.png" alt="Model Detail" width="800" />
<p>Deep dive into any model's performance: win rates, head-to-head records, classification distribution, and recent games.</p>
</details>

<details>
<summary><b>💰 Cost & Performance Dashboard</b></summary>
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
| **Chess Engine** | [Stockfish](https://stockfishchess.org) (depth 18 live eval) |
| **Chess Logic** | [python-chess](https://python-chess.readthedocs.io) |
| **Real-time** | WebSocket (FastAPI → React) |
| **Frontend** | [React 19](https://react.dev) + [TypeScript](https://typescriptlang.org) + [Vite](https://vitejs.dev) |
| **Board UI** | [react-chessboard](https://github.com/Clariity/react-chessboard) |
| **Charts** | [Recharts](https://recharts.org) |
| **Deployment** | [Docker Compose](https://docs.docker.com/compose/) (nginx + uvicorn) |

---

## Getting Started

### Prerequisites

- **Python 3.12+**
- **Node.js 20+**
- **Stockfish** installed and accessible (`apt install stockfish` on Debian/Ubuntu)
- **OpenRouter API key** — Get one at [openrouter.ai](https://openrouter.ai)

### Quick Start with Docker

```bash
# Clone the repo
git clone https://github.com/DeadPackets/LLMChessArena.git
cd LLMChessArena

# Set your API key
cp .env.example .env
# Edit .env and add your OPENROUTER_API_KEY

# Launch
docker compose up --build
```

The app will be available at **http://localhost**.

### Manual Setup

#### Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# Configure environment
cp ../.env.example .env
# Edit .env with your OPENROUTER_API_KEY and STOCKFISH_PATH

# Run
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

The frontend dev server runs at **http://localhost:5173** and proxies API requests to the backend.

---

## Usage

1. **Start a game** — Click "New Game" on the home page, enter two model IDs (e.g., `openai/gpt-4o` vs `anthropic/claude-sonnet-4`), and click Start
2. **Watch live** — The board updates in real-time with move animations, engine evaluation, and AI narration
3. **Review games** — Click any completed game to see full analysis with accuracy scores, critical moments, and replay controls
4. **Track models** — Visit the Leaderboard to see ELO rankings, or click a model name for detailed stats and head-to-head records
5. **Monitor costs** — The Cost & Performance page shows platform-wide spending and token usage across all models

---

## Project Structure

```
LLMChessArena/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app + lifespan
│   │   ├── config.py            # Environment config
│   │   ├── database.py          # SQLModel tables (Game, Move, LLMModel)
│   │   ├── models/
│   │   │   └── api_models.py    # Pydantic response models
│   │   ├── routers/
│   │   │   ├── games.py         # Game CRUD + analysis
│   │   │   ├── models_router.py # Leaderboard + model detail
│   │   │   ├── stats_router.py  # Cost/token overview
│   │   │   └── ws.py            # WebSocket game streaming
│   │   └── services/
│   │       ├── game_engine.py   # Chess game loop
│   │       ├── game_manager.py  # Concurrent game management
│   │       ├── stockfish_service.py  # Async Stockfish UCI
│   │       ├── move_classifier.py    # Move classification
│   │       ├── stats_service.py      # ACPL, accuracy, aggregates
│   │       └── opening_detector.py   # ECO opening book
│   ├── Dockerfile
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── pages/               # GameList, GameViewer, Leaderboard, ModelDetail, CostDashboard
│   │   ├── components/          # Board, EvalBar, MoveList, WinProbGraph, AnalysisPanel, etc.
│   │   ├── hooks/               # useGameWebSocket, useReplayControls
│   │   ├── api/client.ts        # REST API client
│   │   └── types/               # TypeScript interfaces
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── docker-compose.yml
└── .env.example
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/games` | List games (filter by status, model) |
| `POST` | `/api/games` | Create a new game |
| `GET` | `/api/games/:id` | Game detail with moves and analysis |
| `POST` | `/api/games/:id/stop` | Stop an active game |
| `GET` | `/api/games/:id/pgn` | Download PGN |
| `GET` | `/api/models` | List all models |
| `GET` | `/api/models/leaderboard` | ELO leaderboard with enhanced stats |
| `GET` | `/api/models/:id` | Model detail (stats, head-to-head, recent games) |
| `GET` | `/api/stats/overview` | Platform cost/token overview |
| `WS` | `/ws/game/:id` | Real-time game stream |

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `OPENROUTER_API_KEY` | Your OpenRouter API key | *required* |
| `STOCKFISH_PATH` | Path to Stockfish binary | `/usr/games/stockfish` |

---

## License

This project is licensed under the MIT License — see the [LICENSE](LICENSE) file for details.

---

<div align="center">

**Built with [Claude Code](https://claude.ai/claude-code)**

</div>
