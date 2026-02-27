export interface PositionEval {
  centipawns: number;
  mate_in: number | null;
  win_probability_white: number;
  wdl_white: { w: number; d: number; l: number };
  best_move_uci: string | null;
  depth: number;
}

export interface MoveData {
  moveNumber: number;
  color: "white" | "black";
  uci: string;
  san: string;
  fenAfter: string;
  narration: string | null;
  tableTalk: string | null;
  centipawns: number | null;
  mateIn: number | null;
  winProbability: number | null;
  evalBefore: PositionEval | null;
  evalAfter: PositionEval | null;
  bestMoveUci: string | null;
  classification: string | null;
  responseTimeMs: number;
  openingEco: string | null;
  openingName: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
}

export interface GameOverData {
  outcome: string;
  termination: string;
  totalMoves: number;
  totalCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  pgn: string;
}

export interface IllegalMoveData {
  color: "white" | "black";
  model: string;
  attemptedMove: string;
  reason: string;
  attempt: number;
  maxAttempts: number;
  moveNumber: number;
}

export interface GameState {
  connectionStatus: "connecting" | "connected" | "disconnected" | "error";
  gameId: string | null;
  whiteModel: string | null;
  blackModel: string | null;
  status: "active" | "completed" | "stopped" | "pending" | null;
  outcome: string | null;
  termination: string | null;
  openingEco: string | null;
  openingName: string | null;
  whiteTemperature: number | null;
  blackTemperature: number | null;
  whiteReasoningEffort: string | null;
  blackReasoningEffort: string | null;
  whiteIsHuman: boolean;
  blackIsHuman: boolean;
  whiteIsStockfish: boolean;
  blackIsStockfish: boolean;
  awaitingHumanMove: string | null; // color ("white"|"black") or null
  moves: MoveData[];
  illegalMoves: IllegalMoveData[];
  currentFen: string;
  selectedIndex: number;
  autoFollow: boolean;
  statusMessage: string | null;
  gameOverData: GameOverData | null;
}

export type GameAction =
  | { type: "CATCH_UP"; payload: Record<string, unknown> }
  | { type: "MOVE_PLAYED"; payload: Record<string, unknown> }
  | { type: "STATUS_UPDATE"; payload: { message: string } }
  | { type: "GAME_STARTED"; payload: { game_id: string; white_model: string; black_model: string; white_is_human?: boolean; black_is_human?: boolean; white_is_stockfish?: boolean; black_is_stockfish?: boolean } }
  | { type: "GAME_OVER"; payload: Record<string, unknown> }
  | { type: "SET_SELECTED_INDEX"; payload: number }
  | { type: "NAVIGATE"; payload: "first" | "prev" | "next" | "last" }
  | { type: "TOGGLE_AUTO_FOLLOW" }
  | { type: "CONNECTION_STATUS"; payload: GameState["connectionStatus"] }
  | { type: "ILLEGAL_MOVE_ATTEMPT"; payload: IllegalMoveData }
  | { type: "AWAITING_HUMAN_MOVE"; payload: { color: string } };
