from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


ReasoningEffort = Literal["none", "low", "medium", "high"]


# --- Requests ---


class CreateGameRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    white_model: str = ""
    black_model: str = ""
    max_moves: int = Field(default=200, ge=1)
    white_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    black_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    white_reasoning_effort: ReasoningEffort | None = None
    black_reasoning_effort: ReasoningEffort | None = None
    white_is_human: bool = False
    black_is_human: bool = False
    white_is_stockfish: bool = False
    black_is_stockfish: bool = False
    white_stockfish_elo: int | None = Field(default=None, ge=1320, le=3190)
    black_stockfish_elo: int | None = Field(default=None, ge=1320, le=3190)
    chaos_mode: bool = False
    move_time_limit: float | None = Field(default=None, gt=0)
    draw_adjudication: bool = True


# --- Responses ---


class GameSummary(BaseModel):
    id: str
    white_model: str
    black_model: str
    status: str
    outcome: str | None = None
    termination: str | None = None
    opening_eco: str | None = None
    opening_name: str | None = None
    total_moves: int = 0
    started_at: datetime | None = None
    completed_at: datetime | None = None
    white_temperature: float | None = None
    black_temperature: float | None = None
    white_reasoning_effort: str | None = None
    black_reasoning_effort: str | None = None
    white_is_human: bool = False
    black_is_human: bool = False
    white_is_stockfish: bool = False
    black_is_stockfish: bool = False
    white_stockfish_elo: int | None = None
    black_stockfish_elo: int | None = None
    chaos_mode: bool = False
    move_time_limit: float | None = None
    draw_adjudication: bool = True


class MoveDetail(BaseModel):
    move_number: int
    color: str
    uci: str
    san: str
    fen_after: str
    narration: str | None = None
    table_talk: str | None = None
    centipawns: int | None = None
    mate_in: int | None = None
    win_probability: float | None = None
    centipawns_before: int | None = None
    mate_in_before: int | None = None
    win_probability_before: float | None = None
    best_move_uci: str | None = None
    classification: str | None = None
    response_time_ms: int = 0
    opening_eco: str | None = None
    opening_name: str | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    is_chaos_move: bool = False


class CriticalMoment(BaseModel):
    move_index: int
    move_number: int
    color: str
    san: str
    win_prob_before: float
    win_prob_after: float
    swing: float
    classification: str | None = None


class GameAnalysis(BaseModel):
    model_config = ConfigDict(extra="forbid")

    white_acpl: float | None = None
    black_acpl: float | None = None
    white_accuracy: float | None = None
    black_accuracy: float | None = None
    white_classifications: dict[str, int] = {}
    black_classifications: dict[str, int] = {}
    critical_moments: list[CriticalMoment] = []
    white_avg_response_ms: float = 0
    black_avg_response_ms: float = 0
    white_total_tokens: int = 0
    black_total_tokens: int = 0
    white_total_cost: float = 0.0
    black_total_cost: float = 0.0


class GameDetail(GameSummary):
    model_config = ConfigDict(extra="forbid")

    pgn: str | None = None
    moves: list[MoveDetail] = []
    total_cost_usd: float = 0.0
    analysis: GameAnalysis | None = None


class ModelStats(BaseModel):
    id: str
    display_name: str | None = None
    elo_rating: float = 1500.0
    games_played: int = 0
    wins: int = 0
    draws: int = 0
    losses: int = 0
    win_rate: float = 0.0
    total_illegal_moves: int = 0


class EnhancedModelStats(ModelStats):
    avg_acpl: float | None = None
    avg_accuracy: float | None = None
    avg_cost_per_game: float = 0.0
    avg_response_ms: float = 0.0
    illegal_move_rate: float = 0.0


class HeadToHeadRecord(BaseModel):
    opponent: str
    opponent_display_name: str | None = None
    wins: int = 0
    losses: int = 0
    draws: int = 0
    total_games: int = 0


class ModelDetailStats(EnhancedModelStats):
    classifications: dict[str, int] = {}
    games_as_white: int = 0
    games_as_black: int = 0
    wins_as_white: int = 0
    wins_as_black: int = 0
    head_to_head: list[HeadToHeadRecord] = []
    recent_games: list[GameSummary] = []


class ModelCostBreakdown(BaseModel):
    model_id: str
    display_name: str | None = None
    games_played: int = 0
    total_cost_usd: float = 0.0
    avg_cost_per_game: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    avg_response_ms: float = 0.0


class PlatformOverview(BaseModel):
    total_games: int = 0
    total_completed: int = 0
    total_cost_usd: float = 0.0
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    avg_game_cost: float = 0.0
    model_breakdowns: list[ModelCostBreakdown] = []


class HeadToHeadComparison(BaseModel):
    model_a: str
    model_b: str
    model_a_display: str | None = None
    model_b_display: str | None = None
    model_a_elo: float = 1500.0
    model_b_elo: float = 1500.0
    model_a_wins: int = 0
    model_b_wins: int = 0
    draws: int = 0
    total_games: int = 0
    model_a_avg_accuracy: float | None = None
    model_b_avg_accuracy: float | None = None
    model_a_avg_acpl: float | None = None
    model_b_avg_acpl: float | None = None
    recent_games: list[GameSummary] = []


class OpeningStats(BaseModel):
    eco: str
    name: str
    total_games: int = 0
    white_wins: int = 0
    black_wins: int = 0
    draws: int = 0


class EloHistoryPoint(BaseModel):
    game_id: str
    elo_after: float
    elo_change: float
    opponent: str
    outcome: str
    played_at: datetime | None = None


class PaginatedGamesResponse(BaseModel):
    games: list[GameSummary]
    total_count: int
    has_more: bool


class GameCreatedResponse(BaseModel):
    id: str
    status: str
    player_secret: str | None = None
