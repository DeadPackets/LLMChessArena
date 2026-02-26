import { useRef, useEffect } from "react";
import ClassificationBadge from "../shared/ClassificationBadge";
import type { MoveData } from "../../types/websocket";

interface Props {
  moves: MoveData[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export default function MoveList({ moves, selectedIndex, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selectedIndex]);

  // Group moves into pairs (white + black per row)
  const rows: { moveNumber: number; white: { move: MoveData; index: number } | null; black: { move: MoveData; index: number } | null }[] = [];

  for (let i = 0; i < moves.length; i++) {
    const move = moves[i];
    if (move.color === "white") {
      rows.push({
        moveNumber: move.moveNumber,
        white: { move, index: i },
        black: null,
      });
    } else {
      if (rows.length > 0 && rows[rows.length - 1].black === null) {
        rows[rows.length - 1].black = { move, index: i };
      } else {
        rows.push({
          moveNumber: move.moveNumber,
          white: null,
          black: { move, index: i },
        });
      }
    }
  }

  return (
    <div className="move-list panel" ref={containerRef} role="list" aria-label="Move list">
      <div className="move-list__header">
        <span>#</span>
        <span>White</span>
        <span>Black</span>
      </div>
      {rows.map((row) => (
        <div className="move-row" key={row.moveNumber} role="listitem">
          <div className="move-row__number">{row.moveNumber}</div>
          {row.white ? (
            <div
              ref={row.white.index === selectedIndex ? selectedRef : undefined}
              className={`move-cell${row.white.index === selectedIndex ? " move-cell--selected" : ""}`}
              onClick={() => onSelect(row.white!.index)}
              role="button"
              tabIndex={0}
              aria-label={`Move ${row.moveNumber}. White: ${row.white.move.san}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row.white!.index); } }}
            >
              <ClassificationBadge classification={row.white.move.classification} />
              <span className="move-cell__san">{row.white.move.san}</span>
              {row.white.move.responseTimeMs > 0 && (
                <span className="move-cell__time">{formatTime(row.white.move.responseTimeMs)}</span>
              )}
            </div>
          ) : (
            <div className="move-cell" />
          )}
          {row.black ? (
            <div
              ref={row.black.index === selectedIndex ? selectedRef : undefined}
              className={`move-cell${row.black.index === selectedIndex ? " move-cell--selected" : ""}`}
              onClick={() => onSelect(row.black!.index)}
              role="button"
              tabIndex={0}
              aria-label={`Move ${row.moveNumber}. Black: ${row.black.move.san}`}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(row.black!.index); } }}
            >
              <ClassificationBadge classification={row.black.move.classification} />
              <span className="move-cell__san">{row.black.move.san}</span>
              {row.black.move.responseTimeMs > 0 && (
                <span className="move-cell__time">{formatTime(row.black.move.responseTimeMs)}</span>
              )}
            </div>
          ) : (
            <div className="move-cell" />
          )}
        </div>
      ))}
      {moves.length === 0 && (
        <div className="empty-state">
          <div className="empty-state__text">Waiting for moves...</div>
        </div>
      )}
    </div>
  );
}
