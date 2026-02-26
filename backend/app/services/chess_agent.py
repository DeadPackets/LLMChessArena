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
You are a chess engine competing in the LLM Chess Arena. You will receive the board state, FEN, and recent move history each turn. Your goal is to play the strongest chess possible and win.

## UCI Notation

You MUST return moves in UCI (Universal Chess Interface) notation. UCI moves are exactly 4 characters (or 5 for pawn promotion): the source square followed by the destination square.

Format: <file><rank><file><rank>[promotion]
- Files: a, b, c, d, e, f, g, h
- Ranks: 1, 2, 3, 4, 5, 6, 7, 8

Valid examples:
- e2e4 (pawn from e2 to e4)
- g1f3 (knight from g1 to f3)
- e1g1 (king-side castling as White)
- e7e8q (pawn promotion to queen)
- d7d8n (pawn promotion to knight)
- a7b6 (diagonal pawn capture)

Invalid examples (DO NOT output these):
- Nf3 (this is SAN notation, not UCI)
- e2-e4 (no hyphens)
- E2E4 (must be lowercase)
- bf66e7 (too many characters, not a real square)
- e2h5 (impossible move geometry)
- 0-0 (castling is written as king move: e1g1 or e1c1)

## Move Rules

- Look at the board carefully. Only submit moves that are legal in the current position.
- A piece must exist on the source square AND the destination must be a legal target.
- There are two types of errors: (1) invalid UCI notation (malformed string) and (2) illegal move (valid notation but not legal in this position). Both count against you.
- 10 consecutive bad moves = forfeit. The counter resets after each legal move.

## Output

- narration: One short sentence about your move (max 128 chars).
- trash_talk: A short taunt directed at your opponent (max 128 chars). Be creative, witty, and competitive.\
"""

chess_agent = Agent(
    model=None,  # Set at call time per player
    output_type=ChessMove,
    system_prompt=SYSTEM_PROMPT,
    deps_type=ChessGameContext,
)


def build_user_prompt(
    board: chess.Board,
    color: str,
    move_history: list[dict],
    error_context: str = "",
    include_legal_moves: bool = False,
) -> str:
    """Build the user prompt with board state and recent history."""
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
    ]

    # Inject check warning
    if board.is_check():
        king_sq = chess.square_name(board.king(board.turn))
        checkers = [chess.square_name(sq) for sq in board.checkers()]
        parts.append(
            f"⚠ YOUR KING ON {king_sq.upper()} IS IN CHECK from {', '.join(checkers)}! "
            f"You MUST resolve the check (block, capture, or move the king)."
        )

    parts.extend([
        "",
        "--- BOARD ---",
        str(board),
        "",
        f"FEN: {board.fen()}",
        "",
        "--- RECENT MOVES ---",
        history_str,
    ])

    # Inject recent trash talk for conversational memory
    trash_talk_entries = [
        m for m in move_history if m.get("trash_talk")
    ][-20:]
    if trash_talk_entries:
        parts.extend(["", "--- TRASH TALK HISTORY ---"])
        for m in trash_talk_entries:
            speaker = m.get("color", "?").title()
            parts.append(f"  {speaker}: \"{m['trash_talk']}\"")

    if error_context:
        parts.extend([
            "",
            f"⚠ ERROR: {error_context}",
            "Submit a valid UCI move that is legal in this position.",
        ])
    else:
        parts.extend([
            "",
            "Analyze the position and make your move.",
        ])

    if include_legal_moves:
        legal_uci = sorted(m.uci() for m in board.legal_moves)
        parts.extend([
            "",
            "⚠ WARNING: You have made multiple consecutive illegal moves and risk disqualification!",
            "Here are ALL legal moves in this position (UCI notation):",
            ", ".join(legal_uci),
            "You MUST pick one of these moves. Any other move will be rejected.",
        ])

    return "\n".join(parts)
