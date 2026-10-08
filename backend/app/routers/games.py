from __future__ import annotations

import asyncio
import hashlib
import ipaddress
import logging
import secrets
from datetime import datetime, timedelta, timezone

import httpx

import chess
from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import func
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.config import (
    ADMIN_TOKEN,
    GAMES_PER_DAY,
    MAX_MOVES_PER_SIDE,
    TURNSTILE_HOSTNAMES,
    TURNSTILE_SECRET_KEY,
    TURNSTILE_SITE_KEY,
    MIN_MOVE_TIME_LIMIT,
    MAX_MOVE_TIME_LIMIT,
)
from app.database import Game, Move, LLMRequest, get_session, get_session_factory
from app.models.api_models import (
    CreateGameRequest,
    GameCreatedResponse,
    GameDetail,
    GameEfficiency,
    GameSummary,
    MoveDetail,
    PaginatedGamesResponse,
)
from app.middleware.rate_limiter import _get_client_ip
from app.models.chess_models import GameConfig
from app.services import openrouter_key
from app.routers import openrouter_proxy
from app.services.request_stats import get_game_usage, summarize_requests
from app.services.board_image_service import generate_board_png, generate_board_og_png
from app.services.stats_service import compute_game_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])

# Serializes quota check + insert so parallel POSTs cannot both pass.
_create_lock = asyncio.Lock()
# Games that ended through our fault do not use up the creator's quota.
_QUOTA_EXEMPT_TERMINATIONS = ("llm_unavailable", "server_restart", "error")


def _creator_hash(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
        # One IPv6 subscriber usually owns a whole /64.
        if addr.version == 6:
            ip = str(ipaddress.ip_network(f"{ip}/64", strict=False).network_address)
    except ValueError:
        pass
    return hashlib.sha256(f"llmchessarena:{ip}".encode()).hexdigest()


TURNSTILE_ACTION = "create_game"


async def _verify_turnstile(token: str | None, ip: str) -> bool:
    if not token or len(token) > 2048:
        return False
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                data={"secret": TURNSTILE_SECRET_KEY, "response": token, "remoteip": ip},
            )
        if not resp.is_success:
            return False
        data = resp.json()
        # Cloudflare's test keys return no action; real widgets must echo ours.
        action_ok = data.get("action") == TURNSTILE_ACTION or data.get("metadata", {}).get("result_with_testing_key")
        return data.get("success") is True and bool(action_ok) and data.get("hostname") in TURNSTILE_HOSTNAMES
    except (httpx.HTTPError, ValueError):
        logger.warning("Turnstile verification request failed", exc_info=True)
        return False


async def _quota_retry_after(creator_hash: str) -> int | None:
    """Seconds until this creator may start another game, or None if allowed now."""
    since = datetime.now(timezone.utc) - timedelta(hours=24)
    async with get_session_factory()() as session:
        rows = (await session.exec(
            select(Game.started_at)
            .where(Game.creator_ip_hash == creator_hash, Game.started_at >= since)
            .where((Game.termination == None) | (Game.termination.notin_(_QUOTA_EXEMPT_TERMINATIONS)))  # type: ignore[union-attr]  # noqa: E711
            .order_by(Game.started_at)  # type: ignore[arg-type]
        )).all()
    if len(rows) < GAMES_PER_DAY:
        return None
    oldest = rows[-GAMES_PER_DAY]
    if oldest.tzinfo is None:
        oldest = oldest.replace(tzinfo=timezone.utc)
    return max(1, int((oldest + timedelta(hours=24) - datetime.now(timezone.utc)).total_seconds()))


@router.post("", response_model=GameCreatedResponse)
async def create_game(
    req: CreateGameRequest,
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    """Start a new game. At least one side must be an LLM."""
    white_is_llm = not req.white_is_human and not req.white_is_stockfish
    black_is_llm = not req.black_is_human and not req.black_is_stockfish
    if not white_is_llm and not black_is_llm:
        raise HTTPException(400, "At least one side must be an LLM")
    if req.white_is_human and req.white_is_stockfish:
        raise HTTPException(400, "A side cannot be both human and Stockfish")
    if req.black_is_human and req.black_is_stockfish:
        raise HTTPException(400, "A side cannot be both human and Stockfish")
    if white_is_llm and not req.white_model.strip():
        raise HTTPException(400, "White model is required for LLM side")
    if black_is_llm and not req.black_model.strip():
        raise HTTPException(400, "Black model is required for LLM side")
    if any(m.endswith(":batch") for m in (req.white_model, req.black_model)):
        raise HTTPException(400, "Batch model variants cannot play live games")
    if req.max_moves > MAX_MOVES_PER_SIDE:
        raise HTTPException(
            400,
            f"max_moves cannot exceed {MAX_MOVES_PER_SIDE} per side",
        )
    if req.move_time_limit is not None and not (
        MIN_MOVE_TIME_LIMIT <= req.move_time_limit <= MAX_MOVE_TIME_LIMIT
    ):
        raise HTTPException(
            400,
            f"move_time_limit must be between {MIN_MOVE_TIME_LIMIT:g} and {MAX_MOVE_TIME_LIMIT:g} seconds",
        )

    white_label = (
        "Human"
        if req.white_is_human
        else "Stockfish"
        if req.white_is_stockfish
        else req.white_model
    )
    black_label = (
        "Human"
        if req.black_is_human
        else "Stockfish"
        if req.black_is_stockfish
        else req.black_model
    )
    logger.info(
        "API: create game — %s vs %s (max %d moves)",
        white_label,
        black_label,
        req.max_moves,
    )
    manager = request.app.state.game_manager
    queue_state = manager.queue_status()
    if (
        not manager.can_accept_new_game()
        and queue_state["active"] >= queue_state["max"]
    ):
        raise HTTPException(429, "Game queue is full. Please try again later.")
    catalog = {m["id"]: m for m in await openrouter_proxy._fetch_models()}
    efforts = {}
    for color, is_llm in (("white", white_is_llm), ("black", black_is_llm)):
        try:
            efforts[color] = openrouter_proxy.normalize_reasoning_effort(
                catalog.get(getattr(req, f"{color}_model")),
                getattr(req, f"{color}_reasoning_effort"),
            ) if is_llm else None
        except ValueError as exc:
            raise HTTPException(400, f"{color.capitalize()}: {exc}") from exc
    config = GameConfig(
        white_model=req.white_model,
        black_model=req.black_model,
        max_moves=req.max_moves,
        white_temperature=req.white_temperature,
        black_temperature=req.black_temperature,
        white_reasoning_effort=efforts["white"],
        black_reasoning_effort=efforts["black"],
        white_is_human=req.white_is_human,
        black_is_human=req.black_is_human,
        white_is_stockfish=req.white_is_stockfish,
        black_is_stockfish=req.black_is_stockfish,
        white_stockfish_elo=req.white_stockfish_elo,
        black_stockfish_elo=req.black_stockfish_elo,
        chaos_mode=req.chaos_mode,
        move_time_limit=req.move_time_limit,
        draw_adjudication=req.draw_adjudication,
        use_nitro=req.use_nitro,
        routing_mode=req.routing_mode,
    )
    is_admin = bool(ADMIN_TOKEN) and secrets.compare_digest(ADMIN_TOKEN, x_admin_token or "")
    ip = _get_client_ip(request)
    if TURNSTILE_SECRET_KEY and not is_admin and not await _verify_turnstile(req.turnstile_token, ip):
        raise HTTPException(403, "Human verification failed. Please complete the check and try again.")
    unavailable = await openrouter_key.unavailable_reason()
    if unavailable:
        raise HTTPException(503, unavailable)

    player_secret = secrets.token_urlsafe(32)
    creator_hash = _creator_hash(ip)
    async with _create_lock:
        if GAMES_PER_DAY > 0 and not is_admin:
            retry_after = await _quota_retry_after(creator_hash)
            if retry_after is not None:
                hours, minutes = divmod(retry_after // 60, 60)
                raise HTTPException(
                    429,
                    f"You can start {GAMES_PER_DAY} game{'s' if GAMES_PER_DAY != 1 else ''} every 24 hours. "
                    f"Your next game is available in {hours}h {minutes}m.",
                    headers={"Retry-After": str(retry_after)},
                )
        try:
            game_id, game_status = await manager.start_game(
                config, player_secret=player_secret, creator_ip_hash=creator_hash
            )
        except ValueError as exc:
            raise HTTPException(429, str(exc)) from exc
    logger.info("API: game created — id=%s status=%s", game_id, game_status)
    return GameCreatedResponse(
        id=game_id,
        status=game_status,
        player_secret=player_secret,
    )


@router.get("", response_model=PaginatedGamesResponse)
async def list_games(
    status: str | None = None,
    model: str | None = None,
    outcome: str | None = None,
    opening: str | None = None,
    q: str | None = None,
    limit: int = 20,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """List games with pagination, optionally filtered by status, model, outcome, opening, or search query."""
    # Build base filter conditions
    conditions = []
    if status:
        conditions.append(Game.status == status)
    if model:
        conditions.append((Game.white_model == model) | (Game.black_model == model))
    if outcome:
        conditions.append(Game.outcome == outcome)
    if opening:
        conditions.append(Game.opening_eco == opening)
    if q:
        # Search by model name or opening name (case-insensitive)
        like_pattern = f"%{q}%"
        conditions.append(
            Game.white_model.ilike(like_pattern)  # type: ignore[union-attr]
            | Game.black_model.ilike(like_pattern)  # type: ignore[union-attr]
            | Game.opening_name.ilike(like_pattern)  # type: ignore[union-attr]
            | Game.opening_eco.ilike(like_pattern)  # type: ignore[union-attr]
        )

    # Count query
    count_query = select(func.count()).select_from(Game)
    for cond in conditions:
        count_query = count_query.where(cond)
    count_result = await session.exec(count_query)  # type: ignore[arg-type]
    total_count = count_result.one()

    # Data query
    query = select(Game).order_by(Game.started_at.desc()).limit(limit).offset(offset)  # type: ignore[union-attr]
    for cond in conditions:
        query = query.where(cond)

    results = await session.exec(query)
    rows = results.all()

    games = [
        GameSummary(
            id=r.id,
            white_model=r.white_model,
            black_model=r.black_model,
            status=r.status,
            outcome=r.outcome,
            termination=r.termination,
            opening_eco=r.opening_eco,
            opening_name=r.opening_name,
            total_moves=r.total_moves or 0,
            started_at=r.started_at,
            completed_at=r.completed_at,
            white_temperature=r.white_temperature,
            black_temperature=r.black_temperature,
            white_reasoning_effort=r.white_reasoning_effort,
            black_reasoning_effort=r.black_reasoning_effort,
            routing_mode=r.routing_mode,
            use_nitro=r.use_nitro,
            harness_version=r.harness_version,
            white_is_human=bool(r.white_is_human),
            black_is_human=bool(r.black_is_human),
            white_is_stockfish=bool(r.white_is_stockfish),
            black_is_stockfish=bool(r.black_is_stockfish),
            white_stockfish_elo=r.white_stockfish_elo,
            black_stockfish_elo=r.black_stockfish_elo,
            chaos_mode=bool(r.chaos_mode),
            move_time_limit=r.move_time_limit,
            draw_adjudication=bool(r.draw_adjudication)
            if r.draw_adjudication is not None
            else True,
        )
        for r in rows
    ]

    # Enrich active games with live move count + latest eval
    active_ids = [g.id for g in games if g.status == "active"]
    if active_ids:
        sub = (
            select(
                Move.game_id,
                func.count().label("move_count"),
                func.max(Move.id).label("max_id"),
            )
            .where(Move.game_id.in_(active_ids))
            .group_by(Move.game_id)
            .subquery()
        )
        enrich_results = await session.exec(
            select(sub.c.game_id, sub.c.move_count, Move.centipawns, Move.mate_in)  # type: ignore[arg-type]
            .outerjoin(Move, Move.id == sub.c.max_id)
        )
        enrich = {r.game_id: r for r in enrich_results.all()}
        for g in games:
            if g.id in enrich:
                r = enrich[g.id]
                g.live_move_count = r.move_count
                g.current_eval_cp = r.centipawns
                g.current_mate_in = r.mate_in

    return PaginatedGamesResponse(
        games=games,
        total_count=total_count,
        has_more=(offset + limit) < total_count,
    )


@router.get("/queue-status")
async def queue_status(
    request: Request, session: AsyncSession = Depends(get_session)
):
    """Return the current game queue state plus live activity counts."""
    manager = request.app.state.game_manager
    state = manager.queue_status()
    total_games = (
        await session.exec(select(func.count()).select_from(Game))
    ).one()
    state["total_spectators"] = manager.total_spectators()
    state["total_games"] = int(total_games)
    state["llm_unavailable"] = await openrouter_key.unavailable_reason()
    state["turnstile_site_key"] = TURNSTILE_SITE_KEY or None
    state["games_per_day"] = GAMES_PER_DAY
    return state


@router.get("/{game_id}/board.png")
async def get_board_image(
    game_id: str, og: bool = False, session: AsyncSession = Depends(get_session)
):
    """Generate a PNG image of the current/final board position.

    Pass ?og=1 for a 1200x630 OG-sized image with dark background.
    """
    game = await session.get(Game, game_id)
    if not game:
        gen = generate_board_og_png if og else generate_board_png
        png = gen()
        return Response(
            content=png,
            media_type="image/png",
            headers={"Cache-Control": "public, max-age=3600"},
        )

    results = await session.exec(
        select(Move).where(Move.game_id == game_id).order_by(Move.id.desc()).limit(1)  # type: ignore[arg-type]
    )
    last_move = results.first()

    fen = last_move.fen_after if last_move else chess.STARTING_FEN
    last_uci = last_move.uci if last_move else None

    if og:
        png = generate_board_og_png(fen=fen, last_move_uci=last_uci)
    else:
        png = generate_board_png(fen=fen, last_move_uci=last_uci)

    if game.status == "completed":
        cache = "public, max-age=604800, immutable"
    else:
        cache = "public, max-age=30"

    return Response(
        content=png, media_type="image/png", headers={"Cache-Control": cache}
    )


@router.get("/{game_id}/efficiency", response_model=GameEfficiency)
async def get_game_efficiency(game_id: str, session: AsyncSession = Depends(get_session)):
    if not await session.get(Game, game_id):
        raise HTTPException(404, "Game not found")
    records = (await session.exec(select(LLMRequest).where(LLMRequest.game_id == game_id))).all()
    moves = (await session.exec(select(Move).where(Move.game_id == game_id))).all()
    return summarize_requests(records, moves)


@router.get("/{game_id}", response_model=GameDetail)
async def get_game(game_id: str, session: AsyncSession = Depends(get_session)):
    """Get full game details including all moves and evaluations."""
    game = await session.get(Game, game_id)
    if not game:
        raise HTTPException(404, "Game not found")

    results = await session.exec(
        select(Move).where(Move.game_id == game_id).order_by(Move.id)  # type: ignore[arg-type]
    )
    move_rows = results.all()

    analysis = None
    if game.status == "completed":
        analysis = await compute_game_analysis(session, game_id)

    return GameDetail(
        id=game.id,
        white_model=game.white_model,
        black_model=game.black_model,
        status=game.status,
        outcome=game.outcome,
        termination=game.termination,
        opening_eco=game.opening_eco,
        opening_name=game.opening_name,
        total_moves=game.total_moves or 0,
        started_at=game.started_at,
        completed_at=game.completed_at,
        white_temperature=game.white_temperature,
        black_temperature=game.black_temperature,
        white_reasoning_effort=game.white_reasoning_effort,
        black_reasoning_effort=game.black_reasoning_effort,
        routing_mode=game.routing_mode,
        use_nitro=game.use_nitro,
        harness_version=game.harness_version,
        white_is_human=bool(game.white_is_human),
        black_is_human=bool(game.black_is_human),
        white_is_stockfish=bool(game.white_is_stockfish),
        black_is_stockfish=bool(game.black_is_stockfish),
        white_stockfish_elo=game.white_stockfish_elo,
        black_stockfish_elo=game.black_stockfish_elo,
        chaos_mode=bool(game.chaos_mode),
        move_time_limit=game.move_time_limit,
        draw_adjudication=bool(game.draw_adjudication)
        if game.draw_adjudication is not None
        else True,
        pgn=game.pgn,
        moves=[
            MoveDetail(
                move_number=m.move_number,
                color=m.color,
                uci=m.uci,
                san=m.san,
                fen_after=m.fen_after,
                narration=m.narration,
                table_talk=m.table_talk,
                centipawns=m.centipawns,
                mate_in=m.mate_in,
                win_probability=m.win_probability,
                centipawns_before=m.centipawns_before,
                mate_in_before=m.mate_in_before,
                win_probability_before=m.win_probability_before,
                best_move_uci=m.best_move_uci,
                classification=m.classification,
                response_time_ms=m.response_time_ms or 0,
                opening_eco=m.opening_eco,
                opening_name=m.opening_name,
                input_tokens=m.input_tokens,
                output_tokens=m.output_tokens,
                cost_usd=m.cost_usd,
                is_chaos_move=bool(m.is_chaos_move),
            )
            for m in move_rows
        ],
        **await get_game_usage(session, game),
        analysis=analysis,
    )


@router.get("/{game_id}/pgn")
async def get_pgn(game_id: str, session: AsyncSession = Depends(get_session)):
    """Export game as PGN text."""
    game = await session.get(Game, game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    if not game.pgn:
        raise HTTPException(404, "PGN not available yet (game still in progress)")

    return PlainTextResponse(game.pgn, media_type="application/x-chess-pgn")


class StopGameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player_secret: str


@router.post("/{game_id}/stop")
async def stop_game(game_id: str, body: StopGameRequest, request: Request):
    """Force-stop an active game. Requires the creator's player secret."""
    logger.info("API: stop game — id=%s", game_id)
    manager = request.app.state.game_manager
    async with get_session_factory()() as session:
        game = await session.get(Game, game_id)
    if not game:
        raise HTTPException(404, "Game not found")
    if game.status in {"completed", "stopped"}:
        raise HTTPException(409, f"Game already {game.status}")
    if not await manager.validate_player_secret(game_id, body.player_secret):
        raise HTTPException(403, "Unauthorized")
    stopped = await manager.stop_game(game_id)
    if not stopped:
        raise HTTPException(409, "Game is not currently running")
    logger.info("API: game stopped — id=%s", game_id)
    return {"status": "stopped"}


@router.delete("/{game_id}", status_code=204)
async def delete_game(
    game_id: str,
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    """Admin: hard-delete a game and all its moves. Requires the X-Admin-Token header.

    Cancels the game first if it is still running. If the deleted game was rated,
    ELO is recomputed from scratch (ratings are path-dependent). Returns 404
    (feature disabled) unless ADMIN_TOKEN is configured on the server.
    """
    if not ADMIN_TOKEN:
        raise HTTPException(404, "Not found")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(403, "Unauthorized")
    manager = request.app.state.game_manager
    deleted = await manager.delete_game(game_id)
    if not deleted:
        raise HTTPException(404, "Game not found")
    logger.info("API: game deleted by admin — id=%s", game_id)
    return Response(status_code=204)


@router.post("/recompute-elo")
async def recompute_elo(
    request: Request,
    x_admin_token: str | None = Header(default=None),
):
    """Admin: rebuild every model's ELO and leaderboard identity from scratch.

    Replays all eligible rated games under the current rules — including the
    split-by-reasoning-effort identity and the temperature-must-be-default rated
    rule — so existing data migrates to the new leaderboard convention. Idempotent.
    Returns 404 (feature disabled) unless ADMIN_TOKEN is configured on the server.
    """
    if not ADMIN_TOKEN:
        raise HTTPException(404, "Not found")
    if not x_admin_token or not secrets.compare_digest(x_admin_token, ADMIN_TOKEN):
        raise HTTPException(403, "Unauthorized")
    manager = request.app.state.game_manager
    await manager.recompute_all_elo()
    logger.info("API: ELO recomputed by admin")
    return {"status": "recomputed"}
