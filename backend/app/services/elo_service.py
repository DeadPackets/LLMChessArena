from __future__ import annotations

K_FACTOR = 32


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

    new_a = rating_a + K_FACTOR * (score_a - expected_a)
    new_b = rating_b + K_FACTOR * ((1 - score_a) - expected_b)
    return round(new_a, 1), round(new_b, 1)
