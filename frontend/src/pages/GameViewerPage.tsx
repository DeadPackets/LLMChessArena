import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { useGameWebSocket } from "../hooks/useGameWebSocket";
import { useReplayControls } from "../hooks/useReplayControls";
import { getGame } from "../api/client";
import type { GameDetail } from "../types/api";
import ChessboardPanel from "../components/game/ChessboardPanel";
import EvalBar from "../components/game/EvalBar";
import MoveList from "../components/game/MoveList";
import GameControls from "../components/game/GameControls";
import NarrationPanel from "../components/game/NarrationPanel";
import GameInfoHeader from "../components/game/GameInfoHeader";
import GameOverBanner from "../components/game/GameOverBanner";
import WinProbGraph from "../components/game/WinProbGraph";
import ResponseTimeGraph from "../components/game/ResponseTimeGraph";
import AnalysisPanel from "../components/game/AnalysisPanel";

export default function GameViewerPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, selectMove, navigate, toggleAutoFollow } = useGameWebSocket(gameId!);

  // Fetch full game detail for completed games (includes analysis)
  const [gameDetail, setGameDetail] = useState<GameDetail | null>(null);
  useEffect(() => {
    if (state.status === "completed" && gameId) {
      getGame(gameId).then(setGameDetail).catch(() => {});
    }
  }, [state.status, gameId]);

  // Replay controls (for completed games)
  const replay = useReplayControls({
    totalMoves: state.moves.length,
    currentIndex: state.selectedIndex,
    onNavigate: navigate,
  });

  const selectedMove =
    state.selectedIndex >= 0 ? state.moves[state.selectedIndex] ?? null : null;
  const previousMove =
    state.selectedIndex > 0 ? state.moves[state.selectedIndex - 1] ?? null : null;

  const evalData = selectedMove
    ? {
        winProbability: selectedMove.winProbability,
        centipawns: selectedMove.centipawns,
        mateIn: selectedMove.mateIn,
      }
    : { winProbability: null, centipawns: null, mateIn: null };

  if (state.connectionStatus === "connecting" && !state.gameId) {
    return (
      <div className="connecting-overlay">
        <div className="spinner-lg" />
        <div className="connecting-overlay__text">Connecting to game...</div>
      </div>
    );
  }

  if (state.connectionStatus === "disconnected" && !state.gameId) {
    return (
      <div className="connecting-overlay">
        <div className="connecting-overlay__text">
          Unable to connect. The game may not exist or the server is unavailable.
        </div>
      </div>
    );
  }

  const isCompleted = state.status === "completed";
  const isLive = state.status === "active";

  return (
    <div className="game-viewer">
      <GameInfoHeader state={state} />

      {state.gameOverData && (
        <GameOverBanner
          data={state.gameOverData}
          whiteModel={state.whiteModel}
          blackModel={state.blackModel}
        />
      )}

      <div className="game-viewer__main">
        <div className="game-viewer__board-col">
          <EvalBar {...evalData} />
          <ChessboardPanel
            fen={state.currentFen}
            selectedMove={selectedMove}
            previousMove={previousMove}
          />
        </div>

        <div className="game-viewer__sidebar">
          {state.moves.length > 0 && (
            <WinProbGraph
              moves={state.moves}
              selectedIndex={state.selectedIndex}
              onSelectMove={selectMove}
              criticalMoments={gameDetail?.analysis?.critical_moments}
            />
          )}

          <MoveList
            moves={state.moves}
            selectedIndex={state.selectedIndex}
            onSelect={selectMove}
          />

          <GameControls
            canGoFirst={state.selectedIndex > -1}
            canGoPrev={state.selectedIndex > -1}
            canGoNext={state.selectedIndex < state.moves.length - 1}
            canGoLast={state.selectedIndex < state.moves.length - 1}
            autoFollow={state.autoFollow}
            isLive={isLive}
            onNavigate={navigate}
            onToggleAutoFollow={toggleAutoFollow}
            isPlaying={isCompleted ? replay.isPlaying : undefined}
            playSpeed={isCompleted ? replay.playSpeed : undefined}
            onTogglePlay={isCompleted ? replay.togglePlay : undefined}
            onChangeSpeed={isCompleted ? replay.setPlaySpeed : undefined}
            pgn={state.gameOverData?.pgn}
            gameId={gameId}
          />

          <NarrationPanel move={selectedMove} />

          {isCompleted && state.moves.length > 0 && (
            <ResponseTimeGraph
              moves={state.moves}
              selectedIndex={state.selectedIndex}
              onSelectMove={selectMove}
            />
          )}

          {state.statusMessage && (
            <div className="status-message">
              <div className="status-message__spinner" />
              {state.statusMessage}
            </div>
          )}
        </div>
      </div>

      {gameDetail?.analysis && (
        <AnalysisPanel
          analysis={gameDetail.analysis}
          whiteModel={state.whiteModel}
          blackModel={state.blackModel}
          onSelectMove={selectMove}
          moves={state.moves}
        />
      )}
    </div>
  );
}
