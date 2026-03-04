"""Open Graph meta tag endpoint for social media crawlers.

Serves minimal HTML with OG tags for game pages. nginx routes crawler
traffic here; real users are redirected to the SPA via <meta refresh>.
"""

from __future__ import annotations

import json
import logging
from html import escape

from fastapi import APIRouter, Depends
from fastapi.responses import HTMLResponse
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/og", tags=["opengraph"])

SITE_URL = "https://llmchess.deadpackets.pw"
SITE_NAME = "LLM Chess Arena"
DEFAULT_DESCRIPTION = "Watch AI models battle in chess \u2014 real-time evaluation, table talk, and deep analysis."
DEFAULT_IMAGE = f"{SITE_URL}/og-default.png"


def _fmt_model(model_id: str) -> str:
    """'openai/gpt-4o' -> 'gpt-4o'"""
    return model_id.split("/")[-1] if "/" in model_id else model_id


def _fmt_termination(t: str | None) -> str:
    if not t:
        return ""
    return {
        "checkmate": "checkmate",
        "stalemate": "stalemate",
        "insufficient_material": "insufficient material",
        "repetition": "repetition",
        "fifty_moves": "fifty-move rule",
        "max_moves": "move limit",
        "illegal_moves": "illegal moves",
        "timeout": "timeout",
        "resignation": "resignation",
        "adjudication": "adjudication",
        "king_captured": "king captured",
    }.get(t, t.replace("_", " "))


def _player_name(game: Game, color: str) -> str:
    model = game.white_model if color == "white" else game.black_model
    is_human = game.white_is_human if color == "white" else game.black_is_human
    is_sf = game.white_is_stockfish if color == "white" else game.black_is_stockfish
    sf_elo = game.white_stockfish_elo if color == "white" else game.black_stockfish_elo
    if is_human:
        return "Human"
    if is_sf:
        return f"Stockfish ({sf_elo})" if sf_elo else "Stockfish"
    return _fmt_model(model)


def _build_title(game: Game) -> str:
    white = _player_name(game, "white")
    black = _player_name(game, "black")
    moves = game.total_moves or 0

    if game.status == "active":
        return f"LIVE: {white} vs {black}"
    if game.status == "stopped":
        return f"{white} vs {black} \u2014 Stopped"

    if game.outcome and "white" in game.outcome:
        verb = "defeats" if game.termination == "checkmate" else "beats"
        by = f" by {_fmt_termination(game.termination)}" if game.termination else ""
        mv = f" in {moves} moves" if moves else ""
        return f"{white} {verb} {black}{by}{mv}"
    if game.outcome and "black" in game.outcome:
        verb = "defeats" if game.termination == "checkmate" else "beats"
        by = f" by {_fmt_termination(game.termination)}" if game.termination else ""
        mv = f" in {moves} moves" if moves else ""
        return f"{black} {verb} {white}{by}{mv}"
    if game.outcome == "draw":
        mv = f" in {moves} moves" if moves else ""
        return f"{white} vs {black} \u2014 Draw{mv}"

    return f"{white} vs {black}"


def _build_description(game: Game) -> str:
    parts = []
    if game.opening_name:
        parts.append(game.opening_name)
    if game.total_moves:
        parts.append(f"{game.total_moves} moves")
    if game.status == "active":
        parts.append("Game in progress")
    elif game.termination:
        parts.append(_fmt_termination(game.termination).capitalize())
    if parts:
        return " | ".join(parts) + " \u2014 LLM Chess Arena"
    return DEFAULT_DESCRIPTION


def _og_html(title: str, description: str, url: str, image_url: str, canonical: str) -> str:
    t = escape(title)
    d = escape(description)
    u = escape(url)
    img = escape(image_url)
    c = escape(canonical)
    js_url = json.dumps(canonical)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>{t} \u2014 {escape(SITE_NAME)}</title>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="{escape(SITE_NAME)}"/>
<meta property="og:title" content="{t}"/>
<meta property="og:description" content="{d}"/>
<meta property="og:url" content="{u}"/>
<meta property="og:image" content="{img}"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="{t}"/>
<meta name="twitter:description" content="{d}"/>
<meta name="twitter:image" content="{img}"/>
<meta http-equiv="refresh" content="0;url={c}"/>
<link rel="canonical" href="{c}"/>
</head>
<body>
<p>Redirecting to <a href="{c}">{t}</a>...</p>
<script>window.location.replace({js_url})</script>
</body>
</html>"""


@router.get("/game/{game_id}", response_class=HTMLResponse)
async def og_game(game_id: str, session: AsyncSession = Depends(get_session)):
    """Serve OG-tagged HTML for a game page. Used by social crawlers."""
    canonical = f"{SITE_URL}/game/{game_id}"

    game = await session.get(Game, game_id)
    if not game:
        return HTMLResponse(_og_html(
            title=SITE_NAME,
            description=DEFAULT_DESCRIPTION,
            url=SITE_URL,
            image_url=DEFAULT_IMAGE,
            canonical=canonical,
        ))

    title = _build_title(game)
    description = _build_description(game)
    image_url = f"{SITE_URL}/api/games/{game_id}/board.png?og=1"

    return HTMLResponse(_og_html(
        title=title,
        description=description,
        url=canonical,
        image_url=image_url,
        canonical=canonical,
    ))
