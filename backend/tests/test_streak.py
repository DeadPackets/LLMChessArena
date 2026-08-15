from app.routers.models_router import compute_h2h_streak


def test_streak_counts_consecutive_wins_from_most_recent():
    assert compute_h2h_streak(["a", "a", "b", "a"]) == ("a", 2)


def test_draw_breaks_streak():
    assert compute_h2h_streak(["draw", "a", "a"]) == (None, 0)


def test_empty():
    assert compute_h2h_streak([]) == (None, 0)


def test_full_streak():
    assert compute_h2h_streak(["b", "b", "b"]) == ("b", 3)
