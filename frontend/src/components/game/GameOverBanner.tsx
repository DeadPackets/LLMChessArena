import type { GameOverData } from "../../types/websocket";

interface Props {
  data: GameOverData;
  whiteModel: string | null;
  blackModel: string | null;
}

function formatModelName(name: string | null): string {
  if (!name) return "Unknown";
  const parts = name.split("/");
  return parts[parts.length - 1];
}

function outcomeDisplay(outcome: string, whiteModel: string | null, blackModel: string | null) {
  if (outcome.includes("white")) {
    return {
      title: `${formatModelName(whiteModel)} wins!`,
      cls: "game-over-banner__title--white",
    };
  }
  if (outcome.includes("black")) {
    return {
      title: `${formatModelName(blackModel)} wins!`,
      cls: "game-over-banner__title--black",
    };
  }
  return {
    title: "Draw",
    cls: "game-over-banner__title--draw",
  };
}

function formatTermination(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GameOverBanner({ data, whiteModel, blackModel }: Props) {
  const { title, cls } = outcomeDisplay(data.outcome, whiteModel, blackModel);

  return (
    <div className="game-over-banner panel--elevated" role="alert">
      <div className={`game-over-banner__title ${cls}`}>{title}</div>
      <div className="game-over-banner__termination">
        {formatTermination(data.termination)}
      </div>
      <div className="game-over-banner__stats">
        <div>
          <span className="game-over-banner__stat-value">{data.totalMoves}</span>{" "}
          moves
        </div>
        <div>
          <span className="game-over-banner__stat-value">
            {(data.totalInputTokens + data.totalOutputTokens).toLocaleString()}
          </span>{" "}
          tokens
        </div>
        {data.totalCostUsd > 0 && (
          <div>
            <span className="game-over-banner__stat-value">
              ${data.totalCostUsd.toFixed(4)}
            </span>{" "}
            cost
          </div>
        )}
      </div>
    </div>
  );
}
