interface Props {
  winProbability: number | null;
  centipawns: number | null;
  mateIn: number | null;
}

export default function EvalBar({ winProbability, centipawns, mateIn }: Props) {
  const whitePct = winProbability != null ? winProbability * 100 : 50;

  let topLabel = "";
  let bottomLabel = "";

  if (mateIn != null) {
    // mateIn > 0 = White can force mate; mateIn < 0 = Black can force mate
    if (mateIn > 0) {
      bottomLabel = `#${mateIn}`;
    } else {
      topLabel = `#${Math.abs(mateIn)}`;
    }
  } else if (centipawns != null) {
    const abs = Math.abs(centipawns) / 100;
    const formatted = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
    if (centipawns > 0) {
      bottomLabel = `+${formatted}`;
    } else if (centipawns < 0) {
      topLabel = `+${formatted}`;
    }
  }

  const topTitle = topLabel ? `Black advantage: ${topLabel}` : undefined;
  const bottomTitle = bottomLabel ? `White advantage: ${bottomLabel}` : undefined;

  return (
    <div className="eval-bar" role="meter" aria-label="Position evaluation" aria-valuenow={whitePct} aria-valuemin={0} aria-valuemax={100}>
      {topLabel && <span className="eval-bar__label eval-bar__label--top" title={topTitle}>{topLabel}</span>}
      <div className="eval-bar__fill" style={{ height: `${whitePct}%` }} />
      {bottomLabel && <span className="eval-bar__label eval-bar__label--bottom" title={bottomTitle}>{bottomLabel}</span>}
    </div>
  );
}
