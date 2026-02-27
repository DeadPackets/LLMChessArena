import { useEffect, useRef, useMemo } from "react";
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

  // Build interleaved chat entries sorted by move number
  const entries = useMemo<ChatEntry[]>(() => {
    const result: ChatEntry[] = [];

    // Tracks which illegal/chaos moves belong before which move number
    let illegalIdx = 0;
    let chaosIdx = 0;

    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      // Insert any illegal moves that happened before or at this move number
      while (
        illegalIdx < illegalMoves.length &&
        illegalMoves[illegalIdx].moveNumber <= m.moveNumber &&
        illegalMoves[illegalIdx].color === m.color
      ) {
        result.push({ type: "illegal", data: illegalMoves[illegalIdx] });
        illegalIdx++;
      }
      // Insert any chaos moves that happened at this move number
      while (
        chaosIdx < chaosMoves.length &&
        chaosMoves[chaosIdx].moveNumber <= m.moveNumber &&
        chaosMoves[chaosIdx].color === m.color
      ) {
        result.push({ type: "chaos", data: chaosMoves[chaosIdx] });
        chaosIdx++;
      }
      // Only include moves that have table talk or are chaos moves
      if (m.tableTalk || m.isChaosMove) {
        result.push({ type: "move", index: i, move: m });
      }
    }

    // Remaining illegal moves after all moves
    while (illegalIdx < illegalMoves.length) {
      result.push({ type: "illegal", data: illegalMoves[illegalIdx] });
      illegalIdx++;
    }
    while (chaosIdx < chaosMoves.length) {
      result.push({ type: "chaos", data: chaosMoves[chaosIdx] });
      chaosIdx++;
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

  if (entries.length === 0) return null;

  return (
    <div className="table-talk-panel panel">
      <div className="table-talk-panel__label">Table Talk</div>
      <div className="table-talk-chat" ref={chatRef}>
        {entries.map((entry, i) => {
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
