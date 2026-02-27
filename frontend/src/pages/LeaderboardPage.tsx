import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";
import type { EnhancedModelStats } from "../types/api";

function formatModelName(id: string, displayName: string | null): string {
  if (displayName) return displayName;
  const parts = id.split("/");
  return parts[parts.length - 1];
}

export default function LeaderboardPage() {
  const [models, setModels] = useState<EnhancedModelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHuman, setShowHuman] = useState(true);

  useEffect(() => {
    getLeaderboard()
      .then(setModels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  const displayModels = showHuman
    ? models
    : models.filter((m) => m.id !== "Human");

  const maxElo = displayModels.length > 0 ? Math.max(...displayModels.map((m) => m.elo_rating)) : 1500;
  const minElo = displayModels.length > 0 ? Math.min(...displayModels.map((m) => m.elo_rating)) : 1500;
  const eloRange = maxElo - minElo || 1;

  return (
    <div className="leaderboard-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <h1 className="leaderboard-page__title" style={{ marginBottom: 0 }}>Leaderboard</h1>
        <button
          className={`filter-btn${showHuman ? " filter-btn--active" : ""}`}
          onClick={() => setShowHuman(!showHuman)}
        >
          Include Human
        </button>
      </div>
      {displayModels.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9813;</div>
          <div className="empty-state__text">
            No models ranked yet. Play some games first!
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="leaderboard-table-wrap">
          <table className="leaderboard-table leaderboard-table--enhanced">
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>ELO</th>
                <th>W / D / L</th>
                <th>Win %</th>
                <th>Accuracy</th>
                <th>ACPL</th>
                <th>Avg Cost</th>
                <th>Avg Time</th>
              </tr>
            </thead>
            <tbody>
              {displayModels.map((model, i) => {
                const rank = i + 1;
                const barWidth = Math.max(4, ((model.elo_rating - minElo) / eloRange) * 80);
                const rankCls = rank <= 3 ? ` leaderboard__rank--${rank}` : "";
                return (
                  <tr key={model.id}>
                    <td>
                      <span className={`leaderboard__rank${rankCls}`}>{rank}</span>
                    </td>
                    <td>
                      <Link to={`/model/${model.id}`} className="leaderboard__model-link">
                        {formatModelName(model.id, model.display_name)}
                      </Link>
                    </td>
                    <td>
                      <span className="leaderboard__elo">
                        {Math.round(model.elo_rating)}
                      </span>
                      <span
                        className="leaderboard__elo-bar"
                        style={{ width: `${barWidth}px` }}
                      />
                    </td>
                    <td>
                      <span className="leaderboard__record">
                        {model.wins} / {model.draws} / {model.losses}
                      </span>
                    </td>
                    <td>
                      <span className="leaderboard__winrate">
                        {model.win_rate.toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className="leaderboard__winrate">
                        {model.avg_accuracy != null ? `${model.avg_accuracy.toFixed(1)}%` : "--"}
                      </span>
                    </td>
                    <td>
                      {model.avg_acpl != null ? model.avg_acpl.toFixed(1) : "--"}
                    </td>
                    <td>
                      ${model.avg_cost_per_game.toFixed(4)}
                    </td>
                    <td>
                      {(model.avg_response_ms / 1000).toFixed(1)}s
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
