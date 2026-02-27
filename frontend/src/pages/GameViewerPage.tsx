import { useState, useEffect, useCallback } from "react";
import { useParams } from "react-router-dom";
import { useGameWebSocket } from "../hooks/useGameWebSocket";
import { useReplayControls } from "../hooks/useReplayControls";
import { getGame, stopGame } from "../api/client";
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
import TableTalkPanel from "../components/game/TableTalkPanel";
import CapturedMaterial from "../components/game/CapturedMaterial";
import AnalysisPanel from "../components/game/AnalysisPanel";
import type { IllegalMoveData } from "../types/websocket";

function IllegalMoveIndicator({ illegalMoves }: { illegalMoves: IllegalMoveData[] }) {
  const invalidUCI = illegalMoves.filter((m) => m.reason === "Invalid UCI notation").length;
  const illegalMovesCt = illegalMoves.length - invalidUCI;
  const whiteCt = illegalMoves.filter((m) => m.color === "white").length;
  const blackCt = illegalMoves.filter((m) => m.color === "black").length;
  const latest = illegalMoves[illegalMoves.length - 1];
  const latestModel = latest.model.split("/").pop() ?? latest.model;
  const latestType = latest.reason === "Invalid UCI notation" ? "invalid UCI" : "illegal move";

  return (
    <div className="illegal-moves-indicator panel">
      <div className="illegal-moves-indicator__title">Move Errors</div>
      <div className="illegal-moves-indicator__counts">
        <span>White: <span className="illegal-moves-indicator__count-value">{whiteCt}</span></span>
        <span>Black: <span className="illegal-moves-indicator__count-value">{blackCt}</span></span>
        <span style={{ marginLeft: "auto", fontSize: "0.7rem" }}>
          {illegalMovesCt > 0 && <span>{illegalMovesCt} illegal</span>}
          {illegalMovesCt > 0 && invalidUCI > 0 && " / "}
          {invalidUCI > 0 && <span style={{ color: "var(--mistake)" }}>{invalidUCI} invalid UCI</span>}
        </span>
      </div>
      <div className="illegal-moves-indicator__latest">
        {latestModel}: <code>{latest.attemptedMove}</code> &mdash; {latestType}
      </div>
    </div>
  );
}

export default function GameViewerPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret } = useGameWebSocket(gameId!);

  // Fetch full game detail for completed games (includes analysis)
  const [gameDetail, setGameDetail] = useState<GameDetail | null>(null);
  useEffect(() => {
    if (state.status === "completed" && gameId) {
      getGame(gameId).then(setGameDetail).catch(() => {});
    }
  }, [state.status, gameId]);

  const [stopping, setStopping] = useState(false);
  const handleStopGame = useCallback(async () => {
    if (!gameId || !playerSecret || stopping) return;
    setStopping(true);
    try {
      await stopGame(gameId, playerSecret);
    } catch {
      // game_over event from WS will handle UI update
    } finally {
      setStopping(false);
    }
  }, [gameId, playerSecret, stopping]);

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

  // Human player logic — only the game creator (with secret) gets player controls
  const humanColor = isPlayer
    ? (state.whiteIsHuman ? "white" : state.blackIsHuman ? "black" : null)
    : null;
  const isHumanTurn = !!(humanColor && state.awaitingHumanMove === humanColor && isLive);
  const boardOrientation: "white" | "black" = humanColor === "black" ? "black" : "white";

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
        <div className="game-viewer__board-col-wrap">
          <div className="game-viewer__board-col">
            <EvalBar {...evalData} />
            <ChessboardPanel
              fen={state.currentFen}
              selectedMove={selectedMove}
              previousMove={previousMove}
              isHumanTurn={isHumanTurn}
              humanColor={humanColor}
              onHumanMove={submitMove}
              boardOrientation={boardOrientation}
            />
          </div>
          <CapturedMaterial fen={state.currentFen} />
        </div>

        <div className="game-viewer__moves-col">
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
        </div>

        <div className="game-viewer__info-col">
          {state.moves.length > 0 && (
            <WinProbGraph
              moves={state.moves}
              selectedIndex={state.selectedIndex}
              onSelectMove={selectMove}
              criticalMoments={gameDetail?.analysis?.critical_moments}
            />
          )}

          <NarrationPanel move={selectedMove} />

          <TableTalkPanel
            moves={state.moves}
            illegalMoves={state.illegalMoves}
            chaosMoves={state.chaosMoves}
            selectedIndex={state.selectedIndex}
            whiteModel={state.whiteModel}
            blackModel={state.blackModel}
            onSelectMove={selectMove}
          />

          {state.illegalMoves.length > 0 && (
            <IllegalMoveIndicator illegalMoves={state.illegalMoves} />
          )}

          {isHumanTurn && (
            <div className="human-turn-indicator">
              Your turn — drag a piece to move
            </div>
          )}

          {humanColor && isLive && !isHumanTurn && state.awaitingHumanMove === null && (
            <div className="status-message">
              <div className="status-message__spinner" />
              Opponent is thinking...
            </div>
          )}

          {humanColor && isLive && (
            <button className="btn btn--ghost resign-btn" onClick={resign}>
              Resign
            </button>
          )}

          {isPlayer && isLive && (
            <button
              className="btn btn--ghost stop-btn"
              onClick={handleStopGame}
              disabled={stopping}
            >
              {stopping ? "Stopping..." : "Stop Game"}
            </button>
          )}

          {state.statusMessage && !humanColor && (
            <div className="status-message">
              <div className="status-message__spinner" />
              {state.statusMessage}
            </div>
          )}
        </div>
      </div>

      {isCompleted && state.moves.length > 0 && (
        <ResponseTimeGraph
          moves={state.moves}
          selectedIndex={state.selectedIndex}
          onSelectMove={selectMove}
        />
      )}

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
