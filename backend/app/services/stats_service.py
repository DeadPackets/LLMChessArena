from __future__ import annotations

import math
from collections import defaultdict

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, Move, LLMModel
from sqlalchemy import func as sa_func

from app.models.api_models import (
    CriticalMoment,
    GameAnalysis,
    HeadToHeadRecord,
    ModelCostBreakdown,
    PlatformOverview,
)


def compute_accuracy(acpl: float) -> float:
    """Chess.com accuracy formula."""
    if acpl < 0:
        return 100.0
    raw = 103.1668 * math.exp(-0.04354 * acpl) - 3.1669
    return max(0.0, min(100.0, raw))


async def compute_game_analysis(session: AsyncSession, game_id: str) -> GameAnalysis:
    """Compute full analysis stats for a completed game."""
    results = await session.exec(
        select(Move).where(Move.game_id == game_id).order_by(Move.id)  # type: ignore[arg-type]
    )
    moves = results.all()

    if not moves:
        return GameAnalysis()

    white_losses: list[float] = []
    black_losses: list[float] = []
    white_cls: dict[str, int] = {}
    black_cls: dict[str, int] = {}
    white_times: list[int] = []
    black_times: list[int] = []
    white_tokens = 0
    black_tokens = 0
    white_cost = 0.0
    black_cost = 0.0

    for i, move in enumerate(moves):
        cp_before = moves[i - 1].centipawns if i > 0 and moves[i - 1].centipawns is not None else 0
        cp_after = move.centipawns if move.centipawns is not None else cp_before

        if move.color == "white":
            loss = max(0, cp_before - cp_after)
            white_losses.append(loss)
            if move.classification:
                white_cls[move.classification] = white_cls.get(move.classification, 0) + 1
            white_times.append(move.response_time_ms or 0)
            white_tokens += (move.input_tokens or 0) + (move.output_tokens or 0)
            white_cost += move.cost_usd or 0.0
        else:
            loss = max(0, cp_after - cp_before)
            black_losses.append(loss)
            if move.classification:
                black_cls[move.classification] = black_cls.get(move.classification, 0) + 1
            black_times.append(move.response_time_ms or 0)
            black_tokens += (move.input_tokens or 0) + (move.output_tokens or 0)
            black_cost += move.cost_usd or 0.0

    white_acpl = sum(white_losses) / len(white_losses) if white_losses else None
    black_acpl = sum(black_losses) / len(black_losses) if black_losses else None

    # Critical moments: win probability swings >= 0.15
    critical: list[CriticalMoment] = []
    for i, move in enumerate(moves):
        wp_before = moves[i - 1].win_probability if i > 0 and moves[i - 1].win_probability is not None else 0.5
        wp_after = move.win_probability if move.win_probability is not None else wp_before
        swing = abs(wp_after - wp_before)
        if swing >= 0.15:
            critical.append(CriticalMoment(
                move_index=i,
                move_number=move.move_number,
                color=move.color,
                san=move.san,
                win_prob_before=round(wp_before, 4),
                win_prob_after=round(wp_after, 4),
                swing=round(swing, 4),
                classification=move.classification,
            ))
    critical.sort(key=lambda x: x.swing, reverse=True)

    return GameAnalysis(
        white_acpl=round(white_acpl, 1) if white_acpl is not None else None,
        black_acpl=round(black_acpl, 1) if black_acpl is not None else None,
        white_accuracy=round(compute_accuracy(white_acpl), 1) if white_acpl is not None else None,
        black_accuracy=round(compute_accuracy(black_acpl), 1) if black_acpl is not None else None,
        white_classifications=white_cls,
        black_classifications=black_cls,
        critical_moments=critical[:10],
        white_avg_response_ms=round(sum(white_times) / len(white_times), 0) if white_times else 0,
        black_avg_response_ms=round(sum(black_times) / len(black_times), 0) if black_times else 0,
        white_total_tokens=white_tokens,
        black_total_tokens=black_tokens,
        white_total_cost=round(white_cost, 6),
        black_total_cost=round(black_cost, 6),
    )


async def compute_model_aggregate_stats(session: AsyncSession, model_id: str) -> dict:
    """Compute aggregate stats for a model across all completed games."""
    # Get all completed games this model played in
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            (Game.white_model == model_id) | (Game.black_model == model_id),
        )
    )
    games = results.all()

    if not games:
        return {"avg_acpl": None, "avg_accuracy": None, "avg_cost_per_game": 0.0, "avg_response_ms": 0.0}

    game_ids = [g.id for g in games]

    # Get all moves from those games
    all_losses: list[float] = []
    all_times: list[int] = []
    total_cost = 0.0
    total_classifications: dict[str, int] = {}
    games_as_white = 0
    games_as_black = 0
    wins_as_white = 0
    wins_as_black = 0

    for game in games:
        is_white = game.white_model == model_id
        color = "white" if is_white else "black"

        if is_white:
            games_as_white += 1
            if game.outcome and "white" in game.outcome:
                wins_as_white += 1
        else:
            games_as_black += 1
            if game.outcome and "black" in game.outcome:
                wins_as_black += 1

        results = await session.exec(
            select(Move).where(Move.game_id == game.id).order_by(Move.id)  # type: ignore[arg-type]
        )
        moves = results.all()

        for i, move in enumerate(moves):
            if move.color != color:
                continue

            cp_before = moves[i - 1].centipawns if i > 0 and moves[i - 1].centipawns is not None else 0
            cp_after = move.centipawns if move.centipawns is not None else cp_before

            if color == "white":
                loss = max(0, cp_before - cp_after)
            else:
                loss = max(0, cp_after - cp_before)

            all_losses.append(loss)
            all_times.append(move.response_time_ms or 0)
            total_cost += move.cost_usd or 0.0

            if move.classification:
                total_classifications[move.classification] = total_classifications.get(move.classification, 0) + 1

    avg_acpl = sum(all_losses) / len(all_losses) if all_losses else None
    avg_accuracy = round(compute_accuracy(avg_acpl), 1) if avg_acpl is not None else None
    avg_cost_per_game = total_cost / len(games) if games else 0.0
    avg_response_ms = sum(all_times) / len(all_times) if all_times else 0.0

    return {
        "avg_acpl": round(avg_acpl, 1) if avg_acpl is not None else None,
        "avg_accuracy": avg_accuracy,
        "avg_cost_per_game": round(avg_cost_per_game, 6),
        "avg_response_ms": round(avg_response_ms, 0),
        "classifications": total_classifications,
        "games_as_white": games_as_white,
        "games_as_black": games_as_black,
        "wins_as_white": wins_as_white,
        "wins_as_black": wins_as_black,
    }


async def compute_head_to_head(session: AsyncSession, model_id: str) -> list[HeadToHeadRecord]:
    """Compute head-to-head records for a model against all opponents."""
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            (Game.white_model == model_id) | (Game.black_model == model_id),
        )
    )
    games = results.all()

    records: dict[str, dict] = defaultdict(lambda: {"wins": 0, "losses": 0, "draws": 0, "total": 0})

    for game in games:
        if game.white_model == model_id:
            opponent = game.black_model
            if game.outcome and "white" in game.outcome:
                records[opponent]["wins"] += 1
            elif game.outcome and "black" in game.outcome:
                records[opponent]["losses"] += 1
            else:
                records[opponent]["draws"] += 1
        else:
            opponent = game.white_model
            if game.outcome and "black" in game.outcome:
                records[opponent]["wins"] += 1
            elif game.outcome and "white" in game.outcome:
                records[opponent]["losses"] += 1
            else:
                records[opponent]["draws"] += 1
        records[opponent]["total"] += 1

    # Look up display names for opponents
    opponent_ids = list(records.keys())
    display_names: dict[str, str | None] = {}
    for oid in opponent_ids:
        model = await session.get(LLMModel, oid)
        display_names[oid] = model.display_name if model else None

    return [
        HeadToHeadRecord(
            opponent=opp,
            opponent_display_name=display_names.get(opp),
            wins=data["wins"],
            losses=data["losses"],
            draws=data["draws"],
            total_games=data["total"],
        )
        for opp, data in sorted(records.items(), key=lambda x: x[1]["total"], reverse=True)
    ]


async def compute_platform_overview(session: AsyncSession) -> PlatformOverview:
    """Compute platform-wide cost/token/performance stats with per-model breakdowns."""
    # Get all completed games
    results = await session.exec(
        select(Game).where(Game.status == "completed")
    )
    games = results.all()

    total_games = len(games)
    if total_games == 0:
        return PlatformOverview()

    total_cost = sum(g.total_cost_usd or 0.0 for g in games)

    # Collect all model IDs that participated
    model_ids: set[str] = set()
    for g in games:
        model_ids.add(g.white_model)
        model_ids.add(g.black_model)

    # Per-model aggregation
    breakdowns: dict[str, dict] = {
        mid: {
            "games": 0,
            "cost": 0.0,
            "input_tokens": 0,
            "output_tokens": 0,
            "response_times": [],
        }
        for mid in model_ids
    }

    total_input_tokens = 0
    total_output_tokens = 0

    for game in games:
        breakdowns[game.white_model]["games"] += 1
        breakdowns[game.black_model]["games"] += 1

        # Query moves for this game
        move_results = await session.exec(
            select(Move).where(Move.game_id == game.id)
        )
        moves = move_results.all()

        for move in moves:
            mid = game.white_model if move.color == "white" else game.black_model
            inp = move.input_tokens or 0
            out = move.output_tokens or 0
            cost = move.cost_usd or 0.0

            breakdowns[mid]["cost"] += cost
            breakdowns[mid]["input_tokens"] += inp
            breakdowns[mid]["output_tokens"] += out
            breakdowns[mid]["response_times"].append(move.response_time_ms or 0)

            total_input_tokens += inp
            total_output_tokens += out

    # Look up display names
    display_names: dict[str, str | None] = {}
    for mid in model_ids:
        model = await session.get(LLMModel, mid)
        display_names[mid] = model.display_name if model else None

    model_breakdowns = []
    for mid, data in breakdowns.items():
        games_count = data["games"]
        avg_cost = data["cost"] / games_count if games_count > 0 else 0.0
        avg_resp = (
            sum(data["response_times"]) / len(data["response_times"])
            if data["response_times"]
            else 0.0
        )
        model_breakdowns.append(
            ModelCostBreakdown(
                model_id=mid,
                display_name=display_names.get(mid),
                games_played=games_count,
                total_cost_usd=round(data["cost"], 6),
                avg_cost_per_game=round(avg_cost, 6),
                total_input_tokens=data["input_tokens"],
                total_output_tokens=data["output_tokens"],
                avg_response_ms=round(avg_resp, 0),
            )
        )

    # Sort by total cost descending
    model_breakdowns.sort(key=lambda x: x.total_cost_usd, reverse=True)

    return PlatformOverview(
        total_games=total_games,
        total_completed=total_games,
        total_cost_usd=round(total_cost, 6),
        total_input_tokens=total_input_tokens,
        total_output_tokens=total_output_tokens,
        avg_game_cost=round(total_cost / total_games, 6) if total_games > 0 else 0.0,
        model_breakdowns=model_breakdowns,
    )
