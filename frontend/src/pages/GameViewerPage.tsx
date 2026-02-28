import { useState, useEffect, useCallback, useRef } from "react";
import html2canvas from "html2canvas";
import { useParams, useSearchParams } from "react-router-dom";
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
import BoardThemeSelector from "../components/game/BoardThemeSelector";
import EngineLinesPanel from "../components/game/EngineLinesPanel";
import KeyboardShortcutsModal from "../components/game/KeyboardShortcutsModal";
import { useChessSound } from "../hooks/useChessSound";
import { useBoardTheme } from "../hooks/useBoardTheme";
import type { SoundType } from "../hooks/useChessSound";
import type { IllegalMoveData } from "../types/websocket";
import NewGameDialog from "../components/gamelist/NewGameDialog";
import type { RematchSettings, PlayerType } from "../components/gamelist/NewGameDialog";

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

function MoveTimer({ timeLimit, active }: { timeLimit: number; active: boolean }) {
  const [remaining, setRemaining] = useState(timeLimit);
  const startTimeRef = useRef(Date.now());

  useEffect(() => {
    if (!active) {
      setRemaining(timeLimit);
      return;
    }
    startTimeRef.current = Date.now();
    setRemaining(timeLimit);

    const interval = setInterval(() => {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      const left = Math.max(0, timeLimit - elapsed);
      setRemaining(left);
      if (left <= 0) clearInterval(interval);
    }, 100);

    return () => clearInterval(interval);
  }, [active, timeLimit]);

  const fraction = remaining / timeLimit;
  const urgency = fraction > 0.25 ? "normal" : fraction > 0.1 ? "warning" : "critical";

  const mins = Math.floor(remaining / 60);
  const secs = Math.floor(remaining % 60);
  const display = mins > 0 ? `${mins}:${secs.toString().padStart(2, "0")}` : `${secs}s`;

  return (
    <div className={`move-timer move-timer--${urgency}`}>
      <div className="move-timer__bar">
        <div
          className="move-timer__bar-fill"
          style={{ width: `${fraction * 100}%` }}
        />
      </div>
      <div className="move-timer__text">
        <span className="move-timer__time">{display}</span>
        <span className="move-timer__label">Your turn — drag a piece to move</span>
      </div>
    </div>
  );
}

function detectSoundType(san: string): SoundType {
  if (san.endsWith("#")) return "checkmate";
  if (san.endsWith("+")) return "check";
  if (san.includes("x")) return "capture";
  if (san.startsWith("O-O")) return "castle";
  return "move";
}

export default function GameViewerPage() {
  const { gameId } = useParams<{ gameId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret } = useGameWebSocket(gameId!);

  // Board theme
  const { boardColorPreset, customPieces, theme, setBoardColor, setPieceStyle } = useBoardTheme();

  // Feature 25: Sync selectedIndex to URL (?move=N) for shareable position links
  const initialMoveApplied = useRef(false);

  // On initial load, jump to ?move=N if present
  useEffect(() => {
    if (initialMoveApplied.current) return;
    const moveParam = searchParams.get("move");
    if (moveParam !== null && state.moves.length > 0) {
      const idx = parseInt(moveParam, 10);
      if (!isNaN(idx) && idx >= -1 && idx < state.moves.length) {
        selectMove(idx);
      }
      initialMoveApplied.current = true;
    }
  }, [searchParams, state.moves.length, selectMove]);

  // Update URL when selectedIndex changes (after initial load)
  useEffect(() => {
    if (!initialMoveApplied.current && state.moves.length === 0) return;
    initialMoveApplied.current = true;
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (state.selectedIndex >= 0) {
        next.set("move", String(state.selectedIndex));
      } else {
        next.delete("move");
      }
      return next;
    }, { replace: true });
  }, [state.selectedIndex, state.moves.length, setSearchParams]);

  // Keyboard shortcuts modal
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const toggleShortcuts = useCallback(() => setShortcutsOpen((v) => !v), []);

  // Listen for "?" key to toggle shortcuts legend
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "?" || (e.key === "/" && e.shiftKey)) {
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
      if (e.key === "Escape" && shortcutsOpen) {
        setShortcutsOpen(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shortcutsOpen]);

  // Sound effects
  const { playSound, muted, toggleMute } = useChessSound();
  const prevMovesLengthRef = useRef(0);
  const initialLoadDoneRef = useRef(false);
  const prevStatusRef = useRef(state.status);
  const prevIllegalLengthRef = useRef(0);

  // Play sounds on new moves
  useEffect(() => {
    const prevLen = prevMovesLengthRef.current;
    const curLen = state.moves.length;
    prevMovesLengthRef.current = curLen;

    if (!initialLoadDoneRef.current) {
      if (curLen > 0) initialLoadDoneRef.current = true;
      return;
    }

    if (curLen > prevLen) {
      const latestMove = state.moves[curLen - 1];
      if (latestMove?.san) {
        playSound(detectSoundType(latestMove.san));
      }
    }
  }, [state.moves.length, state.moves, playSound]);

  // Play sound on game end
  useEffect(() => {
    if (prevStatusRef.current !== "completed" && state.status === "completed") {
      playSound("gameEnd");
    }
    prevStatusRef.current = state.status;
  }, [state.status, playSound]);

  // Play sound on illegal move
  useEffect(() => {
    const prevLen = prevIllegalLengthRef.current;
    const curLen = state.illegalMoves.length;
    prevIllegalLengthRef.current = curLen;
    if (curLen > prevLen && initialLoadDoneRef.current) {
      playSound("illegal");
    }
  }, [state.illegalMoves.length, playSound]);

  // Export analysis as PNG
  const analysisRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);
  const handleExportPNG = useCallback(async () => {
    if (!analysisRef.current || exporting) return;
    setExporting(true);
    try {
      const canvas = await html2canvas(analysisRef.current, {
        backgroundColor: "#0e1017",
        scale: 2,
        useCORS: true,
      });
      const link = document.createElement("a");
      link.download = `analysis-${gameId || "game"}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch {
      // silently fail
    } finally {
      setExporting(false);
    }
  }, [exporting, gameId]);

  // Fetch full game detail for completed games (includes analysis)
  const [gameDetail, setGameDetail] = useState<GameDetail | null>(null);
  useEffect(() => {
    if (state.status === "completed" && gameId) {
      getGame(gameId).then(setGameDetail).catch(() => {});
    }
  }, [state.status, gameId]);

  const [rematchOpen, setRematchOpen] = useState(false);

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
          onRematch={isCompleted ? () => setRematchOpen(true) : undefined}
        />
      )}

      <div className="game-viewer__main">
        {/* Column 1: Board + eval bar + merged controls bar */}
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
              boardTheme={boardColorPreset}
              customPieces={customPieces}
            />
          </div>
          <div className="game-viewer__controls-bar">
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
              pgn={state.gameOverData?.pgn || gameDetail?.pgn}
              gameId={gameId}
              muted={muted}
              onToggleMute={toggleMute}
              onShowShortcuts={toggleShortcuts}
            />
            <BoardThemeSelector
              activeBoardColor={theme.boardColor}
              activePieceStyle={theme.pieceStyle}
              onBoardColorChange={setBoardColor}
              onPieceStyleChange={setPieceStyle}
            />
          </div>
        </div>

        {/* Column 2: Eval graph + engine lines + captured material + move list */}
        <div className="game-viewer__moves-col">
          {state.moves.length > 0 && (
            <WinProbGraph
              moves={state.moves}
              selectedIndex={state.selectedIndex}
              onSelectMove={selectMove}
              criticalMoments={gameDetail?.analysis?.critical_moments}
            />
          )}

          {selectedMove?.evalAfter?.engine_lines && selectedMove.evalAfter.engine_lines.length > 0 && (
            <EngineLinesPanel
              lines={selectedMove.evalAfter.engine_lines}
              depth={selectedMove.evalAfter.depth}
            />
          )}

          <CapturedMaterial fen={state.currentFen} />

          <MoveList
            moves={state.moves}
            selectedIndex={state.selectedIndex}
            onSelect={selectMove}
          />
        </div>

        {/* Column 3: Commentary + table talk + status/controls */}
        <div className="game-viewer__info-col">
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

          {isHumanTurn && state.moveTimeLimit != null ? (
            <MoveTimer timeLimit={state.moveTimeLimit} active={isHumanTurn} />
          ) : isHumanTurn ? (
            <div className="human-turn-indicator">
              Your turn — drag a piece to move
            </div>
          ) : null}

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
          ref={analysisRef}
          analysis={gameDetail.analysis}
          whiteModel={state.whiteModel}
          blackModel={state.blackModel}
          onSelectMove={selectMove}
          moves={state.moves}
          onExport={handleExportPNG}
          exporting={exporting}
        />
      )}

      <KeyboardShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <NewGameDialog
        open={rematchOpen}
        onClose={() => setRematchOpen(false)}
        initialSettings={{
          white_model: state.whiteModel || "",
          black_model: state.blackModel || "",
          max_moves: 200,
          white_temperature: state.whiteTemperature,
          black_temperature: state.blackTemperature,
          white_reasoning_effort: state.whiteReasoningEffort,
          black_reasoning_effort: state.blackReasoningEffort,
          white_is_human: state.whiteIsHuman,
          black_is_human: state.blackIsHuman,
          white_is_stockfish: state.whiteIsStockfish,
          black_is_stockfish: state.blackIsStockfish,
          white_stockfish_elo: state.whiteStockfishElo,
          black_stockfish_elo: state.blackStockfishElo,
          chaos_mode: state.chaosMode,
          move_time_limit: state.moveTimeLimit,
          draw_adjudication: state.drawAdjudication,
          whiteType: (state.whiteIsHuman ? "human" : state.whiteIsStockfish ? "stockfish" : "llm") as PlayerType,
          blackType: (state.blackIsHuman ? "human" : state.blackIsStockfish ? "stockfish" : "llm") as PlayerType,
        }}
      />
    </div>
  );
}
