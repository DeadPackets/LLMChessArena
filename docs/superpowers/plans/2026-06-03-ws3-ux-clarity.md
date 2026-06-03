# UX Clarity / Onboarding (Workstream 3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every chess + LLM term legible to non-experts via reusable inline help (`<InfoDot>`/`<Legend>`), fix the move-classification taxonomy mismatch, add actionable feedback loops and empty states, and surface microcopy on icon-only controls — all without touching the dark "war room" visual style.

**Architecture:** Build shared primitive P4 first: an `<InfoDot>` tooltip (hover + focus + tap, `aria-describedby`-linked) and a `<Legend>` key component, both war-room styled in `App.css`. Then consume them across `LeaderboardPage`, `ModelDetailPage`, `AnalysisPanel`, `HeadToHeadPage`, `EvalBar`, `NewGameDialog`, `WinProbGraph`, and `EngineLinesPanel`. Unify the classification vocabulary on the backend `MoveClassification` enum (`best/excellent/good/inaccuracy/mistake/blunder`). Wire feedback loops (disabled-button reason, human-move rejection, "Copied!" pill, queued explanation) and actionable empty states with CTAs.

**Tech Stack:** React 19 + TypeScript + Vite. No test framework exists; verification is `cd frontend && npm run build` (`tsc -b` gate) plus manual visual checks. node_modules is installed.

**Spec:** `docs/superpowers/specs/2026-06-03-polish-to-100-design.md` (Workstream 3).

---

## File Structure

```
frontend/src/
  components/
    shared/
      InfoDot.tsx              (NEW — P4 tooltip primitive)
      Legend.tsx               (NEW — P4 legend primitive)
      ClassificationBadge.tsx  (MODIFY — drop brilliant/great, unify vocab + help)
      classification.ts        (NEW — single source of classification metadata)
    game/
      EvalBar.tsx              (MODIFY — InfoDot on eval/pawns + mate-in-N)
      WinProbGraph.tsx         (MODIFY — fix taxonomy, panel title, shape legend)
      EngineLinesPanel.tsx     (MODIFY — panel title InfoDot)
      AnalysisPanel.tsx        (MODIFY — ACPL/accuracy InfoDots + classification legend)
      GameControls.tsx         (MODIFY — "Copied!" pill, hover labels)
      TableTalkPanel.tsx       (MODIFY — table-talk vs commentary microcopy)
      NarrationPanel.tsx       (MODIFY — commentary subtitle microcopy)
    gamelist/
      NewGameDialog.tsx        (MODIFY — temp/reasoning/chaos/stockfish/draw/max InfoDots + disabled reason)
  hooks/
    useGameWebSocket.ts        (MODIFY — queued microcopy + moveError state + error event)
  pages/
    LeaderboardPage.tsx        (MODIFY — header InfoDots, empty CTA, mobile caption)
    ModelDetailPage.tsx        (MODIFY — stat-card InfoDots + classification legend)
    HeadToHeadPage.tsx         (MODIFY — accuracy/ACPL InfoDots, empty CTA)
    GameListPage.tsx           (MODIFY — New Game CTA in empty state)
    OpeningExplorerPage.tsx    (MODIFY — Start a game link in empty state)
    CostDashboardPage.tsx      (MODIFY — Start a game link in empty state)
    GameViewerPage.tsx         (MODIFY — IllegalMoveIndicator human-aware, moveError banner)
  App.css                      (MODIFY — InfoDot/Legend styles + mobile leaderboard caption)
```

Shared help-string constants live in `frontend/src/components/shared/helpText.ts` (NEW, Task 1) so the same wording is reused everywhere.

---

### Task 1: P4 — `<InfoDot>` primitive + shared help-text constants

**Files:**
- Create: `frontend/src/components/shared/InfoDot.tsx`
- Create: `frontend/src/components/shared/helpText.ts`
- Modify: `frontend/src/App.css` (add InfoDot styles after the `.eval-bar` block, ~line 1700s; any stable location near other shared component styles is fine)

- [ ] **Step 1: Create the help-text constants**

Create `frontend/src/components/shared/helpText.ts`. These exact strings are reused by every consumer task — do not paraphrase them downstream:

```ts
// Single source of truth for inline help copy (Workstream 3).
export const HELP = {
  elo: "ELO — a relative skill rating. Players gain points for beating stronger opponents and lose points to weaker ones; ~1500 is the starting baseline.",
  acpl: "ACPL — Average Centipawn Loss. The average evaluation lost per move versus the engine's best move, measured in hundredths of a pawn. Lower is better.",
  accuracy: "Accuracy — how closely a player's moves matched the engine's best moves, scored 0–100%. Higher is better.",
  eval: "Evaluation — Stockfish's score for the position in pawns. A positive number favors White, negative favors Black; 0.0 is dead even.",
  mateIn: "Mate in N — a forced checkmate is available in N moves for the side shown. #3 means mate in 3.",
  winProb: "Win probability — Stockfish's estimate of White's chance to win the game from this position, expressed as a percentage. 50% is an even game.",
  temperature: "Temperature — how random the model's move choice is. 0 = deterministic and focused; higher values (up to 2) make play more varied and unpredictable. Leave at default unless experimenting.",
  reasoning: "Reasoning Effort — how much hidden 'thinking' a reasoning-capable model does before answering. Higher effort can improve move quality but costs more tokens and time. Default lets the model decide.",
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
```

- [ ] **Step 2: Create the `InfoDot` component**

Create `frontend/src/components/shared/InfoDot.tsx`. It renders a small muted `?` affordance that shows a tooltip on hover **and** keyboard focus, is reachable via Tab (`<button>`), toggles on tap (touch), and links the tooltip to the trigger via `aria-describedby`:

```tsx
import { useId, useState, useRef, useEffect } from "react";

interface Props {
  /** The help text shown in the tooltip and exposed to screen readers. */
  label: string;
  /** Optional accessible name for the trigger; defaults to "More information". */
  triggerLabel?: string;
}

export default function InfoDot({ label, triggerLabel = "More information" }: Props) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  // Tap-outside / Escape to dismiss the touch-toggled tooltip.
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span
      className="info-dot"
      ref={wrapRef}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        type="button"
        className="info-dot__trigger"
        aria-label={triggerLabel}
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        ?
      </button>
      <span
        id={id}
        role="tooltip"
        className={`info-dot__tip${open ? " info-dot__tip--open" : ""}`}
      >
        {label}
      </span>
    </span>
  );
}
```

- [ ] **Step 3: Add the war-room InfoDot styles to `App.css`**

In `frontend/src/App.css`, after the `.eval-bar` rule block (or any nearby shared-component location), insert. Palette uses existing tokens only (`--text-muted`, `--amber`, `--amber-dim`, the panel surface/border values already used by `.panel`):

```css
/* ── InfoDot (P4) — war-room inline help ── */
.info-dot {
  position: relative;
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
  margin-left: 0.3rem;
}

.info-dot__trigger {
  width: 14px;
  height: 14px;
  padding: 0;
  border-radius: 50%;
  border: 1px solid var(--amber-dim);
  background: transparent;
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.62rem;
  line-height: 1;
  cursor: help;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.info-dot__trigger:hover,
.info-dot__trigger:focus-visible {
  color: var(--amber);
  border-color: var(--amber);
  outline: none;
}

.info-dot__tip {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  z-index: 50;
  width: max-content;
  max-width: 260px;
  padding: 0.5rem 0.6rem;
  background: #14161f;
  border: 1px solid #272b3d;
  border-radius: 6px;
  color: var(--text-secondary, #c8c4bb);
  font-family: var(--font-sans, inherit);
  font-size: 0.72rem;
  line-height: 1.4;
  text-align: left;
  white-space: normal;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.12s ease;
}

.info-dot__tip--open {
  opacity: 1;
}

/* Flip-safe near the right edge: keep within the viewport on small screens. */
@media (max-width: 640px) {
  .info-dot__tip {
    max-width: 200px;
  }
}
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + `vite build` pass with no errors. (InfoDot/helpText are not yet imported anywhere, so this just confirms they compile.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/InfoDot.tsx frontend/src/components/shared/helpText.ts frontend/src/App.css
git commit -m "feat(ux): add P4 InfoDot tooltip primitive + shared help-text constants"
```

---

### Task 2: P4 — `<Legend>` primitive + war-room styles

**Files:**
- Create: `frontend/src/components/shared/Legend.tsx`
- Modify: `frontend/src/App.css` (add Legend styles directly after the InfoDot block from Task 1)

- [ ] **Step 1: Create the `Legend` component**

Create `frontend/src/components/shared/Legend.tsx`. A compact, reusable key mapping a symbol/shape/color → name → meaning. The `symbol` slot accepts text (e.g. `??`) or a small node (e.g. a colored shape):

```tsx
import type { ReactNode } from "react";

export interface LegendItem {
  /** A glyph, badge, or colored shape node shown at the start of the row. */
  symbol: ReactNode;
  /** Short name, e.g. "Blunder". */
  name: string;
  /** One-line meaning, e.g. "A serious mistake that loses major advantage". */
  meaning: string;
}

interface Props {
  items: LegendItem[];
  /** Optional heading shown above the list. */
  title?: string;
}

export default function Legend({ items, title }: Props) {
  return (
    <div className="legend">
      {title && <div className="legend__title">{title}</div>}
      <ul className="legend__list">
        {items.map((it, i) => (
          <li key={i} className="legend__row">
            <span className="legend__symbol" aria-hidden="true">{it.symbol}</span>
            <span className="legend__name">{it.name}</span>
            <span className="legend__meaning">{it.meaning}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Add the war-room Legend styles to `App.css`** (after the InfoDot block)

```css
/* ── Legend (P4) — reusable key ── */
.legend {
  border: 1px solid #272b3d;
  border-radius: 6px;
  background: rgba(20, 22, 31, 0.5);
  padding: 0.55rem 0.7rem;
}

.legend__title {
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.4rem;
}

.legend__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.3rem;
}

.legend__row {
  display: grid;
  grid-template-columns: 1.6rem auto 1fr;
  align-items: baseline;
  gap: 0.5rem;
  font-size: 0.72rem;
}

.legend__symbol {
  font-family: var(--font-mono);
  text-align: center;
  color: var(--text-secondary, #c8c4bb);
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.legend__name {
  color: var(--text-secondary, #c8c4bb);
  font-weight: 600;
  white-space: nowrap;
}

.legend__meaning {
  color: var(--text-muted);
  line-height: 1.35;
}

@media (max-width: 640px) {
  .legend__row {
    grid-template-columns: 1.4rem 1fr;
  }
  .legend__meaning {
    grid-column: 2 / -1;
  }
}
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: passes; `Legend` compiles though not yet consumed.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/shared/Legend.tsx frontend/src/App.css
git commit -m "feat(ux): add P4 Legend primitive (war-room styled)"
```

---

### Task 3: Fix the classification taxonomy bug (unify to backend enum)

The backend `MoveClassification` enum (`backend/app/services/move_classifier.py:8-14`) is the single source of truth: `best / excellent / good / inaccuracy / mistake / blunder`, with symbols `★ / ✓ / (none) / ?! / ? / ??`. Today `ClassificationBadge.tsx` carries phantom `brilliant`/`great` keys, and `WinProbGraph.tsx` keys its dot colors entirely on `brilliant/great/inaccuracy/mistake/blunder` — so `best`/`excellent`/`good` moves never get dots and the legend would be incoherent. Unify everything on the enum via a shared metadata module.

**Files:**
- Create: `frontend/src/components/shared/classification.ts`
- Modify: `frontend/src/components/shared/ClassificationBadge.tsx`
- Modify: `frontend/src/components/game/WinProbGraph.tsx`

- [ ] **Step 1: Create the shared classification metadata module**

Create `frontend/src/components/shared/classification.ts`. One ordered table drives the badge, the dot color/shape, and the legend. Colors reuse the existing palette already present in the codebase (`--best`/`--excellent`/`--inaccuracy`/`--mistake`/`--blunder` CSS vars exist via `.classification-badge--*`; the hex values below mirror the current `App.css` accent colors and the previous WinProbGraph palette):

```ts
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
```

- [ ] **Step 2: Rewrite `ClassificationBadge.tsx` to use the shared table**

Replace the entire contents of `frontend/src/components/shared/ClassificationBadge.tsx`:

```tsx
import { CLASS_META, isClassification } from "./classification";

interface Props {
  classification: string | null;
}

export default function ClassificationBadge({ classification }: Props) {
  if (!isClassification(classification)) return null;
  if (classification === "good") return null; // keep "good" silent in dense rows

  const meta = CLASS_META[classification];

  return (
    <span
      className={`classification-badge classification-badge--${classification}`}
      title={`${meta.name} — ${meta.meaning}`}
      aria-label={`Move classified as ${meta.name}: ${meta.meaning}`}
    >
      {meta.symbol}
    </span>
  );
}
```

- [ ] **Step 3: Rewrite the `WinProbGraph` dot logic to use the shared table**

In `frontend/src/components/game/WinProbGraph.tsx`, delete the local `CLASSIFICATION_DOT_COLORS` map (lines 15-21) and the local `LARGE_DOT_CLASSIFICATIONS` set (line 23), and import the shared metadata. At the top, change the imports:

```tsx
import type { MoveData } from "../../types/websocket";
import type { CriticalMoment } from "../../types/api";
import { CLASS_META, LARGE_DOT_CLASSIFICATIONS, isClassification } from "../shared/classification";
```

Then in the `dots` `useMemo`, replace the move-loop and critical-moment fallback so they read from `CLASS_META`. The move loop (was lines 79-91) becomes:

```tsx
    // Add dots for moves with notable classifications
    for (let i = 0; i < moves.length; i++) {
      const cls = moves[i].classification;
      if (isClassification(cls) && cls !== "good") {
        const wp = moves[i].winProbability != null ? moves[i].winProbability! * 100 : 50;
        result.push({
          index: i,
          y: wp,
          color: CLASS_META[cls].color,
          r: LARGE_DOT_CLASSIFICATIONS.has(cls) ? 4 : 3,
        });
        seen.add(i);
      }
    }
```

And the critical-moment fallback (was lines 94-109) becomes:

```tsx
    if (criticalMoments) {
      for (const cm of criticalMoments) {
        if (!seen.has(cm.move_index)) {
          const cls = cm.classification;
          const color = isClassification(cls)
            ? CLASS_META[cls].color
            : cm.swing > 0.25 ? CLASS_META.blunder.color : CLASS_META.inaccuracy.color;
          result.push({
            index: cm.move_index,
            y: cm.win_prob_after * 100,
            color,
            r: 3,
          });
        }
      }
    }
```

- [ ] **Step 4: Remove the now-orphaned `brilliant`/`great` badge CSS (optional cleanup, verify first)**

Run: `cd frontend && grep -n "classification-badge--brilliant\|classification-badge--great" src/App.css`
If matches exist, leave the rules in place (harmless dead CSS) OR delete those two specific rules — do not touch `--best/--excellent/--good/--inaccuracy/--mistake/--blunder`. This step is non-blocking; skip if no matches.

- [ ] **Step 5: Build + grep for stragglers**

Run: `cd frontend && npm run build && grep -rn '"brilliant"\|"great"\|brilliant:\|great:' src/`
Expected: build passes; the grep returns **no** matches in `src/components/` (the only acceptable remaining reference is unrelated). The classification vocabulary is now exactly the six enum values everywhere.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shared/classification.ts frontend/src/components/shared/ClassificationBadge.tsx frontend/src/components/game/WinProbGraph.tsx
git commit -m "fix(ux): unify move-classification taxonomy on backend enum (drop phantom brilliant/great)"
```

---

### Task 4: Classification Legend in AnalysisPanel + ACPL/Accuracy InfoDots

**Files:**
- Modify: `frontend/src/components/game/AnalysisPanel.tsx`

- [ ] **Step 1: Wire imports + reuse shared CLASS_ORDER**

In `frontend/src/components/game/AnalysisPanel.tsx`, add imports near the top (after the existing imports):

```tsx
import InfoDot from "../shared/InfoDot";
import Legend from "../shared/Legend";
import { HELP } from "../shared/helpText";
import { CLASS_ORDER, CLASS_META } from "../shared/classification";
```

Delete the local `const CLASS_ORDER = [...]` (line 25) — it is now imported. The `ClassificationBreakdown` filter `CLASS_ORDER.filter((c) => classifications[c])` keeps working unchanged because the imported array holds the same six strings.

- [ ] **Step 2: Add ACPL + Accuracy InfoDots to the accuracy cards**

The accuracy card value is the accuracy %; add an InfoDot to the ACPL line and to the card. Change the white card's ACPL line (was line 99-101):

```tsx
          {analysis.white_acpl != null && (
            <div className="accuracy-card__acpl">
              ACPL: {analysis.white_acpl.toFixed(1)}
              <InfoDot label={HELP.acpl} />
            </div>
          )}
```

Apply the identical change to the black card's ACPL line (was line 109-111), keeping `analysis.black_acpl`.

For accuracy, add a single shared InfoDot in the row container. Wrap the accuracy row header — there is no header today, so add one above the two cards. Replace the opening of the accuracy row (was `<div className="analysis-panel__accuracy-row">`) with a labeled wrapper:

```tsx
      {/* Accuracy cards */}
      <div className="analysis-panel__subtitle" style={{ marginBottom: "0.4rem" }}>
        Accuracy
        <InfoDot label={HELP.accuracy} />
      </div>
      <div className="analysis-panel__accuracy-row">
```

- [ ] **Step 3: Add a classification Legend under the Critical Moments header**

In the Critical Moments block (was lines 136-149), add a `<Legend>` right after the `analysis-panel__subtitle`. Build the items from the shared metadata so symbols/colors stay in sync. Insert after the subtitle line:

```tsx
        <div className="critical-moments">
          <div className="analysis-panel__subtitle">
            Critical Moments
            <InfoDot label="Critical Moments — the moves where the win probability swung the most. Click one to jump to that position." />
          </div>
          <Legend
            title="Move quality"
            items={CLASS_ORDER.map((c) => ({
              symbol: (
                <span style={{ color: CLASS_META[c].color }}>{CLASS_META[c].symbol || "·"}</span>
              ),
              name: CLASS_META[c].name,
              meaning: CLASS_META[c].meaning,
            }))}
          />
          <div className="critical-moments__list">
```

(Ensure the original `<div className="critical-moments__list">` opening line is not duplicated — replace the existing subtitle+list-opening with the block above.)

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: open a completed game's Post-Game Analysis. The Accuracy subtitle and each ACPL line show a `?` dot whose tooltip reads the exact `HELP.accuracy` / `HELP.acpl` strings on hover and on keyboard focus. The Critical Moments section shows a six-row legend (Best ★ … Blunder ??) in war-room styling.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/AnalysisPanel.tsx
git commit -m "feat(ux): ACPL/accuracy InfoDots + move-quality Legend in AnalysisPanel"
```

---

### Task 5: Leaderboard — column-header InfoDots, mobile caption, empty-state CTA

**Files:**
- Modify: `frontend/src/pages/LeaderboardPage.tsx`
- Modify: `frontend/src/App.css` (add the `.leaderboard-mobile-caption` rule + reveal it in the existing ≤900px media query, ~lines 3193-3205 region)

- [ ] **Step 1: Imports + helpers**

In `frontend/src/pages/LeaderboardPage.tsx`, add imports:

```tsx
import InfoDot from "../components/shared/InfoDot";
import { HELP } from "../components/shared/helpText";
```

- [ ] **Step 2: Add InfoDots to the jargon column headers (ELO, Win %, Accuracy, ACPL)**

Replace the `<thead>` row (was lines 57-69):

```tsx
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>ELO<InfoDot label={HELP.elo} /></th>
                <th>W / D / L</th>
                <th>Win %</th>
                <th>Accuracy<InfoDot label={HELP.accuracy} /></th>
                <th>ACPL<InfoDot label={HELP.acpl} /></th>
                <th>Avg Cost</th>
                <th>Avg Time</th>
              </tr>
            </thead>
```

- [ ] **Step 3: Add the mobile caption above the table**

The ≤900px media query hides the Accuracy/ACPL/Cost/Time columns; tell mobile users the data is on the detail page. Insert immediately inside the `<div className="panel">` and before `<div className="leaderboard-table-wrap">` (was line 54-55):

```tsx
        <div className="panel">
          <div className="leaderboard-mobile-caption">
            Tap a model for accuracy, ACPL, cost &amp; response time.
          </div>
          <div className="leaderboard-table-wrap">
```

- [ ] **Step 4: Make the empty state actionable**

Replace the empty-state block (was lines 46-52) so it links to start a game:

```tsx
      {displayModels.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9813;</div>
          <div className="empty-state__text">
            No models ranked yet. Play some games first!
          </div>
          <Link to="/" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
            Start a game
          </Link>
        </div>
      ) : (
```

(`Link` is already imported on line 2.)

- [ ] **Step 5: Add CSS — caption hidden on desktop, shown ≤900px**

In `frontend/src/App.css`, add a base rule near the other `.leaderboard-*` styles:

```css
.leaderboard-mobile-caption {
  display: none;
  padding: 0.5rem 0.75rem;
  font-size: 0.72rem;
  color: var(--text-muted);
  border-bottom: 1px solid var(--border-light, #272b3d);
}
```

Then inside the existing leaderboard mobile media query (the `@media (max-width: 900px)` block that hides columns, ~lines 3193-3205), add:

```css
  .leaderboard-mobile-caption {
    display: block;
  }
```

- [ ] **Step 6: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: on desktop, hovering/focusing the `?` next to ELO/Accuracy/ACPL shows the exact `HELP.*` strings; the caption is hidden. Narrow the window to ≤900px → the four detail columns hide and the caption "Tap a model for accuracy, ACPL, cost & response time." appears. With no ranked models, the empty state shows a "Start a game" button linking to `/`.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/LeaderboardPage.tsx frontend/src/App.css
git commit -m "feat(ux): leaderboard header InfoDots, mobile caption, actionable empty state"
```

---

### Task 6: ModelDetailPage — stat-card InfoDots + classification Legend

**Files:**
- Modify: `frontend/src/pages/ModelDetailPage.tsx`

- [ ] **Step 1: Imports + reuse shared CLASS_ORDER**

Add imports:

```tsx
import InfoDot from "../components/shared/InfoDot";
import Legend from "../components/shared/Legend";
import { HELP } from "../components/shared/helpText";
import { CLASS_ORDER, CLASS_META } from "../components/shared/classification";
```

Delete the local `const CLASS_ORDER = [...]` (line 12); the `classEntries` computation (line 49) works unchanged with the imported array.

- [ ] **Step 2: Add an InfoDot to the ELO header**

Change the ELO header (was lines 65-67):

```tsx
        <div className="model-detail-page__elo">
          {Math.round(model.elo_rating)} ELO
          <InfoDot label={HELP.elo} />
        </div>
```

- [ ] **Step 3: Add InfoDots to the Accuracy and Avg ACPL stat-card labels**

Change the Accuracy stat-card label (was line 84):

```tsx
          <div className="stat-card__label">Accuracy<InfoDot label={HELP.accuracy} /></div>
```

Change the Avg ACPL stat-card label (was line 90):

```tsx
          <div className="stat-card__label">Avg ACPL<InfoDot label={HELP.acpl} /></div>
```

- [ ] **Step 4: Add the classification Legend under the Move Classifications subtitle**

Change the Move Classifications block (was lines 122-134) to add the legend after the subtitle:

```tsx
        {classEntries.length > 0 && (
          <div style={{ marginTop: "0.75rem" }}>
            <div className="analysis-panel__subtitle">
              Move Classifications
              <InfoDot label="How this model's moves rated against the engine across all its games." />
            </div>
            <Legend
              title="Move quality"
              items={CLASS_ORDER.map((c) => ({
                symbol: (
                  <span style={{ color: CLASS_META[c].color }}>{CLASS_META[c].symbol || "·"}</span>
                ),
                name: CLASS_META[c].name,
                meaning: CLASS_META[c].meaning,
              }))}
            />
            <div className="classification-grid">
              {classEntries.map(({ cls, count }) => (
                <span key={cls} className="classification-stat">
                  <ClassificationBadge classification={cls} />
                  <span>{count}</span>
                </span>
              ))}
            </div>
          </div>
        )}
```

- [ ] **Step 5: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: on a model detail page, the ELO header, Accuracy and Avg ACPL stat cards each show a working `?` tooltip with the exact help strings; the Move Classifications section shows the six-row legend.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/ModelDetailPage.tsx
git commit -m "feat(ux): ModelDetailPage stat-card InfoDots + classification Legend"
```

---

### Task 7: HeadToHeadPage — accuracy/ACPL InfoDots + actionable empty state

**Files:**
- Modify: `frontend/src/pages/HeadToHeadPage.tsx`

- [ ] **Step 1: Imports**

```tsx
import { Link } from "react-router-dom";
import InfoDot from "../components/shared/InfoDot";
import { HELP } from "../components/shared/helpText";
```

(Note: `useSearchParams` is already imported from `react-router-dom` on line 2 — add `Link` to that same import line instead of a second import: `import { useSearchParams, Link } from "react-router-dom";`.)

- [ ] **Step 2: Add InfoDots to the Statistics stat-row labels**

Change the Accuracy label (was line 131):

```tsx
                <span className="analysis-panel__stat-label">Accuracy<InfoDot label={HELP.accuracy} /></span>
```

Change the Avg ACPL label (was line 140):

```tsx
                <span className="analysis-panel__stat-label">Avg ACPL<InfoDot label={HELP.acpl} /></span>
```

- [ ] **Step 3: Make the initial empty state actionable**

Change the no-comparison empty state (was lines 162-167) to add a CTA linking to start a game:

```tsx
      {!comparison && !loading && !error && (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">Select two models above to compare their head-to-head record, or start a game to build one.</div>
          <Link to="/" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
            Start a game
          </Link>
        </div>
      )}
```

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: the Statistics panel's Accuracy/ACPL labels show working tooltips; with no models selected, the empty state shows the "Start a game" CTA.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/HeadToHeadPage.tsx
git commit -m "feat(ux): HeadToHeadPage stat InfoDots + actionable empty state"
```

---

### Task 8: EvalBar — eval/pawns + mate-in-N help; WinProbGraph + EngineLines panel titles

**Files:**
- Modify: `frontend/src/components/game/EvalBar.tsx`
- Modify: `frontend/src/components/game/WinProbGraph.tsx`
- Modify: `frontend/src/components/game/EngineLinesPanel.tsx`

- [ ] **Step 1: Add an "=" parity affordance + an InfoDot to EvalBar**

The eval bar is a thin vertical strip; an inline InfoDot would crowd it, so attach the help to the bar's existing `aria-label` and add a small fixed help dot at the top of the strip. In `frontend/src/components/game/EvalBar.tsx`, add the import and a midpoint help node. Add at the top:

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

Replace the return (was lines 33-39). When neither side is ahead (no labels), show a subtle "=" so parity is not color-only; place the InfoDot at the top of the bar:

```tsx
  const isEven = !topLabel && !bottomLabel;

  return (
    <div className="eval-bar" role="meter" aria-label="Position evaluation: White win probability and pawn advantage" aria-valuenow={whitePct} aria-valuemin={0} aria-valuemax={100}>
      <span className="eval-bar__info">
        <InfoDot label={mateIn != null ? HELP.mateIn : HELP.eval} triggerLabel="What the eval bar means" />
      </span>
      {topLabel && <span className="eval-bar__label eval-bar__label--top" title={topTitle}>{topLabel}</span>}
      {isEven && <span className="eval-bar__label eval-bar__label--even" title="Even position">=</span>}
      <div className="eval-bar__fill" style={{ height: `${whitePct}%` }} />
      {bottomLabel && <span className="eval-bar__label eval-bar__label--bottom" title={bottomTitle}>{bottomLabel}</span>}
    </div>
  );
```

Add supporting CSS to `App.css` near the `.eval-bar` rules:

```css
.eval-bar__info {
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
}
.eval-bar__label--even {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  color: var(--text-muted);
  font-family: var(--font-mono);
  font-size: 0.7rem;
}
```

(Confirm `.eval-bar` has `position: relative`; if not, add `position: relative;` to its rule so the absolute children anchor correctly.)

- [ ] **Step 2: Add a panel title with InfoDot to WinProbGraph**

In `frontend/src/components/game/WinProbGraph.tsx`, add imports:

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

Add a header inside the panel wrapper. Change the opening (was line 115):

```tsx
  return (
    <div className="win-prob-graph panel">
      <div className="win-prob-graph__title">
        Win Probability
        <InfoDot label={HELP.winProb} />
      </div>
      <ResponsiveContainer width="100%" height={100}>
```

Add CSS to `App.css` near the win-prob-graph styles:

```css
.win-prob-graph__title {
  display: flex;
  align-items: center;
  font-size: 0.7rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 0.3rem;
}
```

- [ ] **Step 3: Add an InfoDot to the EngineLines panel title**

In `frontend/src/components/game/EngineLinesPanel.tsx`, add imports and an InfoDot in the existing header. Add at the top:

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

Change the title span (was line 30):

```tsx
        <span className="engine-lines__title">Engine Lines<InfoDot label={HELP.engineLines} /></span>
```

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: the eval bar shows a `?` at the top whose tooltip is the eval (or mate-in-N) help; at a dead-even position a subtle "=" appears centered. The Win Probability panel and Engine Lines panel each show a title with a working tooltip.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/EvalBar.tsx frontend/src/components/game/WinProbGraph.tsx frontend/src/components/game/EngineLinesPanel.tsx frontend/src/App.css
git commit -m "feat(ux): eval/mate/win-prob/engine-lines inline help + even-position marker"
```

---

### Task 9: NewGameDialog — temperature, reasoning, chaos, Stockfish, draw, max-moves help + disabled-button reason

**Files:**
- Modify: `frontend/src/components/gamelist/NewGameDialog.tsx`

- [ ] **Step 1: Imports**

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

- [ ] **Step 2: Temperature + Reasoning Effort InfoDots (ModelSettingsPanel)**

In `ModelSettingsPanel`, change the Temperature label (was lines 152-155):

```tsx
        <label className="new-game-dialog__label">
          Temperature
          <InfoDot label={HELP.temperature} />
          <span className="new-game-dialog__label-hint">{tempDisplay}</span>
        </label>
```

Change the Reasoning Effort label (was line 184):

```tsx
        <label className="new-game-dialog__label">
          Reasoning Effort
          <InfoDot label={HELP.reasoning} />
        </label>
```

- [ ] **Step 3: Stockfish Strength InfoDot (StockfishEloSelector)**

Change the label (was line 93):

```tsx
      <label className="new-game-dialog__label">
        Stockfish Strength
        <InfoDot label={HELP.stockfishElo} />
      </label>
```

- [ ] **Step 4: Max Moves + Time per Move InfoDots**

Change the Max Moves label (was lines 401-403):

```tsx
          <label className="new-game-dialog__label" htmlFor="max-moves">
            Max Moves (optional)
            <InfoDot label={HELP.maxMoves} />
          </label>
```

- [ ] **Step 5: Chaos Mode + Draw Adjudication InfoDots on the checkbox labels**

Change the Chaos Mode checkbox label (was lines 433-441):

```tsx
          <label className="new-game-dialog__checkbox-label">
            <input
              type="checkbox"
              className="new-game-dialog__checkbox"
              checked={chaosMode}
              onChange={(e) => setChaosMode(e.target.checked)}
            />
            Chaos Mode &mdash; Illegal LLM moves are allowed
            <InfoDot label={HELP.chaos} />
          </label>
```

Change the Draw Adjudication checkbox label (was lines 456-464):

```tsx
        <label className="new-game-dialog__checkbox-label">
          <input
            type="checkbox"
            className="new-game-dialog__checkbox"
            checked={drawAdjudication}
            onChange={(e) => setDrawAdjudication(e.target.checked)}
          />
          Draw Adjudication &mdash; Auto-draw if eval within &plusmn;0.20 for 30 moves
          <InfoDot label={HELP.drawAdjudication} />
        </label>
```

- [ ] **Step 6: Explain *why* "Start Game" is disabled**

Compute the reason and render it inline above the actions. After the `canSubmit` definition (was lines 265-268), add a derived hint:

```tsx
  const disabledReason =
    submitting
      ? null
      : whiteIsLLM && whiteModel.trim() === "" && blackIsLLM && blackModel.trim() === ""
        ? "Select a model for both LLM sides to start."
        : whiteIsLLM && whiteModel.trim() === ""
          ? "Select a model for White to start."
          : blackIsLLM && blackModel.trim() === ""
            ? "Select a model for Black to start."
            : null;
```

Then change the actions block (was lines 516-527) to surface the hint and give the disabled button an accessible reason:

```tsx
        <div className="new-game-dialog__actions">
          {disabledReason && (
            <span className="new-game-dialog__disabled-hint">{disabledReason}</span>
          )}
          <button type="button" className="btn btn--ghost" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="btn btn--primary"
            disabled={!canSubmit}
            title={disabledReason ?? undefined}
            aria-describedby={disabledReason ? "start-game-hint" : undefined}
          >
            {submitting ? "Creating..." : "Start Game"}
          </button>
        </div>
```

Give the hint span the matching id for `aria-describedby`:

```tsx
            <span id="start-game-hint" className="new-game-dialog__disabled-hint">{disabledReason}</span>
```

(Replace the earlier `<span className="new-game-dialog__disabled-hint">` with this id-carrying version.)

Add CSS to `App.css` near the `.new-game-dialog__actions` rules:

```css
.new-game-dialog__disabled-hint {
  margin-right: auto;
  align-self: center;
  font-size: 0.74rem;
  color: var(--text-muted);
}
```

- [ ] **Step 7: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: open New Game with no model chosen → the actions row shows "Select a model for both LLM sides to start." and the disabled Start Game button exposes that as a `title`/`aria-describedby`. Pick White only → the hint updates to "Select a model for Black to start." Each advanced/option label (Temperature, Reasoning Effort, Stockfish Strength, Max Moves, Chaos Mode, Draw Adjudication) shows a working `?` tooltip with the exact `HELP.*` text.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/gamelist/NewGameDialog.tsx frontend/src/App.css
git commit -m "feat(ux): NewGameDialog inline help for all options + disabled Start Game reason"
```

---

### Task 10: TableTalk vs Commentary microcopy + queued-state explanation

**Files:**
- Modify: `frontend/src/components/game/TableTalkPanel.tsx`
- Modify: `frontend/src/components/game/NarrationPanel.tsx`
- Modify: `frontend/src/hooks/useGameWebSocket.ts`

- [ ] **Step 1: Disambiguate "Table Talk" with an InfoDot**

In `frontend/src/components/game/TableTalkPanel.tsx`, add imports:

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

Change the panel label (was lines 151-162) to add the InfoDot right after the title text:

```tsx
      <div className="table-talk-panel__label">
        Table Talk
        <InfoDot label={HELP.tableTalk} />
        {hasErrors && (
          <button
            className={`table-talk-panel__filter-toggle${hideErrors ? " table-talk-panel__filter-toggle--active" : ""}`}
            onClick={() => setHideErrors((v) => !v)}
            title={hideErrors ? "Show errors" : "Hide errors"}
          >
            {hideErrors ? "Show errors" : "Hide errors"}
          </button>
        )}
      </div>
```

- [ ] **Step 2: Disambiguate "Commentary" with an InfoDot**

In `frontend/src/components/game/NarrationPanel.tsx`, add imports:

```tsx
import InfoDot from "../shared/InfoDot";
import { HELP } from "../shared/helpText";
```

Change the empty-state label (was line 21):

```tsx
        <div className="narration-panel__label">Commentary<InfoDot label={HELP.commentary} /></div>
```

Change the populated-state label (was lines 32-37) to add the InfoDot after the "Commentary" span:

```tsx
      <div className="narration-panel__label">
        <span>Commentary</span>
        <InfoDot label={HELP.commentary} />
        <span style={{ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: "0.68rem" }}>
          {move.moveNumber}. {move.color === "white" ? "" : "..."}{move.san}
        </span>
      </div>
```

- [ ] **Step 3: Make the queued status message explanatory**

In `frontend/src/hooks/useGameWebSocket.ts`, the `QUEUED` reducer (was lines 206-211) sets `statusMessage: "Queued (position/max)"`. The payload is `{ position: number; active: number; max: number }` (per `GameAction` in `types/websocket.ts:107`). Replace it with plain-language copy:

```tsx
    case "QUEUED":
      return {
        ...state,
        status: "queued",
        statusMessage: `Server is busy — your game will start automatically (position ${action.payload.position} of ${action.payload.max}).`,
      };
```

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: in a live game, the Table Talk and Commentary panel headers each show a `?` whose tooltip distinguishes banter from neutral move explanation. When a game is queued, the status message reads "Server is busy — your game will start automatically (position N of M)." rather than the terse "Queued (N/M)".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/TableTalkPanel.tsx frontend/src/components/game/NarrationPanel.tsx frontend/src/hooks/useGameWebSocket.ts
git commit -m "feat(ux): table-talk vs commentary tooltips + explanatory queued status"
```

---

### Task 11: GameControls — "Copied!" pill + hover labels on icon-only buttons

**Files:**
- Modify: `frontend/src/components/game/GameControls.tsx`
- Modify: `frontend/src/App.css` (add `.game-controls__copied-pill` style near the game-controls rules)

- [ ] **Step 1: Replace the bare checkmark with a "Copied!" pill**

In `frontend/src/components/game/GameControls.tsx`, the copy button (was lines 168-175) currently swaps the link glyph for a `✓`. Replace it so a brief labeled "Copied!" pill appears (the 2s timeout in `copyPositionLink` already exists, line 63):

```tsx
      <span className="game-controls__copy-wrap">
        <button
          className="game-controls__btn game-controls__copy-btn"
          onClick={copyPositionLink}
          title="Copy link to this position"
          aria-label="Copy link to current position"
        >
          {"🔗"}
        </button>
        {linkCopied && (
          <span className="game-controls__copied-pill" role="status">Copied!</span>
        )}
      </span>
```

(Keep the existing `linkCopied` state and `copyPositionLink` function unchanged — the button glyph no longer flips to `✓`; the pill conveys success and is announced via `role="status"`.)

- [ ] **Step 2: Strengthen hover labels on the other icon-only controls**

The PGN, mute, and shortcuts buttons already have `title` + `aria-label`. Confirm/keep them; for the PGN button (was lines 146-155) the visible text already reads "PGN" so it's labeled. No change needed beyond Step 1, but verify each icon-only control still has a `title`:

Run: `cd frontend && grep -n 'title=' src/components/game/GameControls.tsx`
Expected: titles present on first/prev/play/next/last/PGN/mute/copy/shortcuts buttons. (They are; this is a guard, not an edit.)

- [ ] **Step 3: Add the "Copied!" pill CSS to `App.css`** (near the `.game-controls` rules)

```css
.game-controls__copy-wrap {
  position: relative;
  display: inline-flex;
}

.game-controls__copied-pill {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  white-space: nowrap;
  padding: 0.2rem 0.45rem;
  font-size: 0.68rem;
  font-family: var(--font-mono);
  color: var(--bg, #0e1017);
  background: var(--amber);
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  pointer-events: none;
}
```

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: click the copy-link button → a small amber "Copied!" pill appears above it for ~2s and is announced by screen readers (`role="status"`); the link glyph no longer silently flips to a checkmark.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/GameControls.tsx frontend/src/App.css
git commit -m "feat(ux): Copied! pill for copy-link button + verified control labels"
```

---

### Task 12: Human-move rejection feedback + stop misattributing "Move Errors" to a model

**Files:**
- Modify: `frontend/src/types/websocket.ts` (add `moveError` to `GameState`, `SET_MOVE_ERROR` action)
- Modify: `frontend/src/hooks/useGameWebSocket.ts` (handle `error` WS event, expose moveError)
- Modify: `frontend/src/pages/GameViewerPage.tsx` (render rejection banner; make IllegalMoveIndicator human-aware)

- [ ] **Step 1: Extend the GameState + action types**

In `frontend/src/types/websocket.ts`, add a field to `GameState` (after `statusMessage`, line 100):

```tsx
  statusMessage: string | null;
  moveError: string | null;
  gameOverData: GameOverData | null;
```

Add a new action to the `GameAction` union (after the `SPECTATOR_COUNT` member, line 118 — change the trailing `;` on that line to `|` and append):

```tsx
  | { type: "SPECTATOR_COUNT"; payload: { count: number } }
  | { type: "SET_MOVE_ERROR"; payload: string | null };
```

- [ ] **Step 2: Initialize + reduce the new state**

In `frontend/src/hooks/useGameWebSocket.ts`, add to `initialState` (after `statusMessage: null,`, line 38):

```tsx
  statusMessage: null,
  moveError: null,
  gameOverData: null,
```

Add a reducer case (next to `SPECTATOR_COUNT`, ~line 327):

```tsx
    case "SET_MOVE_ERROR":
      return { ...state, moveError: action.payload };
```

Clear `moveError` whenever a move is accepted: in the `MOVE_PLAYED` case (line 194-203) and the `AWAITING_HUMAN_MOVE` case (line 308-313), add `moveError: null,` to the returned object so a stale rejection clears once the board advances or it's the human's turn again.

- [ ] **Step 3: Handle the `error` WS event**

In the `onMessage` switch (after the `spectator_count` case, ~line 398), add an `error` handler. The backend (WS3 spec item — human-move safety) sends an `error` event back when a submission is rejected:

```tsx
          case "error":
            dispatch({
              type: "SET_MOVE_ERROR",
              payload: typeof msg.data?.message === "string"
                ? msg.data.message
                : "Move not accepted — try again.",
            });
            break;
```

- [ ] **Step 4: Set a local pending error on submit and expose `moveError`**

In `submitMove` (line 464-466), optimistically clear any prior error so re-submitting feels responsive:

```tsx
  const submitMove = useCallback((uci: string) => {
    dispatch({ type: "SET_MOVE_ERROR", payload: null });
    sendJsonMessage({ type: "human_move", uci, player_secret: playerSecret });
  }, [sendJsonMessage, playerSecret]);
```

`moveError` is already part of `state`, which is returned, so no change to the return statement is needed.

- [ ] **Step 5: Render the rejection banner in GameViewerPage**

In `frontend/src/pages/GameViewerPage.tsx`, in the info column, render a rejection message when `state.moveError` is set and it's the human's turn. Insert just before the `MoveTimer`/`human-turn-indicator` block (before line 416):

```tsx
          {humanColor && isLive && state.moveError && (
            <div className="move-rejected" role="alert">
              {state.moveError}
            </div>
          )}

```

Add CSS to `App.css`:

```css
.move-rejected {
  margin-top: 0.5rem;
  padding: 0.5rem 0.6rem;
  border: 1px solid var(--blunder, #ca3431);
  border-radius: 6px;
  background: rgba(202, 52, 49, 0.12);
  color: var(--blunder, #ca3431);
  font-size: 0.78rem;
}
```

- [ ] **Step 6: Stop labeling "Move Errors" with a model name for human players**

In `IllegalMoveIndicator` (lines 30-56), the latest line shows `{latestModel}: <code>{attemptedMove}</code> — illegal move`. For a human side this misattributes the error to a model. Make the panel human-aware. Change the component signature and the latest-line render. Update the call site (line 412-413) to pass the human color:

Change the call site:

```tsx
          {state.illegalMoves.length > 0 && (
            <IllegalMoveIndicator
              illegalMoves={state.illegalMoves}
              humanColor={humanColor}
            />
          )}
```

Change the component (lines 30-56):

```tsx
function IllegalMoveIndicator({
  illegalMoves,
  humanColor,
}: {
  illegalMoves: IllegalMoveData[];
  humanColor: "white" | "black" | null;
}) {
  const invalidUCI = illegalMoves.filter((m) => m.reason === "Invalid UCI notation").length;
  const illegalMovesCt = illegalMoves.length - invalidUCI;
  const whiteCt = illegalMoves.filter((m) => m.color === "white").length;
  const blackCt = illegalMoves.filter((m) => m.color === "black").length;
  const latest = illegalMoves[illegalMoves.length - 1];
  const latestIsHuman = humanColor != null && latest.color === humanColor;
  const latestActor = latestIsHuman ? "You" : (latest.model.split("/").pop() ?? latest.model);
  const latestType = latest.reason === "Invalid UCI notation" ? "invalid UCI" : "illegal move";

  return (
    <div className="illegal-moves-indicator panel">
      <div className="illegal-moves-indicator__title">Move Errors</div>
      <div className="illegal-moves-indicator__counts">
        <span>White: <span className="illegal-moves-indicator__count-value">{whiteCt}</span></span>
        <span>Black: <span className="illegal-moves-indicator__count-value">{blackCt}</span></span>
        <span style={{ marginLeft: "auto", fontSize: "0.7rem" }}>
          {illegalMovesCt > 0 && <span>{illegalMovesCt} illegal</span>}
          {illegalMovesCt > 0 && invalidUCI > 0 && " / "}
          {invalidUCI > 0 && <span style={{ color: "var(--mistake)" }}>{invalidUCI} invalid UCI</span>}
        </span>
      </div>
      <div className="illegal-moves-indicator__latest">
        {latestActor}: <code>{latest.attemptedMove}</code> &mdash; {latestType}
      </div>
    </div>
  );
}
```

- [ ] **Step 7: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual (requires a human-vs-LLM game): submit an illegal/rejected human move → a red "Move not accepted — try again." (or the server's message) banner appears in the info column with `role="alert"`, and clears once a legal move advances the game. The "Move Errors" panel shows "You: <move> — illegal move" for the human side instead of a fabricated model name.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/types/websocket.ts frontend/src/hooks/useGameWebSocket.ts frontend/src/pages/GameViewerPage.tsx frontend/src/App.css
git commit -m "feat(ux): human-move rejection feedback + human-aware Move Errors panel"
```

---

### Task 13: Actionable empty states — GameList, Openings, Costs

**Files:**
- Modify: `frontend/src/pages/GameListPage.tsx`
- Modify: `frontend/src/pages/OpeningExplorerPage.tsx`
- Modify: `frontend/src/pages/CostDashboardPage.tsx`

- [ ] **Step 1: Put a "New Game" button inside the GameList empty state**

In `frontend/src/pages/GameListPage.tsx`, the empty state (lines 243-253) currently dead-ends. The page already has `setDialogOpen` (line 28) and the `NewGameDialog` (lines 279-283). Replace the empty-state block:

```tsx
      ) : games.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">
            {hasActiveFilters
              ? "No games match your filters."
              : filter === "all"
                ? "No games yet. Start a new game!"
                : `No ${filter} games found.`}
          </div>
          {hasActiveFilters ? (
            <button className="btn btn--ghost" style={{ marginTop: "0.75rem" }} onClick={clearFilters}>
              Clear filters
            </button>
          ) : (
            <button className="btn btn--primary" style={{ marginTop: "0.75rem" }} onClick={() => setDialogOpen(true)}>
              New Game
            </button>
          )}
        </div>
      ) : (
```

(When filters are active, the CTA clears them via the existing `clearFilters`; otherwise it opens the New Game dialog via the existing `setDialogOpen`.)

- [ ] **Step 2: Add a "Start a game" link to the Openings empty state**

In `frontend/src/pages/OpeningExplorerPage.tsx`, add `Link` (already imported on line 2). Replace the empty-state block (lines 38-42):

```tsx
      {openings.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">No completed games with opening data yet.</div>
          <Link to="/" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
            Start a game
          </Link>
        </div>
      ) : (
```

- [ ] **Step 3: Add a "Start a game" link to the Costs empty/error state**

In `frontend/src/pages/CostDashboardPage.tsx`, add the import:

```tsx
import { Link } from "react-router-dom";
```

The `error || !data` branch (lines 96-103) shows an icon + message. Append a CTA only when there is genuinely no data (not on a hard error, to keep "error ≠ empty"). Replace that branch:

```tsx
  if (error || !data) {
    return (
      <div className="empty-state panel">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">{error || "No cost data yet — run a game to start tracking spend."}</div>
        {!error && (
          <Link to="/" className="btn btn--primary" style={{ marginTop: "0.75rem" }}>
            Start a game
          </Link>
        )}
      </div>
    );
  }
```

- [ ] **Step 4: Build + manual check**

Run: `cd frontend && npm run build`
Expected: passes. Manual: with no games, the Games list empty state shows a "New Game" button that opens the dialog; with active filters it shows "Clear filters". Openings and Costs empty states show a "Start a game" link to `/`. (On a real fetch error, Costs still shows just the error message with no misleading CTA.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/GameListPage.tsx frontend/src/pages/OpeningExplorerPage.tsx frontend/src/pages/CostDashboardPage.tsx
git commit -m "feat(ux): actionable empty states across GameList, Openings, and Costs"
```

---

### Task 14: Final whole-workstream verification

**Files:** none (verification only)

- [ ] **Step 1: Full build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + `vite build` complete with zero errors.

- [ ] **Step 2: Taxonomy + placeholder grep**

Run: `cd frontend && grep -rn '"brilliant"\|"great"' src/components/ ; grep -rn "add a tooltip\|TODO\|FIXME\|explaining X" src/`
Expected: no matches (the classification taxonomy is unified; no placeholder copy slipped in).

- [ ] **Step 3: InfoDot reuse sanity check**

Run: `cd frontend && grep -rln "from \"../shared/InfoDot\"\|from \"../components/shared/InfoDot\"" src/`
Expected: matches in `EvalBar`, `WinProbGraph`, `EngineLinesPanel`, `AnalysisPanel`, `TableTalkPanel`, `NarrationPanel`, `NewGameDialog`, `LeaderboardPage`, `ModelDetailPage`, `HeadToHeadPage` — confirming P4 is reused everywhere rather than re-implemented.

- [ ] **Step 4: Manual keyboard/SR spot-check (per spec cross-cutting checklist)**

Tab to any `?` InfoDot trigger → the tooltip appears on focus and reads its `aria-describedby` text; Escape/blur dismisses it. Confirm tooltips are readable (war-room dark panel, amber-accented `?`) and never rely on color alone (the classification Legend pairs each color with a glyph + name + meaning).

- [ ] **Step 5: Commit (no-op safety / docs)**

If any stray formatting fix was needed during verification, commit it:

```bash
git add -A
git commit -m "chore(ux): WS3 final verification fixes" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage map (Workstream 3):**
- **WS3.1 Explain the jargon (P4 InfoDot/Legend):** P4 built first — `InfoDot` (Task 1), `Legend` (Task 2). Applied to ELO (Tasks 5, 6), ACPL (Tasks 4, 5, 6, 7), accuracy (Tasks 4, 5, 6, 7), eval/pawns + mate-in-N (Task 8), move-classification legend (Tasks 4, 6), win probability (Task 8), temperature + reasoning effort (Task 9), chaos mode (Task 9), table-talk vs commentary (Task 10), queued state (Task 10). Targets covered: LeaderboardPage ✓, ModelDetailPage ✓, AnalysisPanel ✓, HeadToHeadPage ✓, EvalBar ✓, NewGameDialog ✓, WinProbGraph ✓, EngineLinesPanel ✓. Exact `HELP.*` strings live in `helpText.ts` (Task 1) including the spec-specified ACPL wording.
- **WS3.2 Classification taxonomy bug:** Task 3 — single `classification.ts` mirroring the backend `MoveClassification` enum (`best/excellent/good/inaccuracy/mistake/blunder`), consumed by `ClassificationBadge` and `WinProbGraph`; phantom `brilliant`/`great` removed; redundant non-color `shape` added per item.
- **WS3.3 Feedback loops:** disabled "Start Game" reason (Task 9); human-move rejection banner + human-aware "Move Errors" (Task 12); "Copied!" pill (Task 11); explanatory queued status (Task 10).
- **WS3.4 Actionable empty states:** New Game CTA in GameList empty state (Task 13); "Start a game" links in Leaderboard (Task 5), HeadToHead (Task 7), Openings + Costs (Task 13).
- **WS3.5 Discoverability & microcopy:** icon-only control labels verified + "Copied!" pill (Task 11); mobile leaderboard caption shown ≤900px (Task 5); panel titles for win-prob + engine-lines (Task 8); expanded Stockfish-ELO / draw-adjudication / max-moves microcopy (Task 9).

**Placeholder scan:** none. Every InfoDot/Legend carries the actual help string from `HELP` or an inline literal (no "explain X" stubs). Task 14 greps for placeholder/TODO copy and for leftover `brilliant`/`great`.

**Type/name consistency:**
- `Classification` union + `CLASS_ORDER` + `CLASS_META` (Task 3) are the single types reused by `ClassificationBadge`, `WinProbGraph`, `AnalysisPanel`, `ModelDetailPage`. `isClassification` narrows `string | null` safely.
- `HELP` keys (`elo`, `acpl`, `accuracy`, `eval`, `mateIn`, `winProb`, `temperature`, `reasoning`, `chaos`, `drawAdjudication`, `maxMoves`, `stockfishElo`, `tableTalk`, `commentary`, `queued`, `engineLines`) — each referenced key is defined in Task 1.
- `GameState.moveError` (Task 12) added to `types/websocket.ts`, initialized in `initialState`, reduced via `SET_MOVE_ERROR`, cleared in `MOVE_PLAYED`/`AWAITING_HUMAN_MOVE`, and read in `GameViewerPage` — all four touchpoints listed.
- `QUEUED` payload uses `position`/`max` (matches `GameAction` in `types/websocket.ts:107`).
- `InfoDot` props (`label`, `triggerLabel`) and `Legend`/`LegendItem` props (`symbol`, `name`, `meaning`, `title`) match all call sites.

**War-room style preserved:** all new CSS uses existing tokens (`--amber`, `--amber-dim`, `--text-muted`, `--text-secondary`, `--blunder`, panel surface `#14161f`/border `#272b3d`); no font, radius, or accent changes. These are clarity/microcopy/feedback edits only.
