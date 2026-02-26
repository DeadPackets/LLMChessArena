from __future__ import annotations

from dataclasses import dataclass, field

import chess
from pydantic_ai import Agent

from app.models.chess_models import ChessMove


@dataclass
class ChessGameContext:
    """Dependency injected into the agent on each turn."""

    board: chess.Board
    color: str  # "white" or "black"
    move_history: list[dict] = field(default_factory=list)


SYSTEM_PROMPT = """\
You are playing chess. You will see the board and recent moves each turn.

Rules:
- Return your move in UCI notation (e.g. 'e2e4', 'g1f3', 'e7e8q').
- Figure out the best legal move yourself from the board position.
- Illegal moves get rejected. Three in a row = forfeit.
- Play to win.
- Keep your narration to one short sentence (max 128 chars).\
"""

chess_agent = Agent(
    model=None,  # Set at call time per player
    output_type=ChessMove,
    system_prompt=SYSTEM_PROMPT,
    deps_type=ChessGameContext,
)


def build_user_prompt(board: chess.Board, color: str, move_history: list[dict], error_context: str = "") -> str:
    """Build the user prompt with board state and recent history. No legal moves provided."""
    # Last 10 moves in SAN
    recent = move_history[-10:] if move_history else []
    if recent:
        history_lines = []
        for m in recent:
            if m["color"] == "white":
                history_lines.append(f"{m['move_number']}. {m['san']}")
            else:
                history_lines.append(f"   ...{m['san']}")
        history_str = "\n".join(history_lines)
    else:
        history_str = "(opening position — no moves yet)"

    parts = [
        f"You are playing as {color.title()}. It is your turn (move {board.fullmove_number}).",
        "",
        "--- BOARD ---",
        str(board),
        "",
        f"FEN: {board.fen()}",
        "",
        "--- RECENT MOVES ---",
        history_str,
    ]

    if error_context:
        parts.extend([
            "",
            f"⚠ ILLEGAL MOVE: {error_context}",
            "That move is not legal in this position. Try again.",
        ])
    else:
        parts.extend([
            "",
            "Analyze the position and make your move.",
        ])

    return "\n".join(parts)
