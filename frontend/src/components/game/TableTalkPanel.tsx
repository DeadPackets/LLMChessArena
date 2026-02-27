import { useState, useEffect, useRef, useMemo } from "react";
import type { MoveData, IllegalMoveData, ChaosMoveData } from "../../types/websocket";

interface Props {
  moves: MoveData[];
  illegalMoves: IllegalMoveData[];
  chaosMoves: ChaosMoveData[];
  selectedIndex: number;
  whiteModel: string | null;
  blackModel: string | null;
  onSelectMove: (index: number) => void;
}

function shortModelName(model: string | null): string {
  if (!model) return "???";
  const parts = model.split("/");
  return parts[parts.length - 1];
}

type ChatEntry =
  | { type: "move"; index: number; move: MoveData }
  | { type: "illegal"; data: IllegalMoveData }
  | { type: "chaos"; data: ChaosMoveData };

export default function TableTalkPanel({
  moves,
  illegalMoves,
  chaosMoves,
  selectedIndex,
  whiteModel,
  blackModel,
  onSelectMove,
}: Props) {
  const chatRef = useRef<HTMLDivElement>(null);
  const [hideErrors, setHideErrors] = useState(false);

  // Build interleaved chat entries sorted by move number.
  // Groups illegal/chaos moves by (moveNumber, color) to avoid interleaving
  // issues where a single-pointer approach skips entries when colors alternate.
  const entries = useMemo<ChatEntry[]>(() => {
    const result: ChatEntry[] = [];

    // Group illegal moves by "moveNumber-color" key for reliable lookup
    const illegalByKey = new Map<string, IllegalMoveData[]>();
    for (const im of illegalMoves) {
      const key = `${im.moveNumber}-${im.color}`;
      const arr = illegalByKey.get(key);
      if (arr) arr.push(im);
      else illegalByKey.set(key, [im]);
    }

    const chaosByKey = new Map<string, ChaosMoveData[]>();
    for (const cm of chaosMoves) {
      const key = `${cm.moveNumber}-${cm.color}`;
      const arr = chaosByKey.get(key);
      if (arr) arr.push(cm);
      else chaosByKey.set(key, [cm]);
    }

    const usedIllegalKeys = new Set<string>();
    const usedChaosKeys = new Set<string>();

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      const key = `${m.moveNumber}-${m.color}`;

      // Insert illegal moves for this (moveNumber, color) before the valid move
      if (!usedIllegalKeys.has(key)) {
        usedIllegalKeys.add(key);
        const illegals = illegalByKey.get(key);
        if (illegals) {
          for (const im of illegals) {
            result.push({ type: "illegal", data: im });
          }
        }
      }

      // Insert chaos moves for this (moveNumber, color) before the valid move
      if (!usedChaosKeys.has(key)) {
        usedChaosKeys.add(key);
        const chaoses = chaosByKey.get(key);
        if (chaoses) {
          for (const cm of chaoses) {
            result.push({ type: "chaos", data: cm });
          }
        }
      }

      // Only include moves that have table talk or are chaos moves
      if (m.tableTalk || m.isChaosMove) {
        result.push({ type: "move", index: i, move: m });
      }
    }

    // Remaining illegal/chaos moves not matched to any valid move
    for (const [key, illegals] of illegalByKey) {
      if (!usedIllegalKeys.has(key)) {
        for (const im of illegals) result.push({ type: "illegal", data: im });
      }
    }
    for (const [key, chaoses] of chaosByKey) {
      if (!usedChaosKeys.has(key)) {
        for (const cm of chaoses) result.push({ type: "chaos", data: cm });
      }
    }

    return result;
  }, [moves, illegalMoves, chaosMoves]);

  const selectedBubbleRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    requestAnimationFrame(() => {
      if (chatRef.current) {
        chatRef.current.scrollTop = chatRef.current.scrollHeight;
      }
    });
  }, [entries.length]);

  // Scroll to the selected bubble when user clicks a move
  useEffect(() => {
    if (selectedBubbleRef.current && chatRef.current) {
      const container = chatRef.current;
      const el = selectedBubbleRef.current;
      const elTop = el.offsetTop - container.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;

      if (elBottom > viewBottom || elTop < viewTop) {
        el.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [selectedIndex]);

  const visibleEntries = hideErrors
    ? entries.filter((e) => e.type === "move")
    : entries;

  if (entries.length === 0) return null;

  const hasErrors = entries.some((e) => e.type === "illegal" || e.type === "chaos");

  return (
    <div className="table-talk-panel panel">
      <div className="table-talk-panel__label">
        Table Talk
        {hasErrors && (
          <button
            className={`table-talk-panel__filter-toggle${hideErrors ? " table-talk-panel__filter-toggle--active" : ""}`}
            onClick={() => setHideErrors((v) => !v)}
            title={hideErrors ? "Show errors" : "Hide errors"}
          >
            {hideErrors ? "Show errors" : "Hide errors"}
          </button>
        )}
      </div>
      <div className="table-talk-chat" ref={chatRef}>
        {visibleEntries.map((entry, i) => {
          if (entry.type === "illegal") {
            const d = entry.data;
            const model = shortModelName(d.model);
            const isInvalidUCI = d.reason === "Invalid UCI notation";
            const errorLabel = isInvalidUCI ? "invalid UCI" : "illegal move";
            const errorClass = isInvalidUCI
              ? "table-talk-bubble--invalid-uci"
              : "table-talk-bubble--illegal";
            return (
              <div
                key={`illegal-${i}`}
                className={`table-talk-bubble ${errorClass} table-talk-bubble--${d.color}`}
              >
                <div className="table-talk-bubble__header">
                  <span className="table-talk-bubble__model">{model}</span>
                  <span className="table-talk-bubble__move">
                    {errorLabel} ({d.attempt}/{d.maxAttempts})
                  </span>
                </div>
                <div className="table-talk-bubble__illegal-text">
                  <code>{d.attemptedMove}</code>
                </div>
                <div className="table-talk-bubble__illegal-reason">{d.reason}</div>
              </div>
            );
          }

          if (entry.type === "chaos") {
            const d = entry.data;
            const model = shortModelName(d.model);
            return (
              <div
                key={`chaos-${i}`}
                className={`table-talk-bubble table-talk-bubble--chaos table-talk-bubble--${d.color}`}
              >
                <div className="table-talk-bubble__header">
                  <span className="table-talk-bubble__model">{model}</span>
                  <span className="table-talk-bubble__move">chaos move detected</span>
                </div>
                <div className="table-talk-bubble__illegal-text" style={{ color: "var(--inaccuracy)" }}>
                  <code>{d.attemptedMove}</code>
                </div>
                <div className="table-talk-bubble__illegal-reason" style={{ fontStyle: "italic" }}>
                  Illegal move allowed in Chaos Mode
                </div>
              </div>
            );
          }

          const m = entry.move;
          const isSelected = entry.index === selectedIndex;
          const model =
            m.color === "white"
              ? shortModelName(whiteModel)
              : shortModelName(blackModel);

          return (
            <div
              key={`move-${entry.index}`}
              ref={isSelected ? selectedBubbleRef : undefined}
              className={`table-talk-bubble table-talk-bubble--${m.color}${
                isSelected ? " table-talk-bubble--selected" : ""
              }`}
              onClick={() => onSelectMove(entry.index)}
            >
              <div className="table-talk-bubble__header">
                <span className="table-talk-bubble__model">{model}</span>
                <span className="table-talk-bubble__move">
                  {m.moveNumber}{m.color === "black" ? "..." : "."} {m.san}
                  {m.isChaosMove && <span className="table-talk-bubble__chaos-tag">CHAOS</span>}
                </span>
              </div>
              {m.tableTalk && <div className="table-talk-bubble__text">{m.tableTalk}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
