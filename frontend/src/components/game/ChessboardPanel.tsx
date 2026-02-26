import { useMemo } from "react";
import { Chessboard } from "react-chessboard";
import type { Arrow, Square } from "react-chessboard/dist/chessboard/types";
import type { MoveData } from "../../types/websocket";

interface Props {
  fen: string;
  selectedMove: MoveData | null;
  previousMove: MoveData | null;
}

/**
 * Find the square of the king that is in check by parsing the FEN.
 * Returns the square name (e.g. "e1") or null if not in check.
 */
function findCheckedKingSquare(fen: string): string | null {
  const parts = fen.split(" ");
  const board = parts[0];
  const turn = parts[1]; // "w" or "b"

  // Find the king for the side to move
  const kingChar = turn === "w" ? "K" : "k";

  // Parse the board to find the king's position
  const rows = board.split("/");
  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const ch of rows[rank]) {
      if (ch >= "1" && ch <= "8") {
        file += parseInt(ch);
      } else {
        if (ch === kingChar) {
          const fileChar = String.fromCharCode(97 + file); // a-h
          const rankNum = 8 - rank; // 1-8
          return `${fileChar}${rankNum}`;
        }
        file++;
      }
    }
  }
  return null;
}

/**
 * Naive check detection: look if any opponent piece attacks the king.
 * We check the FEN for "+" or "#" indicators, but those aren't in FEN.
 * Instead, we do a simple approach: the previous move's SAN ends with "+" or "#".
 */
function isInCheck(selectedMove: MoveData | null): boolean {
  if (!selectedMove?.san) return false;
  return selectedMove.san.endsWith("+") || selectedMove.san.endsWith("#");
}

export default function ChessboardPanel({ fen, selectedMove, previousMove }: Props) {
  // Highlight last move squares
  const lastMoveSquares = useMemo(() => {
    const move = selectedMove ?? previousMove;
    if (!move?.uci) return {};
    const from = move.uci.slice(0, 2);
    const to = move.uci.slice(2, 4);
    const styles: Record<string, React.CSSProperties> = {
      [from]: { background: "rgba(212, 168, 67, 0.35)" },
      [to]: { background: "rgba(212, 168, 67, 0.45)" },
    };

    // Highlight king square if in check
    if (isInCheck(selectedMove)) {
      const kingSquare = findCheckedKingSquare(fen);
      if (kingSquare) {
        styles[kingSquare] = {
          ...styles[kingSquare],
          background: "radial-gradient(circle at center, rgba(202, 52, 49, 0.9) 0%, rgba(202, 52, 49, 0.5) 40%, rgba(202, 52, 49, 0.0) 70%)",
        };
      }
    }

    return styles;
  }, [selectedMove, previousMove, fen]);

  // Arrow showing the current move
  const moveArrow = useMemo<Arrow[]>(() => {
    const move = selectedMove;
    if (!move?.uci || move.uci.length < 4) return [];
    const from = move.uci.slice(0, 2) as Square;
    const to = move.uci.slice(2, 4) as Square;
    return [[from, to, "rgba(240, 192, 80, 0.9)"]];
  }, [selectedMove]);

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
      customArrows={moveArrow}
      animationDuration={250}
    />
  );
}
