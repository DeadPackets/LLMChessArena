from __future__ import annotations

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, Move, get_session
from app.models.api_models import (
    CreateGameRequest,
    GameCreatedResponse,
    GameDetail,
    GameSummary,
    MoveDetail,
)
from app.models.chess_models import GameConfig
from app.services.stats_service import compute_game_analysis

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/games", tags=["games"])


@router.post("", response_model=GameCreatedResponse)
async def create_game(req: CreateGameRequest, request: Request):
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

    white_label = "Human" if req.white_is_human else "Stockfish" if req.white_is_stockfish else req.white_model
    black_label = "Human" if req.black_is_human else "Stockfish" if req.black_is_stockfish else req.black_model
    logger.info("API: create game — %s vs %s (max %d moves)", white_label, black_label, req.max_moves)
    manager = request.app.state.game_manager
    config = GameConfig(
        white_model=req.white_model,
        black_model=req.black_model,
        max_moves=req.max_moves,
        white_temperature=req.white_temperature,
        black_temperature=req.black_temperature,
        white_reasoning_effort=req.white_reasoning_effort,
        black_reasoning_effort=req.black_reasoning_effort,
        white_is_human=req.white_is_human,
        black_is_human=req.black_is_human,
        white_is_stockfish=req.white_is_stockfish,
        black_is_stockfish=req.black_is_stockfish,
    )
    player_secret = secrets.token_urlsafe(32)

    game_id = await manager.start_game(config, player_secret=player_secret)
    logger.info("API: game created — id=%s", game_id)
    return GameCreatedResponse(id=game_id, status="active", player_secret=player_secret)


@router.get("", response_model=list[GameSummary])
async def list_games(
    status: str | None = None,
    model: str | None = None,
    limit: int = 50,
    offset: int = 0,
    session: AsyncSession = Depends(get_session),
):
    """List games, optionally filtered by status or model."""
    query = select(Game).order_by(Game.started_at.desc()).limit(limit).offset(offset)  # type: ignore[union-attr]

    if status:
        query = query.where(Game.status == status)
    if model:
        query = query.where((Game.white_model == model) | (Game.black_model == model))

    results = await session.exec(query)
    rows = results.all()

    return [
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
            white_is_human=bool(r.white_is_human),
            black_is_human=bool(r.black_is_human),
            white_is_stockfish=bool(r.white_is_stockfish),
            black_is_stockfish=bool(r.black_is_stockfish),
        )
        for r in rows
    ]


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
        white_is_human=bool(game.white_is_human),
        black_is_human=bool(game.black_is_human),
        white_is_stockfish=bool(game.white_is_stockfish),
        black_is_stockfish=bool(game.black_is_stockfish),
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
                best_move_uci=m.best_move_uci,
                classification=m.classification,
                response_time_ms=m.response_time_ms or 0,
                opening_eco=m.opening_eco,
                opening_name=m.opening_name,
                input_tokens=m.input_tokens,
                output_tokens=m.output_tokens,
                cost_usd=m.cost_usd,
            )
            for m in move_rows
        ],
        total_cost_usd=game.total_cost_usd or 0.0,
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
    player_secret: str


@router.post("/{game_id}/stop")
async def stop_game(game_id: str, body: StopGameRequest, request: Request):
    """Force-stop an active game. Requires the creator's player secret."""
    logger.info("API: stop game — id=%s", game_id)
    manager = request.app.state.game_manager
    if not manager.validate_player_secret(game_id, body.player_secret):
        raise HTTPException(403, "Unauthorized")
    stopped = await manager.stop_game(game_id)
    if not stopped:
        raise HTTPException(404, "Game not found or already completed")
    logger.info("API: game stopped — id=%s", game_id)
    return {"status": "stopped"}
