export interface GameSummary {
  id: string;
  white_model: string;
  black_model: string;
  status: "active" | "queued" | "completed" | "stopped" | "pending";
  outcome: string | null;
  termination: string | null;
  opening_eco: string | null;
  opening_name: string | null;
  total_moves: number;
  live_move_count: number | null;
  current_eval_cp: number | null;
  current_mate_in: number | null;
  started_at: string | null;
  completed_at: string | null;
  white_temperature: number | null;
  black_temperature: number | null;
  white_reasoning_effort: string | null;
  black_reasoning_effort: string | null;
  white_is_human: boolean;
  black_is_human: boolean;
  white_is_stockfish: boolean;
  black_is_stockfish: boolean;
  white_stockfish_elo: number | null;
  black_stockfish_elo: number | null;
  chaos_mode: boolean;
  move_time_limit: number | null;
  draw_adjudication: boolean;
}

export interface MoveDetail {
  move_number: number;
  color: "white" | "black";
  uci: string;
  san: string;
  fen_after: string;
  narration: string | null;
  table_talk: string | null;
  centipawns: number | null;
  mate_in: number | null;
  win_probability: number | null;
  centipawns_before: number | null;
  mate_in_before: number | null;
  win_probability_before: number | null;
  best_move_uci: string | null;
  classification: string | null;
  response_time_ms: number;
  opening_eco: string | null;
  opening_name: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cost_usd: number | null;
  is_chaos_move: boolean;
}

export interface CriticalMoment {
  move_index: number;
  move_number: number;
  color: "white" | "black";
  san: string;
  win_prob_before: number;
  win_prob_after: number;
  swing: number;
  classification: string | null;
}

export interface GameAnalysis {
  white_acpl: number | null;
  black_acpl: number | null;
  white_accuracy: number | null;
  black_accuracy: number | null;
  white_classifications: Record<string, number>;
  black_classifications: Record<string, number>;
  critical_moments: CriticalMoment[];
  white_avg_response_ms: number;
  black_avg_response_ms: number;
  white_total_tokens: number;
  black_total_tokens: number;
  white_total_cost: number;
  black_total_cost: number;
}

export interface GameDetail extends GameSummary {
  pgn: string | null;
  moves: MoveDetail[];
  total_cost_usd: number;
  analysis: GameAnalysis | null;
}

export interface ModelStats {
  id: string;
  display_name: string | null;
  elo_rating: number;
  games_played: number;
  wins: number;
  draws: number;
  losses: number;
  win_rate: number;
  total_illegal_moves: number;
}

export interface EnhancedModelStats extends ModelStats {
  avg_acpl: number | null;
  avg_accuracy: number | null;
  avg_cost_per_game: number;
  avg_response_ms: number;
  illegal_move_rate: number;
}

export interface HeadToHeadRecord {
  opponent: string;
  opponent_display_name: string | null;
  wins: number;
  losses: number;
  draws: number;
  total_games: number;
}

export interface ModelDetailStats extends EnhancedModelStats {
  classifications: Record<string, number>;
  games_as_white: number;
  games_as_black: number;
  wins_as_white: number;
  wins_as_black: number;
  head_to_head: HeadToHeadRecord[];
  recent_games: GameSummary[];
}

export interface ModelCostBreakdown {
  model_id: string;
  display_name: string | null;
  games_played: number;
  total_cost_usd: number;
  avg_cost_per_game: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_response_ms: number;
}

export interface PlatformOverview {
  total_games: number;
  total_completed: number;
  total_cost_usd: number;
  total_input_tokens: number;
  total_output_tokens: number;
  avg_game_cost: number;
  model_breakdowns: ModelCostBreakdown[];
}

export interface HeadToHeadComparison {
  model_a: string;
  model_b: string;
  model_a_display: string | null;
  model_b_display: string | null;
  model_a_elo: number;
  model_b_elo: number;
  model_a_wins: number;
  model_b_wins: number;
  draws: number;
  total_games: number;
  model_a_avg_accuracy: number | null;
  model_b_avg_accuracy: number | null;
  model_a_avg_acpl: number | null;
  model_b_avg_acpl: number | null;
  recent_games: GameSummary[];
}

export interface OpeningStats {
  eco: string;
  name: string;
  total_games: number;
  white_wins: number;
  black_wins: number;
  draws: number;
}

export interface EloHistoryPoint {
  game_id: string;
  elo_after: number;
  elo_change: number;
  opponent: string;
  outcome: string;
  played_at: string | null;
}

export interface PaginatedGamesResponse {
  games: GameSummary[];
  total_count: number;
  has_more: boolean;
}

export interface CreateGameRequest {
  white_model: string;
  black_model: string;
  max_moves?: number;
  white_temperature?: number | null;
  black_temperature?: number | null;
  white_reasoning_effort?: string | null;
  black_reasoning_effort?: string | null;
  white_is_human?: boolean;
  black_is_human?: boolean;
  white_is_stockfish?: boolean;
  black_is_stockfish?: boolean;
  white_stockfish_elo?: number | null;
  black_stockfish_elo?: number | null;
  chaos_mode?: boolean;
  move_time_limit?: number | null;
  draw_adjudication?: boolean;
}

export interface GameCreatedResponse {
  id: string;
  status: "active" | "queued";
  player_secret: string | null;
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing_prompt: string;
  pricing_completion: string;
}

export type Classification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";
