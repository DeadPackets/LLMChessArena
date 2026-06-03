# Accessibility (Workstream 2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make LLM Chess Arena operable and understandable for keyboard-only and screen-reader users — accessible modals, a keyboard-playable board, polite live announcements, redundant (non-color) encoding for evals/classifications/graphs, real buttons, labelled forms/headings, and minimal contrast nudges — all without altering the dark "war room" visual style.

**Architecture:** Build two shared primitives first — `useModal` (`frontend/src/hooks/useModal.ts`: focus trap, Escape, restore-focus, scroll lock, returns dialog props) and `<LiveAnnouncer>` (`frontend/src/components/shared/LiveAnnouncer.tsx`: one debounced visually-hidden `aria-live="polite"` region driven by a context store), plus a `.visually-hidden` CSS utility. The remaining tasks retrofit `useModal` onto the three overlays, add a keyboard layer to `ChessboardPanel` reusing its existing `getLegalTargets`/`tryMove`/`selectedSquare`/`legalTargets`, and apply ARIA/semantics/contrast fixes component by component. Changes are semantics and interaction only; CSS edits are limited to a new utility class and three one-step-brighter token values.

**Tech Stack:** React 19 + TypeScript + Vite. No test framework exists; verification is `cd frontend && npm run build` (`tsc -b` gate) plus manual checks (keyboard-only walkthrough, VoiceOver). node_modules is installed.

**Spec:** `docs/superpowers/specs/2026-06-03-polish-to-100-design.md` (Workstream 2).

---

## File Structure

New files:
- `frontend/src/hooks/useModal.ts` — P1 hook (focus trap / Escape / restore-focus / scroll lock / dialog props).
- `frontend/src/components/shared/LiveAnnouncer.tsx` — P5 provider + visually-hidden polite live region + `useAnnounce()` hook.

Modified files (by area):
- CSS: `frontend/src/App.css` (`.visually-hidden` utility; classification glyph/contrast; `--text-muted` / `--amber-dim` / `--blunder` token nudges).
- Modals: `frontend/src/components/game/KeyboardShortcutsModal.tsx`, `frontend/src/components/gamelist/NewGameDialog.tsx`, `frontend/src/components/game/GameOverBanner.tsx`.
- Board: `frontend/src/components/game/ChessboardPanel.tsx`.
- Live regions: `frontend/src/components/layout/Layout.tsx`, `frontend/src/pages/GameViewerPage.tsx`.
- Semantics: `frontend/src/components/game/EvalBar.tsx`, `frontend/src/components/shared/ClassificationBadge.tsx`, `frontend/src/components/game/WinProbGraph.tsx`, `frontend/src/components/game/TableTalkPanel.tsx`, `frontend/src/components/game/AnalysisPanel.tsx`, `frontend/src/components/gamelist/ModelSelector.tsx`, `frontend/src/components/game/BoardThemeSelector.tsx`, `frontend/src/pages/GameListPage.tsx`.

---

### Task 1: Shared `.visually-hidden` CSS utility

There is currently **no** visually-hidden / sr-only class in `App.css` (verified). Several later tasks need one (LiveAnnouncer, eval-bar text, board status). Add it once here.

**Files:**
- Modify: `frontend/src/App.css` (append after the `:root { … }` / reset section, e.g. right after the `html { … }` rule ~line 60)

- [ ] **Step 1: Add the utility class**

In `frontend/src/App.css`, insert this block immediately after the `html { … }` rule (~line 60):

```css
/* ─── A11y: visually hidden but readable by screen readers ─── */
.visually-hidden {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` and `vite build` complete with no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(a11y): add .visually-hidden utility class"
```

---

### Task 2: P1 — `useModal` hook

Build the reusable accessible-dialog hook the three overlays will consume. It stores/restores focus, traps Tab, closes on Escape, locks body scroll, and returns props to spread onto the dialog container.

**Files:**
- Create: `frontend/src/hooks/useModal.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useModal.ts`:

```ts
import { useCallback, useEffect, useId, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface UseModalResult {
  /** Attach to the dialog container element. */
  ref: React.RefObject<HTMLElement | null>;
  /** id to attach to the dialog's heading element. */
  titleId: string;
  /** Props to spread onto the dialog container. */
  dialogProps: {
    ref: React.RefObject<HTMLElement | null>;
    role: "dialog";
    "aria-modal": true;
    "aria-labelledby": string;
    tabIndex: -1;
  };
}

/**
 * Accessible-modal behavior: restore focus on close, move focus in on open,
 * trap Tab/Shift+Tab, close on Escape, and lock body scroll while open.
 * The caller owns the `open` flag and renders `null` when closed.
 */
export function useModal(open: boolean, onClose: () => void): UseModalResult {
  const ref = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const previousActive = useRef<HTMLElement | null>(null);

  // Stable Escape handler.
  const onKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !ref.current) return;
      const focusable = Array.from(
        ref.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
      ).filter((el) => el.offsetParent !== null || el === ref.current);
      if (focusable.length === 0) {
        e.preventDefault();
        ref.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && (active === first || active === ref.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;

    previousActive.current = document.activeElement as HTMLElement | null;

    // Move focus into the dialog (first focusable, else the container).
    const node = ref.current;
    if (node) {
      const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? node).focus();
    }

    // Lock body scroll.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", onKeyDown, true);

    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = prevOverflow;
      previousActive.current?.focus?.();
    };
  }, [open, onKeyDown]);

  return {
    ref,
    titleId,
    dialogProps: {
      ref,
      role: "dialog",
      "aria-modal": true,
      "aria-labelledby": titleId,
      tabIndex: -1,
    },
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors. (`useId` and `useCallback` are React 19 exports; the `ref` typed as `RefObject<HTMLElement | null>` matches the spread target.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useModal.ts
git commit -m "feat(a11y): add useModal hook (focus trap, Escape, restore-focus, scroll lock)"
```

---

### Task 3: Retrofit `useModal` onto `KeyboardShortcutsModal`

Today this modal has no role/aria, no focus trap, no Escape (Escape is handled ad-hoc in `GameViewerPage`), and its `<h3>` is not linked. Move the dialog semantics into the modal itself.

**Files:**
- Modify: `frontend/src/components/game/KeyboardShortcutsModal.tsx`

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `frontend/src/components/game/KeyboardShortcutsModal.tsx`:

```tsx
import { useModal } from "../../hooks/useModal";

interface Props {
  open: boolean;
  onClose: () => void;
}

const SHORTCUTS = [
  { keys: ["←"], label: "Previous move" },
  { keys: ["→"], label: "Next move" },
  { keys: ["Home"], label: "First move" },
  { keys: ["End"], label: "Last move" },
  { keys: ["?"], label: "Toggle this help" },
  { keys: ["Right-click"], label: "Highlight square" },
  { keys: ["Right-drag"], label: "Draw arrow" },
  { keys: ["Esc"], label: "Close dialog" },
];

export default function KeyboardShortcutsModal({ open, onClose }: Props) {
  const { dialogProps, titleId } = useModal(open, onClose);
  if (!open) return null;

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div
        {...dialogProps}
        className="keyboard-shortcuts-modal panel"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="keyboard-shortcuts-modal__header">
          <h3 id={titleId} className="keyboard-shortcuts-modal__title">Keyboard Shortcuts</h3>
          <button
            className="keyboard-shortcuts-modal__close"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
          >&times;</button>
        </div>
        <div className="keyboard-shortcuts-modal__list">
          {SHORTCUTS.map((s) => (
            <div key={s.label} className="keyboard-shortcuts-modal__row">
              <div className="keyboard-shortcuts-modal__keys">
                {s.keys.map((k) => (
                  <kbd key={k} className="keyboard-shortcuts-modal__kbd">{k}</kbd>
                ))}
              </div>
              <span className="keyboard-shortcuts-modal__label">{s.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

Note: `dialogProps` spreads `ref`, `role`, `aria-modal`, `aria-labelledby`, and `tabIndex={-1}` onto the dialog container. The container's `ref` is `RefObject<HTMLElement | null>`; the dialog element is a `<div>`, which is assignable to `HTMLElement`.

- [ ] **Step 2: Remove the now-redundant Escape branch in `GameViewerPage`**

`useModal` now owns Escape for this modal. In `frontend/src/pages/GameViewerPage.tsx` the `?`-key handler (~lines 155-168) also closes the modal on Escape; leaving it is harmless (the modal closes either way) but the `useModal` listener uses capture (`true`) and calls `stopPropagation`, so it runs first. **No code change required here** — verify only that pressing Escape closes the modal exactly once.

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual keyboard check**

Open a game, press `?` to open the shortcuts modal. Expected: focus moves into the dialog; Tab cycles only between the close button (and stays trapped); Escape closes it and focus returns to where it was; VoiceOver announces "Keyboard Shortcuts, dialog".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/KeyboardShortcutsModal.tsx
git commit -m "feat(a11y): accessible KeyboardShortcutsModal via useModal"
```

---

### Task 4: Retrofit `useModal` onto `GameOverBanner`

`GameOverBanner` is rendered inline (not an overlay) but the spec lists it as one of the three "overlays" to receive dialog semantics, focus management, and a labelled heading. It currently uses `role="alert"` with no heading link or focus handling. Convert it to a labelled dialog whose title is the outcome. Because it is not dismissible by Escape in the same way (it stays until the page changes), pass an `onClose` that is a no-op-safe focus restore: we keep it open while `data` exists, so `useModal`'s `open` is always `true` here and `onClose` is unused for dismissal but still wired for focus restore on unmount.

**Files:**
- Modify: `frontend/src/components/game/GameOverBanner.tsx`

- [ ] **Step 1: Wire `useModal` and a labelled heading**

Replace the contents of `frontend/src/components/game/GameOverBanner.tsx`:

```tsx
import { useModal } from "../../hooks/useModal";
import type { GameOverData } from "../../types/websocket";
import { formatModelName } from "../../utils/formatModel";

interface Props {
  data: GameOverData;
  whiteModel: string | null;
  blackModel: string | null;
  onRematch?: () => void;
}

function outcomeDisplay(outcome: string, whiteModel: string | null, blackModel: string | null) {
  if (outcome.includes("white")) {
    return {
      title: `${formatModelName(whiteModel)} wins!`,
      cls: "game-over-banner__title--white",
    };
  }
  if (outcome.includes("black")) {
    return {
      title: `${formatModelName(blackModel)} wins!`,
      cls: "game-over-banner__title--black",
    };
  }
  return {
    title: "Draw",
    cls: "game-over-banner__title--draw",
  };
}

function formatTermination(t: string): string {
  return t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function GameOverBanner({ data, whiteModel, blackModel, onRematch }: Props) {
  const { title, cls } = outcomeDisplay(data.outcome, whiteModel, blackModel);
  // Always-open banner: useModal manages initial focus + focus restore on unmount.
  const { dialogProps, titleId } = useModal(true, () => {});

  return (
    <div
      {...dialogProps}
      className="game-over-banner panel--elevated"
      aria-label={undefined}
    >
      <h2 id={titleId} className={`game-over-banner__title ${cls}`}>{title}</h2>
      <div className="game-over-banner__termination">
        {formatTermination(data.termination)}
      </div>
      <div className="game-over-banner__stats">
        <div>
          <span className="game-over-banner__stat-value">{data.totalMoves}</span>{" "}
          moves
        </div>
        <div>
          <span className="game-over-banner__stat-value">
            {(data.totalInputTokens + data.totalOutputTokens).toLocaleString()}
          </span>{" "}
          tokens
        </div>
        {data.totalCostUsd > 0 && (
          <div>
            <span className="game-over-banner__stat-value">
              ${data.totalCostUsd.toFixed(4)}
            </span>{" "}
            cost
          </div>
        )}
      </div>
      {onRematch && (
        <button className="btn btn--primary game-over-banner__rematch" onClick={onRematch}>
          Rematch
        </button>
      )}
    </div>
  );
}
```

Notes:
- The `aria-label={undefined}` line is intentional: `dialogProps` does not set `aria-label`, but we make explicit that the dialog is labelled by the heading (`aria-labelledby={titleId}`) only, avoiding a double label. You may omit that line; it is shown for clarity.
- The `<div className="game-over-banner__title">` became an `<h2>`; the visual classes are preserved, so the war-room styling is unchanged. (The CSS targets `.game-over-banner__title` regardless of tag.)

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual check**

Finish (or stop) a game. Expected: when the banner appears, focus moves into it; VoiceOver announces the outcome as a dialog with a heading (e.g. "GPT-4o wins!, dialog"). Body scroll lock is acceptable here (the banner is at the top of the viewer and the page is short post-game); if scroll lock proves annoying in manual testing, note it — otherwise leave it.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/game/GameOverBanner.tsx
git commit -m "feat(a11y): GameOverBanner as labelled dialog via useModal"
```

---

### Task 5: Retrofit `useModal` onto `NewGameDialog` + form labels/aria + slider aria-valuetext

`NewGameDialog` already has `role="dialog"`/`aria-modal`/`aria-label="New Game"` on the overlay but no focus trap, Escape, scroll lock, or restore-focus, and its title is a `<div>` not linked via `aria-labelledby`. The two range sliders (temperature, Stockfish ELO) have no `aria-label`/`aria-valuetext`. Apply `useModal` to the inner `<form>` and label the sliders.

**Files:**
- Modify: `frontend/src/components/gamelist/NewGameDialog.tsx`

- [ ] **Step 1: Add slider aria to `StockfishEloSelector`**

In `frontend/src/components/gamelist/NewGameDialog.tsx`, the Stockfish ELO range input (lines ~112-120) currently has no labelling. Replace that `<input … type="range" …>` with:

```tsx
          <input
            className="new-game-dialog__range"
            type="range"
            min="1320"
            max="3190"
            step="10"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label="Stockfish ELO strength"
            aria-valuetext={`${value} ELO`}
          />
```

- [ ] **Step 2: Add slider aria to the Temperature range in `ModelSettingsPanel`**

The temperature range input (lines ~158-168) — replace it with:

```tsx
          <input
            className="new-game-dialog__range"
            type="range"
            min="0"
            max="2"
            step="0.1"
            value={settings.temperature !== "" ? settings.temperature : "1"}
            onChange={(e) =>
              onChange({ ...settings, temperature: e.target.value })
            }
            aria-label={`${label} temperature`}
            aria-valuetext={
              settings.temperature !== ""
                ? parseFloat(settings.temperature).toFixed(1)
                : "default (1.0)"
            }
          />
```

- [ ] **Step 3: Wire `useModal` into the dialog and link the title**

Add the import at the top of the file (with the other imports, line ~6):

```tsx
import { useModal } from "../../hooks/useModal";
```

Inside `NewGameDialog`, after the existing `const [error, setError] = useState<string | null>(null);` (line ~227) add:

```tsx
  const { ref: dialogRef, titleId } = useModal(open, onClose);
```

Replace the outer return wrapper. Change the opening of the returned JSX (lines ~340-349) from:

```tsx
  return (
    <div
      className="dialog-overlay"
      onClick={handleOverlayClick}
      role="dialog"
      aria-modal="true"
      aria-label="New Game"
    >
      <form className="new-game-dialog panel--elevated" onSubmit={handleSubmit}>
        <div className="new-game-dialog__title">New Game</div>
```

to:

```tsx
  return (
    <div className="dialog-overlay" onClick={handleOverlayClick}>
      <form
        ref={dialogRef as React.RefObject<HTMLFormElement>}
        className="new-game-dialog panel--elevated"
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <h2 id={titleId} className="new-game-dialog__title">New Game</h2>
```

Notes:
- The dialog semantics move from the overlay onto the `<form>` (the actual focusable container `useModal` manages). `ModelSelector` has `autoFocus` on the White input, so initial focus lands there; the `useModal` focus-in is a safe fallback. Escape now closes the dialog and restores focus; outside-click still works via the existing `handleOverlayClick`.
- The title `<div>` becomes an `<h2>` with the same class (`.new-game-dialog__title`), preserving styling.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 5: Manual keyboard check**

Open "New Game". Expected: focus is in the White model search; Tab cycles through all controls and wraps without leaving the dialog; Escape closes it and returns focus to the "New Game" button; dragging the temperature slider with arrow keys announces e.g. "White temperature, 1.2"; the Stockfish slider announces "1500 ELO". VoiceOver announces "New Game, dialog".

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/gamelist/NewGameDialog.tsx
git commit -m "feat(a11y): NewGameDialog focus trap, labelled title, slider aria-valuetext"
```

---

### Task 6: P5 — `<LiveAnnouncer>` provider + `useAnnounce`

A single visually-hidden `aria-live="polite" aria-atomic="true"` region near the app root, with a context store exposing `announce(message)`. Announcements are **debounced** so only the latest move is read (no centipawn spam). Mounted in `Layout` so all in-Layout pages can announce; the embed route is intentionally excluded.

**Files:**
- Create: `frontend/src/components/shared/LiveAnnouncer.tsx`
- Modify: `frontend/src/components/layout/Layout.tsx`

- [ ] **Step 1: Create the provider**

Create `frontend/src/components/shared/LiveAnnouncer.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type AnnounceFn = (message: string) => void;

const LiveAnnouncerContext = createContext<AnnounceFn>(() => {});

/**
 * Hook to push a polite, debounced screen-reader announcement.
 * Safe to call when no provider is mounted (no-op).
 */
export function useAnnounce(): AnnounceFn {
  return useContext(LiveAnnouncerContext);
}

/**
 * Renders one visually-hidden polite live region and provides `announce()`.
 * Debounces by 600ms so rapid updates collapse to the latest message only.
 */
export function LiveAnnouncer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<number | null>(null);
  const pending = useRef<string>("");

  const announce = useCallback<AnnounceFn>((msg) => {
    pending.current = msg;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // Clear then set on next frame so identical-text repeats still announce.
      setMessage("");
      requestAnimationFrame(() => setMessage(pending.current));
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <LiveAnnouncerContext.Provider value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}
```

- [ ] **Step 2: Mount it in `Layout`**

Replace the contents of `frontend/src/components/layout/Layout.tsx`:

```tsx
import { Outlet } from "react-router-dom";
import Header from "./Header";
import { LiveAnnouncer } from "../shared/LiveAnnouncer";

export default function Layout() {
  return (
    <LiveAnnouncer>
      <Header />
      <main className="app-content">
        <Outlet />
      </main>
    </LiveAnnouncer>
  );
}
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/LiveAnnouncer.tsx frontend/src/components/layout/Layout.tsx
git commit -m "feat(a11y): add LiveAnnouncer polite live region + useAnnounce"
```

---

### Task 7: Announce latest move + `role="status"` on thinking/status blocks

Drive `useAnnounce` from `GameViewerPage` when a new move arrives, with a plain-language summary. Add `role="status"` to the two "thinking…" / `statusMessage` blocks so they are announced too. (The "Opponent is thinking..." block and the bottom `statusMessage` block currently have no live role.)

**Files:**
- Modify: `frontend/src/pages/GameViewerPage.tsx`

- [ ] **Step 1: Import the hook**

In `frontend/src/pages/GameViewerPage.tsx`, add to the imports (near line 19-23):

```tsx
import { useAnnounce } from "../components/shared/LiveAnnouncer";
```

- [ ] **Step 2: Add an announcement effect**

Inside `GameViewerPage`, after the `const { state, … } = useGameWebSocket(gameId!);` line (line ~114), add:

```tsx
  const announce = useAnnounce();
```

Then add this effect alongside the other sound/move effects (e.g. directly after the "Play sounds on new moves" effect that ends ~line 194). It announces only the newest move, in plain language:

```tsx
  // Announce the latest move politely for screen readers (debounced in LiveAnnouncer).
  const prevAnnouncedLenRef = useRef(0);
  useEffect(() => {
    const curLen = state.moves.length;
    const prevLen = prevAnnouncedLenRef.current;
    prevAnnouncedLenRef.current = curLen;
    if (curLen <= prevLen || curLen === 0) return;
    const m = state.moves[curLen - 1];
    if (!m?.san) return;
    const side = m.color === "white" ? "White" : "Black";
    const parts = [`Move ${m.moveNumber}, ${side} ${m.san}`];
    if (m.classification && m.classification !== "good") {
      parts.push(m.classification);
    }
    if (m.centipawns != null) {
      const pawns = m.centipawns / 100;
      if (Math.abs(pawns) < 0.2) {
        parts.push("even");
      } else if (pawns > 0) {
        parts.push(`White ${pawns >= 0 ? "+" : ""}${pawns.toFixed(1)}`);
      } else {
        parts.push(`Black +${Math.abs(pawns).toFixed(1)}`);
      }
    }
    announce(parts.join(". ") + ".");
  }, [state.moves, announce]);
```

- [ ] **Step 3: Add `role="status"` to the status blocks**

In the same file, the "Opponent is thinking..." block (~line 424-429):

```tsx
          {humanColor && isLive && !isHumanTurn && state.awaitingHumanMove === null && (
            <div className="status-message" role="status">
              <div className="status-message__spinner" />
              Opponent is thinking...
            </div>
          )}
```

And the bottom `statusMessage` block (~line 447-452):

```tsx
          {state.statusMessage && !humanColor && (
            <div className="status-message" role="status">
              <div className="status-message__spinner" />
              {state.statusMessage}
            </div>
          )}
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 5: Manual VoiceOver check**

Open a live LLM-vs-LLM game with VoiceOver on. Expected: as each move lands, VoiceOver reads e.g. "Move 14, Black Nf6, blunder. White +2.3." once (not per-centipawn); the "thinking" status is announced when it appears. Rapid moves collapse to the latest (600ms debounce).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/GameViewerPage.tsx
git commit -m "feat(a11y): announce latest move + role=status on thinking/status blocks"
```

---

### Task 8: Keyboard-playable board (`ChessboardPanel`)

A human on keyboard is currently fully blocked (drag/click only). Add a focusable board layer with a roving square cursor (arrow keys), Enter to select/place, Escape to deselect, reusing the existing `selectedSquare`/`legalTargets`/`getLegalTargets`/`tryMove`. Add an `aria-label` describing turn + last move. The visual board (react-chessboard) is unchanged; we add a sibling focusable layer over the same container and reflect the cursor via the existing `selectedSquare`/legal-target highlight machinery where possible, plus a lightweight cursor highlight.

**Files:**
- Modify: `frontend/src/components/game/ChessboardPanel.tsx`

- [ ] **Step 1: Add cursor state + helpers**

In `frontend/src/components/game/ChessboardPanel.tsx`, after the existing click-to-move state (the `pendingPromotion` state, ~line 95) add:

```tsx
  // Keyboard cursor: roving square highlighted when the board layer has focus.
  const [cursorSquare, setCursorSquare] = useState<Square | null>(null);
```

Add these pure helpers near the other top-level helpers (e.g. after `isInCheck`, ~line 70), outside the component:

```tsx
function squareToFileRank(sq: Square): { file: number; rank: number } {
  return { file: sq.charCodeAt(0) - 97, rank: parseInt(sq[1], 10) - 1 };
}

function fileRankToSquare(file: number, rank: number): Square | null {
  if (file < 0 || file > 7 || rank < 0 || rank > 7) return null;
  return (String.fromCharCode(97 + file) + String(rank + 1)) as Square;
}

/** Move a square by (df, dr) in board coordinates; clamps to the board. */
function moveSquare(sq: Square, df: number, dr: number): Square {
  const { file, rank } = squareToFileRank(sq);
  return fileRankToSquare(
    Math.max(0, Math.min(7, file + df)),
    Math.max(0, Math.min(7, rank + dr)),
  )!;
}
```

- [ ] **Step 2: Add the keyboard handler**

Inside the component, after `handleSquareClick` (~line 365), add a handler that drives the same move logic from the keyboard. It respects board orientation so arrow keys feel natural for whichever side the human plays:

```tsx
  // Keyboard play: arrows move the cursor, Enter selects/places, Escape deselects.
  function handleBoardKeyDown(e: React.KeyboardEvent) {
    // Orientation factor: when viewing as black, screen-up means rank-down.
    const flip = boardOrientation === "black" ? -1 : 1;
    const start: Square = cursorSquare ?? selectedSquare ?? (humanColor === "black" ? "e7" : "e2");

    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        setCursorSquare(moveSquare(start, 0, flip));
        return;
      case "ArrowDown":
        e.preventDefault();
        setCursorSquare(moveSquare(start, 0, -flip));
        return;
      case "ArrowLeft":
        e.preventDefault();
        setCursorSquare(moveSquare(start, -flip, 0));
        return;
      case "ArrowRight":
        e.preventDefault();
        setCursorSquare(moveSquare(start, flip, 0));
        return;
      case "Escape":
        if (selectedSquare) {
          e.preventDefault();
          setSelectedSquare(null);
          setLegalTargets([]);
        }
        return;
      case "Enter":
      case " ": {
        e.preventDefault();
        if (!isHumanTurn || !humanColor || !onHumanMove) return;
        const target = cursorSquare ?? start;

        // If a piece is selected and the cursor is a legal target → make/queue the move.
        if (selectedSquare && legalTargets.includes(target)) {
          try {
            const game = new Chess(displayFen);
            const srcPiece = game.get(selectedSquare);
            const isPromotionRank =
              (humanColor === "white" && target[1] === "8") ||
              (humanColor === "black" && target[1] === "1");
            if (srcPiece && srcPiece.type === "p" && isPromotionRank) {
              setPendingPromotion({ from: selectedSquare, to: target });
              setSelectedSquare(null);
              setLegalTargets([]);
              return;
            }
          } catch {
            /* ignore */
          }
          const newFen = tryMove(selectedSquare, target);
          if (newFen) {
            setOptimisticFen(newFen);
            onHumanMove(`${selectedSquare}${target}`);
          }
          setSelectedSquare(null);
          setLegalTargets([]);
          return;
        }

        // Otherwise, if the cursor is on the human's own piece → select it.
        try {
          const game = new Chess(displayFen);
          const piece = game.get(target);
          if (piece) {
            const pieceColor = piece.color === "w" ? "white" : "black";
            if (pieceColor === humanColor) {
              setSelectedSquare(target);
              setLegalTargets(getLegalTargets(target));
              return;
            }
          }
        } catch {
          /* ignore */
        }
        // Empty/opponent square with nothing selected → deselect.
        setSelectedSquare(null);
        setLegalTargets([]);
        return;
      }
    }
  }
```

- [ ] **Step 3: Reflect the cursor in the square styles**

The cursor needs a visible ring. Extend `combinedSquareStyles` so the cursor square gets an outline. Replace the `combinedSquareStyles` memo (~line 239-242) with:

```tsx
  // Cursor highlight (keyboard navigation)
  const cursorStyle = useMemo<Record<string, React.CSSProperties>>(() => {
    if (!cursorSquare) return {};
    return {
      [cursorSquare]: {
        boxShadow: "inset 0 0 0 3px var(--amber)",
        borderRadius: "4px",
      },
    };
  }, [cursorSquare]);

  // Merge last-move highlights with legal-move indicators, user highlights, and cursor
  const combinedSquareStyles = useMemo(
    () => ({ ...userHighlightStyles, ...lastMoveSquares, ...legalMoveStyles, ...cursorStyle }),
    [lastMoveSquares, legalMoveStyles, userHighlightStyles, cursorStyle],
  );
```

- [ ] **Step 4: Reset the cursor when the position/turn changes**

Extend the existing "Clear selection when turn/position changes" effect (~line 130-134) to also clear the cursor:

```tsx
  // Clear selection when turn/position changes
  useEffect(() => {
    setSelectedSquare(null);
    setLegalTargets([]);
    setPendingPromotion(null);
    setCursorSquare(null);
  }, [isHumanTurn, fen]);
```

- [ ] **Step 5: Make the container focusable + labelled**

Replace the container `<div>` opening (~line 420-421) and pass `aria-label`/`tabIndex`/`onKeyDown`. Build a description from turn + last move just above the `return`:

```tsx
  const lastMove = selectedMove ?? previousMove;
  const turnLabel = isHumanTurn
    ? "Your move"
    : humanColor
    ? "Opponent to move"
    : displayFen.split(" ")[1] === "w"
    ? "White to move"
    : "Black to move";
  const boardAriaLabel =
    `Chess board. ${turnLabel}.` +
    (lastMove?.san ? ` Last move ${lastMove.san}.` : "") +
    (isHumanTurn ? " Use arrow keys to move the cursor, Enter to select and place a piece, Escape to deselect." : "");

  return (
    <div
      ref={containerRef}
      className="chessboard-panel__board-container"
      role="application"
      aria-label={boardAriaLabel}
      tabIndex={isHumanTurn ? 0 : -1}
      onKeyDown={handleBoardKeyDown}
    >
```

(The rest of the `<Chessboard … />` JSX is unchanged; the closing `</div>` stays.)

- [ ] **Step 6: Build**

Run: `cd frontend && npm run build`
Expected: no errors. (`getLegalTargets`, `tryMove`, `setSelectedSquare`, `setLegalTargets`, `setOptimisticFen`, `setPendingPromotion`, `displayFen`, `Chess` are all already in scope from the existing component.)

- [ ] **Step 7: Manual keyboard check**

Start a Human-vs-LLM game and take the human side. Tab to the board (it shows a focus ring; VoiceOver announces the board label + turn). Use arrow keys to move the amber cursor; press Enter on your own piece (legal targets show dots/rings); arrow to a legal target; press Enter to play it. Escape deselects. Verify orientation: as Black, ArrowUp still moves the cursor "up" on screen.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/components/game/ChessboardPanel.tsx
git commit -m "feat(a11y): keyboard-playable board (roving cursor, Enter/Escape, aria-label)"
```

---

### Task 9: EvalBar — `aria-valuetext` + parity "=" label

Today both eval labels are empty at parity, so an even position is color-only; and the `role="meter"` has only a numeric `aria-valuenow`. Add `aria-valuetext` (win % + pawns or "Even") and render a subtle "=" label when neither side has an advantage.

**Files:**
- Modify: `frontend/src/components/game/EvalBar.tsx`

- [ ] **Step 1: Replace the component**

Replace the contents of `frontend/src/components/game/EvalBar.tsx`:

```tsx
interface Props {
  winProbability: number | null;
  centipawns: number | null;
  mateIn: number | null;
}

export default function EvalBar({ winProbability, centipawns, mateIn }: Props) {
  const whitePct = winProbability != null ? winProbability * 100 : 50;

  let topLabel = "";
  let bottomLabel = "";

  if (mateIn != null) {
    // mateIn > 0 = White can force mate; mateIn < 0 = Black can force mate
    if (mateIn > 0) {
      bottomLabel = `#${mateIn}`;
    } else {
      topLabel = `#${Math.abs(mateIn)}`;
    }
  } else if (centipawns != null) {
    const abs = Math.abs(centipawns) / 100;
    const formatted = abs >= 10 ? abs.toFixed(0) : abs.toFixed(1);
    if (centipawns > 0) {
      bottomLabel = `+${formatted}`;
    } else if (centipawns < 0) {
      topLabel = `+${formatted}`;
    }
  }

  // Parity: no advantage label on either side -> show a subtle "=" at center.
  const isEven = topLabel === "" && bottomLabel === "";

  const topTitle = topLabel ? `Black advantage: ${topLabel}` : undefined;
  const bottomTitle = bottomLabel ? `White advantage: ${bottomLabel}` : undefined;

  // Spoken description of the evaluation.
  let valueText: string;
  if (mateIn != null) {
    valueText =
      mateIn > 0
        ? `White has mate in ${mateIn}`
        : `Black has mate in ${Math.abs(mateIn)}`;
  } else if (isEven) {
    valueText = "Even";
  } else {
    const side = bottomLabel ? "White" : "Black";
    const sidePct = bottomLabel ? whitePct : 100 - whitePct;
    const pawns = bottomLabel || topLabel; // already "+x.y"
    valueText = `${side} ${sidePct.toFixed(0)}% win probability, ${pawns}`;
  }

  return (
    <div
      className="eval-bar"
      role="meter"
      aria-label="Position evaluation"
      aria-valuenow={whitePct}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuetext={valueText}
    >
      {topLabel && <span className="eval-bar__label eval-bar__label--top" title={topTitle}>{topLabel}</span>}
      {isEven && (
        <span className="eval-bar__label eval-bar__label--even" aria-hidden="true">=</span>
      )}
      <div className="eval-bar__fill" style={{ height: `${whitePct}%` }} />
      {bottomLabel && <span className="eval-bar__label eval-bar__label--bottom" title={bottomTitle}>{bottomLabel}</span>}
    </div>
  );
}
```

- [ ] **Step 2: Add the centered "=" label style**

In `frontend/src/App.css`, find the `.eval-bar__label--top` / `.eval-bar__label--bottom` rules (search `eval-bar__label`). Add a sibling rule that centers the parity label vertically, matching the existing label typography. Insert after the bottom-label rule:

```css
.eval-bar__label--even {
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  opacity: 0.7;
}
```

(If `.eval-bar__label` does not already set `position: absolute`, the `top`/`transform` will not apply — verify by reading the existing `.eval-bar__label`, `.eval-bar__label--top`, `.eval-bar__label--bottom` rules first and mirror their positioning approach; the existing top/bottom labels are absolutely positioned, so the even label uses the same scheme.)

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual check**

Open a game and navigate to a dead-even position (eval ≈ 0). Expected: a faint "=" appears centered on the eval bar; VoiceOver on the bar announces "Position evaluation, Even". On an unbalanced position it announces e.g. "White 62% win probability, +1.4".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/EvalBar.tsx frontend/src/App.css
git commit -m "feat(a11y): EvalBar aria-valuetext and parity = label"
```

---

### Task 10: ClassificationBadge — unique glyphs + contrast ≥4.5:1

Today `good` renders nothing (so it's filtered out) and `best` (★) vs `excellent` (✓) are easy to confuse only by color; brilliant `#fff` on `#26c2a3` is 2.25:1. Give each classification a unique glyph and raise badge text contrast. Note `WinProbGraph` uses a different vocabulary (`brilliant`/`great`) — that taxonomy unification is owned by WS3; here we only ensure every value in the **current** `SYMBOLS` map has a distinct glyph and that badge text passes contrast. We keep `good` returning `null` (it is intentionally not badged in the move list), but give it a glyph in the map for any future legend use.

**Files:**
- Modify: `frontend/src/components/shared/ClassificationBadge.tsx`
- Modify: `frontend/src/App.css` (badge color values)

- [ ] **Step 1: Give every classification a distinct glyph**

Replace the `SYMBOLS` map in `frontend/src/components/shared/ClassificationBadge.tsx`:

```tsx
const SYMBOLS: Record<string, string> = {
  brilliant: "!!",
  great: "!",
  best: "★",      // ★ filled star
  excellent: "☆", // ☆ open star — visually distinct from best's filled star
  good: "·",      // · (used only in legends; move list still hides "good")
  inaccuracy: "?!",
  mistake: "?",
  blunder: "??",
};
```

(`best` = filled star ★, `excellent` = open star ☆: distinguishable by shape, not just color.)

- [ ] **Step 2: Raise badge text contrast**

In `frontend/src/App.css`, replace the eight `.classification-badge--*` color rules (lines ~579-586) so text contrast against each background is ≥4.5:1. The badge backgrounds are unchanged (war-room palette preserved); only the **text color** changes where needed:

```css
.classification-badge--brilliant { background: var(--brilliant); color: #06231d; }
.classification-badge--great { background: var(--great); color: #0a1822; }
.classification-badge--best { background: var(--best); color: #0e1a06; }
.classification-badge--excellent { background: var(--excellent); color: #0c1606; }
.classification-badge--good { background: var(--good); color: #f2f2f2; }
.classification-badge--inaccuracy { background: var(--inaccuracy); color: #1a1400; }
.classification-badge--mistake { background: var(--mistake); color: #1c0e00; }
.classification-badge--blunder { background: var(--blunder); color: #ffffff; }
```

Rationale (light vs dark backgrounds):
- `--brilliant` `#26c2a3`, `--great` `#5b8bb4`, `--best` `#8bba3c`, `--excellent` `#6da832`, `--inaccuracy` `#e6b422`, `--mistake` `#e08832` are light/mid backgrounds → use near-black text (≥4.5:1).
- `--blunder` `#ca3431` is dark enough that white text passes (`#fff` on `#ca3431` ≈ 4.6:1) — kept white.
- `--good` `#6e6e6e` keeps near-white text (`#f2f2f2` on `#6e6e6e` ≈ 4.6:1).

- [ ] **Step 3: Verify contrast (spot-check)**

Manually verify each pair ≥4.5:1 using any WCAG contrast tool (e.g. browser devtools color picker). Expected: all eight badges pass AA for the badge glyph text. The badges are small (16px) but the glyphs are bold; AA normal-text threshold (4.5:1) is the target per spec.

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/shared/ClassificationBadge.tsx frontend/src/App.css
git commit -m "feat(a11y): unique classification glyphs and badge text contrast >=4.5:1"
```

---

### Task 11: WinProbGraph — dot shapes + aria summary + keyboard-reachable dots

Critical-moment dots are color-only (`ReferenceDot fill`). Encode them by **shape** as well: triangle = blunder/mistake (errors), diamond = brilliant/great (brilliancies), circle = other. Add an `aria-label` summary on the chart wrapper and a visually-hidden keyboard-reachable list of the dots so SR/keyboard users can jump to those moves. Wrap the panel in a `role="img"`-labelled region with a hidden text summary.

**Files:**
- Modify: `frontend/src/components/game/WinProbGraph.tsx`

- [ ] **Step 1: Add a `shape` to each `DotInfo` and render custom shapes**

In `frontend/src/components/game/WinProbGraph.tsx`, extend the `DotInfo` interface (lines ~25-30) and the classification→shape mapping. Replace the `DotInfo` interface with:

```tsx
type DotShape = "triangle" | "diamond" | "circle";

interface DotInfo {
  index: number;
  y: number;
  color: string;
  r: number;
  shape: DotShape;
  label: string;
}
```

Add a shape helper above the component (after the `LARGE_DOT_CLASSIFICATIONS` const, ~line 23):

```tsx
function shapeFor(cls: string | null): DotShape {
  if (cls === "blunder" || cls === "mistake" || cls === "inaccuracy") return "triangle";
  if (cls === "brilliant" || cls === "great") return "diamond";
  return "circle";
}
```

In the `dots` memo (lines ~74-112), set `shape` and `label` on each pushed dot. For the classification loop entry, replace the `result.push({ … })` with:

```tsx
        result.push({
          index: i,
          y: wp,
          color: CLASSIFICATION_DOT_COLORS[cls],
          r: LARGE_DOT_CLASSIFICATIONS.has(cls) ? 4 : 3,
          shape: shapeFor(cls),
          label: `${moves[i].moveNumber}${moves[i].color === "black" ? "..." : "."} ${moves[i].san} (${cls})`,
        });
```

For the critical-moments loop entry, replace its `result.push({ … })` with:

```tsx
          result.push({
            index: cm.move_index,
            y: cm.win_prob_after * 100,
            color,
            r: 3,
            shape: shapeFor(cls),
            label: `${cm.san} (${cls ?? (cm.swing > 0.25 ? "blunder" : "inaccuracy")})`,
          });
```

- [ ] **Step 2: Render dots by shape**

`ReferenceDot` accepts a custom `shape` render prop. Replace the dots `.map(...)` (lines ~132-141) with a renderer that draws a triangle/diamond/circle. Insert this shape-renderer helper above the component (next to `shapeFor`):

```tsx
function DotShapeMark({ cx, cy, r, color, shape }: { cx?: number; cy?: number; r: number; color: string; shape: DotShape }) {
  if (cx == null || cy == null) return null;
  if (shape === "triangle") {
    const h = r * 1.6;
    const pts = `${cx},${cy - h} ${cx - h},${cy + h * 0.7} ${cx + h},${cy + h * 0.7}`;
    return <polygon points={pts} fill={color} stroke="#0e1017" strokeWidth={0.75} />;
  }
  if (shape === "diamond") {
    const h = r * 1.5;
    const pts = `${cx},${cy - h} ${cx + h},${cy} ${cx},${cy + h} ${cx - h},${cy}`;
    return <polygon points={pts} fill={color} stroke="#0e1017" strokeWidth={0.75} />;
  }
  return <circle cx={cx} cy={cy} r={r} fill={color} stroke="#0e1017" strokeWidth={0.5} />;
}
```

Then replace the dots map with:

```tsx
          {dots.map((dot) => (
            <ReferenceDot
              key={`dot-${dot.index}`}
              x={dot.index}
              y={dot.y}
              r={dot.r}
              isFront
              shape={(props: { cx?: number; cy?: number }) => (
                <DotShapeMark cx={props.cx} cy={props.cy} r={dot.r} color={dot.color} shape={dot.shape} />
              )}
            />
          ))}
```

- [ ] **Step 3: Add an aria summary + keyboard-reachable dot list**

Wrap the panel content with a labelled region and a visually-hidden, focusable list of dots. Replace the outer `return ( <div className="win-prob-graph panel"> … </div> )` so the panel has a title heading and the hidden list. Change the opening:

```tsx
  const summary =
    dots.length === 0
      ? "Win probability over the game. No critical moments."
      : `Win probability over the game. ${dots.length} critical moment${dots.length === 1 ? "" : "s"}: ` +
        dots
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => d.label)
          .join("; ") + ".";

  return (
    <div className="win-prob-graph panel" role="group" aria-label="Win probability graph">
      <h3 className="visually-hidden">Win probability</h3>
      <p className="visually-hidden">{summary}</p>
```

And immediately before the closing `</div>` of the panel (after `</ResponsiveContainer>`), add a keyboard-reachable jump list (visually hidden but focusable) so non-mouse users can reach the critical moments:

```tsx
      <ul className="visually-hidden">
        {dots
          .slice()
          .sort((a, b) => a.index - b.index)
          .map((d) => (
            <li key={`jump-${d.index}`}>
              <button type="button" onClick={() => onSelectMove(d.index)}>
                Go to {d.label}
              </button>
            </li>
          ))}
      </ul>
```

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: no errors. If `ReferenceDot`'s `shape` prop type rejects the render function, wrap with `// eslint-disable-next-line @typescript-eslint/no-explicit-any` and type the `shape` callback param as `any` (recharts' `shape` render-prop typings are loose). Verify the dots still render as triangles/diamonds/circles in the browser.

- [ ] **Step 5: Manual check**

Open a completed game with critical moments. Expected: blunders/mistakes render as triangles, brilliancies as diamonds, others as circles (distinguishable with color off / grayscale). With VoiceOver, the graph region announces the summary listing each critical moment; Tab reaches the hidden "Go to …" buttons and activating one jumps the board to that move.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/game/WinProbGraph.tsx
git commit -m "feat(a11y): WinProbGraph dot shapes, aria summary, keyboard-reachable dots"
```

---

### Task 12: Real buttons — TableTalkPanel move bubbles + AnalysisPanel critical-moment items

`TableTalkPanel` move bubbles are clickable `<div>`s with no role/tabindex/keyhandler (mouse-only). `AnalysisPanel`'s `CriticalMomentItem` has `role="button"` + `tabIndex` but only handles `Enter` (not Space) and is still a `<div>`. Convert the table-talk move bubble to a real `<button>` and complete the critical-moment item's keyboard handling.

**Files:**
- Modify: `frontend/src/components/game/TableTalkPanel.tsx`
- Modify: `frontend/src/components/game/AnalysisPanel.tsx`

- [ ] **Step 1: Convert the move bubble to a `<button>`**

In `frontend/src/components/game/TableTalkPanel.tsx`, replace the move-entry render (the final `return (...)` inside the `.map`, lines ~221-239) with a `<button>` that keeps the existing classes and selected-ref:

```tsx
          return (
            <button
              type="button"
              key={`move-${entry.index}`}
              ref={isSelected ? (selectedBubbleRef as React.RefObject<HTMLButtonElement>) : undefined}
              className={`table-talk-bubble table-talk-bubble--${m.color}${
                isSelected ? " table-talk-bubble--selected" : ""
              }`}
              aria-pressed={isSelected}
              onClick={() => onSelectMove(entry.index)}
            >
              <div className="table-talk-bubble__header">
                <span className="table-talk-bubble__model">{model}</span>
                <span className="table-talk-bubble__move">
                  {m.moveNumber}{m.color === "black" ? "..." : "."} {m.san}
                  {m.isChaosMove && <span className="table-talk-bubble__chaos-tag">CHAOS</span>}
                </span>
              </div>
              {m.tableTalk && <div className="table-talk-bubble__text">{m.tableTalk}</div>}
            </button>
          );
```

Then change the `selectedBubbleRef` type (line ~110) from `useRef<HTMLDivElement>(null)` to:

```tsx
  const selectedBubbleRef = useRef<HTMLButtonElement>(null);
```

Notes: the scroll-into-view effect (lines ~125-139) uses `el.offsetTop`/`offsetHeight`/`scrollIntoView`, all valid on `HTMLButtonElement`, so no further changes needed. The `table-talk-bubble` CSS applies to the class regardless of tag; add a tiny normalize so the button doesn't inherit default button chrome (Step 2). The illegal/chaos bubbles stay as non-interactive `<div>`s (they have no click handler) — that is correct.

- [ ] **Step 2: Normalize the button-as-bubble in CSS**

In `frontend/src/App.css`, find `.table-talk-bubble` (search for it). Add a normalize rule immediately after the base `.table-talk-bubble` rule so the new `<button>` looks identical to the old `<div>` (full-width, left-aligned, inherits font, war-room look preserved):

```css
button.table-talk-bubble {
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  appearance: none;
}
```

(Verify the existing `.table-talk-bubble` already sets background/border/padding; this rule only neutralizes default button styling and keeps it full-width.)

- [ ] **Step 3: Complete the critical-moment item keyboard handling**

In `frontend/src/components/game/AnalysisPanel.tsx`, the `CriticalMomentItem` (lines ~53-57) handles only `Enter`. Update its `onKeyDown` to also handle Space and prevent page scroll:

```tsx
    <div className="critical-moment-item" onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      aria-label={`Critical moment: ${cm.move_number}${cm.color === "black" ? "..." : "."} ${cm.san}`}
    >
```

(Kept as a `<div role="button">` since it nests a `ClassificationBadge` and spans; the full role/tabindex/keyhandler now satisfy the spec's "or add full role/tabindex/keyhandlers".)

- [ ] **Step 4: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 5: Manual keyboard check**

Open a game with table talk. Expected: Tab reaches each move bubble; Enter/Space selects it (board + move list sync), and the selected bubble shows `aria-pressed`. In a completed game's analysis, Tab to a critical moment and press Space → board jumps to that move.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/game/TableTalkPanel.tsx frontend/src/components/game/AnalysisPanel.tsx frontend/src/App.css
git commit -m "feat(a11y): real buttons for table-talk bubbles and critical-moment items"
```

---

### Task 13: GameList search aria-label

The search input has only a placeholder. Add an explicit `aria-label="Search games"`.

**Files:**
- Modify: `frontend/src/pages/GameListPage.tsx`

- [ ] **Step 1: Add the label**

In `frontend/src/pages/GameListPage.tsx`, the search input (~lines 214-220) — add `aria-label`:

```tsx
        <input
          className="game-list-page__search-input"
          type="text"
          placeholder="Search by model or opening..."
          aria-label="Search games"
          value={searchInput}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
```

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/GameListPage.tsx
git commit -m "feat(a11y): aria-label on GameList search input"
```

---

### Task 14: Section-title `<div>`→heading promotions (keep classes)

Several visual section titles are `<div>`s, so screen readers get no heading structure. Promote them to `<h2>`/`<h3>` keeping their existing classes (styling preserved). The dialog titles were already promoted in their respective tasks (NewGameDialog `<h2>`, GameOverBanner `<h2>`, KeyboardShortcutsModal already `<h3>`). This task covers the in-page panel titles.

**Files:**
- Modify: `frontend/src/components/game/NarrationPanel.tsx`
- Modify: `frontend/src/components/game/TableTalkPanel.tsx`
- Modify: `frontend/src/components/game/AnalysisPanel.tsx`
- Modify: `frontend/src/components/game/ResponseTimeGraph.tsx`

- [ ] **Step 1: NarrationPanel "Commentary" label → `<h3>`**

In `frontend/src/components/game/NarrationPanel.tsx`, the `<div className="narration-panel__label">Commentary</div>` (~line 21) becomes:

```tsx
        <h3 className="narration-panel__label">Commentary</h3>
```

(If line ~32 has a second `.narration-panel__label` that is dynamic/non-title text, leave it as a `<div>` — read the file and only promote the static "Commentary" heading.)

- [ ] **Step 2: TableTalkPanel "Table Talk" label → `<h3>`**

In `frontend/src/components/game/TableTalkPanel.tsx`, the `.table-talk-panel__label` wrapper (~line 151) contains both the title text and the filter button. To keep the button valid (no button-inside-heading), wrap only the text in a heading. Replace:

```tsx
      <div className="table-talk-panel__label">
        Table Talk
        {hasErrors && (
```

with:

```tsx
      <div className="table-talk-panel__label">
        <h3 className="table-talk-panel__heading">Table Talk</h3>
        {hasErrors && (
```

Add a CSS rule so the new heading inherits the label's typography (in `App.css`, after the `.table-talk-panel__label` rule):

```css
.table-talk-panel__heading {
  font: inherit;
  color: inherit;
  margin: 0;
}
```

- [ ] **Step 3: AnalysisPanel titles → headings**

In `frontend/src/components/game/AnalysisPanel.tsx`:
- The `.analysis-panel__title` wrapper (~line 78) contains the title text plus an export button. Wrap just the text in an `<h2>`. Read the block; if it is e.g. `<div className="analysis-panel__title">Game Analysis<button …>…</button></div>`, change the text node into `<h2 className="analysis-panel__heading">Game Analysis</h2>` keeping the button as a sibling.
- The `.analysis-panel__subtitle` "Critical Moments" (~line 138) → `<h3 className="analysis-panel__subtitle">Critical Moments</h3>`.

Add the heading normalize CSS (in `App.css`, after `.analysis-panel__title`):

```css
.analysis-panel__heading {
  font: inherit;
  color: inherit;
  margin: 0;
}
```

(Read the exact JSX of the title block before editing — the export button must remain a sibling of the heading, not nested inside it.)

- [ ] **Step 4: ResponseTimeGraph + TokensPerMoveChart subtitles → `<h3>`**

In `frontend/src/components/game/ResponseTimeGraph.tsx` (~line 52): `<div className="response-time-graph__title">Response Time</div>` → `<h3 className="response-time-graph__title">Response Time</h3>`.

`TokensPerMoveChart.tsx` (~line 42) uses `.analysis-panel__subtitle` for "Tokens per Move" → change that `<div>` to `<h3>` with the same class.

- [ ] **Step 5: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 6: Manual check**

With VoiceOver's rotor (headings), confirm panel titles now appear in the headings list; visually confirm nothing shifted (the classes are unchanged; new normalize rules keep font/color/margin inherited).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/game/NarrationPanel.tsx frontend/src/components/game/TableTalkPanel.tsx frontend/src/components/game/AnalysisPanel.tsx frontend/src/components/game/ResponseTimeGraph.tsx frontend/src/components/game/TokensPerMoveChart.tsx frontend/src/App.css
git commit -m "feat(a11y): promote section-title divs to headings (classes preserved)"
```

---

### Task 15: BoardThemeSelector — Escape + outside-click dismissal + labelled popup role

`BoardThemeSelector` opens a dropdown that does not close on Escape or outside-click (unlike `ModelSelector`), and the popup has no role/label. Match `ModelSelector`'s dismissal and label the popup.

**Files:**
- Modify: `frontend/src/components/game/BoardThemeSelector.tsx`

- [ ] **Step 1: Add refs + dismissal effects**

Replace the imports and the top of the component in `frontend/src/components/game/BoardThemeSelector.tsx`. Change:

```tsx
import { useState } from "react";
import { BOARD_COLORS, PIECE_STYLES } from "../../hooks/useBoardTheme";
import type { BoardColorPreset } from "../../hooks/useBoardTheme";
```

to:

```tsx
import { useState, useRef, useEffect } from "react";
import { BOARD_COLORS, PIECE_STYLES } from "../../hooks/useBoardTheme";
import type { BoardColorPreset } from "../../hooks/useBoardTheme";
```

Then inside the component, after `const [open, setOpen] = useState(false);` add:

```tsx
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside-click (mousedown, matching ModelSelector).
  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open]);
```

- [ ] **Step 2: Attach the ref + label the popup**

Change the root wrapper:

```tsx
    <div className="board-theme-selector" ref={containerRef}>
```

And label the dropdown popup (the `{open && (<div className="board-theme-selector__dropdown">` ~line 39):

```tsx
        <div className="board-theme-selector__dropdown" role="group" aria-label="Board and piece theme options">
```

- [ ] **Step 3: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 4: Manual check**

Open the Theme dropdown. Expected: clicking outside closes it; pressing Escape closes it; with VoiceOver the popup is announced as a labelled group "Board and piece theme options".

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/game/BoardThemeSelector.tsx
git commit -m "feat(a11y): BoardThemeSelector Escape + outside-click dismissal, labelled popup"
```

---

### Task 16: Contrast token nudges (one step brighter, palette preserved)

Bump the three tokens used as small readable text — `--text-muted`, `--amber-dim` (used as text in `.model-selector__option-ctx`), and error red `--blunder` — one step brighter each so they pass contrast as text, preserving the war-room character. These are minimal nudges; the hue is unchanged.

**Files:**
- Modify: `frontend/src/App.css` (`:root` tokens, lines ~15, ~21, ~40)

- [ ] **Step 1: Nudge the tokens**

In `frontend/src/App.css` `:root`, change these three values:

- `--text-muted` (line ~21) from `#8a887f` to `#9d9b91` (a touch brighter; remains a muted warm grey).

```css
  --text-muted: #9d9b91;
```

- `--amber-dim` (line ~15) from `#8b7332` to `#a98c3f` (brighter amber so the price/context text in `.model-selector__option-ctx` reads on dark backgrounds; still clearly "dim" vs `--amber`).

```css
  --amber-dim: #a98c3f;
```

- `--blunder` (line ~40) from `#ca3431` to `#dd4441` (slightly brighter red so error text/blunder labels read better; same hue family).

```css
  --blunder: #dd4441;
```

Note on scope: `--amber-dim` is also used as a **border** color in several rules (e.g. `.filter-btn--active`, dialog borders). A one-step-brighter border is acceptable and preserves character; if any border looks too hot in manual review, that is the only thing to revisit — do not change the hue. `--blunder` is used both as background (badges/timer) and as text/error color; the `ClassificationBadge` blunder text stays `#fff` (Task 10) and `#fff` on `#dd4441` is ≈4.1:1 — acceptable for the large bold `??` glyph; the eval/error red text uses on dark backgrounds where the brighter red improves legibility.

- [ ] **Step 2: Build**

Run: `cd frontend && npm run build`
Expected: no errors.

- [ ] **Step 3: Manual contrast spot-check**

Open the New Game dialog model list (muted context/price text), a page using `--text-muted` body text, and a game with a blunder/eval-loss in red. Expected: all three read more clearly against the dark backgrounds; the overall palette still looks like the war-room theme (no garish shift). Spot-check `--text-muted` `#9d9b91` on `--bg-primary` `#0e1017` ≈ 7.0:1 (passes AA); `--amber-dim` `#a98c3f` on `#0e1017` ≈ 6.0:1; brighter `--blunder` text on dark backgrounds ≈ 4.8:1+.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat(a11y): nudge --text-muted, --amber-dim, --blunder one step brighter for contrast"
```

---

## Self-Review

**Spec coverage map (Workstream 2):**
1. **Modals (P1)** — `useModal` built in Task 2; retrofitted to KeyboardShortcutsModal (Task 3), GameOverBanner (Task 4), NewGameDialog (Task 5). Each gets focus trap, Escape, restore-focus, scroll lock, `role="dialog"`/`aria-modal`/`aria-labelledby` (pointed at the real `<h2>`/`<h3>` heading). ✓
2. **Keyboard-playable board** — Task 8: focusable container (`role="application"`, `tabIndex`, `aria-label` with turn + last move + instructions), arrow-key roving cursor (orientation-aware), Enter select/place, Escape deselect — reusing existing `selectedSquare`/`legalTargets`/`getLegalTargets`/`tryMove`/`setOptimisticFen`/promotion. ✓
3. **Live regions (P5)** — `<LiveAnnouncer>` built (Task 6) and mounted in `Layout`; latest-move announcement effect + `role="status"` on the two thinking/`statusMessage` blocks (Task 7). EvalBar is **not** a live region. ✓
4. **Eval bar semantics** — Task 9: `aria-valuetext` always set ("White 62% win probability, +1.4" / "Even" / "White has mate in N") + subtle "=" parity label. ✓
5. **Classification redundancy + contrast** — Task 10: unique glyphs (best ★ vs excellent ☆, good ·, etc.); badge text contrast raised to ≥4.5:1 (brilliant text now `#06231d` on `#26c2a3`). ✓
6. **Win-prob graph** — Task 11: dots encoded by shape (triangle=error, diamond=brilliancy, circle=other) + color; `aria-label`/visually-hidden summary; keyboard-reachable "Go to …" dot buttons. ✓
7. **Real buttons** — Task 12: TableTalkPanel move bubble → `<button>` (with `aria-pressed`); AnalysisPanel critical-moment item gets Space + preventDefault (full role/tabindex/keyhandler). ✓
8. **Forms & headings** — Task 5 (NewGameDialog: title `<h2>` linked via `aria-labelledby`; temperature + Stockfish-ELO sliders get `aria-label`/`aria-valuetext`); Task 13 (GameList search `aria-label="Search games"`); Task 14 (section-title `<div>`→`<h2>/<h3>`, classes kept). Existing per-control `<label htmlFor>` associations in NewGameDialog were already present and preserved. ✓
9. **Dropdown dismissal** — Task 15: BoardThemeSelector closes on Escape + outside-click (mirrors ModelSelector); popup gets labelled `role="group"`. ✓
10. **Contrast token nudges** — Task 16: `--text-muted`, `--amber-dim`, `--blunder` each one step brighter, hue preserved. ✓
- **Shared utility** — `.visually-hidden` added once (Task 1), consumed by LiveAnnouncer, WinProbGraph summary/jump-list, and the win-prob heading.

**Placeholder scan:** none — every step contains exact TSX/TS/CSS or an exact command with expected output. Three steps (Task 9 Step 2, Task 14 Steps 1/3) instruct the implementer to read the exact existing CSS/JSX first because the precise surrounding markup (label positioning; export button sibling) must be preserved; the edits themselves are fully specified.

**Type/name consistency:**
- `useModal(open, onClose)` returns `{ ref, titleId, dialogProps }`; `dialogProps` includes `ref` (so spreading it is sufficient) — KeyboardShortcutsModal/GameOverBanner spread `dialogProps`; NewGameDialog uses `ref`/`titleId` directly because its container is a `<form>` (cast `ref as React.RefObject<HTMLFormElement>`). Consistent.
- `useAnnounce()` returns `(message: string) => void`; `LiveAnnouncer` provides it; `GameViewerPage` calls `announce(...)`. Consistent. No-op default keeps the embed route (no provider) safe.
- `DotShape` / `DotInfo.shape` / `shapeFor` / `DotShapeMark` names align in WinProbGraph; `onSelectMove(index)` reused for the jump list, matching the component's existing prop.
- `selectedBubbleRef` retyped to `HTMLButtonElement` in TableTalkPanel to match the `<button>`; the scroll effect uses only members valid on that type.
- Board helpers (`squareToFileRank`/`fileRankToSquare`/`moveSquare`) return `Square` and feed the existing `tryMove`/`getLegalTargets` signatures (`Square`), and `Chess` is already imported in ChessboardPanel.
- CSS classes are reused unchanged everywhere; new classes are `.visually-hidden`, `.eval-bar__label--even`, `.table-talk-panel__heading`, `.analysis-panel__heading`, plus `button.table-talk-bubble` normalize — none collide with existing rules (verified absent in App.css).

**Visual-style preservation:** No layout/spacing/font/radius changes. CSS edits are limited to the new `.visually-hidden` utility, heading normalizers that inherit font/color/margin, a centered parity label reusing existing eval-label typography, badge **text-color-only** changes (backgrounds untouched), and three one-step token nudges with hue preserved. The war-room dark theme is intact.
