from app.services.stats_service import compute_badges

BASE = dict(
    games_played=5,
    total_illegal_moves=1,
    avg_accuracy=70.0,
    outcomes_newest_first=["loss"],
    won_checkmate_min_plies=None,
    won_max_plies=None,
    upset_wins=0,
)


def ids(**over):
    return {b.id for b in compute_badges(**{**BASE, **over})}


def test_speedrunner():
    assert "speedrunner" in ids(won_checkmate_min_plies=38)
    assert "speedrunner" not in ids(won_checkmate_min_plies=41)


def test_marathoner():
    assert "marathoner" in ids(won_max_plies=120)
    assert "marathoner" not in ids(won_max_plies=119)


def test_clean_sheet_needs_three_games():
    assert "clean_sheet" in ids(total_illegal_moves=0, games_played=3)
    assert "clean_sheet" not in ids(total_illegal_moves=0, games_played=2)
    assert "clean_sheet" not in ids(total_illegal_moves=1, games_played=5)


def test_on_fire():
    assert "on_fire" in ids(outcomes_newest_first=["win", "win", "win", "loss"])
    assert "on_fire" not in ids(outcomes_newest_first=["win", "win", "loss"])


def test_sharpshooter():
    assert "sharpshooter" in ids(avg_accuracy=85.0, games_played=3)
    assert "sharpshooter" not in ids(avg_accuracy=84.9, games_played=3)
    assert "sharpshooter" not in ids(avg_accuracy=None)


def test_giant_slayer():
    assert "giant_slayer" in ids(upset_wins=1)
    assert "giant_slayer" not in ids(upset_wins=0)
