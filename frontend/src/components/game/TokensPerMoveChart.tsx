import { useMemo } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import type { MoveData } from "../../types/websocket";

interface Props {
  moves: MoveData[];
}

interface DataPoint {
  label: string;
  input: number;
  output: number;
}

function formatTokens(n: number): string {
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export default function TokensPerMoveChart({ moves }: Props) {
  const data = useMemo<DataPoint[]>(() => {
    return moves.map((m) => ({
      label: `${m.moveNumber}${m.color === "black" ? "..." : "."} ${m.san}`,
      input: m.inputTokens ?? 0,
      output: m.outputTokens ?? 0,
    }));
  }, [moves]);

  const hasTokens = data.some((d) => d.input > 0 || d.output > 0);
  if (!hasTokens) return null;

  return (
    <div className="tokens-chart">
      <div className="analysis-panel__subtitle">Tokens per Move</div>
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -10 }}>
          <XAxis dataKey="label" hide />
          <YAxis tick={{ fill: "#908e87", fontSize: 10 }} tickFormatter={(v: number) => formatTokens(v)} width={40} />
          <Tooltip
            contentStyle={{
              backgroundColor: "#14161f",
              border: "1px solid #272b3d",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              color: "#e8e4dd",
            }}
            labelStyle={{ color: "#e8e4dd" }}
            itemStyle={{ color: "#c8c4bb" }}
            formatter={(value: number | undefined, name: string | undefined) => [
              formatTokens(value ?? 0),
              name === "Input" ? "Input" : "Output",
            ]}
            labelFormatter={(label) => String(label)}
          />
          <Legend wrapperStyle={{ color: "#908e87", fontSize: "0.7rem" }} />
          <Bar dataKey="input" stackId="tok" fill="#6ba5e7" name="Input" maxBarSize={6} radius={[0, 0, 0, 0]} isAnimationActive={false} />
          <Bar dataKey="output" stackId="tok" fill="#d4a843" name="Output" maxBarSize={6} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
