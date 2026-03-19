const SYMBOLS: Record<string, string> = {
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

  const symbol = SYMBOLS[classification] ?? "";

  return (
    <span
      className={`classification-badge classification-badge--${classification}`}
      title={classification}
      aria-label={`Move classified as ${classification}`}
    >
      {symbol}
    </span>
  );
}
