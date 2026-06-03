import { useState } from "react";
import { Link } from "react-router-dom";
import { getOpeningStats } from "../api/client";
import type { OpeningStats } from "../types/api";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";

export default function OpeningExplorerPage() {
  const [sortBy, setSortBy] = useState<"games" | "white_wr" | "eco">("games");
  const state = useAsync<OpeningStats[]>(
    getOpeningStats,
    [],
    (d) => d.length === 0,
  );

  return (
    <div className="opening-explorer-page">
      <h1 className="opening-explorer-page__title">Opening Explorer</h1>
      <p className="opening-explorer-page__subtitle">
        Win rates by opening across all completed games.
      </p>

      <AsyncBoundary
        state={state}
        empty={
          <div className="empty-state panel">
            <div className="empty-state__icon">&#9816;</div>
            <div className="empty-state__text">
              No completed games with opening data yet. <Link to="/" className="opening-explorer-page__eco-link">Start a game</Link>.
            </div>
          </div>
        }
      >
        {(openings) => {
          const sorted = [...openings].sort((a, b) => {
            if (sortBy === "games") return b.total_games - a.total_games;
            if (sortBy === "eco") return a.eco.localeCompare(b.eco);
            const wrA = a.total_games > 0 ? a.white_wins / a.total_games : 0;
            const wrB = b.total_games > 0 ? b.white_wins / b.total_games : 0;
            return wrB - wrA;
          });

          return (
            <div className="opening-explorer-page__table-wrap panel">
              <table className="opening-explorer-page__table">
                <thead>
                  <tr>
                    <th onClick={() => setSortBy("eco")} className="opening-explorer-page__th--sortable">
                      ECO {sortBy === "eco" && "▲"}
                    </th>
                    <th>Opening</th>
                    <th onClick={() => setSortBy("games")} className="opening-explorer-page__th--sortable">
                      Games {sortBy === "games" && "▼"}
                    </th>
                    <th onClick={() => setSortBy("white_wr")} className="opening-explorer-page__th--sortable">
                      White WR {sortBy === "white_wr" && "▼"}
                    </th>
                    <th>Draw</th>
                    <th>Black WR</th>
                    <th>Result Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((o) => {
                    const wPct = o.total_games > 0 ? (o.white_wins / o.total_games) * 100 : 0;
                    const dPct = o.total_games > 0 ? (o.draws / o.total_games) * 100 : 0;
                    const bPct = o.total_games > 0 ? (o.black_wins / o.total_games) * 100 : 0;
                    return (
                      <tr key={o.eco}>
                        <td>
                          <Link to={`/?opening=${o.eco}`} className="opening-explorer-page__eco-link">
                            {o.eco}
                          </Link>
                        </td>
                        <td className="opening-explorer-page__name">{o.name}</td>
                        <td>{o.total_games}</td>
                        <td>{wPct.toFixed(0)}%</td>
                        <td>{dPct.toFixed(0)}%</td>
                        <td>{bPct.toFixed(0)}%</td>
                        <td>
                          <div className="opening-explorer-page__result-bar">
                            <div className="opening-explorer-page__bar-w" style={{ width: `${wPct}%` }} />
                            <div className="opening-explorer-page__bar-d" style={{ width: `${dPct}%` }} />
                            <div className="opening-explorer-page__bar-b" style={{ width: `${bPct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
