from __future__ import annotations

from app.config import ELO_K_FACTOR


def score_white_from_outcome(outcome: str | None) -> float:
    """Map a game outcome to White's score: 1.0 win, 0.5 draw, 0.0 loss.

    Decisive outcomes are ``"white_wins"`` / ``"black_wins"`` (a forfeit is also
    emitted as ``"{winner}_wins"``; the *reason* lives in ``termination``).
    Anything else (``"draw"``, adjudication, unknown) counts as a draw. This is
    the single source of truth shared by the live ELO path, the leaderboard
    recompute, and the ELO-history chart so they can never disagree.
    """
    if outcome and "white_wins" in outcome:
        return 1.0
    if outcome and "black_wins" in outcome:
        return 0.0
    return 0.5


def calculate_elo_change(
    rating_a: float, rating_b: float, score_a: float
) -> tuple[float, float]:
    """Calculate new ELO ratings after a game.

    Args:
        rating_a: Current rating of player A.
        rating_b: Current rating of player B.
        score_a: Result for player A — 1.0 = win, 0.5 = draw, 0.0 = loss.

    Returns:
        (new_rating_a, new_rating_b)
    """
    expected_a = 1.0 / (1.0 + 10 ** ((rating_b - rating_a) / 400))
    expected_b = 1.0 - expected_a

    new_a = rating_a + ELO_K_FACTOR * (score_a - expected_a)
    new_b = rating_b + ELO_K_FACTOR * ((1 - score_a) - expected_b)
    return round(new_a, 1), round(new_b, 1)
