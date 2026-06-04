import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";
import type { EnhancedModelStats } from "../types/api";
import { formatModelName } from "../utils/formatModel";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";
import InfoDot from "../components/shared/InfoDot";
import { HELP } from "../components/shared/helpText";

type SortMode = "strength" | "value" | "speed";

// ELO per dollar spent per game. Guards against zero/near-zero cost.
function eloPerDollar(m: EnhancedModelStats): number {
  if (!m.avg_cost_per_game || m.avg_cost_per_game <= 0) return 0;
  return m.elo_rating / m.avg_cost_per_game;
}

// Accuracy percentage per dollar spent per game. Null accuracy -> null.
function accuracyPerDollar(m: EnhancedModelStats): number | null {
  if (m.avg_accuracy == null) return null;
  if (!m.avg_cost_per_game || m.avg_cost_per_game <= 0) return null;
  return m.avg_accuracy / m.avg_cost_per_game;
}

function sortModels(list: EnhancedModelStats[], sortMode: SortMode): EnhancedModelStats[] {
  const copy = [...list];
  if (sortMode === "value") {
    copy.sort((a, b) => eloPerDollar(b) - eloPerDollar(a));
  } else if (sortMode === "speed") {
    // Fastest first; treat 0 (no data) as slowest so it sinks.
    copy.sort((a, b) => {
      const av = a.avg_response_ms > 0 ? a.avg_response_ms : Infinity;
      const bv = b.avg_response_ms > 0 ? b.avg_response_ms : Infinity;
      return av - bv;
    });
  } else {
    copy.sort((a, b) => b.elo_rating - a.elo_rating);
  }
  return copy;
}

export default function LeaderboardPage() {
  const [showHuman, setShowHuman] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("strength");
  const state = useAsync<EnhancedModelStats[]>(
    getLeaderboard,
    [],
    (d) => d.length === 0,
  );

  return (
    <div className="leaderboard-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", gap: "1rem", flexWrap: "wrap" }}>
        <h1 className="leaderboard-page__title" style={{ marginBottom: 0 }}>Leaderboard</h1>
        <div className="leaderboard-page__controls">
          <div className="leaderboard-sort" role="group" aria-label="Sort leaderboard">
            <span className="leaderboard-sort__label">Sort</span>
            <button
              className={`filter-btn${sortMode === "strength" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("strength")}
              aria-pressed={sortMode === "strength"}
            >
              Strength
            </button>
            <button
              className={`filter-btn${sortMode === "value" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("value")}
              aria-pressed={sortMode === "value"}
            >
              Value
            </button>
            <button
              className={`filter-btn${sortMode === "speed" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("speed")}
              aria-pressed={sortMode === "speed"}
            >
              Speed
            </button>
          </div>
          <span className="leaderboard-page__divider" aria-hidden="true" />
          <label className="toggle-check">
            <input
              type="checkbox"
              className="toggle-check__input"
              checked={showHuman}
              onChange={(e) => setShowHuman(e.target.checked)}
            />
            <span className="toggle-check__box" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
                <path d="M2 8.5l3.5 3.5L14 3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span className="toggle-check__text">Include Human</span>
          </label>
        </div>
      </div>

      <AsyncBoundary
        state={state}
        empty={
          <div className="empty-state panel">
            <div className="empty-state__icon">&#9813;</div>
            <div className="empty-state__text">
              No models ranked yet. Play some games first!
            </div>
            <Link to="/" className="btn btn--primary">
              Start a game
            </Link>
          </div>
        }
      >
        {(models) => {
          const filtered = showHuman ? models : models.filter((m) => m.id !== "Human");
          const displayModels = sortModels(filtered, sortMode);
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
                      {sortMode === "value" && <th>ELO / $</th>}
                      {sortMode === "value" && <th>Acc / $</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {displayModels.map((model, i) => {
                      const rank = i + 1;
                      const barWidth = Math.max(4, ((model.elo_rating - minElo) / eloRange) * 80);
                      const rankCls = rank <= 3 ? ` leaderboard__rank--${rank}` : "";
                      const epd = eloPerDollar(model);
                      const apd = accuracyPerDollar(model);
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
                          {sortMode === "value" && (
                            <td>
                              <span className="leaderboard__value">
                                {epd > 0 ? Math.round(epd).toLocaleString() : "--"}
                              </span>
                            </td>
                          )}
                          {sortMode === "value" && (
                            <td>
                              <span className="leaderboard__value">
                                {apd != null ? apd.toFixed(0) : "--"}
                              </span>
                            </td>
                          )}
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
