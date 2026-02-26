import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getModelDetail } from "../api/client";
import type { ModelDetailStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import HeadToHeadTable from "../components/model/HeadToHeadTable";
import ClassificationBadge from "../components/shared/ClassificationBadge";

const CLASS_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

function formatModelName(id: string, displayName: string | null): string {
  if (displayName) return displayName;
  const parts = id.split("/");
  return parts[parts.length - 1];
}

export default function ModelDetailPage() {
  const location = useLocation();
  // Extract model ID from path: /model/openai/gpt-4o → "openai/gpt-4o"
  const modelId = location.pathname.replace(/^\/model\//, "");

  const [model, setModel] = useState<ModelDetailStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getModelDetail(modelId)
      .then(setModel)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [modelId]);

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="empty-state panel">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">{error || "Model not found"}</div>
      </div>
    );
  }

  const classEntries = CLASS_ORDER.filter((c) => model.classifications[c]).map((c) => ({
    cls: c,
    count: model.classifications[c],
  }));

  return (
    <div className="model-detail-page">
      <div className="model-detail-page__header">
        <div>
          <h1 className="model-detail-page__name">
            {formatModelName(model.id, model.display_name)}
          </h1>
          <div style={{ color: "var(--text-muted)", fontFamily: "var(--font-mono)", fontSize: "0.78rem" }}>
            {model.id}
          </div>
        </div>
        <div className="model-detail-page__elo">
          {Math.round(model.elo_rating)} ELO
        </div>
      </div>

      {/* Stats grid */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card__value">{model.games_played}</div>
          <div className="stat-card__label">Games</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{model.win_rate.toFixed(0)}%</div>
          <div className="stat-card__label">Win Rate</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">
            {model.avg_accuracy != null ? `${model.avg_accuracy.toFixed(1)}%` : "--"}
          </div>
          <div className="stat-card__label">Accuracy</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">
            {model.avg_acpl != null ? model.avg_acpl.toFixed(1) : "--"}
          </div>
          <div className="stat-card__label">Avg ACPL</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">${model.avg_cost_per_game.toFixed(4)}</div>
          <div className="stat-card__label">Avg Cost/Game</div>
        </div>
        <div className="stat-card">
          <div className="stat-card__value">{(model.avg_response_ms / 1000).toFixed(1)}s</div>
          <div className="stat-card__label">Avg Response</div>
        </div>
      </div>

      {/* Record + side breakdown */}
      <div className="panel" style={{ padding: "1rem" }}>
        <div className="analysis-panel__title">Performance</div>
        <div className="analysis-panel__stats">
          <div className="analysis-panel__stat-row">
            <span className="analysis-panel__stat-val">{model.wins}</span>
            <span className="analysis-panel__stat-label">Wins</span>
            <span className="analysis-panel__stat-val">{model.draws}</span>
            <span className="analysis-panel__stat-label">Draws</span>
            <span className="analysis-panel__stat-val">{model.losses}</span>
            <span className="analysis-panel__stat-label">Losses</span>
          </div>
          <div className="analysis-panel__stat-row" style={{ marginTop: "0.5rem" }}>
            <span className="analysis-panel__stat-val">{model.wins_as_white}/{model.games_as_white}</span>
            <span className="analysis-panel__stat-label">As White</span>
            <span className="analysis-panel__stat-val">{model.wins_as_black}/{model.games_as_black}</span>
            <span className="analysis-panel__stat-label">As Black</span>
          </div>
        </div>

        {classEntries.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="analysis-panel__subtitle">Move Classifications</div>
            <div className="classification-grid">
              {classEntries.map(({ cls, count }) => (
                <span key={cls} className="classification-stat">
                  <ClassificationBadge classification={cls} />
                  <span>{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Head to head */}
      {model.head_to_head.length > 0 && (
        <div className="panel" style={{ padding: "1rem" }}>
          <div className="analysis-panel__title">Head-to-Head</div>
          <HeadToHeadTable records={model.head_to_head} />
        </div>
      )}

      {/* Recent games */}
      {model.recent_games.length > 0 && (
        <div>
          <div className="analysis-panel__title" style={{ marginBottom: "0.5rem" }}>Recent Games</div>
          <div className="game-list">
            {model.recent_games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
