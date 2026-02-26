import { useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  ReferenceDot,
} from "recharts";
import type { MoveData } from "../../types/websocket";
import type { CriticalMoment } from "../../types/api";

interface Props {
  moves: MoveData[];
  selectedIndex: number;
  onSelectMove: (index: number) => void;
  criticalMoments?: CriticalMoment[];
}

interface DataPoint {
  index: number;
  label: string;
  wp: number;
}

export default function WinProbGraph({ moves, selectedIndex, onSelectMove, criticalMoments }: Props) {
  const data = useMemo<DataPoint[]>(() => {
    const points: DataPoint[] = [{ index: -1, label: "Start", wp: 50 }];
    for (let i = 0; i < moves.length; i++) {
      const wp = moves[i].winProbability != null ? moves[i].winProbability! * 100 : 50;
      const m = moves[i];
      points.push({
        index: i,
        label: `${m.moveNumber}${m.color === "black" ? "..." : "."} ${m.san}`,
        wp,
      });
    }
    return points;
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

  const selectedDataIndex = selectedIndex + 1; // offset by 1 for "Start" point

  return (
    <div className="win-prob-graph panel">
      <ResponsiveContainer width="100%" height={100}>
        <AreaChart data={data} onClick={handleClick} margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
          <defs>
            <linearGradient id="wpGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e8e4dd" stopOpacity={0.6} />
              <stop offset="50%" stopColor="#e8e4dd" stopOpacity={0.05} />
              <stop offset="50%" stopColor="#18191f" stopOpacity={0.05} />
              <stop offset="100%" stopColor="#18191f" stopOpacity={0.6} />
            </linearGradient>
          </defs>
          <XAxis dataKey="index" hide />
          <YAxis domain={[0, 100]} hide />
          <ReferenceLine y={50} stroke="#333" strokeDasharray="3 3" />
          {selectedDataIndex >= 0 && selectedDataIndex < data.length && (
            <ReferenceLine x={data[selectedDataIndex]?.index} stroke="#d4a843" strokeWidth={1.5} />
          )}
          {criticalMoments?.map((cm) => (
            <ReferenceDot
              key={cm.move_index}
              x={cm.move_index}
              y={cm.win_prob_after * 100}
              r={3}
              fill={cm.swing > 0.25 ? "#ca3431" : "#e6b422"}
              stroke="none"
            />
          ))}
          <Area
            type="monotone"
            dataKey="wp"
            stroke="#908e87"
            strokeWidth={1.5}
            fill="url(#wpGradient)"
            isAnimationActive={false}
          />
          <Tooltip
            contentStyle={{
              background: "#14161f",
              border: "1px solid #272b3d",
              borderRadius: "6px",
              fontSize: "0.75rem",
              fontFamily: "var(--font-mono)",
              color: "#e8e4dd",
            }}
            formatter={(value: number | undefined) => [`${(value ?? 50).toFixed(1)}%`, "White Win Prob"]}
            labelFormatter={(_, payload) => {
              if (payload?.[0]?.payload?.label) return payload[0].payload.label;
              return "";
            }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
