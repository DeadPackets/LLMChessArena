import { useReducer, useCallback, useEffect, useRef } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import type { GameState, GameAction, MoveData, PositionEval, GameOverData, IllegalMoveData, ChaosMoveData } from "../types/websocket";

const STARTING_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

const initialState: GameState = {
  connectionStatus: "connecting",
  gameId: null,
  whiteModel: null,
  blackModel: null,
  status: null,
  outcome: null,
  termination: null,
  openingEco: null,
  openingName: null,
  whiteTemperature: null,
  blackTemperature: null,
  whiteReasoningEffort: null,
  blackReasoningEffort: null,
  whiteIsHuman: false,
  blackIsHuman: false,
  whiteIsStockfish: false,
  blackIsStockfish: false,
  awaitingHumanMove: null,
  moves: [],
  illegalMoves: [],
  chaosMoves: [],
  chaosMode: false,
  whiteStockfishElo: null,
  blackStockfishElo: null,
  moveTimeLimit: null,
  drawAdjudication: true,
  spectatorCount: 0,
  currentFen: STARTING_FEN,
  selectedIndex: -1,
  autoFollow: true,
  statusMessage: null,
  gameOverData: null,
};

function normalizeEval(raw: Record<string, unknown>): PositionEval {
  return {
    centipawns: (raw.centipawns as number) ?? 0,
    mate_in: (raw.mate_in as number | null) ?? null,
    win_probability_white: (raw.win_probability_white as number) ?? 0.5,
    wdl_white: (raw.wdl_white as { w: number; d: number; l: number }) ?? { w: 500, d: 0, l: 500 },
    best_move_uci: (raw.best_move_uci as string | null) ?? null,
    depth: (raw.depth as number) ?? 0,
    engine_lines: (raw.engine_lines as PositionEval["engine_lines"]) ?? [],
  };
}

function normalizeCatchUpMove(raw: Record<string, unknown>): MoveData {
  return {
    moveNumber: raw.move_number as number,
    color: raw.color as "white" | "black",
    uci: raw.uci as string,
    san: raw.san as string,
    fenAfter: raw.fen_after as string,
    narration: (raw.narration as string | null) ?? null,
    tableTalk: (raw.table_talk as string | null) ?? null,
    centipawns: (raw.centipawns as number | null) ?? null,
    mateIn: (raw.mate_in as number | null) ?? null,
    winProbability: (raw.win_probability as number | null) ?? null,
    evalBefore: null,
    evalAfter: null,
    bestMoveUci: (raw.best_move_uci as string | null) ?? null,
    classification: (raw.classification as string | null) ?? null,
    responseTimeMs: (raw.response_time_ms as number) ?? 0,
    openingEco: (raw.opening_eco as string | null) ?? null,
    openingName: (raw.opening_name as string | null) ?? null,
    inputTokens: (raw.input_tokens as number | null) ?? null,
    outputTokens: (raw.output_tokens as number | null) ?? null,
    costUsd: (raw.cost_usd as number | null) ?? null,
    isChaosMove: (raw.is_chaos_move as boolean) ?? false,
  };
}

function normalizeLiveMove(raw: Record<string, unknown>): MoveData {
  const evalAfterRaw = raw.eval_after as Record<string, unknown> | null;
  const evalBeforeRaw = raw.eval_before as Record<string, unknown> | null;
  const evalAfter = evalAfterRaw ? normalizeEval(evalAfterRaw) : null;
  const evalBefore = evalBeforeRaw ? normalizeEval(evalBeforeRaw) : null;

  return {
    moveNumber: raw.move_number as number,
    color: raw.color as "white" | "black",
    uci: raw.uci as string,
    san: raw.san as string,
    fenAfter: raw.fen_after as string,
    narration: (raw.narration as string | null) ?? null,
    tableTalk: (raw.table_talk as string | null) ?? null,
    centipawns: evalAfter?.centipawns ?? null,
    mateIn: evalAfter?.mate_in ?? null,
    winProbability: evalAfter?.win_probability_white ?? null,
    evalBefore,
    evalAfter,
    bestMoveUci: (raw.best_move_uci as string | null) ?? null,
    classification: (raw.classification as string | null) ?? null,
    responseTimeMs: (raw.response_time_ms as number) ?? 0,
    openingEco: (raw.opening_eco as string | null) ?? null,
    openingName: (raw.opening_name as string | null) ?? null,
    inputTokens: (raw.input_tokens as number | null) ?? null,
    outputTokens: (raw.output_tokens as number | null) ?? null,
    costUsd: (raw.cost_usd as number | null) ?? null,
    isChaosMove: (raw.is_chaos_move as boolean) ?? false,
  };
}

function findLastOpening(moves: MoveData[]): { eco: string; name: string } | null {
  for (let i = moves.length - 1; i >= 0; i--) {
    if (moves[i].openingEco && moves[i].openingName) {
      return { eco: moves[i].openingEco!, name: moves[i].openingName! };
    }
  }
  return null;
}

function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "CATCH_UP": {
      const d = action.payload;
      const moves = ((d.moves as Record<string, unknown>[]) || []).map(normalizeCatchUpMove);
      const lastIdx = moves.length - 1;
      const lastFen = moves.length > 0 ? moves[lastIdx].fenAfter : STARTING_FEN;
      const opening = findLastOpening(moves);
      const status = d.status as GameState["status"];

      // Build gameOverData for completed games so the banner + rematch show
      let gameOverData: GameOverData | null = null;
      if (status === "completed" && d.outcome) {
        let totalInput = 0, totalOutput = 0, totalCost = 0;
        for (const m of moves) {
          totalInput += m.inputTokens ?? 0;
          totalOutput += m.outputTokens ?? 0;
          totalCost += m.costUsd ?? 0;
        }
        gameOverData = {
          outcome: d.outcome as string,
          termination: (d.termination as string) ?? "",
          totalMoves: moves.length,
          totalCostUsd: totalCost,
          totalInputTokens: totalInput,
          totalOutputTokens: totalOutput,
          pgn: "",
        };
      }

      return {
        ...state,
        gameId: d.game_id as string,
        whiteModel: d.white_model as string,
        blackModel: d.black_model as string,
        status,
        outcome: (d.outcome as string | null) ?? null,
        termination: (d.termination as string | null) ?? null,
        moves,
        currentFen: lastFen,
        selectedIndex: lastIdx,
        autoFollow: status === "active",
        openingEco: opening?.eco ?? null,
        openingName: opening?.name ?? null,
        whiteTemperature: (d.white_temperature as number | null) ?? null,
        blackTemperature: (d.black_temperature as number | null) ?? null,
        whiteReasoningEffort: (d.white_reasoning_effort as string | null) ?? null,
        blackReasoningEffort: (d.black_reasoning_effort as string | null) ?? null,
        whiteIsHuman: (d.white_is_human as boolean) ?? false,
        blackIsHuman: (d.black_is_human as boolean) ?? false,
        whiteIsStockfish: (d.white_is_stockfish as boolean) ?? false,
        blackIsStockfish: (d.black_is_stockfish as boolean) ?? false,
        awaitingHumanMove: (d.awaiting_human_move as string | null) ?? null,
        chaosMode: (d.chaos_mode as boolean) ?? false,
        whiteStockfishElo: (d.white_stockfish_elo as number | null) ?? null,
        blackStockfishElo: (d.black_stockfish_elo as number | null) ?? null,
        moveTimeLimit: (d.move_time_limit as number | null) ?? null,
        drawAdjudication: (d.draw_adjudication as boolean) ?? true,
        spectatorCount: (d.spectator_count as number) ?? 0,
        statusMessage: null,
        gameOverData,
      };
    }

    case "MOVE_PLAYED": {
      const move = normalizeLiveMove(action.payload);
      // Deduplicate: if move already exists (from catch-up race), skip
      const exists = state.moves.some(
        (m) => m.moveNumber === move.moveNumber && m.color === move.color
      );
      if (exists) return state;

      const newMoves = [...state.moves, move];
      const newIdx = state.autoFollow ? newMoves.length - 1 : state.selectedIndex;
      return {
        ...state,
        moves: newMoves,
        currentFen: state.autoFollow ? move.fenAfter : state.currentFen,
        selectedIndex: newIdx,
        openingEco: move.openingEco ?? state.openingEco,
        openingName: move.openingName ?? state.openingName,
        awaitingHumanMove: null,
        statusMessage: null,
      };
    }

    case "QUEUED":
      return {
        ...state,
        status: "queued",
        statusMessage: `Queued (${action.payload.position}/${action.payload.max})`,
      };

    case "STATUS_UPDATE":
      return { ...state, statusMessage: action.payload.message };

    case "GAME_STARTED":
      return {
        ...state,
        gameId: action.payload.game_id,
        whiteModel: action.payload.white_model,
        blackModel: action.payload.black_model,
        whiteIsHuman: action.payload.white_is_human ?? false,
        blackIsHuman: action.payload.black_is_human ?? false,
        whiteIsStockfish: action.payload.white_is_stockfish ?? false,
        blackIsStockfish: action.payload.black_is_stockfish ?? false,
        chaosMode: action.payload.chaos_mode ?? false,
        status: "active",
      };

    case "GAME_OVER": {
      const d = action.payload;
      const gameOverData: GameOverData = {
        outcome: d.outcome as string,
        termination: d.termination as string,
        totalMoves: (d.total_moves as number) ?? 0,
        totalCostUsd: (d.total_cost_usd as number) ?? 0,
        totalInputTokens: (d.total_input_tokens as number) ?? 0,
        totalOutputTokens: (d.total_output_tokens as number) ?? 0,
        pgn: (d.pgn as string) ?? "",
      };
      const newStatus = gameOverData.termination === "stopped" ? "stopped" : "completed";
      return {
        ...state,
        status: newStatus,
        outcome: gameOverData.outcome,
        termination: gameOverData.termination,
        gameOverData,
        autoFollow: false,
      };
    }

    case "SET_SELECTED_INDEX": {
      const idx = action.payload;
      const fen =
        idx < 0 ? STARTING_FEN : state.moves[idx]?.fenAfter ?? STARTING_FEN;
      return {
        ...state,
        selectedIndex: idx,
        currentFen: fen,
        autoFollow: false,
      };
    }

    case "NAVIGATE": {
      let newIdx = state.selectedIndex;
      switch (action.payload) {
        case "first":
          newIdx = -1;
          break;
        case "prev":
          newIdx = Math.max(-1, state.selectedIndex - 1);
          break;
        case "next":
          newIdx = Math.min(state.moves.length - 1, state.selectedIndex + 1);
          break;
        case "last":
          newIdx = state.moves.length - 1;
          break;
      }
      const fen =
        newIdx < 0 ? STARTING_FEN : state.moves[newIdx]?.fenAfter ?? STARTING_FEN;
      const isAtLast = newIdx === state.moves.length - 1;
      return {
        ...state,
        selectedIndex: newIdx,
        currentFen: fen,
        autoFollow: isAtLast && state.status === "active",
      };
    }

    case "TOGGLE_AUTO_FOLLOW": {
      const newAF = !state.autoFollow;
      if (newAF && state.moves.length > 0) {
        const lastIdx = state.moves.length - 1;
        return {
          ...state,
          autoFollow: true,
          selectedIndex: lastIdx,
          currentFen: state.moves[lastIdx].fenAfter,
        };
      }
      return { ...state, autoFollow: newAF };
    }

    case "CONNECTION_STATUS":
      return { ...state, connectionStatus: action.payload };

    case "AWAITING_HUMAN_MOVE":
      return {
        ...state,
        awaitingHumanMove: action.payload.color,
        statusMessage: null,
      };

    case "ILLEGAL_MOVE_ATTEMPT":
      return {
        ...state,
        illegalMoves: [...state.illegalMoves, action.payload],
      };

    case "CHAOS_MOVE_DETECTED":
      return {
        ...state,
        chaosMoves: [...state.chaosMoves, action.payload],
      };

    case "SPECTATOR_COUNT":
      return { ...state, spectatorCount: action.payload.count };

    default:
      return state;
  }
}

export function useGameWebSocket(gameId: string) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Use a ref for status to avoid stale closures in shouldReconnect
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/games/${gameId}`;

  const { readyState, sendJsonMessage } = useWebSocket(wsUrl, {
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data);
        switch (msg.type) {
          case "catch_up":
            dispatch({ type: "CATCH_UP", payload: msg.data });
            break;
          case "move_played":
            dispatch({ type: "MOVE_PLAYED", payload: msg.data });
            break;
          case "queued":
            dispatch({ type: "QUEUED", payload: msg.data });
            break;
          case "status":
            dispatch({ type: "STATUS_UPDATE", payload: msg.data });
            break;
          case "game_started":
            dispatch({ type: "GAME_STARTED", payload: msg.data });
            break;
          case "game_over":
            dispatch({ type: "GAME_OVER", payload: msg.data });
            break;
          case "illegal_move_attempt": {
            const d = msg.data;
            const illegalMove: IllegalMoveData = {
              color: d.color as "white" | "black",
              model: d.model as string,
              attemptedMove: d.attempted_move as string,
              reason: d.reason as string,
              attempt: d.attempt as number,
              maxAttempts: d.max_attempts as number,
              moveNumber: d.move_number as number,
            };
            dispatch({ type: "ILLEGAL_MOVE_ATTEMPT", payload: illegalMove });
            break;
          }
          case "chaos_move_detected": {
            const cd = msg.data;
            const chaosMove: ChaosMoveData = {
              color: cd.color as "white" | "black",
              model: cd.model as string,
              attemptedMove: cd.attempted_move as string,
              moveNumber: cd.move_number as number,
            };
            dispatch({ type: "CHAOS_MOVE_DETECTED", payload: chaosMove });
            break;
          }
          case "awaiting_human_move":
            dispatch({ type: "AWAITING_HUMAN_MOVE", payload: msg.data });
            break;
          case "spectator_count":
            dispatch({ type: "SPECTATOR_COUNT", payload: { count: msg.data.count } });
            break;
        }
      } catch {
        // ignore malformed messages
      }
    },
    shouldReconnect: () => statusRef.current === "active" || statusRef.current === "queued" || statusRef.current === null,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });

  useEffect(() => {
    const map: Record<number, GameState["connectionStatus"]> = {
      [ReadyState.CONNECTING]: "connecting",
      [ReadyState.OPEN]: "connected",
      [ReadyState.CLOSING]: "disconnected",
      [ReadyState.CLOSED]: "disconnected",
      [ReadyState.UNINSTANTIATED]: "connecting",
    };
    dispatch({ type: "CONNECTION_STATUS", payload: map[readyState] ?? "error" });
  }, [readyState]);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowLeft":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", payload: "prev" });
          break;
        case "ArrowRight":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", payload: "next" });
          break;
        case "Home":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", payload: "first" });
          break;
        case "End":
          e.preventDefault();
          dispatch({ type: "NAVIGATE", payload: "last" });
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const selectMove = useCallback((index: number) => {
    dispatch({ type: "SET_SELECTED_INDEX", payload: index });
  }, []);

  const navigate = useCallback((dir: "first" | "prev" | "next" | "last") => {
    dispatch({ type: "NAVIGATE", payload: dir });
  }, []);

  const toggleAutoFollow = useCallback(() => {
    dispatch({ type: "TOGGLE_AUTO_FOLLOW" });
  }, []);

  const playerSecret = typeof window !== "undefined"
    ? localStorage.getItem(`chess_player_secret_${gameId}`)
    : null;
  const isPlayer = !!playerSecret && state.status !== "completed" && state.status !== "stopped";

  const submitMove = useCallback((uci: string) => {
    sendJsonMessage({ type: "human_move", uci, player_secret: playerSecret });
  }, [sendJsonMessage, playerSecret]);

  const resign = useCallback(() => {
    sendJsonMessage({ type: "resign", player_secret: playerSecret });
  }, [sendJsonMessage, playerSecret]);

  return { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret };
}
