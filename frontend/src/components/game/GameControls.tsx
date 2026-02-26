interface Props {
  canGoFirst: boolean;
  canGoPrev: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
  autoFollow: boolean;
  isLive: boolean;
  onNavigate: (dir: "first" | "prev" | "next" | "last") => void;
  onToggleAutoFollow: () => void;
  // Replay controls
  isPlaying?: boolean;
  playSpeed?: number;
  onTogglePlay?: () => void;
  onChangeSpeed?: (speed: number) => void;
  // PGN download
  pgn?: string | null;
  gameId?: string;
}

const SPEEDS = [0.5, 1, 2, 5];

function downloadPgn(pgn: string, gameId: string) {
  const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `game-${gameId}.pgn`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GameControls({
  canGoFirst,
  canGoPrev,
  canGoNext,
  canGoLast,
  autoFollow,
  isLive,
  onNavigate,
  onToggleAutoFollow,
  isPlaying,
  playSpeed,
  onTogglePlay,
  onChangeSpeed,
  pgn,
  gameId,
}: Props) {
  return (
    <div className="game-controls" role="toolbar" aria-label="Move navigation">
      <button
        className={`game-controls__btn${!canGoFirst ? " game-controls__btn--disabled" : ""}`}
        onClick={() => onNavigate("first")}
        disabled={!canGoFirst}
        title="First move (Home)"
        aria-label="Go to first move"
      >
        &#x23EE;
      </button>
      <button
        className={`game-controls__btn${!canGoPrev ? " game-controls__btn--disabled" : ""}`}
        onClick={() => onNavigate("prev")}
        disabled={!canGoPrev}
        title="Previous move (Left arrow)"
        aria-label="Go to previous move"
      >
        &#x23F4;
      </button>

      {onTogglePlay && (
        <button
          className="game-controls__play-btn"
          onClick={onTogglePlay}
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause replay" : "Play replay"}
        >
          {isPlaying ? "\u23F8" : "\u23F5"}
        </button>
      )}

      <button
        className={`game-controls__btn${!canGoNext ? " game-controls__btn--disabled" : ""}`}
        onClick={() => onNavigate("next")}
        disabled={!canGoNext}
        title="Next move (Right arrow)"
        aria-label="Go to next move"
      >
        &#x23F5;
      </button>
      <button
        className={`game-controls__btn${!canGoLast ? " game-controls__btn--disabled" : ""}`}
        onClick={() => onNavigate("last")}
        disabled={!canGoLast}
        title="Last move (End)"
        aria-label="Go to last move"
      >
        &#x23ED;
      </button>

      {onChangeSpeed && playSpeed != null && (
        <select
          className="game-controls__speed"
          value={playSpeed}
          onChange={(e) => onChangeSpeed(Number(e.target.value))}
          aria-label="Playback speed"
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      )}

      {isLive && (
        <button
          className={`game-controls__live-btn ${autoFollow ? "game-controls__live-btn--active" : "game-controls__live-btn--inactive"}`}
          onClick={onToggleAutoFollow}
          aria-label={autoFollow ? "Auto-follow enabled" : "Click to enable auto-follow"}
        >
          <span
            className={`status-badge__dot ${autoFollow ? "status-badge__dot--live" : "status-badge__dot--completed"}`}
          />
          Live
        </button>
      )}

      {pgn && gameId && (
        <button
          className="game-controls__pgn-btn"
          onClick={() => downloadPgn(pgn, gameId)}
          title="Download PGN"
          aria-label="Download PGN file"
        >
          &#x2B07; PGN
        </button>
      )}
    </div>
  );
}
