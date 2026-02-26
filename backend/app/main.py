from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path

from app.config import STOCKFISH_PATH
from app.database import init_db
from app.services.game_manager import GameManager
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService

# ─── Central logging configuration ───
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    stream=sys.stdout,
    force=True,
)
# Silence noisy third-party loggers
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("openai").setLevel(logging.WARNING)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup: init DB, Stockfish, opening book. Shutdown: close Stockfish."""
    # Database
    await init_db()
    logger.info("Database initialized")

    # Stockfish
    stockfish = StockfishService(path=STOCKFISH_PATH)
    await stockfish.start()
    logger.info("Stockfish started")

    # Opening detector
    data_dir = Path(__file__).parent / "data" / "openings"
    opening_detector = OpeningDetector(data_dir=data_dir)
    logger.info("Opening book loaded (%d positions)", len(opening_detector.openings))

    # Game manager
    game_manager = GameManager(
        stockfish=stockfish,
        opening_detector=opening_detector,
    )

    # Clean up any games orphaned by a previous restart
    await game_manager.recover_orphaned_games()

    # Store in app state for access by routers
    app.state.stockfish = stockfish
    app.state.opening_detector = opening_detector
    app.state.game_manager = game_manager

    yield

    # Shutdown
    await stockfish.stop()
    logger.info("Stockfish stopped")


app = FastAPI(title="LLM Chess Arena", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
from app.routers.games import router as games_router
from app.routers.models_router import router as models_router
from app.routers.stats_router import router as stats_router
from app.routers.ws import router as ws_router

app.include_router(games_router)
app.include_router(models_router)
app.include_router(stats_router)
app.include_router(ws_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
