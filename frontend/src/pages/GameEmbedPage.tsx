import { useState, useEffect, useCallback } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import { getGame } from "../api/client";
import type { GameDetail, MoveDetail } from "../types/api";
import type { MoveData } from "../types/websocket";
import ChessboardPanel from "../components/game/ChessboardPanel";
import MoveList from "../components/game/MoveList";
import GameControls from "../components/game/GameControls";
import { useReplayControls } from "../hooks/useReplayControls";
import { useBoardTheme } from "../hooks/useBoardTheme";
import { formatModelName } from "../utils/formatModel";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Convert API MoveDetail (snake_case) to MoveData (camelCase) used by components. */
function toMoveData(m: MoveDetail): MoveData {
  return {
    moveNumber: m.move_number,
    color: m.color,
    uci: m.uci,
    san: m.san,
    fenAfter: m.fen_after,
    narration: m.narration,
    tableTalk: m.table_talk,
    centipawns: m.centipawns,
    mateIn: m.mate_in,
    winProbability: m.win_probability,
    evalBefore: null,
    evalAfter: null,
    bestMoveUci: m.best_move_uci,
    classification: m.classification,
    responseTimeMs: m.response_time_ms,
    openingEco: m.opening_eco,
    openingName: m.opening_name,
    inputTokens: m.input_tokens,
    outputTokens: m.output_tokens,
    costUsd: m.cost_usd,
    isChaosMove: m.is_chaos_move ?? false,
  };
}

function outcomeLabel(game: GameDetail): string {
  if (!game.outcome) return "";
  if (game.outcome.includes("white")) return "1-0";
  if (game.outcome.includes("black")) return "0-1";
  if (game.outcome === "draw") return "\u00BD-\u00BD";
  return game.outcome;
}

export default function GameEmbedPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [game, setGame] = useState<GameDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { boardColorPreset, customPieces } = useBoardTheme();

  // Fetch game data
  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    getGame(gameId)
      .then((data) => {
        setGame(data);
        setError(null);
      })
      .catch(() => setError("Game not found"))
      .finally(() => setLoading(false));
  }, [gameId]);

  const moves: MoveData[] = game ? game.moves.map(toMoveData) : [];

  // Selected move index
  const initialMove = searchParams.get("move");
  const [selectedIndex, setSelectedIndex] = useState<number>(() => {
    if (initialMove !== null) {
      const idx = parseInt(initialMove, 10);
      if (!isNaN(idx)) return idx;
    }
    return -1;
  });

  // Sync to actual move count once loaded
  useEffect(() => {
    if (moves.length === 0) return;
    if (selectedIndex === -1 && initialMove === null) {
      // Default to last move for completed games
      setSelectedIndex(moves.length - 1);
    } else if (selectedIndex >= moves.length) {
      setSelectedIndex(moves.length - 1);
    }
  }, [moves.length, selectedIndex, initialMove]);

  // Update URL on move change
  useEffect(() => {
    if (selectedIndex < 0) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("move", String(selectedIndex));
        return next;
      },
      { replace: true },
    );
  }, [selectedIndex, setSearchParams]);

  const selectMove = useCallback((idx: number) => setSelectedIndex(idx), []);

  const navigate = useCallback(
    (dir: "first" | "prev" | "next" | "last") => {
      setSelectedIndex((cur) => {
        if (dir === "first") return -1;
        if (dir === "prev") return Math.max(-1, cur - 1);
        if (dir === "next") return Math.min(moves.length - 1, cur + 1);
        if (dir === "last") return moves.length - 1;
        return cur;
      });
    },
    [moves.length],
  );

  const replay = useReplayControls({
    totalMoves: moves.length,
    currentIndex: selectedIndex,
    onNavigate: navigate,
  });

  const currentFen =
    selectedIndex >= 0 && moves[selectedIndex]
      ? moves[selectedIndex].fenAfter
      : START_FEN;
  const selectedMove = selectedIndex >= 0 ? moves[selectedIndex] ?? null : null;
  const previousMove = selectedIndex > 0 ? moves[selectedIndex - 1] ?? null : null;

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        navigate("prev");
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        navigate("next");
      } else if (e.key === "Home") {
        e.preventDefault();
        navigate("first");
      } else if (e.key === "End") {
        e.preventDefault();
        navigate("last");
      } else if (e.key === " ") {
        e.preventDefault();
        replay.togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [navigate, replay]);

  if (loading) {
    return (
      <div className="game-embed game-embed--loading">
        <div className="spinner-lg" />
      </div>
    );
  }

  if (error || !game) {
    return (
      <div className="game-embed game-embed--error">
        <div className="game-embed__error-text">{error || "Game not found"}</div>
      </div>
    );
  }

  if (game.status === "active" || game.status === "queued") {
    return (
      <div className="game-embed game-embed--error">
        <div className="game-embed__error-text">
          This game is not ready for embedding yet.
        </div>
        <a
          href={`/game/${gameId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn--primary"
        >
          Watch Live
        </a>
      </div>
    );
  }

  const whiteName = formatModelName(game.white_model);
  const blackName = formatModelName(game.black_model);

  return (
    <div className="game-embed">
      <div className="game-embed__header">
        <span className="game-embed__players">
          <span className="game-embed__piece game-embed__piece--white">&#9812;</span>
          {whiteName}
          <span className="game-embed__vs">vs</span>
          <span className="game-embed__piece game-embed__piece--black">&#9818;</span>
          {blackName}
        </span>
        <span className="game-embed__result">
          {outcomeLabel(game)}
          {game.total_moves > 0 && (
            <span className="game-embed__moves">{game.total_moves} moves</span>
          )}
        </span>
      </div>

      <div className="game-embed__main">
        <div className="game-embed__board">
          <ChessboardPanel
            fen={currentFen}
            selectedMove={selectedMove}
            previousMove={previousMove}
            boardTheme={boardColorPreset}
            customPieces={customPieces}
          />
        </div>

        <div className="game-embed__sidebar">
          <MoveList
            moves={moves}
            selectedIndex={selectedIndex}
            onSelect={selectMove}
          />
          <GameControls
            canGoFirst={selectedIndex > -1}
            canGoPrev={selectedIndex > -1}
            canGoNext={selectedIndex < moves.length - 1}
            canGoLast={selectedIndex < moves.length - 1}
            autoFollow={false}
            isLive={false}
            onNavigate={navigate}
            onToggleAutoFollow={() => {}}
            isPlaying={replay.isPlaying}
            playSpeed={replay.playSpeed}
            onTogglePlay={replay.togglePlay}
            onChangeSpeed={replay.setPlaySpeed}
            pgn={game.pgn}
            gameId={gameId}
          />
        </div>
      </div>

      <div className="game-embed__footer">
        <Link
          to={`/game/${gameId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="game-embed__link"
        >
          View full game &#8599;
        </Link>
        <span className="game-embed__branding">LLM Chess Arena</span>
      </div>
    </div>
  );
}
