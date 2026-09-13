import type { CreateGameRequest, OpenRouterModel } from "../types/api";
import type { GameState } from "../types/websocket";
import { normalizeReasoningEffort, temperatureApplies } from "./reasoning";

export function rematchRequest(state: GameState, models: OpenRouterModel[]): CreateGameRequest {
  const whiteModel = models.find((model) => model.id === state.blackModel);
  const blackModel = models.find((model) => model.id === state.whiteModel);
  return {
    white_model: state.blackModel ?? "",
    black_model: state.whiteModel ?? "",
    max_moves: 200,
    white_temperature: !state.blackIsHuman && !state.blackIsStockfish && temperatureApplies(state.blackReasoningEffort, whiteModel) ? state.blackTemperature : null,
    black_temperature: !state.whiteIsHuman && !state.whiteIsStockfish && temperatureApplies(state.whiteReasoningEffort, blackModel) ? state.whiteTemperature : null,
    white_reasoning_effort: state.blackIsHuman || state.blackIsStockfish ? null
      : normalizeReasoningEffort(state.blackReasoningEffort, whiteModel),
    black_reasoning_effort: state.whiteIsHuman || state.whiteIsStockfish ? null
      : normalizeReasoningEffort(state.whiteReasoningEffort, blackModel),
    white_is_human: state.blackIsHuman,
    black_is_human: state.whiteIsHuman,
    white_is_stockfish: state.blackIsStockfish,
    black_is_stockfish: state.whiteIsStockfish,
    white_stockfish_elo: state.blackStockfishElo,
    black_stockfish_elo: state.whiteStockfishElo,
    chaos_mode: state.chaosMode,
    move_time_limit: state.moveTimeLimit,
    draw_adjudication: state.drawAdjudication,
    ...(state.routingMode === null && state.useNitro
      ? { use_nitro: true }
      : { routing_mode: state.routingMode ?? "economy" }),
  };
}
