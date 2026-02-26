import { Link } from "react-router-dom";
import type { HeadToHeadRecord } from "../../types/api";

interface Props {
  records: HeadToHeadRecord[];
}

function formatModelName(id: string, displayName: string | null): string {
  if (displayName) return displayName;
  const parts = id.split("/");
  return parts[parts.length - 1];
}

export default function HeadToHeadTable({ records }: Props) {
  if (records.length === 0) {
    return (
      <div className="empty-state" style={{ padding: "1.5rem" }}>
        <div className="empty-state__text">No head-to-head data yet.</div>
      </div>
    );
  }

  return (
    <table className="leaderboard-table">
      <thead>
        <tr>
          <th>Opponent</th>
          <th>Record (W-D-L)</th>
          <th>Win Rate</th>
          <th>Games</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => {
          const winRate = r.total_games > 0 ? (r.wins / r.total_games) * 100 : 0;
          return (
            <tr key={r.opponent}>
              <td>
                <Link to={`/model/${r.opponent}`} className="leaderboard__model-link">
                  {formatModelName(r.opponent, r.opponent_display_name)}
                </Link>
              </td>
              <td>
                <span className="leaderboard__record">
                  {r.wins} - {r.draws} - {r.losses}
                </span>
              </td>
              <td>
                <span className="leaderboard__winrate">{winRate.toFixed(0)}%</span>
              </td>
              <td>
                <span className="leaderboard__record">{r.total_games}</span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
