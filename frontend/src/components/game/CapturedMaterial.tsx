import { useMemo } from "react";

interface Props {
  fen: string;
}

const STARTING_PIECES: Record<string, number> = {
  P: 8, N: 2, B: 2, R: 2, Q: 1, K: 1,
  p: 8, n: 2, b: 2, r: 2, q: 1, k: 1,
};

const PIECE_VALUES: Record<string, number> = {
  P: 1, N: 3, B: 3, R: 5, Q: 9,
  p: 1, n: 3, b: 3, r: 5, q: 9,
};

const WHITE_UNICODE: Record<string, string> = {
  Q: "\u2655", R: "\u2656", B: "\u2657", N: "\u2658", P: "\u2659",
};
const BLACK_UNICODE: Record<string, string> = {
  q: "\u265B", r: "\u265C", b: "\u265D", n: "\u265E", p: "\u265F",
};

// Map black piece keys to white unicode (for white's captures) and vice versa
const BLACK_TO_WHITE: Record<string, string> = {
  q: "\u2655", r: "\u2656", b: "\u2657", n: "\u2658", p: "\u2659",
};
const WHITE_TO_BLACK: Record<string, string> = {
  Q: "\u265B", R: "\u265C", B: "\u265D", N: "\u265E", P: "\u265F",
};

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
  const { capturedBlack, capturedWhite, materialDiff } = useMemo(() => {
    const current = countPiecesInFen(fen);

    // Black pieces captured (by white) — shown on left, growing right
    const capturedBlack: string[] = [];
    for (const piece of BLACK_ORDER) {
      const missing = (STARTING_PIECES[piece] || 0) - (current[piece] || 0);
      for (let i = 0; i < missing; i++) capturedBlack.push(piece);
    }

    // White pieces captured (by black) — shown on right, growing left
    const capturedWhite: string[] = [];
    for (const piece of WHITE_ORDER) {
      const missing = (STARTING_PIECES[piece] || 0) - (current[piece] || 0);
      for (let i = 0; i < missing; i++) capturedWhite.push(piece);
    }

    const whiteMat = WHITE_ORDER.reduce(
      (s, p) => s + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );
    const blackMat = BLACK_ORDER.reduce(
      (s, p) => s + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );

    return {
      capturedBlack,
      capturedWhite,
      materialDiff: whiteMat - blackMat,
    };
  }, [fen]);

  const hasCaptured = capturedBlack.length > 0 || capturedWhite.length > 0;
  if (!hasCaptured) return null;

  return (
    <div className="captured-mat">
      {/* Left side: captured by white (shown as white pieces), grows left→right */}
      <div className="captured-mat__left">
        {capturedBlack.map((p, i) => (
          <span key={i} className="captured-mat__piece captured-mat__piece--white">
            {BLACK_TO_WHITE[p]}
          </span>
        ))}
        {materialDiff > 0 && (
          <span className="captured-mat__diff">+{materialDiff}</span>
        )}
      </div>

      {/* Right side: captured by black (shown as black pieces), grows right→left */}
      <div className="captured-mat__right">
        {materialDiff < 0 && (
          <span className="captured-mat__diff">+{Math.abs(materialDiff)}</span>
        )}
        {capturedWhite.map((p, i) => (
          <span key={i} className="captured-mat__piece captured-mat__piece--black">
            {WHITE_TO_BLACK[p]}
          </span>
        ))}
      </div>
    </div>
  );
}
