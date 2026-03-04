"""Board image generation: FEN -> SVG (python-chess) -> PNG (cairosvg)."""

from __future__ import annotations

import chess
import chess.svg
import cairosvg

# Board colors matching the site's dark theme
BOARD_COLORS = {
    "square light": "#b8c0c8",
    "square dark": "#5c6670",
    "margin": "#08090d",
}


def generate_board_png(
    fen: str = chess.STARTING_FEN,
    size: int = 600,
    last_move_uci: str | None = None,
) -> bytes:
    """Generate a PNG image of a chess board from a FEN string.

    Returns PNG bytes.
    """
    board = chess.Board(fen)

    last_move = None
    if last_move_uci:
        try:
            last_move = chess.Move.from_uci(last_move_uci)
        except (ValueError, chess.InvalidMoveError):
            pass

    check_square = None
    if board.is_check():
        check_square = board.king(board.turn)

    svg_str = chess.svg.board(
        board,
        size=size,
        lastmove=last_move,
        check=check_square,
        colors=BOARD_COLORS,
        coordinates=True,
    )

    return cairosvg.svg2png(
        bytestring=svg_str.encode("utf-8"),
        output_width=size,
        output_height=size,
    )
