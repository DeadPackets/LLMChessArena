from __future__ import annotations

from app.config import DEFAULT_TEMPERATURE, ELO_K_FACTOR

# Delimiter joining a model id to its reasoning tier in the composite leaderboard
# identity, e.g. ``anthropic/claude-opus-4.8::high``. Chosen because real
# OpenRouter model ids never contain ``::`` and it is URL-safe (the leaderboard
# links to ``/model/<id>`` unencoded, and ids already contain ``/``).
RATING_KEY_SEP = "::"


def _effort_norm(effort: str | None) -> str:
    """Normalize a reasoning effort to one of low/medium/high/none."""
    return effort if effort in ("low", "medium", "high") else "none"


def reasoning_suffix(effort: str | None) -> str:
    """Human-readable reasoning tier, e.g. ``Reasoning, High`` / ``Non-reasoning``."""
    e = _effort_norm(effort)
    return "Non-reasoning" if e == "none" else f"Reasoning, {e.capitalize()}"


def rating_key(
    label: str, effort: str | None, is_human: bool, is_stockfish: bool
) -> str:
    """Leaderboard identity for one side.

    Following the convention benchmarks use, LLMs are split by reasoning tier:
    ``Opus`` at high effort ranks separately from ``Opus`` non-reasoning. Humans
    and Stockfish have no reasoning tier, so their label is used unchanged. This
    is the single source of truth shared by the live ELO path, the leaderboard
    recompute, the ELO-history chart, and every per-model stat so they can never
    disagree. ``label`` is the raw player label stored in ``Game.white_model``
    (the model id, ``"Human"``, or ``"Stockfish"``).
    """
    if is_human or is_stockfish:
        return label
    return f"{label}{RATING_KEY_SEP}{_effort_norm(effort)}"


def rating_display(
    label: str, effort: str | None, is_human: bool, is_stockfish: bool
) -> str:
    """Pretty leaderboard label, e.g. ``claude-opus-4.8 (Reasoning, High)``."""
    if is_human or is_stockfish:
        return label
    base = label.split("/")[-1]
    return f"{base} ({reasoning_suffix(effort)})"


def raw_label_of(rating_key_value: str) -> str:
    """Strip the reasoning-tier suffix back to the raw player label.

    Used to prefilter games in SQL (which stores the raw label) before matching
    the full composite key in Python. Human/Stockfish keys have no suffix.
    """
    return rating_key_value.rsplit(RATING_KEY_SEP, 1)[0]


def temperature_is_default(temp: float | None) -> bool:
    """True when a side's temperature is left at the rated default (or unset)."""
    return temp is None or abs(temp - DEFAULT_TEMPERATURE) < 1e-6


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
