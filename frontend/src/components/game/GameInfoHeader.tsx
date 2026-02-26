import type { GameState } from "../../types/websocket";

interface Props {
  state: GameState;
}

function formatModelName(name: string | null): string {
  if (!name) return "Unknown";
  // Strip provider prefix if present (e.g. "openai/gpt-4o" → "gpt-4o")
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function totalCost(state: GameState): number {
  return state.moves.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
}

export default function GameInfoHeader({ state }: Props) {
  const isLive = state.status === "active";
  const cost = state.gameOverData?.totalCostUsd ?? totalCost(state);

  return (
    <div className="game-info panel">
      <div className="game-info__players">
        <div className="game-info__player">
          <span className="game-info__player-icon game-info__player-icon--white">&#9812;</span>
          <span className="game-info__player-name" title={state.whiteModel ?? undefined}>
            {formatModelName(state.whiteModel)}
          </span>
        </div>
        <span className="game-info__vs">vs</span>
        <div className="game-info__player">
          <span className="game-info__player-icon game-info__player-icon--black">&#9818;</span>
          <span className="game-info__player-name" title={state.blackModel ?? undefined}>
            {formatModelName(state.blackModel)}
          </span>
        </div>
      </div>

      <div className="game-info__meta">
        {state.openingEco && (
          <span className="game-info__opening">
            <span className="game-info__opening-eco">{state.openingEco}</span>
            {state.openingName}
          </span>
        )}
        {isLive && (
          <span className="status-badge status-badge--live">
            <span className="status-badge__dot status-badge__dot--live" />
            Live
          </span>
        )}
        {state.status === "completed" && (
          <span className="status-badge status-badge--completed">
            <span className="status-badge__dot status-badge__dot--completed" />
            Completed
          </span>
        )}
        {cost > 0 && (
          <span className="game-info__cost">${cost.toFixed(4)}</span>
        )}
      </div>
    </div>
  );
}
