from __future__ import annotations

from enum import Enum

from app.models.chess_models import PositionEval


class MoveClassification(str, Enum):
    BEST = "best"
    EXCELLENT = "excellent"
    GOOD = "good"
    INACCURACY = "inaccuracy"
    MISTAKE = "mistake"
    BLUNDER = "blunder"


# Symbols for display
CLASSIFICATION_SYMBOLS = {
    MoveClassification.BEST: "★",
    MoveClassification.EXCELLENT: "✓",
    MoveClassification.GOOD: "",
    MoveClassification.INACCURACY: "?!",
    MoveClassification.MISTAKE: "?",
    MoveClassification.BLUNDER: "??",
}


def classify_move(
    eval_before: PositionEval,
    eval_after: PositionEval,
    played_move_uci: str,
    color: str,
) -> MoveClassification:
    """Classify a move based on Expected Points Lost (EPL).

    EPL = win_prob_before - win_prob_after (from the mover's perspective).
    The win probabilities are already 0.0-1.0 from White's perspective.
    """
    if color == "white":
        wp_before = eval_before.win_probability_white
        wp_after = eval_after.win_probability_white
    else:
        wp_before = 1.0 - eval_before.win_probability_white
        wp_after = 1.0 - eval_after.win_probability_white

    epl = wp_before - wp_after

    is_best = played_move_uci == eval_before.best_move_uci

    if is_best and epl <= 0.0:
        return MoveClassification.BEST
    elif epl <= 0.0:
        return MoveClassification.BEST
    elif epl < 0.02:
        return MoveClassification.EXCELLENT
    elif epl < 0.05:
        return MoveClassification.GOOD
    elif epl < 0.10:
        return MoveClassification.INACCURACY
    elif epl < 0.20:
        return MoveClassification.MISTAKE
    else:
        return MoveClassification.BLUNDER
