import { useReducer, useCallback, useEffect } from "react";
import useWebSocket, { ReadyState } from "react-use-websocket";
import type { GameState, GameAction, MoveData, PositionEval, GameOverData } from "../types/websocket";

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
  moves: [],
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
      return {
        ...state,
        gameId: d.game_id as string,
        whiteModel: d.white_model as string,
        blackModel: d.black_model as string,
        status: d.status as GameState["status"],
        outcome: (d.outcome as string | null) ?? null,
        termination: (d.termination as string | null) ?? null,
        moves,
        currentFen: lastFen,
        selectedIndex: lastIdx,
        autoFollow: d.status === "active",
        openingEco: opening?.eco ?? null,
        openingName: opening?.name ?? null,
        statusMessage: null,
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
        statusMessage: null,
      };
    }

    case "STATUS_UPDATE":
      return { ...state, statusMessage: action.payload.message };

    case "GAME_STARTED":
      return {
        ...state,
        gameId: action.payload.game_id,
        whiteModel: action.payload.white_model,
        blackModel: action.payload.black_model,
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
      return {
        ...state,
        status: "completed",
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

    default:
      return state;
  }
}

export function useGameWebSocket(gameId: string) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/games/${gameId}`;

  const { readyState } = useWebSocket(wsUrl, {
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
          case "status":
            dispatch({ type: "STATUS_UPDATE", payload: msg.data });
            break;
          case "game_started":
            dispatch({ type: "GAME_STARTED", payload: msg.data });
            break;
          case "game_over":
            dispatch({ type: "GAME_OVER", payload: msg.data });
            break;
        }
      } catch {
        // ignore malformed messages
      }
    },
    shouldReconnect: () => state.status === "active",
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

  return { state, selectMove, navigate, toggleAutoFollow };
}
