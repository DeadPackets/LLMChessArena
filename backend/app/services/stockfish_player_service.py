from __future__ import annotations

import logging
import time

import chess
import chess.engine

from app.config import (
    STOCKFISH_PATH,
    STOCKFISH_PLAYER_THREADS,
    STOCKFISH_PLAYER_HASH_MB,
    STOCKFISH_PLAYER_MOVE_TIME,
    STOCKFISH_MIN_ELO,
    STOCKFISH_MAX_ELO,
)

logger = logging.getLogger(__name__)


class StockfishPlayerService:
    """A separate Stockfish instance for playing as a strength-limited player.

    Unlike StockfishService (used for evaluation at full strength), this
    instance uses UCI_LimitStrength and UCI_Elo to play at a specified level.
    """

    def __init__(self, path: str = STOCKFISH_PATH):
        self.path = path
        self._engine: chess.engine.UciProtocol | None = None
        self.elo: int | None = None

    async def start(self, elo: int | None = None) -> None:
        """Start the engine. If elo is provided, limit strength."""
        logger.info("Starting Stockfish player engine at %s", self.path)
        _, self._engine = await chess.engine.popen_uci(self.path)
        config: dict = {"Threads": STOCKFISH_PLAYER_THREADS, "Hash": STOCKFISH_PLAYER_HASH_MB}
        if elo is not None:
            clamped = max(STOCKFISH_MIN_ELO, min(STOCKFISH_MAX_ELO, elo))
            config["UCI_LimitStrength"] = True
            config["UCI_Elo"] = clamped
            self.elo = clamped
            logger.info("Stockfish player: strength limited to ELO %d", clamped)
        else:
            logger.info("Stockfish player: full strength (no ELO limit)")
        await self._engine.configure(config)

    async def stop(self) -> None:
        if self._engine:
            logger.info("Stopping Stockfish player engine")
            await self._engine.quit()
            self._engine = None

    async def get_best_move(self, board: chess.Board, time_limit: float = STOCKFISH_PLAYER_MOVE_TIME) -> tuple[str | None, int]:
        """Get the best move from this strength-limited engine.

        Returns (uci_string, elapsed_ms).
        """
        if self._engine is None:
            raise RuntimeError("Stockfish player engine not started")
        start = time.monotonic()
        result = await self._engine.play(board, chess.engine.Limit(time=time_limit))
        elapsed_ms = int((time.monotonic() - start) * 1000)
        if result.move:
            return result.move.uci(), elapsed_ms
        return None, elapsed_ms
