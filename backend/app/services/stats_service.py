from __future__ import annotations

import math
import statistics
from collections import defaultdict

from sqlmodel import select
from sqlmodel.ext.asyncio.session import AsyncSession

from app.database import Game, Move, LLMModel
from sqlalchemy import func as sa_func

from app.config import DEFAULT_MODEL_ELO
from app.services.elo_service import (
    calculate_elo_change,
    raw_label_of,
    rating_key,
    score_white_from_outcome,
)
from app.models.api_models import (
    CriticalMoment,
    EloHistoryPoint,
    GameAnalysis,
    HeadToHeadRecord,
    ModelBadge,
    ModelCostBreakdown,
    OpeningStats,
    PlatformOverview,
)


# Cap per-move loss to avoid mate scores (±9999cp) from destroying the average
MAX_LOSS_PER_MOVE = 1000


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

# ── Lichess accuracy constants (full precision) ──
_ACC_MULTIPLIER = 103.1668100711649
_ACC_DECAY = -0.04354415386753951
_ACC_OFFSET = -3.166924740191411
_ACC_BONUS = 1.0  # uncertainty bonus for imperfect analysis


def _per_move_accuracy(win_pct_diff: float) -> float:
    """Lichess per-move accuracy from win-percentage loss (0–100 scale)."""
    if win_pct_diff <= 0:
        return 100.0
    raw = (
        _ACC_MULTIPLIER * math.exp(_ACC_DECAY * win_pct_diff) + _ACC_OFFSET + _ACC_BONUS
    )
    return max(0.0, min(100.0, raw))


def _aggregate_accuracy(
    win_pcts: list[float],
    move_accuracies: list[float],
) -> float:
    """Lichess game-level accuracy: volatility-weighted mean + harmonic mean.

    win_pcts:        per-position win% (0–100, from mover's perspective)
    move_accuracies: per-move accuracy values (0–100)
    """
    n = len(move_accuracies)
    if n == 0:
        return 100.0
    if n == 1:
        return move_accuracies[0]

    # Window size: clamp(total_moves / 10, 2, 8)
    window_size = max(2, min(8, n // 10))

    # Volatility weights from sliding windows of win percentages
    weights: list[float] = []
    for i in range(n):
        half = window_size // 2
        start = max(0, i - half)
        end = min(len(win_pcts), i + half + 1)
        window = win_pcts[start:end]
        if len(window) >= 2:
            w = max(0.5, min(12.0, statistics.stdev(window)))
        else:
            w = 0.5
        weights.append(w)

    # Volatility-weighted mean
    weight_total = sum(weights)
    weighted_mean = sum(a * w for a, w in zip(move_accuracies, weights)) / weight_total

    # Harmonic mean (skip zeros to avoid division by zero)
    nonzero = [a for a in move_accuracies if a > 0]
    if nonzero:
        harmonic_mean = len(nonzero) / sum(1.0 / a for a in nonzero)
    else:
        harmonic_mean = 0.0

    return (weighted_mean + harmonic_mean) / 2.0


def _move_eval_before(move: Move) -> tuple[int | None, float | None]:
    cp_before = move.centipawns_before
    wp_before = move.win_probability_before

    if cp_before is None and move.centipawns is not None:
        cp_before = 0
    if wp_before is None and move.win_probability is not None:
        wp_before = 0.5

    return cp_before, wp_before


async def compute_game_analysis(session: AsyncSession, game_id: str) -> GameAnalysis:
    """Compute full analysis stats for a completed game."""
    results = await session.exec(
        select(Move).where(Move.game_id == game_id).order_by(Move.id)  # type: ignore[arg-type]
    )
    moves = results.all()

    if not moves:
        return GameAnalysis()

    white_cp_losses: list[float] = []
    black_cp_losses: list[float] = []
    white_move_accs: list[float] = []
    black_move_accs: list[float] = []
    white_win_pcts: list[float] = []
    black_win_pcts: list[float] = []
    white_cls: dict[str, int] = {}
    black_cls: dict[str, int] = {}
    white_times: list[int] = []
    black_times: list[int] = []
    white_tokens = 0
    black_tokens = 0
    white_cost = 0.0
    black_cost = 0.0

    for i, move in enumerate(moves):
        has_cp = move.centipawns is not None
        has_wp = move.win_probability is not None
        cp_before: int = 0
        cp_after: int = move.centipawns if move.centipawns is not None else 0
        _, wp_before = _move_eval_before(move)
        if wp_before is None:
            wp_before = (
                moves[i - 1].win_probability
                if i > 0 and moves[i - 1].win_probability is not None
                else 0.5
            )
        wp_after = move.win_probability if has_wp else wp_before

        if has_cp:
            raw_cp_before, _ = _move_eval_before(move)
            if raw_cp_before is None:
                cp_before = (
                    moves[i - 1].centipawns
                    if i > 0 and moves[i - 1].centipawns is not None
                    else 0
                )
            else:
                cp_before = raw_cp_before

        if move.color == "white":
            if has_cp:
                white_cp_losses.append(
                    min(max(0, cp_before - cp_after), MAX_LOSS_PER_MOVE)
                )
            if has_wp:
                win_diff = (wp_before - wp_after) * 100  # scale to 0-100
                white_win_pcts.append(wp_before * 100)
                white_move_accs.append(_per_move_accuracy(win_diff))
            if move.classification:
                white_cls[move.classification] = (
                    white_cls.get(move.classification, 0) + 1
                )
            white_times.append(move.response_time_ms or 0)
            white_tokens += (move.input_tokens or 0) + (move.output_tokens or 0)
            white_cost += move.cost_usd or 0.0
        else:
            if has_cp:
                black_cp_losses.append(
                    min(max(0, cp_after - cp_before), MAX_LOSS_PER_MOVE)
                )
            if has_wp:
                win_diff = (
                    (1.0 - wp_before) - (1.0 - wp_after)
                ) * 100  # from black's perspective
                black_win_pcts.append((1.0 - wp_before) * 100)
                black_move_accs.append(_per_move_accuracy(win_diff))
            if move.classification:
                black_cls[move.classification] = (
                    black_cls.get(move.classification, 0) + 1
                )
            black_times.append(move.response_time_ms or 0)
            black_tokens += (move.input_tokens or 0) + (move.output_tokens or 0)
            black_cost += move.cost_usd or 0.0

    white_acpl = (
        sum(white_cp_losses) / len(white_cp_losses) if white_cp_losses else None
    )
    black_acpl = (
        sum(black_cp_losses) / len(black_cp_losses) if black_cp_losses else None
    )
    white_accuracy = (
        _aggregate_accuracy(white_win_pcts, white_move_accs)
        if white_move_accs
        else None
    )
    black_accuracy = (
        _aggregate_accuracy(black_win_pcts, black_move_accs)
        if black_move_accs
        else None
    )

    # Critical moments: win probability swings >= 0.15
    critical: list[CriticalMoment] = []
    for i, move in enumerate(moves):
        _, wp_before = _move_eval_before(move)
        if wp_before is None:
            wp_before = (
                moves[i - 1].win_probability
                if i > 0 and moves[i - 1].win_probability is not None
                else 0.5
            )
        wp_after = (
            move.win_probability if move.win_probability is not None else wp_before
        )
        swing = abs(wp_after - wp_before)
        if swing >= 0.15:
            critical.append(
                CriticalMoment(
                    move_index=i,
                    move_number=move.move_number,
                    color=move.color,
                    san=move.san,
                    win_prob_before=round(wp_before, 4),
                    win_prob_after=round(wp_after, 4),
                    swing=round(swing, 4),
                    classification=move.classification,
                )
            )
    critical.sort(key=lambda x: x.swing, reverse=True)

    return GameAnalysis(
        white_acpl=round(white_acpl, 1) if white_acpl is not None else None,
        black_acpl=round(black_acpl, 1) if black_acpl is not None else None,
        white_accuracy=round(white_accuracy, 1) if white_accuracy is not None else None,
        black_accuracy=round(black_accuracy, 1) if black_accuracy is not None else None,
        white_classifications=white_cls,
        black_classifications=black_cls,
        critical_moments=critical[:10],
        white_avg_response_ms=round(sum(white_times) / len(white_times), 0)
        if white_times
        else 0,
        black_avg_response_ms=round(sum(black_times) / len(black_times), 0)
        if black_times
        else 0,
        white_total_tokens=white_tokens,
        black_total_tokens=black_tokens,
        white_total_cost=round(white_cost, 6),
        black_total_cost=round(black_cost, 6),
    )


async def compute_model_aggregate_stats(session: AsyncSession, model_id: str) -> dict:
    """Compute aggregate stats for a model across all completed games.

    Uses a single JOIN query to fetch games + moves together (avoids N+1).
    """
    # Prefilter on the raw label (what the DB stores), then match the full
    # composite identity (model + reasoning tier) in Python.
    raw = raw_label_of(model_id)
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            (Game.white_model == raw) | (Game.black_model == raw),
            Game.chaos_mode != True,  # noqa: E712 — exclude chaos games from stats
        )
    )
    games = [
        g
        for g in results.all()
        if _white_key(g) == model_id or _black_key(g) == model_id
    ]

    if not games:
        return {
            "avg_acpl": None,
            "avg_accuracy": None,
            "avg_cost_per_game": 0.0,
            "avg_response_ms": 0.0,
        }

    game_ids = [g.id for g in games]
    game_color_map = {
        g.id: ("white" if _white_key(g) == model_id else "black") for g in games
    }

    # Single query for ALL moves across ALL matching games
    move_results = await session.exec(
        select(Move).where(Move.game_id.in_(game_ids)).order_by(Move.game_id, Move.id)  # type: ignore[union-attr,arg-type]
    )
    all_moves = move_results.all()

    # Group moves by game
    moves_by_game: dict[str, list[Move]] = defaultdict(list)
    for m in all_moves:
        moves_by_game[m.game_id].append(m)

    all_cp_losses: list[float] = []
    all_move_accs: list[float] = []
    all_win_pcts: list[float] = []
    all_times: list[int] = []
    total_cost = 0.0
    total_classifications: dict[str, int] = {}
    games_as_white = 0
    games_as_black = 0
    wins_as_white = 0
    wins_as_black = 0

    for game in games:
        color = game_color_map[game.id]
        is_white = color == "white"

        if is_white:
            games_as_white += 1
            if game.outcome and "white" in game.outcome:
                wins_as_white += 1
        else:
            games_as_black += 1
            if game.outcome and "black" in game.outcome:
                wins_as_black += 1

        moves = moves_by_game.get(game.id, [])

        for i, move in enumerate(moves):
            if move.color != color:
                continue

            cp_before: int = 0
            cp_after: int = move.centipawns if move.centipawns is not None else 0
            _, wp_before = _move_eval_before(move)
            if wp_before is None:
                wp_before = (
                    moves[i - 1].win_probability
                    if i > 0 and moves[i - 1].win_probability is not None
                    else 0.5
                )
            wp_after = (
                move.win_probability if move.win_probability is not None else wp_before
            )

            # Centipawn loss (for ACPL)
            if move.centipawns is not None:
                raw_cp_before, _ = _move_eval_before(move)
                if raw_cp_before is None:
                    prev_cp = (
                        moves[i - 1].centipawns
                        if i > 0 and moves[i - 1].centipawns is not None
                        else 0
                    )
                    cp_before = prev_cp if prev_cp is not None else 0
                else:
                    cp_before = raw_cp_before
                if color == "white":
                    all_cp_losses.append(
                        min(max(0, cp_before - cp_after), MAX_LOSS_PER_MOVE)
                    )
                else:
                    all_cp_losses.append(
                        min(max(0, cp_after - cp_before), MAX_LOSS_PER_MOVE)
                    )

            # Per-move accuracy (from win probability)
            if move.win_probability is not None:
                wp_before_val = wp_before if wp_before is not None else 0.5
                wp_after_val = wp_after if wp_after is not None else wp_before_val
                if color == "white":
                    win_diff = (wp_before_val - wp_after_val) * 100
                    all_win_pcts.append(wp_before_val * 100)
                else:
                    win_diff = ((1.0 - wp_before_val) - (1.0 - wp_after_val)) * 100
                    all_win_pcts.append((1.0 - wp_before_val) * 100)
                all_move_accs.append(_per_move_accuracy(win_diff))

            all_times.append(move.response_time_ms or 0)
            total_cost += move.cost_usd or 0.0

            if move.classification:
                total_classifications[move.classification] = (
                    total_classifications.get(move.classification, 0) + 1
                )

    avg_acpl = sum(all_cp_losses) / len(all_cp_losses) if all_cp_losses else None
    avg_accuracy = (
        round(_aggregate_accuracy(all_win_pcts, all_move_accs), 1)
        if all_move_accs
        else None
    )
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


async def compute_head_to_head(
    session: AsyncSession, model_id: str
) -> list[HeadToHeadRecord]:
    """Compute head-to-head records for a model against all opponents."""
    raw = raw_label_of(model_id)
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            (Game.white_model == raw) | (Game.black_model == raw),
            Game.chaos_mode != True,  # noqa: E712 — exclude chaos games
        )
    )
    games = [
        g
        for g in results.all()
        if _white_key(g) == model_id or _black_key(g) == model_id
    ]

    records: dict[str, dict] = defaultdict(
        lambda: {"wins": 0, "losses": 0, "draws": 0, "total": 0}
    )

    for game in games:
        if _white_key(game) == model_id:
            opponent = _black_key(game)
            if game.outcome and "white" in game.outcome:
                records[opponent]["wins"] += 1
            elif game.outcome and "black" in game.outcome:
                records[opponent]["losses"] += 1
            else:
                records[opponent]["draws"] += 1
        else:
            opponent = _white_key(game)
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
        for opp, data in sorted(
            records.items(), key=lambda x: x[1]["total"], reverse=True
        )
    ]


async def compute_platform_overview(session: AsyncSession) -> PlatformOverview:
    """Compute platform-wide cost/token/performance stats with per-model breakdowns.

    Uses a single bulk query for all moves (avoids N+1 per-game queries).
    """
    # Get all completed games
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            Game.chaos_mode != True,  # noqa: E712 — exclude chaos games
        )
    )
    games = results.all()

    total_games = len(games)
    if total_games == 0:
        return PlatformOverview()

    total_cost = sum(g.total_cost_usd or 0.0 for g in games)

    # Collect all leaderboard identities (model + reasoning tier) that participated
    model_ids: set[str] = set()
    game_map: dict[str, Game] = {}
    for g in games:
        model_ids.add(_white_key(g))
        model_ids.add(_black_key(g))
        game_map[g.id] = g

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
        breakdowns[_white_key(game)]["games"] += 1
        breakdowns[_black_key(game)]["games"] += 1

    # Single query for ALL moves across ALL games
    game_ids = list(game_map.keys())
    move_results = await session.exec(
        select(Move).where(Move.game_id.in_(game_ids))  # type: ignore[union-attr]
    )
    all_moves = move_results.all()

    for move in all_moves:
        game = game_map.get(move.game_id)
        if not game:
            continue
        mid = _white_key(game) if move.color == "white" else _black_key(game)
        inp = move.input_tokens or 0
        out = move.output_tokens or 0
        cost = move.cost_usd or 0.0

        breakdowns[mid]["cost"] += cost
        breakdowns[mid]["input_tokens"] += inp
        breakdowns[mid]["output_tokens"] += out
        breakdowns[mid]["response_times"].append(move.response_time_ms or 0)

        total_input_tokens += inp
        total_output_tokens += out

    # Look up display names in bulk
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


async def compute_opening_stats(session: AsyncSession) -> list[OpeningStats]:
    """Compute opening statistics across all completed games."""
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            Game.opening_eco.isnot(None),  # type: ignore[union-attr]
        )
    )
    games = results.all()

    openings: dict[str, dict] = defaultdict(
        lambda: {
            "name": "",
            "total": 0,
            "white_wins": 0,
            "black_wins": 0,
            "draws": 0,
        }
    )

    for g in games:
        eco = g.opening_eco
        if not eco:
            continue
        openings[eco]["name"] = g.opening_name or eco
        openings[eco]["total"] += 1
        if g.outcome and "white" in g.outcome:
            openings[eco]["white_wins"] += 1
        elif g.outcome and "black" in g.outcome:
            openings[eco]["black_wins"] += 1
        else:
            openings[eco]["draws"] += 1

    return sorted(
        [
            OpeningStats(
                eco=eco,
                name=data["name"],
                total_games=data["total"],
                white_wins=data["white_wins"],
                black_wins=data["black_wins"],
                draws=data["draws"],
            )
            for eco, data in openings.items()
        ],
        key=lambda x: x.total_games,
        reverse=True,
    )


async def compute_elo_history(
    session: AsyncSession, model_id: str
) -> list[EloHistoryPoint]:
    """Compute a model's ELO history by replaying the rated games chronologically.

    Uses the *same* game set (``Game.rated``), ordering (``completed_at`` then
    ``id``) and scoring as ``GameManager._apply_elo`` / ``recompute_all_elo``, so
    the running ratings here match the stored leaderboard exactly — the final
    point for a model equals its leaderboard ELO. Keep this in lock-step with
    ``recompute_all_elo`` if either changes.
    """
    result = await session.exec(
        select(Game)
        .where(Game.rated == True)  # noqa: E712
        .order_by(
            Game.completed_at.asc(),  # type: ignore[union-attr]
            Game.id.asc(),  # type: ignore[union-attr]
        )
    )
    rated_games = result.all()

    eligible_ids = {
        g.id
        for g in rated_games
        if _white_key(g) == model_id or _black_key(g) == model_id
    }
    if not eligible_ids:
        return []

    running_elos: dict[str, float] = {}
    history: list[EloHistoryPoint] = []

    for g in rated_games:
        w_id = _white_key(g)
        b_id = _black_key(g)
        w_elo = running_elos.get(w_id, DEFAULT_MODEL_ELO)
        b_elo = running_elos.get(b_id, DEFAULT_MODEL_ELO)

        score_w = score_white_from_outcome(g.outcome)

        new_w, new_b = calculate_elo_change(w_elo, b_elo, score_w)
        running_elos[w_id] = new_w
        running_elos[b_id] = new_b

        # Record a history point only for games the target model played in.
        if g.id in eligible_ids:
            is_white = w_id == model_id
            elo_now = new_w if is_white else new_b
            elo_prev = w_elo if is_white else b_elo
            score = score_w if is_white else (1.0 - score_w)
            opponent = b_id if is_white else w_id
            outcome_label = "win" if score == 1.0 else ("loss" if score == 0.0 else "draw")
            history.append(EloHistoryPoint(
                game_id=g.id,
                elo_after=round(elo_now, 1),
                elo_change=round(elo_now - elo_prev, 1),
                opponent=opponent,
                outcome=outcome_label,
                played_at=g.completed_at,
            ))

    return history


async def compute_elo_sparklines(
    session: AsyncSession, last_n: int = 20
) -> dict[str, list[float]]:
    """Post-game rating series per model, one replay pass over all rated games.

    Same game set, ordering and scoring as ``compute_elo_history`` — keep the
    replays in lock-step with ``recompute_all_elo`` if either changes.
    """
    result = await session.exec(
        select(Game)
        .where(Game.rated == True)  # noqa: E712
        .order_by(
            Game.completed_at.asc(),  # type: ignore[union-attr]
            Game.id.asc(),  # type: ignore[union-attr]
        )
    )
    running: dict[str, float] = {}
    series: dict[str, list[float]] = {}
    for g in result.all():
        w_id, b_id = _white_key(g), _black_key(g)
        w_elo = running.get(w_id, DEFAULT_MODEL_ELO)
        b_elo = running.get(b_id, DEFAULT_MODEL_ELO)
        new_w, new_b = calculate_elo_change(
            w_elo, b_elo, score_white_from_outcome(g.outcome)
        )
        running[w_id], running[b_id] = new_w, new_b
        series.setdefault(w_id, []).append(round(new_w, 1))
        series.setdefault(b_id, []).append(round(new_b, 1))
    return {k: v[-last_n:] for k, v in series.items()}


def compute_badges(
    *,
    games_played: int,
    total_illegal_moves: int,
    avg_accuracy: float | None,
    outcomes_newest_first: list[str],
    won_checkmate_min_plies: int | None,
    won_max_plies: int | None,
    upset_wins: int,
) -> list[ModelBadge]:
    """Achievement badges from pre-aggregated per-model inputs (pure, testable)."""
    badges: list[ModelBadge] = []
    if won_checkmate_min_plies is not None and won_checkmate_min_plies <= 40:
        badges.append(ModelBadge(
            id="speedrunner", label="Speedrunner", icon="⚡",
            description="Won by checkmate in 20 moves or fewer",
        ))
    if won_max_plies is not None and won_max_plies >= 120:
        badges.append(ModelBadge(
            id="marathoner", label="Marathoner", icon="\U0001f3c3",
            description="Won a game lasting 60+ moves",
        ))
    if upset_wins > 0:
        badges.append(ModelBadge(
            id="giant_slayer", label="Giant Slayer", icon="\U0001f5e1️",
            description="Beat an opponent rated 150+ ELO higher",
        ))
    if games_played >= 3 and total_illegal_moves == 0:
        badges.append(ModelBadge(
            id="clean_sheet", label="Clean Sheet", icon="✨",
            description="Never attempted an illegal move (3+ games)",
        ))
    streak = 0
    for o in outcomes_newest_first:
        if o != "win":
            break
        streak += 1
    if streak >= 3:
        badges.append(ModelBadge(
            id="on_fire", label=f"On Fire ×{streak}", icon="\U0001f525",
            description=f"Current win streak of {streak}",
        ))
    if avg_accuracy is not None and avg_accuracy >= 85 and games_played >= 3:
        badges.append(ModelBadge(
            id="sharpshooter", label="Sharpshooter", icon="\U0001f3af",
            description="Average accuracy 85%+ (3+ games)",
        ))
    return badges


async def compute_upset_wins(session: AsyncSession) -> dict[str, int]:
    """Wins against an opponent rated >=150 higher at game time, per model.

    Replays the same rated-game sequence as ``compute_elo_sparklines`` so the
    "at game time" ratings match the leaderboard's history exactly.
    """
    result = await session.exec(
        select(Game)
        .where(Game.rated == True)  # noqa: E712
        .order_by(
            Game.completed_at.asc(),  # type: ignore[union-attr]
            Game.id.asc(),  # type: ignore[union-attr]
        )
    )
    running: dict[str, float] = {}
    upsets: dict[str, int] = defaultdict(int)
    for g in result.all():
        w_id, b_id = _white_key(g), _black_key(g)
        w_elo = running.get(w_id, DEFAULT_MODEL_ELO)
        b_elo = running.get(b_id, DEFAULT_MODEL_ELO)
        score_w = score_white_from_outcome(g.outcome)
        if score_w == 1.0 and b_elo - w_elo >= 150:
            upsets[w_id] += 1
        elif score_w == 0.0 and w_elo - b_elo >= 150:
            upsets[b_id] += 1
        new_w, new_b = calculate_elo_change(w_elo, b_elo, score_w)
        running[w_id], running[b_id] = new_w, new_b
    return dict(upsets)


async def compute_model_badge_inputs(
    session: AsyncSession, model_id: str
) -> dict:
    """Per-model badge inputs from completed non-chaos games (newest first)."""
    raw = raw_label_of(model_id)
    results = await session.exec(
        select(Game).where(
            Game.status == "completed",
            (Game.white_model == raw) | (Game.black_model == raw),
            Game.chaos_mode != True,  # noqa: E712
        ).order_by(Game.completed_at.desc())  # type: ignore[union-attr]
    )
    games = [
        g
        for g in results.all()
        if _white_key(g) == model_id or _black_key(g) == model_id
    ]

    outcomes: list[str] = []
    won_checkmate_min_plies: int | None = None
    won_max_plies: int | None = None
    for g in games:
        as_white = _white_key(g) == model_id
        if g.outcome == "draw":
            outcomes.append("draw")
            won = False
        else:
            won = bool(
                g.outcome
                and (("white" in g.outcome) if as_white else ("black" in g.outcome))
            )
            outcomes.append("win" if won else "loss")
        if won:
            plies = g.total_moves or 0
            if g.termination == "checkmate" and plies > 0:
                if won_checkmate_min_plies is None or plies < won_checkmate_min_plies:
                    won_checkmate_min_plies = plies
            if won_max_plies is None or plies > won_max_plies:
                won_max_plies = plies

    return {
        "outcomes_newest_first": outcomes,
        "won_checkmate_min_plies": won_checkmate_min_plies,
        "won_max_plies": won_max_plies,
    }
