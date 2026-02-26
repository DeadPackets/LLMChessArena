from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
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

router = APIRouter(prefix="/api/games", tags=["games"])


@router.post("", response_model=GameCreatedResponse)
async def create_game(req: CreateGameRequest, request: Request):
    """Start a new game between two LLM models."""
    manager = request.app.state.game_manager
    config = GameConfig(
        white_model=req.white_model,
        black_model=req.black_model,
        max_moves=req.max_moves,
    )
    game_id = await manager.start_game(config)
    return GameCreatedResponse(id=game_id, status="active")


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
        pgn=game.pgn,
        moves=[
            MoveDetail(
                move_number=m.move_number,
                color=m.color,
                uci=m.uci,
                san=m.san,
                fen_after=m.fen_after,
                narration=m.narration,
                trash_talk=m.trash_talk,
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


@router.post("/{game_id}/stop")
async def stop_game(game_id: str, request: Request):
    """Force-stop an active game."""
    manager = request.app.state.game_manager
    stopped = await manager.stop_game(game_id)
    if not stopped:
        raise HTTPException(404, "Game not found or already completed")
    return {"status": "stopped"}
