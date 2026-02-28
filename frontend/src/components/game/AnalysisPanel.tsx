import { forwardRef } from "react";
import type { GameAnalysis, CriticalMoment } from "../../types/api";
import type { MoveData } from "../../types/websocket";
import ClassificationBadge from "../shared/ClassificationBadge";
import TokensPerMoveChart from "./TokensPerMoveChart";
import { formatModelName } from "../../utils/formatModel";

interface Props {
  analysis: GameAnalysis;
  whiteModel: string | null;
  blackModel: string | null;
  onSelectMove?: (index: number) => void;
  moves?: MoveData[];
  onExport?: () => void;
  exporting?: boolean;
}

function accuracyClass(acc: number | null): string {
  if (acc == null) return "";
  if (acc >= 80) return "accuracy-card__value--high";
  if (acc >= 50) return "accuracy-card__value--mid";
  return "accuracy-card__value--low";
}

const CLASS_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

function ClassificationBreakdown({ classifications }: { classifications: Record<string, number> }) {
  const entries = CLASS_ORDER.filter((c) => classifications[c]).map((c) => ({
    cls: c,
    count: classifications[c],
  }));
  if (entries.length === 0) return null;

  return (
    <div className="classification-grid">
      {entries.map(({ cls, count }) => (
        <span key={cls} className="classification-stat">
          <ClassificationBadge classification={cls} />
          <span>{count}</span>
        </span>
      ))}
    </div>
  );
}

function CriticalMomentItem({ cm, onClick }: { cm: CriticalMoment; onClick: () => void }) {
  const isGainForWhite = cm.win_prob_after > cm.win_prob_before;
  const direction = cm.color === "white"
    ? (isGainForWhite ? "+" : "-")
    : (isGainForWhite ? "-" : "+");
  const swingPct = (cm.swing * 100).toFixed(0);

  return (
    <div className="critical-moment-item" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      aria-label={`Critical moment: ${cm.move_number}${cm.color === "black" ? "..." : "."} ${cm.san}`}
    >
      <ClassificationBadge classification={cm.classification} />
      <span>
        {cm.move_number}{cm.color === "black" ? "..." : "."} {cm.san}
      </span>
      <span
        className={`critical-moment-item__swing ${direction === "+" ? "critical-moment-item__swing--positive" : "critical-moment-item__swing--negative"}`}
        style={{ marginLeft: "auto" }}
      >
        {direction}{swingPct}%
      </span>
    </div>
  );
}

const AnalysisPanel = forwardRef<HTMLDivElement, Props>(function AnalysisPanel(
  { analysis, whiteModel, blackModel, onSelectMove, moves, onExport, exporting },
  ref,
) {
  return (
    <div className="analysis-panel panel" ref={ref}>
      <div className="analysis-panel__title">
        Post-Game Analysis
        {onExport && (
          <button
            className="btn btn--ghost btn--sm analysis-panel__export-btn"
            onClick={onExport}
            disabled={exporting}
            title="Export analysis as PNG"
          >
            {exporting ? "Exporting..." : "\u{1F4F7} Export PNG"}
          </button>
        )}
      </div>

      {/* Accuracy cards */}
      <div className="analysis-panel__accuracy-row">
        <div className="accuracy-card">
          <div className={`accuracy-card__value ${accuracyClass(analysis.white_accuracy)}`}>
            {analysis.white_accuracy != null ? `${analysis.white_accuracy.toFixed(1)}%` : "--"}
          </div>
          <div className="accuracy-card__label">{formatModelName(whiteModel)}</div>
          {analysis.white_acpl != null && (
            <div className="accuracy-card__acpl">ACPL: {analysis.white_acpl.toFixed(1)}</div>
          )}
          <ClassificationBreakdown classifications={analysis.white_classifications} />
        </div>
        <div className="accuracy-card">
          <div className={`accuracy-card__value ${accuracyClass(analysis.black_accuracy)}`}>
            {analysis.black_accuracy != null ? `${analysis.black_accuracy.toFixed(1)}%` : "--"}
          </div>
          <div className="accuracy-card__label">{formatModelName(blackModel)}</div>
          {analysis.black_acpl != null && (
            <div className="accuracy-card__acpl">ACPL: {analysis.black_acpl.toFixed(1)}</div>
          )}
          <ClassificationBreakdown classifications={analysis.black_classifications} />
        </div>
      </div>

      {/* Stats comparison */}
      <div className="analysis-panel__stats">
        <div className="analysis-panel__stat-row">
          <span className="analysis-panel__stat-val">{(analysis.white_avg_response_ms / 1000).toFixed(1)}s</span>
          <span className="analysis-panel__stat-label">Avg Response</span>
          <span className="analysis-panel__stat-val">{(analysis.black_avg_response_ms / 1000).toFixed(1)}s</span>
        </div>
        <div className="analysis-panel__stat-row">
          <span className="analysis-panel__stat-val">{analysis.white_total_tokens.toLocaleString()}</span>
          <span className="analysis-panel__stat-label">Total Tokens</span>
          <span className="analysis-panel__stat-val">{analysis.black_total_tokens.toLocaleString()}</span>
        </div>
        <div className="analysis-panel__stat-row">
          <span className="analysis-panel__stat-val">${analysis.white_total_cost.toFixed(4)}</span>
          <span className="analysis-panel__stat-label">Cost</span>
          <span className="analysis-panel__stat-val">${analysis.black_total_cost.toFixed(4)}</span>
        </div>
      </div>

      {/* Critical moments */}
      {analysis.critical_moments.length > 0 && (
        <div className="critical-moments">
          <div className="analysis-panel__subtitle">Critical Moments</div>
          <div className="critical-moments__list">
            {analysis.critical_moments.map((cm) => (
              <CriticalMomentItem
                key={cm.move_index}
                cm={cm}
                onClick={() => onSelectMove?.(cm.move_index)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Tokens per move chart */}
      {moves && moves.length > 0 && <TokensPerMoveChart moves={moves} />}
    </div>
  );
});

export default AnalysisPanel;
