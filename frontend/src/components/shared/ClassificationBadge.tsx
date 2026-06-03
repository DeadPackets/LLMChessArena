const SYMBOLS: Record<string, string> = {
  brilliant: "!!",
  great: "!",
  best: "\u2605",      // \u2605 filled star
  excellent: "\u2606", // \u2606 open star \u2014 visually distinct from best's filled star
  good: "\u00b7",      // \u00b7 (used only in legends; move list still hides "good")
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
