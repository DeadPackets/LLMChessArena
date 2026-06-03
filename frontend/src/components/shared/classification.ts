// Single source of truth for move classifications — mirrors the backend
// MoveClassification enum (backend/app/services/move_classifier.py).
export type Classification =
  | "best"
  | "excellent"
  | "good"
  | "inaccuracy"
  | "mistake"
  | "blunder";

export const CLASS_ORDER: Classification[] = [
  "best",
  "excellent",
  "good",
  "inaccuracy",
  "mistake",
  "blunder",
];

export interface ClassMeta {
  symbol: string;       // glyph (matches backend CLASSIFICATION_SYMBOLS)
  name: string;         // display name
  meaning: string;      // legend one-liner
  color: string;        // dot / accent color
  shape: "circle" | "diamond" | "triangle"; // redundant (non-color) encoding
}

export const CLASS_META: Record<Classification, ClassMeta> = {
  best: {
    symbol: "★", // ★
    name: "Best",
    meaning: "The engine's top move.",
    color: "#26c2a3",
    shape: "diamond",
  },
  excellent: {
    symbol: "✓", // ✓
    name: "Excellent",
    meaning: "Nearly best — a strong move.",
    color: "#5bb784",
    shape: "circle",
  },
  good: {
    symbol: "·", // · (was empty; give it a visible glyph)
    name: "Good",
    meaning: "A reasonable move with little eval lost.",
    color: "#8a887f",
    shape: "circle",
  },
  inaccuracy: {
    symbol: "?!",
    name: "Inaccuracy",
    meaning: "A slightly weak move that gives up some advantage.",
    color: "#e6b422",
    shape: "circle",
  },
  mistake: {
    symbol: "?",
    name: "Mistake",
    meaning: "A clear error that loses notable advantage.",
    color: "#e08832",
    shape: "triangle",
  },
  blunder: {
    symbol: "??",
    name: "Blunder",
    meaning: "A serious error that can lose the game.",
    color: "#ca3431",
    shape: "triangle",
  },
};

export const LARGE_DOT_CLASSIFICATIONS = new Set<Classification>([
  "best",
  "blunder",
]);

export function isClassification(v: string | null | undefined): v is Classification {
  return v != null && v in CLASS_META;
}
