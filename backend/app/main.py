from __future__ import annotations

import asyncio
import logging
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from pathlib import Path

from app.config import STOCKFISH_PATH, LOG_LEVEL, ALLOWED_ORIGINS, OPENROUTER_API_KEY
from app.database import init_db
from app.middleware.rate_limiter import RateLimitMiddleware, periodic_cleanup
from app.services.game_manager import GameManager
from app.services.opening_detector import OpeningDetector
from app.services.stockfish_service import StockfishService

# ─── Central logging configuration ───
logging.basicConfig(
    level=getattr(logging, LOG_LEVEL, logging.INFO),
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
    if not OPENROUTER_API_KEY:
        logger.warning("OPENROUTER_API_KEY is not set — LLM games will fail")

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

    # Start rate limiter cleanup task
    cleanup_task = asyncio.create_task(periodic_cleanup())

    # Store in app state for access by routers
    app.state.stockfish = stockfish
    app.state.opening_detector = opening_detector
    app.state.game_manager = game_manager

    yield

    # Shutdown
    cleanup_task.cancel()
    try:
        await cleanup_task
    except asyncio.CancelledError:
        pass
    await stockfish.stop()
    logger.info("Stockfish stopped")


app = FastAPI(title="LLM Chess Arena", version="0.1.0", lifespan=lifespan)

app.add_middleware(RateLimitMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)

# Include routers
from app.routers.games import router as games_router
from app.routers.models_router import router as models_router
from app.routers.stats_router import router as stats_router
from app.routers.ws import router as ws_router
from app.routers.openrouter_proxy import router as openrouter_router

app.include_router(games_router)
app.include_router(models_router)
app.include_router(stats_router)
app.include_router(ws_router)
app.include_router(openrouter_router)


@app.exception_handler(Exception)
async def global_exception_handler(request, exc):
    logger.error("Unhandled exception on %s %s: %s", request.method, request.url.path, exc, exc_info=True)
    from starlette.responses import JSONResponse as _JSONResponse
    return _JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.get("/health")
async def health():
    return {"status": "ok"}
