from __future__ import annotations

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field


ReasoningEffort = Literal["none", "minimal", "low", "medium", "high", "xhigh"]
ConfiguredReasoningEffort = ReasoningEffort | Literal["provider_default"]
RoutingMode = Literal["economy", "responsive"]


class ChessMove(BaseModel):
    """Structured output the LLM must return."""

    move: str = Field(
        description="Your move in UCI notation: 4 chars (source square + destination square), or 5 chars for promotion. Examples: 'e2e4', 'g1f3', 'e7e8q'. Lowercase only, no hyphens, no SAN."
    )
    narration: str = Field(
        description="Brief commentary on your move, max 128 characters", max_length=128
    )
    table_talk: str = Field(
        description="A short natural reaction to the current position, max 128 characters",
        max_length=128,
    )


class GameConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    white_model: str  # OpenRouter model ID, e.g. "anthropic/claude-sonnet-4-5"
    black_model: str
    max_moves: int = Field(default=200, ge=1)  # per side
    white_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    black_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    white_reasoning_effort: ConfiguredReasoningEffort | None = None
    black_reasoning_effort: ConfiguredReasoningEffort | None = None
    white_is_human: bool = False
    black_is_human: bool = False
    white_is_stockfish: bool = False
    black_is_stockfish: bool = False
    white_stockfish_elo: int | None = Field(default=None, ge=1320, le=3190)
    black_stockfish_elo: int | None = Field(default=None, ge=1320, le=3190)
    chaos_mode: bool = False
    move_time_limit: float | None = Field(default=None, gt=0)
    draw_adjudication: bool = True  # Auto-draw if eval within ±20cp for 30+ moves
    routing_mode: RoutingMode | None = None
    use_nitro: bool = False


class EngineLine(BaseModel):
    """A single candidate move from Stockfish multipv."""

    rank: int  # 1 = best, 2 = second, etc.
    move_uci: str
    centipawns: int
    mate_in: int | None = None


class PositionEval(BaseModel):
    """Stockfish evaluation of a single position."""

    centipawns: int  # from White's perspective; positive = White advantage
    mate_in: int | None = None  # positive = White mates in N, negative = Black mates
    win_probability_white: float  # 0.0 to 1.0
    wdl_white: dict[str, int] = Field(
        default_factory=dict
    )  # {"w": wins, "d": draws, "l": losses} per mille
    best_move_uci: str | None = None
    depth: int = 0
    engine_lines: list[EngineLine] = Field(
        default_factory=list
    )  # top N candidate moves


class MoveRecord(BaseModel):
    move_number: int
    color: str  # "white" or "black"
    uci: str
    san: str
    fen_after: str
    narration: str
    table_talk: str = ""
    response_time_ms: int = 0
    # Evaluation fields (populated by Stockfish in Phase 2)
    eval_before: PositionEval | None = None
    eval_after: PositionEval | None = None
    classification: str | None = None  # MoveClassification value
    best_move_uci: str | None = None
    opening_eco: str | None = None
    opening_name: str | None = None
    # Token & cost tracking (from OpenRouter)
    input_tokens: int | None = None
    output_tokens: int | None = None
    cost_usd: float | None = None
    is_chaos_move: bool = False


class LLMRequestRecord(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    move_number: int
    color: str
    model: str
    provider: str | None = None
    request_id: str | None = None
    attempt: int
    output_mode: str
    reasoning_effort: str | None = None
    routing_mode: str
    harness_version: str
    status: Literal[
        "accepted", "illegal_move", "invalid_output", "transport_error",
        "provider_error", "cancelled",
    ] = "invalid_output"
    elapsed_ms: int
    first_token_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None
    cache_read_tokens: int | None = None
    cache_write_tokens: int | None = None
    cost_usd: float | None = None


class GameResult(BaseModel):
    outcome: str  # "white_wins", "black_wins", "draw", "forfeit_white", "forfeit_black"
    termination: str  # "checkmate", "stalemate", "insufficient_material", "repetition", "fifty_moves", "max_moves", "illegal_moves"
    moves: list[MoveRecord]
    pgn: str
    total_moves: int
    white_model: str
    black_model: str
    opening_eco: str | None = None
    opening_name: str | None = None
    # Aggregated token & cost tracking
    total_input_tokens: int | None = None
    total_output_tokens: int | None = None
    total_cost_usd: float | None = None
    known_input_tokens: int = 0
    known_output_tokens: int = 0
    known_cost_usd: float = 0.0
