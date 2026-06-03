import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";
import type { EnhancedModelStats } from "../types/api";
import { formatModelName } from "../utils/formatModel";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";
import InfoDot from "../components/shared/InfoDot";
import { HELP } from "../components/shared/helpText";

export default function LeaderboardPage() {
  const [showHuman, setShowHuman] = useState(true);
  const state = useAsync<EnhancedModelStats[]>(
    getLeaderboard,
    [],
    (d) => d.length === 0,
  );

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

      <AsyncBoundary
        state={state}
        empty={
          <div className="empty-state panel">
            <div className="empty-state__icon">&#9813;</div>
            <div className="empty-state__text">
              No models ranked yet. Play some games first!
            </div>
            <Link to="/" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
              Start a game
            </Link>
          </div>
        }
      >
        {(models) => {
          const displayModels = showHuman ? models : models.filter((m) => m.id !== "Human");
          const maxElo = displayModels.length > 0 ? Math.max(...displayModels.map((m) => m.elo_rating)) : 1500;
          const minElo = displayModels.length > 0 ? Math.min(...displayModels.map((m) => m.elo_rating)) : 1500;
          const eloRange = maxElo - minElo || 1;

          if (displayModels.length === 0) {
            return (
              <div className="empty-state panel">
                <div className="empty-state__icon">&#9813;</div>
                <div className="empty-state__text">No models match this filter.</div>
              </div>
            );
          }

          return (
            <div className="panel">
              <div className="leaderboard-mobile-caption">
                Tap a model for accuracy, ACPL, cost &amp; response time.
              </div>
              <div className="leaderboard-table-wrap">
                <table className="leaderboard-table leaderboard-table--enhanced">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Model</th>
                      <th>ELO<InfoDot label={HELP.elo} /></th>
                      <th>W / D / L</th>
                      <th>Win %</th>
                      <th>Accuracy<InfoDot label={HELP.accuracy} /></th>
                      <th>ACPL<InfoDot label={HELP.acpl} /></th>
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
                            <span className="leaderboard__elo">{Math.round(model.elo_rating)}</span>
                            <span className="leaderboard__elo-bar" style={{ width: `${barWidth}px` }} />
                          </td>
                          <td>
                            <span className="leaderboard__record">
                              {model.wins} / {model.draws} / {model.losses}
                            </span>
                          </td>
                          <td>
                            <span className="leaderboard__winrate">{model.win_rate.toFixed(0)}%</span>
                          </td>
                          <td>
                            <span className="leaderboard__winrate">
                              {model.avg_accuracy != null ? `${model.avg_accuracy.toFixed(1)}%` : "--"}
                            </span>
                          </td>
                          <td>{model.avg_acpl != null ? model.avg_acpl.toFixed(1) : "--"}</td>
                          <td>${model.avg_cost_per_game.toFixed(4)}</td>
                          <td>{(model.avg_response_ms / 1000).toFixed(1)}s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
