import type { Classification } from "../../types/api";

const SYMBOLS: Record<Classification, string> = {
  brilliant: "!!",
  great: "!",
  best: "\u2605",
  excellent: "\u2713",
  good: "",
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};

interface Props {
  classification: string | null;
}

export default function ClassificationBadge({ classification }: Props) {
  if (!classification || classification === "good") return null;

  const cls = classification as Classification;
  const symbol = SYMBOLS[cls] ?? "";

  return (
    <span
      className={`classification-badge classification-badge--${cls}`}
      title={classification}
      aria-label={`Move classified as ${classification}`}
    >
      {symbol}
    </span>
  );
}
