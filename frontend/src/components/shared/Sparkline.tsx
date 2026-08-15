interface SparklineProps {
  points: number[];
  width?: number;
  height?: number;
}

/** Tiny inline ELO trend line; green when trending up, red when down. */
export default function Sparkline({ points, width = 72, height = 20 }: SparklineProps) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points
    .map((p, i) => `${(i * step).toFixed(1)},${(height - 2 - ((p - min) / range) * (height - 4)).toFixed(1)}`)
    .join(" ");
  const up = points[points.length - 1] >= points[0];
  return (
    <svg width={width} height={height} className="sparkline" aria-hidden="true">
      <polyline
        points={coords}
        fill="none"
        stroke={up ? "var(--brilliant)" : "var(--blunder)"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
