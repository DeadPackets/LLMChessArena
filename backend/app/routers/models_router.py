from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, LLMModel, get_session
from app.models.api_models import (
    EloHistoryPoint,
    EnhancedModelStats,
    GameSummary,
    HeadToHeadComparison,
    HeadToHeadRecord,
    ModelDetailStats,
    ModelStats,
)
from app.services.elo_service import raw_label_of, rating_key
from app.services.stats_service import (
    compute_badges,
    compute_elo_history,
    compute_elo_sparklines,
    compute_head_to_head,
    compute_model_aggregate_stats,
    compute_model_badge_inputs,
    compute_upset_wins,
)

router = APIRouter(prefix="/api/models", tags=["models"])


def _white_key(g: Game) -> str:
    """Composite leaderboard identity (model + reasoning tier) for a game's white side."""
    return rating_key(
        g.white_model,
        g.white_reasoning_effort,
        bool(g.white_is_human),
        bool(g.white_is_stockfish),
    )


def _black_key(g: Game) -> str:
    return rating_key(
        g.black_model,
        g.black_reasoning_effort,
        bool(g.black_is_human),
        bool(g.black_is_stockfish),
    )


def compute_h2h_streak(outcomes: list[str]) -> tuple[str | None, int]:
    """Current win streak in a matchup. ``outcomes`` newest-first as 'a'/'b'/'draw'."""
    if not outcomes or outcomes[0] == "draw":
        return None, 0
    leader = outcomes[0]
    count = 0
    for o in outcomes:
        if o != leader:
            break
        count += 1
    return leader, count


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

    sparks = await compute_elo_sparklines(session)
    upsets = await compute_upset_wins(session)
    enhanced = []
    for r in rows:
        base = _row_to_stats(r)
        agg = await compute_model_aggregate_stats(session, r.id)
        badge_inputs = await compute_model_badge_inputs(session, r.id)
        gp = r.games_played or 1
        enhanced.append(EnhancedModelStats(
            **base.model_dump(),
            avg_acpl=agg["avg_acpl"],
            avg_accuracy=agg["avg_accuracy"],
            avg_cost_per_game=agg["avg_cost_per_game"],
            avg_response_ms=agg["avg_response_ms"],
            illegal_move_rate=round((r.total_illegal_moves or 0) / gp, 2),
            elo_history=sparks.get(r.id, []),
            badges=compute_badges(
                games_played=r.games_played or 0,
                total_illegal_moves=r.total_illegal_moves or 0,
                avg_accuracy=agg["avg_accuracy"],
                upset_wins=upsets.get(r.id, 0),
                **badge_inputs,
            ),
        ))
    return enhanced


@router.get("/compare", response_model=HeadToHeadComparison)
async def compare_models(
    model_a: str,
    model_b: str,
    session: AsyncSession = Depends(get_session),
):
    """Compare two models head-to-head."""
    ma = await session.get(LLMModel, model_a)
    mb = await session.get(LLMModel, model_b)
    if not ma or not mb:
        raise HTTPException(404, "One or both models not found")

    # Get direct matchups. Prefilter on raw labels (what the DB stores), then
    # match the composite identities (model + reasoning tier) in Python.
    raw_a = raw_label_of(model_a)
    raw_b = raw_label_of(model_b)
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            Game.chaos_mode != True,  # noqa: E712
            (
                ((Game.white_model == raw_a) & (Game.black_model == raw_b))
                | ((Game.white_model == raw_b) & (Game.black_model == raw_a))
            ),
        ).order_by(Game.completed_at.desc())  # type: ignore[union-attr]
    )
    games = [
        g
        for g in results.all()
        if {_white_key(g), _black_key(g)} == {model_a, model_b}
    ]

    a_wins = 0
    b_wins = 0
    draws = 0
    outcomes: list[str] = []  # newest-first ('a'/'b'/'draw'), for the streak
    for g in games:
        if _white_key(g) == model_a:
            if g.outcome and "white" in g.outcome:
                a_wins += 1
                outcomes.append("a")
            elif g.outcome and "black" in g.outcome:
                b_wins += 1
                outcomes.append("b")
            else:
                draws += 1
                outcomes.append("draw")
        else:
            if g.outcome and "black" in g.outcome:
                a_wins += 1
                outcomes.append("a")
            elif g.outcome and "white" in g.outcome:
                b_wins += 1
                outcomes.append("b")
            else:
                draws += 1
                outcomes.append("draw")
    streak_key, streak_count = compute_h2h_streak(outcomes)
    streak_model = (
        model_a if streak_key == "a" else model_b if streak_key == "b" else None
    )

    # Aggregate stats
    agg_a = await compute_model_aggregate_stats(session, model_a)
    agg_b = await compute_model_aggregate_stats(session, model_b)

    recent = [
        GameSummary(
            id=g.id, white_model=g.white_model, black_model=g.black_model,
            status=g.status, outcome=g.outcome, termination=g.termination,
            opening_eco=g.opening_eco, opening_name=g.opening_name,
            total_moves=g.total_moves or 0, started_at=g.started_at,
            completed_at=g.completed_at,
            white_is_human=bool(g.white_is_human), black_is_human=bool(g.black_is_human),
            white_is_stockfish=bool(g.white_is_stockfish), black_is_stockfish=bool(g.black_is_stockfish),
            chaos_mode=bool(g.chaos_mode),
        )
        for g in games[:10]
    ]

    return HeadToHeadComparison(
        model_a=model_a, model_b=model_b,
        model_a_display=ma.display_name, model_b_display=mb.display_name,
        model_a_elo=ma.elo_rating, model_b_elo=mb.elo_rating,
        model_a_wins=a_wins, model_b_wins=b_wins, draws=draws,
        total_games=len(games),
        model_a_avg_accuracy=agg_a.get("avg_accuracy"),
        model_b_avg_accuracy=agg_b.get("avg_accuracy"),
        model_a_avg_acpl=agg_a.get("avg_acpl"),
        model_b_avg_acpl=agg_b.get("avg_acpl"),
        streak_model=streak_model,
        streak_count=streak_count,
        recent_games=recent,
    )


@router.get("/{model_id:path}/elo-history", response_model=list[EloHistoryPoint])
async def elo_history(model_id: str, session: AsyncSession = Depends(get_session)):
    """Get ELO rating history for a model."""
    model = await session.get(LLMModel, model_id)
    if not model:
        raise HTTPException(404, "Model not found")
    return await compute_elo_history(session, model_id)


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
    badge_inputs = await compute_model_badge_inputs(session, model_id)
    upsets = await compute_upset_wins(session)
    gp = model.games_played or 1

    # Recent games. Prefilter on the raw label, match the composite identity in
    # Python, then take the latest 10 (the Python filter must precede the limit).
    raw = raw_label_of(model_id)
    results = await session.exec(
        select(Game)
        .where((Game.white_model == raw) | (Game.black_model == raw))
        .order_by(Game.started_at.desc())  # type: ignore[union-attr]
    )
    recent = [
        g
        for g in results.all()
        if _white_key(g) == model_id or _black_key(g) == model_id
    ][:10]
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
            chaos_mode=bool(g.chaos_mode),
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
        badges=compute_badges(
            games_played=model.games_played or 0,
            total_illegal_moves=model.total_illegal_moves or 0,
            avg_accuracy=agg["avg_accuracy"],
            upset_wins=upsets.get(model_id, 0),
            **badge_inputs,
        ),
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
