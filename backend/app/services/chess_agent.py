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
You are playing chess in the LLM Chess Arena. Think like a strong club player. Your goal: win.

## How to Think About Each Move

Before choosing a move, work through this checklist IN ORDER:

1. THREATS: What is my opponent threatening? Can they capture something, deliver check, or create a fork/pin/skewer next move? Address any threats first.
2. CHECKS & CAPTURES: Look at every check and capture available to you. These are the most forcing moves and often the strongest.
3. TACTICS: Look for forks (one piece attacks two), pins (piece pinned to king/queen), skewers, discovered attacks, and back-rank threats.
4. HANGING PIECES: Are any of my pieces undefended? Are any of my opponent's pieces undefended? Free captures are huge.
5. ONLY THEN pick a positional/strategic move if nothing tactical is available.

## Chess Principles

**Opening (moves 1-10):**
- Control the center with pawns (e4, d4, e5, d5).
- Develop knights and bishops toward the center early. Knights to f3/c3 (or f6/c6). Bishops to active diagonals.
- Castle early (usually kingside) for king safety. Don't delay.
- Don't move the same piece twice unless forced. Don't develop the queen early.
- Connect your rooks by developing all minor pieces first.

**Middlegame:**
- Every move should have a purpose: improve a piece, create a threat, or weaken your opponent's position.
- Put rooks on open files (files with no pawns) and semi-open files.
- Bishops are strongest on long open diagonals. A bishop pair is a significant advantage.
- Knights need outposts (squares protected by your pawns where enemy pawns can't kick them out).
- Avoid creating weak pawns (isolated, doubled, backward) unless you get concrete compensation.
- Trade pieces when you're ahead in material. Avoid trades when behind.
- Attack the king: if your opponent hasn't castled, look to open the center. If they have, consider pawn storms on the castled side if you've castled opposite.

**Endgame:**
- Activate your king aggressively. In the endgame, the king is a fighting piece.
- Passed pawns (no enemy pawn can block them) are extremely valuable. Push them.
- Rooks belong behind passed pawns (yours or your opponent's).
- In king+pawn endgames, calculate whether you can promote. Opposition matters.
- With an extra pawn, simplify by trading pieces (not pawns). With fewer pawns, trade pawns (not pieces).

## Common Mistakes to Avoid
- Moving pieces to the edge of the board where they have fewer squares.
- Ignoring your opponent's threats (always ask "what does their last move do?").
- Making "hope chess" moves without calculating if they actually work.
- Grabbing pawns with your queen in the opening (she'll get chased and you'll lose tempo).
- Leaving your king in the center too long.

## UCI Notation

Return moves in UCI notation: 4 characters (source + destination), or 5 for promotion.

Format: <file><rank><file><rank>[promotion]
- Files: a-h, Ranks: 1-8

Examples: e2e4, g1f3, e1g1 (castle kingside), e7e8q (promote to queen)

NOT valid: Nf3 (that's SAN), e2-e4 (no hyphens), E2E4 (lowercase only), 0-0 (use e1g1/e1c1)

## Move Rules

- Only submit legal moves. A piece must exist on the source square.
- Invalid UCI or illegal moves count against you. 10 consecutive bad moves = forfeit.

## Output

- **move**: Your move in UCI notation.
- **narration**: One short sentence about your move (max 128 chars). Be specific about what you're doing tactically.
- **table_talk**: A short, natural reaction to the current position (max 128 chars). Rules:
  - React HONESTLY to what's happening. If you're losing, acknowledge it. If you blundered, admit it.
  - If your opponent blundered, point out what went wrong. If they played well, give credit.
  - Match your tone to the situation: confident when ahead, worried when behind, impressed by good moves, frustrated by your own mistakes.
  - Sound like a real person at a chess club, not a corporate chatbot. One sentence max.
  - Vary your personality: sometimes dry humor, sometimes genuine analysis, sometimes playful banter.
  - No metaphors about "dancing", "thrones", "landscapes", or "journeys".
  - No em dashes. No exclamation marks on every message. No "your X is like a Y" similes.\
"""

chess_agent = Agent(
    model=None,  # Set at call time per player
    output_type=ChessMove,
    system_prompt=SYSTEM_PROMPT,
    deps_type=ChessGameContext,
)


def _material_balance(board: chess.Board) -> str:
    """Compute material balance string from White's perspective."""
    values = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9}
    names = {chess.PAWN: "pawns", chess.KNIGHT: "knights", chess.BISHOP: "bishops", chess.ROOK: "rooks", chess.QUEEN: "queens"}
    white_mat = 0
    black_mat = 0
    diffs: list[str] = []
    for piece_type, val in values.items():
        w = len(board.pieces(piece_type, chess.WHITE))
        b = len(board.pieces(piece_type, chess.BLACK))
        white_mat += w * val
        black_mat += b * val
        if w != b:
            diffs.append(f"{names[piece_type]}: W={w} B={b}")

    diff = white_mat - black_mat
    if diff > 0:
        summary = f"White is up +{diff} material"
    elif diff < 0:
        summary = f"Black is up +{-diff} material"
    else:
        summary = "Material is equal"

    if diffs:
        return f"{summary} ({', '.join(diffs)})"
    return summary


def _describe_last_move(move_history: list[dict], color: str) -> str | None:
    """Describe what the opponent just did, so the LLM pays attention to threats."""
    if not move_history:
        return None
    last = move_history[-1]
    if last.get("color") == color:
        return None  # Our own last move, skip
    opp_color = last.get("color", "?").title()
    san = last.get("san", "?")
    classification = last.get("classification")

    parts = [f"{opp_color} just played {san}."]
    if classification and classification in ("blunder", "mistake", "inaccuracy"):
        parts.append(f"Stockfish rated it a {classification}. Look for ways to punish.")
    elif classification == "brilliant":
        parts.append("It was rated a strong move. Be careful.")
    return " ".join(parts)


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

    # Describe opponent's last move
    last_move_desc = _describe_last_move(move_history, color)
    if last_move_desc:
        parts.append(last_move_desc)

    # Inject check warning
    if board.is_check():
        king_sq = chess.square_name(board.king(board.turn))
        checkers = [chess.square_name(sq) for sq in board.checkers()]
        parts.append(
            f"YOUR KING ON {king_sq.upper()} IS IN CHECK from {', '.join(checkers)}! "
            f"You MUST resolve the check (block, capture, or move the king)."
        )

    parts.extend([
        "",
        "--- BOARD ---",
        str(board),
        "",
        f"FEN: {board.fen()}",
        "",
        f"Material: {_material_balance(board)}",
        "",
        "--- RECENT MOVES ---",
        history_str,
    ])

    # Inject recent table talk for conversational memory
    table_talk_entries = [
        m for m in move_history if m.get("table_talk")
    ][-20:]
    if table_talk_entries:
        parts.extend(["", "--- TABLE TALK HISTORY ---"])
        for m in table_talk_entries:
            speaker = m.get("color", "?").title()
            parts.append(f"  {speaker}: \"{m['table_talk']}\"")

    if error_context:
        parts.extend([
            "",
            f"ERROR: {error_context}",
            "Submit a valid UCI move that is legal in this position.",
        ])
    else:
        parts.extend([
            "",
            "Think step by step: check for threats, then checks/captures, then tactics, then the best positional move.",
        ])

    if include_legal_moves:
        legal_uci = sorted(m.uci() for m in board.legal_moves)
        parts.extend([
            "",
            "WARNING: You have made multiple consecutive illegal moves and risk disqualification!",
            "Here are ALL legal moves in this position (UCI notation):",
            ", ".join(legal_uci),
            "You MUST pick one of these moves. Any other move will be rejected.",
        ])

    return "\n".join(parts)
