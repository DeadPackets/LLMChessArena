import { useEffect, useState } from "react";
import { useModal } from "../../hooks/useModal";
import type { GameOverData } from "../../types/websocket";
import type { HeadToHeadComparison } from "../../types/api";
import { compareModels } from "../../api/client";
import { formatModelName } from "../../utils/formatModel";

interface Props {
  data: GameOverData;
  whiteModel: string | null;
  blackModel: string | null;
  onRematch?: () => void;
  rematchPending?: boolean;
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

function SeriesScore({ whiteModel, blackModel }: { whiteModel: string; blackModel: string }) {
  const [h2h, setH2h] = useState<HeadToHeadComparison | null>(null);

  useEffect(() => {
    let cancelled = false;
    compareModels(whiteModel, blackModel)
      .then((res) => {
        if (!cancelled) setH2h(res);
      })
      .catch(() => {
        if (!cancelled) setH2h(null);
      });
    return () => {
      cancelled = true;
    };
  }, [whiteModel, blackModel]);

  if (!h2h || h2h.total_games === 0) return null;

  const aName = formatModelName(h2h.model_a, h2h.model_a_display);
  const bName = formatModelName(h2h.model_b, h2h.model_b_display);

  return (
    <div className="game-over-banner__series" aria-label="Head-to-head series record">
      <span className="game-over-banner__series-label">Series</span>
      <span className="game-over-banner__series-name">{aName}</span>
      <span className="game-over-banner__series-score">{h2h.model_a_wins}</span>
      <span className="game-over-banner__series-dash">&ndash;</span>
      <span className="game-over-banner__series-score">{h2h.model_b_wins}</span>
      <span className="game-over-banner__series-name">{bName}</span>
      {h2h.draws > 0 && (
        <span className="game-over-banner__series-draws">({h2h.draws} drawn)</span>
      )}
    </div>
  );
}

export default function GameOverBanner({ data, whiteModel, blackModel, onRematch, rematchPending }: Props) {
  const { title, cls } = outcomeDisplay(data.outcome, whiteModel, blackModel);
  // Always-open banner: useModal manages initial focus + focus restore on unmount.
  const { dialogProps, titleId } = useModal(true, () => {});

  return (
    <div
      {...dialogProps}
      ref={dialogProps.ref as React.RefObject<HTMLDivElement>}
      className="game-over-banner panel--elevated"
    >
      <h2 id={titleId} className={`game-over-banner__title ${cls}`}>{title}</h2>
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
      {whiteModel && blackModel && (
        <SeriesScore whiteModel={whiteModel} blackModel={blackModel} />
      )}
      {onRematch && (
        <button
          className="btn btn--primary game-over-banner__rematch"
          onClick={onRematch}
          disabled={rematchPending}
        >
          {rematchPending ? "Starting rematch…" : "Rematch (swap colors)"}
        </button>
      )}
    </div>
  );
}
