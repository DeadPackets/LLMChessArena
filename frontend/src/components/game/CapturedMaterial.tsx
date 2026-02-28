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

/** Group consecutive same-type pieces: ["p","p","n"] → [{piece:"p",count:2},{piece:"n",count:1}] */
function groupPieces(pieces: string[]): { piece: string; count: number }[] {
  const groups: { piece: string; count: number }[] = [];
  for (const p of pieces) {
    const last = groups[groups.length - 1];
    if (last && last.piece === p) {
      last.count++;
    } else {
      groups.push({ piece: p, count: 1 });
    }
  }
  return groups;
}

export default function CapturedMaterial({ fen }: Props) {
  const { whiteCapturedGroups, blackCapturedGroups, materialDiff } = useMemo(() => {
    const current = countPiecesInFen(fen);

    // Pieces captured BY white = black pieces missing
    const capturedByWhite: string[] = [];
    for (const piece of BLACK_ORDER) {
      const missing = (STARTING_PIECES[piece] || 0) - (current[piece] || 0);
      for (let i = 0; i < missing; i++) capturedByWhite.push(piece);
    }

    // Pieces captured BY black = white pieces missing
    const capturedByBlack: string[] = [];
    for (const piece of WHITE_ORDER) {
      const missing = (STARTING_PIECES[piece] || 0) - (current[piece] || 0);
      for (let i = 0; i < missing; i++) capturedByBlack.push(piece);
    }

    const whiteMat = WHITE_ORDER.reduce(
      (s, p) => s + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );
    const blackMat = BLACK_ORDER.reduce(
      (s, p) => s + (current[p] || 0) * (PIECE_VALUES[p] || 0), 0
    );

    return {
      whiteCapturedGroups: groupPieces(capturedByWhite),
      blackCapturedGroups: groupPieces(capturedByBlack),
      materialDiff: whiteMat - blackMat,
    };
  }, [fen]);

  const hasCaptured = whiteCapturedGroups.length > 0 || blackCapturedGroups.length > 0;
  if (!hasCaptured) return null;

  return (
    <div className="captured-mat">
      {/* Black captured white pieces */}
      <div className="captured-mat__side">
        {blackCapturedGroups.map((g, i) => (
          <span key={i} className="captured-mat__group captured-mat__group--white">
            {Array.from({ length: g.count }, (_, j) => (
              <span key={j} className="captured-mat__piece">{WHITE_UNICODE[g.piece]}</span>
            ))}
          </span>
        ))}
        {materialDiff < 0 && (
          <span className="captured-mat__diff">+{Math.abs(materialDiff)}</span>
        )}
      </div>
      {/* White captured black pieces */}
      <div className="captured-mat__side">
        {whiteCapturedGroups.map((g, i) => (
          <span key={i} className="captured-mat__group captured-mat__group--black">
            {Array.from({ length: g.count }, (_, j) => (
              <span key={j} className="captured-mat__piece">{BLACK_UNICODE[g.piece]}</span>
            ))}
          </span>
        ))}
        {materialDiff > 0 && (
          <span className="captured-mat__diff">+{materialDiff}</span>
        )}
      </div>
    </div>
  );
}
