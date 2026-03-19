import { Link } from "react-router-dom";
import type { GameSummary } from "../../types/api";
import { formatModelLabel } from "../../utils/formatModel";

interface Props {
  game: GameSummary;
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return "";
  const date = new Date(dateStr);
  const now = Date.now();
  const diffMs = now - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}

function formatCompactEval(cp: number | null, mateIn: number | null): string | null {
  if (mateIn != null) {
    return mateIn > 0 ? `#${mateIn}` : `-#${Math.abs(mateIn)}`;
  }
  if (cp != null) {
    const abs = Math.abs(cp) / 100;
    const formatted = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
    return cp >= 0 ? `+${formatted}` : `-${formatted}`;
  }
  return null;
}

function getWinner(game: GameSummary): "white" | "black" | null {
  if (game.outcome?.includes("white")) return "white";
  if (game.outcome?.includes("black")) return "black";
  return null;
}

export default function GameCard({ game }: Props) {
  const winner = getWinner(game);
  const isLive = game.status === "active";
  const isQueued = game.status === "queued";
  const timestamp = game.completed_at ?? game.started_at;

  const whiteLabel = game.white_is_human
    ? "Human"
    : game.white_is_stockfish
    ? "Stockfish"
    : formatModelLabel(game.white_model, game.white_reasoning_effort, game.white_temperature);
  const blackLabel = game.black_is_human
    ? "Human"
    : game.black_is_stockfish
    ? "Stockfish"
    : formatModelLabel(game.black_model, game.black_reasoning_effort, game.black_temperature);

  return (
    <Link to={`/game/${game.id}`} className="game-card panel" aria-label={`Game: ${game.white_model} vs ${game.black_model}`}>
      <div className="game-card__players">
        <div className="game-card__player">
          <span className="game-card__piece game-card__piece--white">&#9812;</span>
          <span>{whiteLabel}</span>
          {winner === "white" && <span className="game-card__result game-card__result--winner">1</span>}
          {winner === "black" && <span className="game-card__result">0</span>}
          {game.outcome === "draw" && <span className="game-card__result">&frac12;</span>}
        </div>
        <div className="game-card__player">
          <span className="game-card__piece game-card__piece--black">&#9818;</span>
          <span>{blackLabel}</span>
          {winner === "black" && <span className="game-card__result game-card__result--winner">1</span>}
          {winner === "white" && <span className="game-card__result">0</span>}
          {game.outcome === "draw" && <span className="game-card__result">&frac12;</span>}
        </div>
      </div>

      <div className="game-card__info">
        {game.opening_name && (
          <span className="game-card__opening">{game.opening_name}</span>
        )}
        {isLive && (() => {
          const evalStr = formatCompactEval(game.current_eval_cp, game.current_mate_in);
          if (!evalStr) return null;
          const cp = game.current_eval_cp ?? 0;
          const cls = game.current_mate_in != null
            ? (game.current_mate_in > 0 ? "game-card__eval--white" : "game-card__eval--black")
            : cp > 50 ? "game-card__eval--white" : cp < -50 ? "game-card__eval--black" : "game-card__eval--even";
          return <span className={`game-card__eval ${cls}`}>{evalStr}</span>;
        })()}
        <span className="game-card__time">
          {isLive
            ? (game.live_move_count != null && game.live_move_count > 0 && `${game.live_move_count} moves`)
            : (game.total_moves > 0 && `${game.total_moves} moves`)
          }
          {((isLive ? game.live_move_count : game.total_moves) ?? 0) > 0 && timestamp && " \u00b7 "}
          {timestamp && timeAgo(timestamp)}
        </span>
      </div>

      <div>
        {game.chaos_mode && (
          <span className="status-badge status-badge--chaos">CHAOS</span>
        )}
        {isLive ? (
          <span className="status-badge status-badge--live">
            <span className="status-badge__dot status-badge__dot--live" />
            Live
          </span>
        ) : isQueued ? (
          <span className="status-badge status-badge--completed">Queued</span>
        ) : game.status === "stopped" ? (
          <span className="status-badge status-badge--stopped">
            <span className="status-badge__dot status-badge__dot--stopped" />
            Stopped
          </span>
        ) : game.status === "completed" ? (
          <span className="status-badge status-badge--completed">
            <span className="status-badge__dot status-badge__dot--completed" />
            Done
          </span>
        ) : (
          <span className="status-badge status-badge--completed">Pending</span>
        )}
      </div>
    </Link>
  );
}
