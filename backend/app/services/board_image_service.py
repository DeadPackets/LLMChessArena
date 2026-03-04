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

OG_WIDTH = 1200
OG_HEIGHT = 630
BG_COLOR = "#08090d"


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


def generate_board_og_png(
    fen: str = chess.STARTING_FEN,
    last_move_uci: str | None = None,
) -> bytes:
    """Generate a 1200x630 OG image with the board centered on a dark background."""
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

    board_size = 560
    board_svg = chess.svg.board(
        board,
        size=board_size,
        lastmove=last_move,
        check=check_square,
        colors=BOARD_COLORS,
        coordinates=True,
    )

    # Strip the outer <svg> wrapper so we can embed the content
    # python-chess wraps in <svg ...>...</svg>
    inner = board_svg
    if inner.startswith("<?xml"):
        inner = inner[inner.index("?>") + 2 :].strip()

    x_offset = (OG_WIDTH - board_size) // 2
    y_offset = (OG_HEIGHT - board_size) // 2

    wrapper = f"""<svg xmlns="http://www.w3.org/2000/svg"
         width="{OG_WIDTH}" height="{OG_HEIGHT}"
         viewBox="0 0 {OG_WIDTH} {OG_HEIGHT}">
      <rect width="{OG_WIDTH}" height="{OG_HEIGHT}" fill="{BG_COLOR}"/>
      <g transform="translate({x_offset},{y_offset})">
        {inner}
      </g>
    </svg>"""

    return cairosvg.svg2png(
        bytestring=wrapper.encode("utf-8"),
        output_width=OG_WIDTH,
        output_height=OG_HEIGHT,
    )
