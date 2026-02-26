from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, LLMModel, get_session
from app.models.api_models import (
    EnhancedModelStats,
    GameSummary,
    HeadToHeadRecord,
    ModelDetailStats,
    ModelStats,
)
from app.services.stats_service import (
    compute_head_to_head,
    compute_model_aggregate_stats,
)

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=list[ModelStats])
async def list_models(session: AsyncSession = Depends(get_session)):
    """List all models with their stats."""
    results = await session.exec(
        select(LLMModel).order_by(LLMModel.elo_rating.desc())  # type: ignore[union-attr]
    )
    rows = results.all()
    return [_row_to_stats(r) for r in rows]


@router.get("/leaderboard", response_model=list[EnhancedModelStats])
async def leaderboard(session: AsyncSession = Depends(get_session)):
    """Get models sorted by ELO rating with enhanced stats."""
    results = await session.exec(
        select(LLMModel)
        .where(LLMModel.games_played > 0)
        .order_by(LLMModel.elo_rating.desc())  # type: ignore[union-attr]
    )
    rows = results.all()

    enhanced = []
    for r in rows:
        base = _row_to_stats(r)
        agg = await compute_model_aggregate_stats(session, r.id)
        gp = r.games_played or 1
        enhanced.append(EnhancedModelStats(
            **base.model_dump(),
            avg_acpl=agg["avg_acpl"],
            avg_accuracy=agg["avg_accuracy"],
            avg_cost_per_game=agg["avg_cost_per_game"],
            avg_response_ms=agg["avg_response_ms"],
            illegal_move_rate=round((r.total_illegal_moves or 0) / gp, 2),
        ))
    return enhanced


@router.get("/{model_id:path}/head-to-head", response_model=list[HeadToHeadRecord])
async def head_to_head(model_id: str, session: AsyncSession = Depends(get_session)):
    """Get head-to-head records for a model against all opponents."""
    model = await session.get(LLMModel, model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    return await compute_head_to_head(session, model_id)


@router.get("/{model_id:path}", response_model=ModelDetailStats)
async def model_detail(model_id: str, session: AsyncSession = Depends(get_session)):
    """Get detailed stats for a specific model."""
    model = await session.get(LLMModel, model_id)
    if not model:
        raise HTTPException(404, "Model not found")

    base = _row_to_stats(model)
    agg = await compute_model_aggregate_stats(session, model_id)
    h2h = await compute_head_to_head(session, model_id)
    gp = model.games_played or 1

    # Recent games
    results = await session.exec(
        select(Game)
        .where(
            (Game.white_model == model_id) | (Game.black_model == model_id),
        )
        .order_by(Game.started_at.desc())  # type: ignore[union-attr]
        .limit(10)
    )
    recent = results.all()
    recent_summaries = [
        GameSummary(
            id=g.id,
            white_model=g.white_model,
            black_model=g.black_model,
            status=g.status,
            outcome=g.outcome,
            termination=g.termination,
            opening_eco=g.opening_eco,
            opening_name=g.opening_name,
            total_moves=g.total_moves or 0,
            started_at=g.started_at,
            completed_at=g.completed_at,
            white_is_human=bool(g.white_is_human),
            black_is_human=bool(g.black_is_human),
            white_is_stockfish=bool(g.white_is_stockfish),
            black_is_stockfish=bool(g.black_is_stockfish),
        )
        for g in recent
    ]

    return ModelDetailStats(
        **base.model_dump(),
        avg_acpl=agg["avg_acpl"],
        avg_accuracy=agg["avg_accuracy"],
        avg_cost_per_game=agg["avg_cost_per_game"],
        avg_response_ms=agg["avg_response_ms"],
        illegal_move_rate=round((model.total_illegal_moves or 0) / gp, 2),
        classifications=agg.get("classifications", {}),
        games_as_white=agg.get("games_as_white", 0),
        games_as_black=agg.get("games_as_black", 0),
        wins_as_white=agg.get("wins_as_white", 0),
        wins_as_black=agg.get("wins_as_black", 0),
        head_to_head=h2h,
        recent_games=recent_summaries,
    )


def _row_to_stats(r: LLMModel) -> ModelStats:
    gp = r.games_played or 0
    wins = r.wins or 0
    return ModelStats(
        id=r.id,
        display_name=r.display_name,
        elo_rating=r.elo_rating or 1500.0,
        games_played=gp,
        wins=wins,
        draws=r.draws or 0,
        losses=r.losses or 0,
        win_rate=round(wins / gp * 100, 1) if gp > 0 else 0.0,
        total_illegal_moves=r.total_illegal_moves or 0,
    )
