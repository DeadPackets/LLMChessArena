import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { getEloHistory } from "../../api/client";
import type { EloHistoryPoint } from "../../types/api";

interface Props {
  modelId: string;
  currentElo: number;
}

export default function EloHistoryChart({ modelId, currentElo }: Props) {
  const [history, setHistory] = useState<EloHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getEloHistory(modelId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [modelId]);

  if (loading) return null;
  if (history.length < 2) return null;

  const data = [
    { game: 0, elo: 1500, label: "Start" },
    ...history.map((h, i) => ({
      game: i + 1,
      elo: h.elo_after,
      change: h.elo_change,
      opponent: h.opponent.split("/").pop() || h.opponent,
      outcome: h.outcome,
      label: `Game ${i + 1}`,
    })),
  ];

  const minElo = Math.min(...data.map((d) => d.elo)) - 20;
  const maxElo = Math.max(...data.map((d) => d.elo)) + 20;

  return (
    <div className="panel" style={{ padding: "1rem" }}>
      <div className="analysis-panel__title">ELO History</div>
      <div style={{ width: "100%", height: 200, marginTop: "0.5rem" }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: 10 }}>
            <XAxis
              dataKey="game"
              tick={{ fill: "#7a7870", fontSize: 11 }}
              axisLine={{ stroke: "#1c1f2e" }}
              tickLine={false}
            />
            <YAxis
              domain={[minElo, maxElo]}
              tick={{ fill: "#7a7870", fontSize: 11 }}
              axisLine={{ stroke: "#1c1f2e" }}
              tickLine={false}
              width={45}
            />
            <ReferenceLine y={1500} stroke="#1c1f2e" strokeDasharray="3 3" />
            <Tooltip
              contentStyle={{
                background: "#14161f",
                border: "1px solid #1c1f2e",
                borderRadius: 8,
                fontSize: "0.78rem",
                color: "#e8e4dd",
              }}
              formatter={((value: number, _name: string, props: any) => {
                const p = props.payload;
                const changeStr = p.change != null ? ` (${p.change > 0 ? "+" : ""}${p.change})` : "";
                return [`${value.toFixed(1)}${changeStr}`, "ELO"];
              }) as any}
              labelFormatter={(label: any) => {
                const idx = typeof label === "number" ? label : parseInt(label, 10);
                const point = data[idx];
                if (!point || idx === 0) return "Start";
                const p = point as typeof data[number] & { opponent?: string; outcome?: string };
                return p.opponent ? `vs ${p.opponent} (${p.outcome})` : `Game ${idx}`;
              }}
            />
            <Line
              type="monotone"
              dataKey="elo"
              stroke="#d4a843"
              strokeWidth={2}
              dot={{ r: 3, fill: "#d4a843", stroke: "#0e1017", strokeWidth: 1 }}
              activeDot={{ r: 5, fill: "#f0c050" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div style={{ textAlign: "center", color: "var(--text-muted)", fontSize: "0.72rem", marginTop: "0.25rem" }}>
        Current: {Math.round(currentElo)} ELO across {history.length} rated game{history.length !== 1 ? "s" : ""}
      </div>
    </div>
  );
}
