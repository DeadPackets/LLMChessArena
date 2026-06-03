import { CLASS_META, isClassification } from "./classification";

interface Props {
  classification: string | null;
}

export default function ClassificationBadge({ classification }: Props) {
  if (!isClassification(classification)) return null;
  if (classification === "good") return null; // keep "good" silent in dense rows

  const meta = CLASS_META[classification];

  return (
    <span
      className={`classification-badge classification-badge--${classification}`}
      title={`${meta.name} — ${meta.meaning}`}
      aria-label={`Move classified as ${meta.name}: ${meta.meaning}`}
    >
      {meta.symbol}
    </span>
  );
}
