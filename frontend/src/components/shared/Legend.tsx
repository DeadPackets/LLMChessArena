import type { ReactNode } from "react";

export interface LegendItem {
  /** A glyph, badge, or colored shape node shown at the start of the row. */
  symbol: ReactNode;
  /** Short name, e.g. "Blunder". */
  name: string;
  /** One-line meaning, e.g. "A serious mistake that loses major advantage". */
  meaning: string;
}

interface Props {
  items: LegendItem[];
  /** Optional heading shown above the list. */
  title?: string;
}

export default function Legend({ items, title }: Props) {
  return (
    <div className="legend">
      {title && <div className="legend__title">{title}</div>}
      <ul className="legend__list">
        {items.map((it, i) => (
          <li key={i} className="legend__row">
            <span className="legend__symbol" aria-hidden="true">{it.symbol}</span>
            <span className="legend__name">{it.name}</span>
            <span className="legend__meaning">{it.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
