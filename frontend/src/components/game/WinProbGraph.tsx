import { useMemo, useCallback } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import type { MoveData } from "../../types/websocket";
import type { CriticalMoment } from "../../types/api";
import { isClassification } from "../shared/classification";
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";

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

interface CriticalLabel {
  index: number;
  label: string;
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

  // Notable moments — kept only for the screen-reader summary and jump list.
  // The graph itself is intentionally dot-free; the eval line tells the story
  // and the move list / critical-moments panel carry the per-move detail.
  const criticalLabels = useMemo<CriticalLabel[]>(() => {
    const seen = new Set<number>();
    const result: CriticalLabel[] = [];

    for (let i = 0; i < moves.length; i++) {
      const cls = moves[i].classification;
      if (isClassification(cls) && cls !== "good") {
        result.push({
          index: i,
          label: `${moves[i].moveNumber}${moves[i].color === "black" ? "..." : "."} ${moves[i].san} (${cls})`,
        });
        seen.add(i);
      }
    }

    if (criticalMoments) {
      for (const cm of criticalMoments) {
        if (!seen.has(cm.move_index)) {
          const cls = cm.classification;
          result.push({
            index: cm.move_index,
            label: `${cm.san} (${cls ?? (cm.swing > 0.25 ? "blunder" : "inaccuracy")})`,
          });
        }
      }
    }

    return result.sort((a, b) => a.index - b.index);
  }, [moves, criticalMoments]);

  const summary =
    criticalLabels.length === 0
      ? "Win probability over the game. No critical moments."
      : `Win probability over the game. ${criticalLabels.length} critical moment${criticalLabels.length === 1 ? "" : "s"}: ` +
        criticalLabels.map((d) => d.label).join("; ") + ".";

  return (
    <div className="win-prob-graph panel" role="group" aria-label="Win probability graph">
      <div className="win-prob-graph__title" aria-hidden="true">
        Win Probability
        <InfoDot label={HELP.winProb} />
      </div>
      <h3 className="visually-hidden">Win probability</h3>
      <p className="visually-hidden">{summary}</p>
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
          <Area
            type="monotone"
            dataKey="wp"
            stroke="#a5a39c"
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
      <ul className="visually-hidden">
        {criticalLabels.map((d) => (
          <li key={`jump-${d.index}`}>
            <button type="button" onClick={() => onSelectMove(d.index)}>
              Go to {d.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
