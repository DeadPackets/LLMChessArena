from __future__ import annotations

import math

import chess
import chess.engine

from app.config import STOCKFISH_PATH
from app.models.chess_models import PositionEval


class StockfishService:
    """Persistent Stockfish engine wrapper for async position evaluation."""

    def __init__(self, path: str = STOCKFISH_PATH):
        self.path = path
        self._transport: chess.engine.UciProtocol | None = None
        self._engine: chess.engine.UciProtocol | None = None

    async def start(self) -> None:
        self._transport, self._engine = await chess.engine.popen_uci(self.path)
        await self._engine.configure({
            "Threads": 2,
            "Hash": 128,
        })

    async def stop(self) -> None:
        if self._engine:
            await self._engine.quit()
            self._engine = None

    @property
    def engine(self) -> chess.engine.UciProtocol:
        if self._engine is None:
            raise RuntimeError("Stockfish not started. Call start() first.")
        return self._engine

    async def evaluate(self, board: chess.Board, depth: int = 18) -> PositionEval:
        """Evaluate a position and return structured evaluation data."""
        info = await self.engine.analyse(
            board,
            chess.engine.Limit(depth=depth),
        )

        score = info["score"].white()  # Always from White's perspective
        cp = score.score(mate_score=10000)
        mate_in = score.mate()

        # Win probability using Lichess sigmoid formula
        win_prob = self.cp_to_win_probability(cp)

        # WDL from Stockfish model
        wdl = score.wdl()

        # Best move from principal variation
        pv = info.get("pv", [])
        best_move = pv[0].uci() if pv else None

        return PositionEval(
            centipawns=cp,
            mate_in=mate_in,
            win_probability_white=win_prob,
            wdl_white={"w": wdl.wins, "d": wdl.draws, "l": wdl.losses},
            best_move_uci=best_move,
            depth=info.get("depth", depth),
        )

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
