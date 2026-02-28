import { useState, useEffect, useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Cell,
} from "recharts";
import { getStatsOverview } from "../api/client";
import type { PlatformOverview, ModelCostBreakdown } from "../types/api";
import { formatModelName } from "../utils/formatModel";

type SortKey = "cost" | "tokens" | "games" | "response";
type SortDir = "asc" | "desc";

const CHART_COLORS = [
  "#d4a843",
  "#6ba5e7",
  "#ca3431",
  "#5bb784",
  "#b87fd4",
  "#e0884d",
  "#3dc7c2",
  "#d46b8f",
];

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ChartTooltipStyle: any = {
  backgroundColor: "#14161f",
  border: "1px solid #272b3d",
  borderRadius: "6px",
  fontSize: "0.75rem",
  fontFamily: "var(--font-mono)",
  color: "#e8e4dd",
};

const ChartTooltipLabelStyle = { color: "#e8e4dd" };
const ChartTooltipItemStyle = { color: "#c8c4bb" };

export default function CostDashboardPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    getStatsOverview()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  const sortedBreakdowns = useMemo(() => {
    if (!data) return [];
    const items = [...data.model_breakdowns];
    items.sort((a, b) => {
      let va: number, vb: number;
      switch (sortKey) {
        case "cost": va = a.total_cost_usd; vb = b.total_cost_usd; break;
        case "tokens": va = a.total_input_tokens + a.total_output_tokens; vb = b.total_input_tokens + b.total_output_tokens; break;
        case "games": va = a.games_played; vb = b.games_played; break;
        case "response": va = a.avg_response_ms; vb = b.avg_response_ms; break;
      }
      return sortDir === "desc" ? vb - va : va - vb;
    });
    return items;
  }, [data, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty-state panel">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">{error || "No data available"}</div>
      </div>
    );
  }

  // Prepare chart data
  const costChartData = data.model_breakdowns
    .filter((m) => m.total_cost_usd > 0)
    .sort((a, b) => b.total_cost_usd - a.total_cost_usd)
    .map((m) => ({
      name: formatModelName(m.model_id, m.display_name),
      cost: m.total_cost_usd,
    }));

  const tokenChartData = data.model_breakdowns
    .filter((m) => m.total_input_tokens + m.total_output_tokens > 0)
    .sort((a, b) =>
      (b.total_input_tokens + b.total_output_tokens) - (a.total_input_tokens + a.total_output_tokens))
    .map((m) => ({
      name: formatModelName(m.model_id, m.display_name),
      input: m.total_input_tokens,
      output: m.total_output_tokens,
    }));

  const responseChartData = data.model_breakdowns
    .filter((m) => m.avg_response_ms > 0)
    .sort((a, b) => b.avg_response_ms - a.avg_response_ms)
    .map((m) => ({
      name: formatModelName(m.model_id, m.display_name),
      ms: m.avg_response_ms,
    }));

  const sortIndicator = (key: SortKey) => {
    if (sortKey !== key) return "";
    return sortDir === "desc" ? " \u25BC" : " \u25B2";
  };

  return (
    <div className="cost-dashboard">
      <h1 className="cost-dashboard__title">Cost & Performance</h1>

      {/* Summary cards */}
      <div className="cost-dashboard__summary">
        <div className="cost-dashboard__card">
          <div className="cost-dashboard__card-value">{data.total_completed}</div>
          <div className="cost-dashboard__card-label">Completed Games</div>
        </div>
        <div className="cost-dashboard__card">
          <div className="cost-dashboard__card-value">${data.total_cost_usd.toFixed(4)}</div>
          <div className="cost-dashboard__card-label">Total Cost</div>
        </div>
        <div className="cost-dashboard__card">
          <div className="cost-dashboard__card-value">{formatTokens(data.total_input_tokens + data.total_output_tokens)}</div>
          <div className="cost-dashboard__card-label">Total Tokens</div>
        </div>
        <div className="cost-dashboard__card">
          <div className="cost-dashboard__card-value">${data.avg_game_cost.toFixed(4)}</div>
          <div className="cost-dashboard__card-label">Avg Cost / Game</div>
        </div>
      </div>

      {/* Charts row */}
      <div className="cost-dashboard__charts">
        {/* Cost per model */}
        {costChartData.length > 0 && (
          <div className="cost-dashboard__chart panel">
            <div className="cost-dashboard__chart-title">Cost per Model</div>
            <ResponsiveContainer width="100%" height={Math.max(200, costChartData.length * 36)}>
              <BarChart data={costChartData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 10 }}>
                <XAxis type="number" tick={{ fill: "#908e87", fontSize: 11 }} tickFormatter={(v: number) => `$${v.toFixed(3)}`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#c8c4bb", fontSize: 11 }} />
                <Tooltip
                  contentStyle={ChartTooltipStyle}
                  labelStyle={ChartTooltipLabelStyle}
                  itemStyle={ChartTooltipItemStyle}
                  formatter={(value: number | undefined) => [`$${(value ?? 0).toFixed(6)}`, "Cost"]}
                />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {costChartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Token usage */}
        {tokenChartData.length > 0 && (
          <div className="cost-dashboard__chart panel">
            <div className="cost-dashboard__chart-title">Token Usage per Model</div>
            <ResponsiveContainer width="100%" height={Math.max(200, tokenChartData.length * 36)}>
              <BarChart data={tokenChartData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 10 }}>
                <XAxis type="number" tick={{ fill: "#908e87", fontSize: 11 }} tickFormatter={(v: number) => formatTokens(v)} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#c8c4bb", fontSize: 11 }} />
                <Tooltip
                  contentStyle={ChartTooltipStyle}
                  labelStyle={ChartTooltipLabelStyle}
                  itemStyle={ChartTooltipItemStyle}
                  formatter={(value: number | undefined, name: string | undefined) => [formatTokens(value ?? 0), name === "Input" ? "Input Tokens" : "Output Tokens"]}
                />
                <Legend wrapperStyle={{ color: "#908e87", fontSize: "0.75rem" }} />
                <Bar dataKey="input" stackId="tokens" fill="#6ba5e7" name="Input" radius={[0, 0, 0, 0]} maxBarSize={24} />
                <Bar dataKey="output" stackId="tokens" fill="#d4a843" name="Output" radius={[0, 4, 4, 0]} maxBarSize={24} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Response time */}
        {responseChartData.length > 0 && (
          <div className="cost-dashboard__chart panel">
            <div className="cost-dashboard__chart-title">Avg Response Time per Model</div>
            <ResponsiveContainer width="100%" height={Math.max(200, responseChartData.length * 36)}>
              <BarChart data={responseChartData} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 10 }}>
                <XAxis type="number" tick={{ fill: "#908e87", fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(1)}s`} />
                <YAxis type="category" dataKey="name" width={120} tick={{ fill: "#c8c4bb", fontSize: 11 }} />
                <Tooltip
                  contentStyle={ChartTooltipStyle}
                  labelStyle={ChartTooltipLabelStyle}
                  itemStyle={ChartTooltipItemStyle}
                  formatter={(value: number | undefined) => [`${((value ?? 0) / 1000).toFixed(2)}s`, "Avg Response"]}
                />
                <Bar dataKey="ms" radius={[0, 4, 4, 0]} maxBarSize={24}>
                  {responseChartData.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[(i + 2) % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Breakdown table */}
      {sortedBreakdowns.length > 0 && (
        <div className="cost-dashboard__table-wrap panel">
          <div className="cost-dashboard__chart-title">Model Breakdown</div>
          <table className="leaderboard-table">
            <thead>
              <tr>
                <th>Model</th>
                <th className="sortable-header" onClick={() => handleSort("games")}>
                  Games{sortIndicator("games")}
                </th>
                <th className="sortable-header" onClick={() => handleSort("cost")}>
                  Total Cost{sortIndicator("cost")}
                </th>
                <th>Avg Cost/Game</th>
                <th className="sortable-header" onClick={() => handleSort("tokens")}>
                  Total Tokens{sortIndicator("tokens")}
                </th>
                <th>Input / Output</th>
                <th className="sortable-header" onClick={() => handleSort("response")}>
                  Avg Response{sortIndicator("response")}
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedBreakdowns.map((m) => (
                <tr key={m.model_id}>
                  <td>
                    <span className="leaderboard__model-link" style={{ cursor: "default" }}>
                      {formatModelName(m.model_id, m.display_name)}
                    </span>
                  </td>
                  <td>{m.games_played}</td>
                  <td>${m.total_cost_usd.toFixed(4)}</td>
                  <td>${m.avg_cost_per_game.toFixed(4)}</td>
                  <td>{formatTokens(m.total_input_tokens + m.total_output_tokens)}</td>
                  <td>
                    <span style={{ color: "#6ba5e7" }}>{formatTokens(m.total_input_tokens)}</span>
                    {" / "}
                    <span style={{ color: "#d4a843" }}>{formatTokens(m.total_output_tokens)}</span>
                  </td>
                  <td>{(m.avg_response_ms / 1000).toFixed(1)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
