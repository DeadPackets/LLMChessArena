import type { GameEfficiency } from "../../types/api";
import { formatRequestCost } from "../../utils/efficiency";

interface Props {
  data: GameEfficiency | null;
  error: string | null;
  onRetry: () => void;
  active: boolean;
  expanded?: boolean;
  refreshing?: boolean;
}

export default function GameEfficiencyPanel({ data, error, onRetry, active, expanded = true, refreshing = false }: Props) {
  return (
    <section id="game-usage-details" className="game-efficiency" aria-label="Usage details" hidden={!expanded}>
      {error && (
        <p role="status">
          {error} {data ? "Showing the last update. " : ""}
          <button type="button" className="btn btn--ghost game-efficiency__retry" onClick={onRetry} disabled={refreshing}>{refreshing ? "Retrying…" : "Retry"}</button>
        </p>
      )}
      {!data && !error && <p role="status">Loading request usage…</p>}
      {data?.request_count === 0 && (
        <p>{active ? "No requests recorded yet." : "Request usage not recorded for this game."}</p>
      )}
      {data && data.request_count > 0 && (
        <>
          <dl className="game-efficiency__metrics">
            <div><dt>Spend · all attempts</dt><dd>{formatRequestCost(data)}</dd></div>
            <div><dt>Requests</dt><dd>{data.request_count.toLocaleString()}</dd></div>
            <div><dt>Retries</dt><dd>{data.retry_count.toLocaleString()}</dd></div>
            <div><dt>Retry spend</dt><dd>{data.retry_cost_usd === null ? "Unknown" : `$${data.retry_cost_usd.toFixed(4)}`}</dd></div>
            <div><dt>Cached input</dt><dd>{data.cache_hit_ratio === null ? "Not reported" : `${(data.cache_hit_ratio * 100).toFixed(1)}%`}</dd></div>
            <div><dt>Average move time</dt><dd>{data.avg_move_ms === null ? "Not recorded" : `${(data.avg_move_ms / 1000).toFixed(1)} s`}</dd></div>
          </dl>
          <p>
            Includes retries. Cost reported for {data.cost_known_requests}/{data.request_count} requests;
            cache usage for {data.cache_known_requests}/{data.request_count}.
            {data.total_cost_usd === null ? " Total spend is unknown." : ""}
          </p>
          {data.providers.length > 0 && <p>Providers: {data.providers.join(", ")}</p>}
        </>
      )}
    </section>
  );
}
