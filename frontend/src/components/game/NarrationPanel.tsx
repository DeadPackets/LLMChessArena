import type { MoveData } from "../../types/websocket";

interface Props {
  move: MoveData | null;
}

function formatCost(usd: number | null): string {
  if (usd == null) return "";
  return `$${usd.toFixed(4)}`;
}

function formatTokens(input: number | null, output: number | null): string {
  if (input == null && output == null) return "";
  return `${input ?? 0} in / ${output ?? 0} out`;
}

export default function NarrationPanel({ move }: Props) {
  if (!move) {
    return (
      <div className="narration-panel panel">
        <div className="narration-panel__label">Commentary</div>
        <div className="narration-panel__text">Select a move to see commentary.</div>
      </div>
    );
  }

  const tokens = formatTokens(move.inputTokens, move.outputTokens);
  const cost = formatCost(move.costUsd);

  return (
    <div className="narration-panel panel">
      <div className="narration-panel__label">
        <span>Commentary</span>
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>
          {move.moveNumber}. {move.color === "white" ? "" : "..."}{move.san}
        </span>
      </div>
      {move.narration ? (
        <div className="narration-panel__text">{move.narration}</div>
      ) : (
        <div className="narration-panel__text" style={{ opacity: 0.4 }}>
          No commentary for this move.
        </div>
      )}
      {(tokens || cost) && (
        <div className="narration-panel__meta">
          {tokens && <span>{tokens} tokens</span>}
          {cost && <span>{cost}</span>}
          {move.responseTimeMs > 0 && (
            <span>{(move.responseTimeMs / 1000).toFixed(1)}s</span>
          )}
        </div>
      )}
    </div>
  );
}
