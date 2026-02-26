import type { GameState } from "../../types/websocket";

interface Props {
  state: GameState;
}

function formatModelName(name: string | null): string {
  if (!name) return "Unknown";
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function formatModelLabel(
  name: string | null,
  reasoningEffort: string | null,
  temperature: number | null,
): string {
  let label = formatModelName(name);
  const suffixes: string[] = [];
  if (reasoningEffort) suffixes.push(`${reasoningEffort}`);
  if (temperature !== null) suffixes.push(`temp: ${temperature.toFixed(1)}`);
  if (suffixes.length > 0) label += ` (${suffixes.join(", ")})`;
  return label;
}

function totalCost(state: GameState): number {
  return state.moves.reduce((sum, m) => sum + (m.costUsd ?? 0), 0);
}

export default function GameInfoHeader({ state }: Props) {
  const isLive = state.status === "active";
  const cost = state.gameOverData?.totalCostUsd ?? totalCost(state);

  const whiteLabel = state.whiteIsHuman
    ? "Human"
    : state.whiteIsStockfish
    ? "Stockfish"
    : formatModelLabel(state.whiteModel, state.whiteReasoningEffort, state.whiteTemperature);
  const blackLabel = state.blackIsHuman
    ? "Human"
    : state.blackIsStockfish
    ? "Stockfish"
    : formatModelLabel(state.blackModel, state.blackReasoningEffort, state.blackTemperature);

  return (
    <div className="game-info panel">
      <div className="game-info__players">
        <div className="game-info__player">
          <span className="game-info__player-icon game-info__player-icon--white">&#9812;</span>
          <span className="game-info__player-name" title={state.whiteModel ?? undefined}>
            {whiteLabel}
          </span>
        </div>
        <span className="game-info__vs">vs</span>
        <div className="game-info__player">
          <span className="game-info__player-icon game-info__player-icon--black">&#9818;</span>
          <span className="game-info__player-name" title={state.blackModel ?? undefined}>
            {blackLabel}
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
