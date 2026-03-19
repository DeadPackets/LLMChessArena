import type { EngineLine } from "../../types/websocket";

interface Props {
  lines: EngineLine[];
  depth: number;
}

function formatEval(cp: number, mateIn: number | null): string {
  if (mateIn != null) {
    return mateIn > 0 ? `#${mateIn}` : `-#${Math.abs(mateIn)}`;
  }
  const abs = Math.abs(cp) / 100;
  const formatted = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
  return cp >= 0 ? `+${formatted}` : `-${formatted}`;
}

function evalColorClass(cp: number, mateIn: number | null): string {
  if (mateIn != null) return mateIn > 0 ? "engine-lines__eval--white" : "engine-lines__eval--black";
  if (cp > 50) return "engine-lines__eval--white";
  if (cp < -50) return "engine-lines__eval--black";
  return "engine-lines__eval--even";
}

export default function EngineLinesPanel({ lines, depth }: Props) {
  if (lines.length === 0) return null;

  return (
    <div className="engine-lines panel">
      <div className="engine-lines__header">
        <span className="engine-lines__title">Engine Lines</span>
        <span className="engine-lines__depth">depth {depth}</span>
      </div>
      <div className="engine-lines__list">
        {lines.map((line) => (
          <div key={line.rank} className="engine-lines__row">
            <span className={`engine-lines__eval ${evalColorClass(line.centipawns, line.mate_in)}`}>
              {formatEval(line.centipawns, line.mate_in)}
            </span>
            <span className="engine-lines__move">{line.move_uci}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
