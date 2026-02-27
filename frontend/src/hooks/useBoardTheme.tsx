import React, { useState, useCallback, useMemo } from "react";

export interface BoardColorPreset {
  id: string;
  label: string;
  light: string;
  dark: string;
  highlight: string;
}

export interface PieceStylePreset {
  id: string;
  label: string;
}

export const BOARD_COLORS: BoardColorPreset[] = [
  { id: "classic", label: "Classic", light: "#c8b891", dark: "#7a6b4e", highlight: "rgba(212, 168, 67, 0.45)" },
  { id: "tournament", label: "Tournament", light: "#ebecd0", dark: "#739552", highlight: "rgba(255, 255, 50, 0.4)" },
  { id: "ice", label: "Ice", light: "#dee3e6", dark: "#8ca2ad", highlight: "rgba(100, 180, 255, 0.4)" },
  { id: "walnut", label: "Walnut", light: "#d2a56c", dark: "#6b4226", highlight: "rgba(240, 180, 80, 0.4)" },
  { id: "midnight", label: "Midnight", light: "#c3c3d5", dark: "#5a5a8a", highlight: "rgba(160, 140, 255, 0.4)" },
  { id: "emerald", label: "Emerald", light: "#f0edd0", dark: "#4e8a50", highlight: "rgba(120, 220, 100, 0.4)" },
  { id: "rose", label: "Rose", light: "#f0d9d9", dark: "#b05878", highlight: "rgba(230, 130, 160, 0.4)" },
  { id: "sandcastle", label: "Sandcastle", light: "#f0e0c8", dark: "#b8865a", highlight: "rgba(230, 170, 90, 0.4)" },
  { id: "ocean", label: "Ocean", light: "#d5e8e0", dark: "#3d7a7a", highlight: "rgba(80, 200, 180, 0.4)" },
  { id: "slate", label: "Slate", light: "#e0e0e0", dark: "#888888", highlight: "rgba(180, 180, 180, 0.5)" },
];

export const PIECE_STYLES: PieceStylePreset[] = [
  { id: "standard", label: "Standard" },
  { id: "neo", label: "Neo" },
  { id: "classic", label: "Classic" },
  { id: "california", label: "California" },
  { id: "cardinal", label: "Cardinal" },
  { id: "gioco", label: "Gioco" },
  { id: "governor", label: "Governor" },
  { id: "horsey", label: "Horsey" },
  { id: "kosal", label: "Kosal" },
  { id: "letter", label: "Letter" },
  { id: "maestro", label: "Maestro" },
  { id: "pirouetti", label: "Pirouetti" },
  { id: "tatiana", label: "Tatiana" },
  { id: "pixel", label: "Pixel" },
];

const STORAGE_KEY = "chess-board-theme";

const PIECE_KEYS = ["wK", "wQ", "wR", "wB", "wN", "wP", "bK", "bQ", "bR", "bB", "bN", "bP"] as const;

function loadTheme(): { boardColor: string; pieceStyle: string } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        boardColor: typeof parsed.boardColor === "string" ? parsed.boardColor : "classic",
        pieceStyle: typeof parsed.pieceStyle === "string" ? parsed.pieceStyle : "standard",
      };
    }
  } catch { /* ignore */ }
  return { boardColor: "classic", pieceStyle: "standard" };
}

function saveTheme(boardColor: string, pieceStyle: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ boardColor, pieceStyle }));
}

export function getCustomPieces(
  style: string,
): Record<string, (props?: { squareWidth?: number }) => React.JSX.Element> | undefined {
  if (style === "standard") return undefined;

  const pieces: Record<string, (props?: { squareWidth?: number }) => React.JSX.Element> = {};
  for (const key of PIECE_KEYS) {
    const src = `/pieces/${style}/${key}.svg`;
    pieces[key] = ({ squareWidth }: { squareWidth?: number } = {}) => (
      <img
        src={src}
        alt={key}
        style={{
          width: squareWidth ?? 45,
          height: squareWidth ?? 45,
        }}
      />
    );
  }
  return pieces;
}

export function useBoardTheme() {
  const [theme, setTheme] = useState(loadTheme);

  const setBoardColor = useCallback((id: string) => {
    setTheme((prev) => {
      const next = { ...prev, boardColor: id };
      saveTheme(next.boardColor, next.pieceStyle);
      return next;
    });
  }, []);

  const setPieceStyle = useCallback((id: string) => {
    setTheme((prev) => {
      const next = { ...prev, pieceStyle: id };
      saveTheme(next.boardColor, next.pieceStyle);
      return next;
    });
  }, []);

  const boardColorPreset = BOARD_COLORS.find((c) => c.id === theme.boardColor) ?? BOARD_COLORS[0];
  const customPieces = useMemo(() => getCustomPieces(theme.pieceStyle), [theme.pieceStyle]);

  return {
    theme,
    boardColorPreset,
    customPieces,
    setBoardColor,
    setPieceStyle,
  };
}
