from __future__ import annotations

import csv
from pathlib import Path

import chess


class OpeningDetector:
    """Detect chess openings by matching board positions against the Lichess opening database."""

    def __init__(self, data_dir: Path | str):
        self.openings: dict[str, dict[str, str]] = {}  # EPD -> {eco, name}
        self._load(Path(data_dir))

    def _load(self, data_dir: Path) -> None:
        for filename in ["a.tsv", "b.tsv", "c.tsv", "d.tsv", "e.tsv"]:
            filepath = data_dir / filename
            if not filepath.exists():
                continue
            with open(filepath, "r") as f:
                reader = csv.DictReader(f, delimiter="\t")
                for row in reader:
                    # Replay the PGN moves to get the final position's EPD
                    board = chess.Board()
                    try:
                        for token in row["pgn"].split():
                            # Skip move numbers like "1." or "2."
                            if "." in token:
                                continue
                            board.push_san(token)
                    except (ValueError, KeyError):
                        continue
                    epd = self._board_to_epd(board)
                    self.openings[epd] = {
                        "eco": row.get("eco", ""),
                        "name": row.get("name", ""),
                    }

    def detect(self, board: chess.Board) -> dict[str, str] | None:
        """Find the deepest known opening matching the current position.

        Walks backward through the move stack to find the most specific match.
        Returns {"eco": "B90", "name": "Sicilian Defense: Najdorf Variation"} or None.
        """
        # Check current position first
        epd = self._board_to_epd(board)
        if epd in self.openings:
            return self.openings[epd]

        # Walk backward through move history for a shallower match
        b = board.copy()
        while b.move_stack:
            b.pop()
            epd = self._board_to_epd(b)
            if epd in self.openings:
                return self.openings[epd]

        return None

    @staticmethod
    def _board_to_epd(board: chess.Board) -> str:
        """Generate EPD string (FEN without halfmove and fullmove counters)."""
        parts = board.fen().split()
        return " ".join(parts[:4])
