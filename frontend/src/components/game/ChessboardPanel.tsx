import { useMemo } from "react";
import { Chessboard } from "react-chessboard";
import type { MoveData } from "../../types/websocket";

interface Props {
  fen: string;
  selectedMove: MoveData | null;
  previousMove: MoveData | null;
}

export default function ChessboardPanel({ fen, selectedMove, previousMove }: Props) {
  const lastMoveSquares = useMemo(() => {
    const move = selectedMove ?? previousMove;
    if (!move?.uci) return {};
    const from = move.uci.slice(0, 2);
    const to = move.uci.slice(2, 4);
    return {
      [from]: { background: "rgba(212, 168, 67, 0.35)" },
      [to]: { background: "rgba(212, 168, 67, 0.45)" },
    };
  }, [selectedMove, previousMove]);

  return (
    <Chessboard
      id="spectator-board"
      position={fen}
      arePiecesDraggable={false}
      boardWidth={540}
      customBoardStyle={{
        borderRadius: "8px",
        boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
      }}
      customDarkSquareStyle={{ backgroundColor: "#7a6b4e" }}
      customLightSquareStyle={{ backgroundColor: "#c8b891" }}
      customSquareStyles={lastMoveSquares}
      animationDuration={250}
    />
  );
}
