from app.services.game_manager import pgn_from_sans


def test_pgn_from_sans_basic():
    pgn = pgn_from_sans("modelA", "modelB", ["e4", "e5", "Nf3"])
    assert "1. e4 e5 2. Nf3" in pgn
    assert '[White "modelA"]' in pgn
    assert '[Result "*"]' in pgn


def test_pgn_from_sans_stops_on_unparseable():
    pgn = pgn_from_sans("a", "b", ["e4", "Qh5xh8"])
    assert "1. e4" in pgn
    assert "Qh5xh8" not in pgn


def test_pgn_from_sans_empty():
    pgn = pgn_from_sans("a", "b", [])
    assert '[Result "*"]' in pgn
