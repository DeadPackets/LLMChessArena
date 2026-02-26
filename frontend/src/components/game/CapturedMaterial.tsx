import { useMemo } from "react";

interface Props {
  fen: string;
}

// Starting piece counts
const STARTING_PIECES: Record<string, number> = {
  P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1,
  p: 8, n: 2, b: 2, r: 2, q: 1, k: 1,
};

// Piece values for material difference
const PIECE_VALUES: Record<string, number> = {
  P: 1, N: 3, B: 3, R: 5, Q: 9,
  p: 1, n: 3, b: 3, r: 5, q: 9,
};

// Unicode pieces for display (ordered by value: Q, R, B, N, P)
const WHITE_PIECES_UNICODE: Record<string, string> = {
  Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
};
const BLACK_PIECES_UNICODE: Record<string, string> = {
  q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

// Display order (high value first)
const WHITE_ORDER = ["Q", "R", "B", "N", "P"];
const BLACK_ORDER = ["q", "r", "b", "n", "p"];

function countPiecesInFen(fen: string): Record<string, number> {
  const board = fen.split(" ")[0];
  const counts: Record<string, number> = {};
  for (const ch of board) {
    if (/[pnbrqkPNBRQK]/.test(ch)) {
      counts[ch] = (counts[ch] || 0) + 1;
    }
  }
  return counts;
}

export default function CapturedMaterial({ fen }: Props) {
  const { capturedByWhite, capturedByBlack, materialDiff } = useMemo(() => {
    const current = countPiecesInFen(fen);

    // Pieces captured BY white = black pieces missing from the board
    const capturedByWhite: string[] = [];
    for (const piece of BLACK_ORDER) {
      const starting = STARTING_PIECES[piece] || 0;
      const onBoard = current[piece] || 0;
      const captured = starting - onBoard;
      for (let i = 0; i < captured; i++) {
        capturedByWhite.push(piece);
      }
    }

    // Pieces captured BY black = white pieces missing from the board
    const capturedByBlack: string[] = [];
    for (const piece of WHITE_ORDER) {
      const starting = STARTING_PIECES[piece] || 0;
      const onBoard = current[piece] || 0;
      const captured = starting - onBoard;
      for (let i = 0; i < captured; i++) {
        capturedByBlack.push(piece);
      }
    }

    // Material difference from White's perspective
    const whiteMaterial = WHITE_ORDER.reduce(
      (sum, p) => sum + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );
    const blackMaterial = BLACK_ORDER.reduce(
      (sum, p) => sum + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );

    return {
      capturedByWhite,
      capturedByBlack,
      materialDiff: whiteMaterial - blackMaterial,
    };
  }, [fen]);

  const hasCaptured = capturedByWhite.length > 0 || capturedByBlack.length > 0;
  if (!hasCaptured) return null;

  return (
    <div className="captured-material">
      <div className="captured-material__row">
        <div className="captured-material__pieces captured-material__pieces--black">
          {capturedByBlack.map((p, i) => (
            <span key={i} className="captured-material__piece">
              {WHITE_PIECES_UNICODE[p]}
            </span>
          ))}
        </div>
        {materialDiff < 0 && (
          <span className="captured-material__diff">+{Math.abs(materialDiff)}</span>
        )}
      </div>
      <div className="captured-material__row">
        <div className="captured-material__pieces captured-material__pieces--white">
          {capturedByWhite.map((p, i) => (
            <span key={i} className="captured-material__piece">
              {BLACK_PIECES_UNICODE[p]}
            </span>
          ))}
        </div>
        {materialDiff > 0 && (
          <span className="captured-material__diff">+{materialDiff}</span>
        )}
      </div>
    </div>
  );
}
