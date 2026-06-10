// Single source of truth for inline help copy (Workstream 3).
export const HELP = {
  elo: "ELO — a relative skill rating. Players gain points for beating stronger opponents and lose points to weaker ones; ~1500 is the starting baseline.",
  acpl: "ACPL — Average Centipawn Loss. The average evaluation lost per move versus the engine's best move, measured in hundredths of a pawn. Lower is better.",
  accuracy: "Accuracy — how closely a player's moves matched the engine's best moves, scored 0–100%. Higher is better.",
  eval: "Evaluation — Stockfish's score for the position in pawns. A positive number favors White, negative favors Black; 0.0 is dead even.",
  mateIn: "Mate in N — a forced checkmate is available in N moves for the side shown. #3 means mate in 3.",
  winProb: "Win probability — Stockfish's estimate of White's chance to win the game from this position, expressed as a percentage. 50% is an even game.",
  temperature: "Temperature — how random the model's move choice is. 0 = deterministic and focused; higher values (up to 2) make play more varied. Defaults to 0.7; changing it means the game will NOT count toward ELO.",
  reasoning: "Reasoning Effort — how much hidden 'thinking' a reasoning-capable model does before answering. Higher effort can improve move quality but costs more tokens and time. Defaults to High; each effort level ranks separately on the leaderboard.",
  nitro: "Speed (Nitro) — route each move to the fastest provider instead of the cheapest. Faster games, higher cost. Off by default (cheapest routing). Does not affect ELO.",
  chaos: "Chaos Mode — illegal moves from an LLM are played anyway instead of being rejected. Fun to watch, but these games do not count toward ELO or model stats.",
  drawAdjudication: "Draw Adjudication — automatically end the game as a draw if the engine evaluation stays within ±0.20 pawns for 30 consecutive moves, preventing endless dead-drawn games.",
  maxMoves: "Max Moves — the game is force-ended once this many moves are played, as a safety cap against games that never finish. Leave at 200 for a normal full game.",
  stockfishElo: "Stockfish Strength — caps the engine's playing strength to a target ELO so it plays at a human-like level. Strength-limited games do not count toward ELO or model stats.",
  tableTalk: "Table Talk — in-character trash talk and banter the models write alongside their moves. It does not affect play.",
  commentary: "Commentary — a neutral, plain-language explanation of what the selected move does and why. Generated per move; not every move has one.",
  queued: "Queued — the server is at its concurrent-game limit. Your game starts automatically as soon as a slot frees up.",
  engineLines: "Engine Lines — Stockfish's top candidate moves for this position, each with its evaluation. Rank 1 is the engine's preferred move.",
} as const;

export type HelpKey = keyof typeof HELP;
