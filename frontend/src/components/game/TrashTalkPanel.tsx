import { useEffect, useRef, useMemo } from "react";
import type { MoveData, IllegalMoveData } from "../../types/websocket";

interface Props {
  moves: MoveData[];
  illegalMoves: IllegalMoveData[];
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
  | { type: "illegal"; data: IllegalMoveData };

export default function TrashTalkPanel({
  moves,
  illegalMoves,
  selectedIndex,
  whiteModel,
  blackModel,
  onSelectMove,
}: Props) {
  const chatRef = useRef<HTMLDivElement>(null);

  // Build interleaved chat entries sorted by move number
  const entries = useMemo<ChatEntry[]>(() => {
    const result: ChatEntry[] = [];

    // Tracks which illegal moves belong before which move number
    let illegalIdx = 0;

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
      // Only include moves that have trash talk
      if (m.trashTalk) {
        result.push({ type: "move", index: i, move: m });
      }
    }

    // Remaining illegal moves after all moves
    while (illegalIdx < illegalMoves.length) {
      result.push({ type: "illegal", data: illegalMoves[illegalIdx] });
      illegalIdx++;
    }

    return result;
  }, [moves, illegalMoves]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (chatRef.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight;
    }
  }, [entries.length]);

  if (entries.length === 0) return null;

  return (
    <div className="trash-talk-panel panel">
      <div className="trash-talk-panel__label">Trash Talk</div>
      <div className="trash-talk-chat" ref={chatRef}>
        {entries.map((entry, i) => {
          if (entry.type === "illegal") {
            const d = entry.data;
            const model = shortModelName(d.model);
            const isInvalidUCI = d.reason === "Invalid UCI notation";
            const errorLabel = isInvalidUCI ? "invalid UCI" : "illegal move";
            const errorClass = isInvalidUCI
              ? "trash-talk-bubble--invalid-uci"
              : "trash-talk-bubble--illegal";
            return (
              <div
                key={`illegal-${i}`}
                className={`trash-talk-bubble ${errorClass} trash-talk-bubble--${d.color}`}
              >
                <div className="trash-talk-bubble__header">
                  <span className="trash-talk-bubble__model">{model}</span>
                  <span className="trash-talk-bubble__move">
                    {errorLabel} ({d.attempt}/{d.maxAttempts})
                  </span>
                </div>
                <div className="trash-talk-bubble__illegal-text">
                  <code>{d.attemptedMove}</code>
                </div>
                <div className="trash-talk-bubble__illegal-reason">{d.reason}</div>
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
              className={`trash-talk-bubble trash-talk-bubble--${m.color}${
                isSelected ? " trash-talk-bubble--selected" : ""
              }`}
              onClick={() => onSelectMove(entry.index)}
            >
              <div className="trash-talk-bubble__header">
                <span className="trash-talk-bubble__model">{model}</span>
                <span className="trash-talk-bubble__move">
                  {m.moveNumber}{m.color === "black" ? "..." : "."} {m.san}
                </span>
              </div>
              <div className="trash-talk-bubble__text">{m.trashTalk}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
