import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { compareModels, getLeaderboard } from "../api/client";
import type { HeadToHeadComparison, EnhancedModelStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import { formatModelName } from "../utils/formatModel";

export default function HeadToHeadPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const paramA = searchParams.get("a") || "";
  const paramB = searchParams.get("b") || "";

  const [models, setModels] = useState<EnhancedModelStats[]>([]);
  const [modelA, setModelA] = useState(paramA);
  const [modelB, setModelB] = useState(paramB);
  const [comparison, setComparison] = useState<HeadToHeadComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch model list for dropdowns
  useEffect(() => {
    getLeaderboard().then(setModels).catch(() => {});
  }, []);

  // Auto-compare when URL params are set
  useEffect(() => {
    if (paramA && paramB) {
      setModelA(paramA);
      setModelB(paramB);
      setLoading(true);
      setError(null);
      compareModels(paramA, paramB)
        .then(setComparison)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
        .finally(() => setLoading(false));
    }
  }, [paramA, paramB]);

  function handleCompare() {
    if (!modelA || !modelB || modelA === modelB) return;
    setSearchParams({ a: modelA, b: modelB }, { replace: true });
  }

  const total = comparison ? comparison.total_games : 0;

  return (
    <div className="h2h-page">
      <h1 className="h2h-page__title">Head-to-Head Comparison</h1>

      <div className="h2h-page__selector">
        <select
          className="h2h-page__select"
          value={modelA}
          onChange={(e) => setModelA(e.target.value)}
        >
          <option value="">Select Model A</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{formatModelName(m.id, m.display_name)} ({Math.round(m.elo_rating)})</option>
          ))}
        </select>
        <span className="h2h-page__vs">vs</span>
        <select
          className="h2h-page__select"
          value={modelB}
          onChange={(e) => setModelB(e.target.value)}
        >
          <option value="">Select Model B</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>{formatModelName(m.id, m.display_name)} ({Math.round(m.elo_rating)})</option>
          ))}
        </select>
        <button
          className="btn btn--primary"
          onClick={handleCompare}
          disabled={!modelA || !modelB || modelA === modelB}
        >
          Compare
        </button>
      </div>

      {loading && (
        <div className="spinner-page"><div className="spinner-lg" /></div>
      )}

      {error && (
        <div className="empty-state panel">
          <div className="empty-state__text">{error}</div>
        </div>
      )}

      {comparison && !loading && (
        <>
          {/* Score banner */}
          <div className="h2h-page__score panel">
            <div className="h2h-page__score-side">
              <div className="h2h-page__score-name">{formatModelName(comparison.model_a, comparison.model_a_display)}</div>
              <div className="h2h-page__score-elo">{Math.round(comparison.model_a_elo)} ELO</div>
            </div>
            <div className="h2h-page__score-center">
              <div className="h2h-page__score-record">
                <span className="h2h-page__score-wins">{comparison.model_a_wins}</span>
                <span className="h2h-page__score-draws">{comparison.draws}</span>
                <span className="h2h-page__score-wins">{comparison.model_b_wins}</span>
              </div>
              <div className="h2h-page__score-labels">
                <span>W</span><span>D</span><span>W</span>
              </div>
              {total > 0 && (
                <div className="h2h-page__score-bar">
                  <div className="h2h-page__score-bar-a" style={{ width: `${(comparison.model_a_wins / total) * 100}%` }} />
                  <div className="h2h-page__score-bar-d" style={{ width: `${(comparison.draws / total) * 100}%` }} />
                  <div className="h2h-page__score-bar-b" style={{ width: `${(comparison.model_b_wins / total) * 100}%` }} />
                </div>
              )}
              <div className="h2h-page__score-total">{total} game{total !== 1 ? "s" : ""}</div>
            </div>
            <div className="h2h-page__score-side">
              <div className="h2h-page__score-name">{formatModelName(comparison.model_b, comparison.model_b_display)}</div>
              <div className="h2h-page__score-elo">{Math.round(comparison.model_b_elo)} ELO</div>
            </div>
          </div>

          {/* Stats comparison */}
          <div className="h2h-page__stats panel">
            <div className="analysis-panel__title">Statistics</div>
            <div className="analysis-panel__stats">
              <div className="analysis-panel__stat-row">
                <span className="analysis-panel__stat-val">
                  {comparison.model_a_avg_accuracy != null ? `${comparison.model_a_avg_accuracy.toFixed(1)}%` : "--"}
                </span>
                <span className="analysis-panel__stat-label">Accuracy</span>
                <span className="analysis-panel__stat-val">
                  {comparison.model_b_avg_accuracy != null ? `${comparison.model_b_avg_accuracy.toFixed(1)}%` : "--"}
                </span>
              </div>
              <div className="analysis-panel__stat-row">
                <span className="analysis-panel__stat-val">
                  {comparison.model_a_avg_acpl != null ? comparison.model_a_avg_acpl.toFixed(1) : "--"}
                </span>
                <span className="analysis-panel__stat-label">Avg ACPL</span>
                <span className="analysis-panel__stat-val">
                  {comparison.model_b_avg_acpl != null ? comparison.model_b_avg_acpl.toFixed(1) : "--"}
                </span>
              </div>
            </div>
          </div>

          {/* Recent games */}
          {comparison.recent_games.length > 0 && (
            <div>
              <div className="analysis-panel__title" style={{ marginBottom: "0.5rem" }}>Recent Games</div>
              <div className="game-list">
                {comparison.recent_games.map((g) => (
                  <GameCard key={g.id} game={g} />
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {!comparison && !loading && !error && (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">Select two models to compare their head-to-head record.</div>
        </div>
      )}
    </div>
  );
}
