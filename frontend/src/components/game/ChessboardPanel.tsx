import { useMemo, useState, useEffect, useCallback, useRef } from "react";
import { Chessboard } from "react-chessboard";
import { Chess } from "chess.js";
import type { Arrow, Piece, PromotionPieceOption, Square } from "react-chessboard/dist/chessboard/types";
import type { MoveData } from "../../types/websocket";

interface Props {
  fen: string;
  selectedMove: MoveData | null;
  previousMove: MoveData | null;
  isHumanTurn?: boolean;
  humanColor?: "white" | "black" | null;
  onHumanMove?: (uci: string) => void;
  boardOrientation?: "white" | "black";
}

/**
 * Find the square of the king that is in check by parsing the FEN.
 */
function findCheckedKingSquare(fen: string): string | null {
  const parts = fen.split(" ");
  const board = parts[0];
  const turn = parts[1];
  const kingChar = turn === "w" ? "K" : "k";

  const rows = board.split("/");
  for (let rank = 0; rank < 8; rank++) {
    let file = 0;
    for (const ch of rows[rank]) {
      if (ch >= "1" && ch <= "8") {
        file += parseInt(ch);
      } else {
        if (ch === kingChar) {
          const fileChar = String.fromCharCode(97 + file);
          const rankNum = 8 - rank;
          return `${fileChar}${rankNum}`;
        }
        file++;
      }
    }
  }
  return null;
}

function isInCheck(selectedMove: MoveData | null): boolean {
  if (!selectedMove?.san) return false;
  return selectedMove.san.endsWith("+") || selectedMove.san.endsWith("#");
}

export default function ChessboardPanel({
  fen,
  selectedMove,
  previousMove,
  isHumanTurn = false,
  humanColor = null,
  onHumanMove,
  boardOrientation = "white",
}: Props) {
  // Optimistic FEN: shown immediately after human drops a piece, before server confirms
  const [optimisticFen, setOptimisticFen] = useState<string | null>(null);
  // Click-to-move state
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null);
  const [legalTargets, setLegalTargets] = useState<Square[]>([]);
  // Click-to-move promotion
  const [pendingPromotion, setPendingPromotion] = useState<{ from: Square; to: Square } | null>(null);

  const displayFen = optimisticFen ?? fen;

  // Clear optimistic FEN when server FEN catches up
  useEffect(() => {
    setOptimisticFen(null);
  }, [fen]);

  // Revert optimistic FEN if server re-requests a human move (move was rejected)
  useEffect(() => {
    if (isHumanTurn && optimisticFen) {
      setOptimisticFen(null);
    }
  }, [isHumanTurn]); // eslint-disable-line react-hooks/exhaustive-deps

  // Safety timeout: revert optimistic FEN after 5s if server hasn't confirmed
  useEffect(() => {
    if (!optimisticFen) return;
    const timer = setTimeout(() => setOptimisticFen(null), 5000);
    return () => clearTimeout(timer);
  }, [optimisticFen]);

  // Clear selection when turn/position changes
  useEffect(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
    setPendingPromotion(null);
  }, [isHumanTurn, fen]);

  // Get legal move targets from a square using chess.js
  const getLegalTargets = useCallback(
    (square: Square): Square[] => {
      try {
        const game = new Chess(displayFen);
        const moves = game.moves({ square, verbose: true });
        return moves.map((m) => m.to as Square);
      } catch {
        return [];
      }
    },
    [displayFen],
  );

  // Try a move client-side and return the resulting FEN, or null if illegal
  const tryMove = useCallback(
    (from: Square, to: Square, promotion?: string): string | null => {
      try {
        const game = new Chess(displayFen);
        const result = game.move({ from, to, promotion });
        if (result) return game.fen();
      } catch {
        /* illegal */
      }
      return null;
    },
    [displayFen],
  );

  // Highlight last move squares + check
  const lastMoveSquares = useMemo(() => {
    const move = selectedMove ?? previousMove;
    if (!move?.uci) return {};
    const from = move.uci.slice(0, 2);
    const to = move.uci.slice(2, 4);
    const styles: Record<string, React.CSSProperties> = {
      [from]: { background: "rgba(212, 168, 67, 0.35)" },
      [to]: { background: "rgba(212, 168, 67, 0.45)" },
    };

    if (isInCheck(selectedMove)) {
      const kingSquare = findCheckedKingSquare(displayFen);
      if (kingSquare) {
        styles[kingSquare] = {
          ...styles[kingSquare],
          background:
            "radial-gradient(circle at center, rgba(202, 52, 49, 0.9) 0%, rgba(202, 52, 49, 0.5) 40%, rgba(202, 52, 49, 0.0) 70%)",
        };
      }
    }

    return styles;
  }, [selectedMove, previousMove, displayFen]);

  // Legal move indicator styles (dots for empty squares, rings for captures)
  const legalMoveStyles = useMemo(() => {
    if (legalTargets.length === 0 && !selectedSquare) return {};
    const styles: Record<string, React.CSSProperties> = {};

    let game: Chess | null = null;
    try {
      game = new Chess(displayFen);
    } catch {
      /* ignore */
    }

    for (const sq of legalTargets) {
      const piece = game?.get(sq);
      if (piece) {
        // Capture: ring around the edge
        styles[sq] = {
          background: "radial-gradient(transparent 51%, rgba(0,0,0,0.15) 51%)",
          borderRadius: "50%",
        };
      } else {
        // Empty: centered dot
        styles[sq] = {
          background: "radial-gradient(rgba(0,0,0,0.15) 25%, transparent 25%)",
          borderRadius: "50%",
        };
      }
    }

    if (selectedSquare) {
      styles[selectedSquare] = {
        background: "rgba(212, 168, 67, 0.55)",
      };
    }

    return styles;
  }, [legalTargets, selectedSquare, displayFen]);

  // Merge last-move highlights with legal-move indicators
  const combinedSquareStyles = useMemo(
    () => ({ ...lastMoveSquares, ...legalMoveStyles }),
    [lastMoveSquares, legalMoveStyles],
  );

  // Arrow showing the current move
  const moveArrow = useMemo<Arrow[]>(() => {
    const move = selectedMove;
    if (!move?.uci || move.uci.length < 4) return [];
    const from = move.uci.slice(0, 2) as Square;
    const to = move.uci.slice(2, 4) as Square;
    return [[from, to, "rgba(240, 192, 80, 0.9)"]];
  }, [selectedMove]);

  // Only allow dragging the human's own pieces
  function isDraggablePiece({ piece }: { piece: Piece; sourceSquare: Square }) {
    if (!isHumanTurn || !humanColor) return false;
    const pieceColor = piece[0] === "w" ? "white" : "black";
    return pieceColor === humanColor;
  }

  // Show legal moves when drag begins
  function handlePieceDragBegin(_piece: Piece, sourceSquare: Square) {
    if (!isHumanTurn) return;
    const targets = getLegalTargets(sourceSquare);
    setSelectedSquare(sourceSquare);
    setLegalTargets(targets);
  }

  // Clear legal move indicators when drag ends
  function handlePieceDragEnd() {
    setSelectedSquare(null);
    setLegalTargets([]);
  }

  function onPieceDrop(sourceSquare: Square, targetSquare: Square, piece: Piece): boolean {
    if (!onHumanMove) return false;
    setSelectedSquare(null);
    setLegalTargets([]);

    // Check promotion
    const isPawn = piece[1] === "P";
    const isPromotionRank =
      (humanColor === "white" && targetSquare[1] === "8") ||
      (humanColor === "black" && targetSquare[1] === "1");

    if (isPawn && isPromotionRank) {
      // react-chessboard will show the promotion dialog via onPromotionCheck
      // We'll handle the actual move in onPromotionPieceSelect
      setPendingPromotion({ from: sourceSquare, to: targetSquare });
      return true;
    }

    // Optimistic update: compute new FEN client-side
    const newFen = tryMove(sourceSquare, targetSquare);
    if (newFen) {
      setOptimisticFen(newFen);
      onHumanMove(`${sourceSquare}${targetSquare}`);
      return true;
    }

    return false;
  }

  // Click-to-move: click a piece to select, click a target to move
  function handleSquareClick(square: Square, piece: Piece | undefined) {
    if (!isHumanTurn || !humanColor || !onHumanMove) return;

    // If a piece is already selected and this square is a legal target → make the move
    if (selectedSquare && legalTargets.includes(square)) {
      // Check for promotion
      try {
        const game = new Chess(displayFen);
        const srcPiece = game.get(selectedSquare);
        if (srcPiece && srcPiece.type === "p") {
          const isPromotionRank =
            (humanColor === "white" && square[1] === "8") ||
            (humanColor === "black" && square[1] === "1");
          if (isPromotionRank) {
            setPendingPromotion({ from: selectedSquare, to: square });
            setSelectedSquare(null);
            setLegalTargets([]);
            return;
          }
        }
      } catch {
        /* ignore */
      }

      const newFen = tryMove(selectedSquare, square);
      if (newFen) {
        setOptimisticFen(newFen);
        onHumanMove(`${selectedSquare}${square}`);
      }
      setSelectedSquare(null);
      setLegalTargets([]);
      return;
    }

    // Clicking on own piece → select it and show legal moves
    if (piece) {
      const pieceColor = piece[0] === "w" ? "white" : "black";
      if (pieceColor === humanColor) {
        const targets = getLegalTargets(square);
        setSelectedSquare(square);
        setLegalTargets(targets);
        return;
      }
    }

    // Clicking elsewhere → deselect
    setSelectedSquare(null);
    setLegalTargets([]);
  }

  function onPromotionCheck(sourceSquare: Square, targetSquare: Square, piece: Piece): boolean {
    if (!isHumanTurn || !humanColor) return false;
    const isPawn = piece[1] === "P";
    const isPromotionRank =
      (humanColor === "white" && targetSquare[1] === "8") ||
      (humanColor === "black" && targetSquare[1] === "1");
    return isPawn && isPromotionRank;
  }

  function onPromotionPieceSelect(
    piece?: PromotionPieceOption,
    from?: Square,
    to?: Square,
  ): boolean {
    if (!onHumanMove || !piece) {
      setPendingPromotion(null);
      return false;
    }

    const src = from ?? pendingPromotion?.from;
    const dst = to ?? pendingPromotion?.to;
    if (!src || !dst) {
      setPendingPromotion(null);
      return false;
    }

    const promotionPiece = piece[1].toLowerCase();
    const newFen = tryMove(src, dst, promotionPiece);
    if (newFen) {
      setOptimisticFen(newFen);
      onHumanMove(`${src}${dst}${promotionPiece}`);
    }
    setPendingPromotion(null);
    return true;
  }

  // Dynamic board sizing via ResizeObserver
  const containerRef = useRef<HTMLDivElement>(null);
  const [boardWidth, setBoardWidth] = useState(540);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        setBoardWidth(Math.min(w, 540));
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={containerRef} className="chessboard-panel__board-container">
      <Chessboard
        id="game-board"
        position={displayFen}
        arePiecesDraggable={isHumanTurn}
        isDraggablePiece={isDraggablePiece}
        onPieceDragBegin={handlePieceDragBegin}
        onPieceDragEnd={handlePieceDragEnd}
        onPieceDrop={onPieceDrop}
        onSquareClick={handleSquareClick}
        onPromotionCheck={onPromotionCheck}
        onPromotionPieceSelect={onPromotionPieceSelect}
        showPromotionDialog={!!pendingPromotion}
        promotionToSquare={pendingPromotion?.to ?? null}
        boardOrientation={boardOrientation}
        boardWidth={boardWidth}
        customBoardStyle={{
          borderRadius: "8px",
          boxShadow: "0 8px 32px rgba(0, 0, 0, 0.5)",
        }}
        customDarkSquareStyle={{ backgroundColor: "#7a6b4e" }}
        customLightSquareStyle={{ backgroundColor: "#c8b891" }}
        customSquareStyles={combinedSquareStyles}
        customArrows={moveArrow}
        animationDuration={250}
      />
    </div>
  );
}
