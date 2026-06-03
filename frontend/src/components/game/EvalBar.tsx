import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";

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

  // Parity: no advantage label on either side -> show a subtle "=" at center.
  const isEven = topLabel === "" && bottomLabel === "";

  const topTitle = topLabel ? `Black advantage: ${topLabel}` : undefined;
  const bottomTitle = bottomLabel ? `White advantage: ${bottomLabel}` : undefined;

  // Spoken description of the evaluation.
  let valueText: string;
  if (mateIn != null) {
    valueText =
      mateIn > 0
        ? `White has mate in ${mateIn}`
        : `Black has mate in ${Math.abs(mateIn)}`;
  } else if (isEven) {
    valueText = "Even";
  } else {
    const side = bottomLabel ? "White" : "Black";
    const sidePct = bottomLabel ? whitePct : 100 - whitePct;
    const pawns = bottomLabel || topLabel; // already "+x.y"
    valueText = `${side} ${sidePct.toFixed(0)}% win probability, ${pawns}`;
  }

  return (
    <div
      className="eval-bar"
      role="meter"
      aria-label="Position evaluation: White win probability and pawn advantage"
      aria-valuenow={whitePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
    >
      <span className="eval-bar__info">
        <InfoDot label={mateIn != null ? HELP.mateIn : HELP.eval} triggerLabel="What the eval bar means" />
      </span>
      {topLabel && <span className="eval-bar__label eval-bar__label--top" title={topTitle}>{topLabel}</span>}
      {isEven && (
        <span className="eval-bar__label eval-bar__label--even" aria-hidden="true">=</span>
      )}
      <div className="eval-bar__fill" style={{ height: `${whitePct}%` }} />
      {bottomLabel && <span className="eval-bar__label eval-bar__label--bottom" title={bottomTitle}>{bottomLabel}</span>}
    </div>
  );
}
