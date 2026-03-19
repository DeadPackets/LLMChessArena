from __future__ import annotations

import asyncio
import logging
import math
import time

import chess
import chess.engine

from app.config import STOCKFISH_PATH, STOCKFISH_THREADS, STOCKFISH_HASH_MB
from app.models.chess_models import EngineLine, PositionEval

logger = logging.getLogger(__name__)


class StockfishService:
    """Persistent Stockfish engine wrapper for async position evaluation."""

    def __init__(self, path: str = STOCKFISH_PATH):
        self.path = path
        self._transport: chess.engine.UciProtocol | None = None
        self._engine: chess.engine.UciProtocol | None = None
        self._lock = asyncio.Lock()

    async def start(self) -> None:
        logger.info("Starting Stockfish at %s", self.path)
        self._transport, self._engine = await chess.engine.popen_uci(self.path)
        await self._engine.configure({
            "Threads": STOCKFISH_THREADS,
            "Hash": STOCKFISH_HASH_MB,
        })
        logger.info("Stockfish ready (Threads=%d, Hash=%dMB)", STOCKFISH_THREADS, STOCKFISH_HASH_MB)

    async def stop(self) -> None:
        if self._engine:
            logger.info("Stopping Stockfish")
            await self._engine.quit()
            self._engine = None

    @property
    def engine(self) -> chess.engine.UciProtocol:
        if self._engine is None:
            raise RuntimeError("Stockfish not started. Call start() first.")
        return self._engine

    async def evaluate(self, board: chess.Board, depth: int = 18, multipv: int = 3) -> PositionEval:
        """Evaluate a position and return structured evaluation data with top N lines."""
        start = time.monotonic()
        async with self._lock:
            infos = await self.engine.analyse(
            board,
            chess.engine.Limit(depth=depth),
                multipv=multipv,
            )
        elapsed_ms = int((time.monotonic() - start) * 1000)

        # multipv returns a list of InfoDicts; single PV returns a single dict
        if not isinstance(infos, list):
            infos = [infos]

        # Primary line (rank 1)
        primary = infos[0] if infos else {}
        score = primary["score"].white()
        cp = score.score(mate_score=10000)
        mate_in = score.mate()
        win_prob = self.cp_to_win_probability(cp)
        wdl = score.wdl()
        pv = primary.get("pv", [])
        best_move = pv[0].uci() if pv else None

        # Build engine lines from all multipv results
        engine_lines: list[EngineLine] = []
        for rank_idx, info in enumerate(infos):
            line_score = info["score"].white()
            line_cp = line_score.score(mate_score=10000)
            line_mate = line_score.mate()
            line_pv = info.get("pv", [])
            if line_pv:
                engine_lines.append(EngineLine(
                    rank=rank_idx + 1,
                    move_uci=line_pv[0].uci(),
                    centipawns=line_cp,
                    mate_in=line_mate,
                ))

        eval_result = PositionEval(
            centipawns=cp,
            mate_in=mate_in,
            win_probability_white=win_prob,
            wdl_white={"w": wdl.wins, "d": wdl.draws, "l": wdl.losses},
            best_move_uci=best_move,
            depth=primary.get("depth", depth),
            engine_lines=engine_lines,
        )
        logger.debug(
            "Stockfish eval: depth=%d, cp=%d, mate=%s, best=%s, lines=%d, %dms",
            primary.get("depth", depth), cp, mate_in, best_move, len(engine_lines), elapsed_ms,
        )
        return eval_result

    @staticmethod
    def cp_to_win_probability(cp: int) -> float:
        """Convert centipawns to win probability for White (0.0 to 1.0)."""
        return 1.0 / (1.0 + math.exp(-0.00368208 * cp))

    @staticmethod
    def format_eval(cp: int, mate_in: int | None) -> str:
        """Format evaluation for display (e.g. '+0.35' or 'M5')."""
        if mate_in is not None:
            return f"{'M' if mate_in > 0 else '-M'}{abs(mate_in)}"
        return f"{'+' if cp >= 0 else ''}{cp / 100:.2f}"
