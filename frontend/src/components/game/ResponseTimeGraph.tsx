import { useMemo, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import type { MoveData } from "../../types/websocket";

interface Props {
  moves: MoveData[];
  selectedIndex: number;
  onSelectMove: (index: number) => void;
}

interface DataPoint {
  index: number;
  label: string;
  ms: number;
  color: "white" | "black";
}

export default function ResponseTimeGraph({ moves, selectedIndex, onSelectMove }: Props) {
  const data = useMemo<DataPoint[]>(() => {
    return moves.map((m, i) => ({
      index: i,
      label: `${m.moveNumber}${m.color === "black" ? "..." : "."} ${m.san}`,
      ms: m.responseTimeMs,
      color: m.color,
    }));
  }, [moves]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleClick = useCallback(
    (state: any) => {
      if (state?.activeTooltipIndex != null && typeof state.activeTooltipIndex === "number") {
        const point = data[state.activeTooltipIndex];
        if (point) onSelectMove(point.index);
      }
    },
    [data, onSelectMove],
  );

  if (data.length === 0) return null;

  return (
    <div className="response-time-graph panel">
      <div className="response-time-graph__title">Response Time</div>
      <ResponsiveContainer width="100%" height={80}>
        <BarChart data={data} onClick={handleClick} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <XAxis dataKey="index" hide />
          <YAxis tick={{ fill: "#908e87", fontSize: 10 }} tickFormatter={(v: number) => `${(v / 1000).toFixed(0)}s`} width={32} />
          {selectedIndex >= 0 && selectedIndex < data.length && (
            <ReferenceLine x={selectedIndex} stroke="#d4a843" strokeWidth={1.5} />
          )}
          <Bar dataKey="ms" isAnimationActive={false} maxBarSize={6} radius={[2, 2, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.color === "white" ? "#c8c4bb" : "#4a4e5c"} />
            ))}
          </Bar>
          <Tooltip
            contentStyle={{
              background: "#14161f",
              border: "1px solid #272b3d",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              color: "#e8e4dd",
            }}
            formatter={(value: number | undefined) => [`${((value ?? 0) / 1000).toFixed(2)}s`, "Response"]}
            labelFormatter={(_, payload) => {
              if (payload?.[0]?.payload?.label) return payload[0].payload.label;
              return "";
            }}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
