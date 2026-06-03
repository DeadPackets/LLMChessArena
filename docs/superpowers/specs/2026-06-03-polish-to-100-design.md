# LLM Chess Arena — Polish to 100% (Comprehensive Design Spec)

- **Date:** 2026-06-03
- **Status:** Approved (design) — ready for implementation planning
- **Author:** brainstormed with Claude Code
- **Scope:** One comprehensive design covering a new live navbar counter plus three audit-and-fix passes (stability, accessibility, UX clarity), and a ranked new-feature backlog. Implementation proceeds workstream-by-workstream; the user picks the order.

## Context

LLM Chess Arena is a full-stack app (FastAPI + SQLite backend, React 19 + Vite frontend) where LLMs (via OpenRouter), humans, and Stockfish play chess with live Stockfish evaluation, AI "table talk", an ELO leaderboard, cost tracking, opening explorer, head-to-head comparison, and embeddable replays. See `CLAUDE.md` for architecture.

The system works. This initiative brings it "to 100%" via a live activity counter and a thorough quality pass, grounded in a four-lens audit (accessibility, stability, UX clarity, new features) of the real codebase.

## Goals

- Add a live activity counter in the navbar (live games · spectators · total games).
- Make failure states legible and recoverable (no more blank-on-error).
- Make the app operable and understandable for keyboard and screen-reader users.
- Explain the domain jargon inline so non-experts can read the data.
- Catalog and design a backlog of engaging new features, with quick wins implemented in this pass.

## Non-Goals

- **No visual restyle.** The "war room" dark theme, amber accents, fonts (Cormorant Garamond / Outfit / JetBrains Mono), radii, and 1px borders are preserved. All changes are interaction, semantics, resilience, and inline-help only.
- No new auth/accounts system.
- No move to a multi-process backend or external broker (the in-memory pub/sub stays single-process; we harden it, not replace it).

## Design Principles

- **Build shared primitives once, reuse everywhere.** Five primitives below underpin all four passes, keeping behavior consistent and edits small and reviewable.
- **Preserve existing patterns.** Follow the established CSS-variable design tokens, panel structure, and component conventions.
- **Error ≠ empty.** A failed request and a genuinely-empty dataset must look different and offer different actions.
- **Redundant encoding.** Never rely on color alone; pair it with glyph/shape/text.

---

## Shared Primitives

These are implemented first; the workstreams consume them.

### P1. `useModal` hook
A hook (`frontend/src/hooks/useModal.ts`) that, given an `open` flag and `onClose`:
- Stores `document.activeElement` on open; restores focus to it on close/unmount.
- Moves focus into the dialog (container `tabIndex={-1}` or first focusable).
- Traps Tab / Shift+Tab within the dialog.
- Closes on `Escape`.
- Locks body scroll while open.
- Returns a ref + props to spread (`role="dialog"`, `aria-modal="true"`, `aria-labelledby`).

Retrofitted to: `KeyboardShortcutsModal.tsx`, `NewGameDialog.tsx`, `GameOverBanner.tsx`.

### P2. `useAsync` + `<AsyncBoundary>`
A hook returning `{ status: 'loading'|'error'|'empty'|'ready', data, error, reload }` and a presentational wrapper that renders:
- **loading** → skeleton in the existing panel style (no layout shift).
- **error** → message (from typed error, see P3) + a **Retry** button calling `reload`.
- **empty** → caller-supplied empty state (with a CTA where relevant).
- **ready** → children.

Replaces the `.catch(() => {})` pattern across data pages.

### P3. Typed API errors
`frontend/src/api/client.ts` throws `ApiError extends Error { status: number; retryAfter?: number; body?: string }`:
- Reads `Retry-After` on 429 and surfaces "Rate limited — retrying in Ns".
- Maps `AbortError` (the 15s timeout) to "Request timed out — check your connection."
- Pages render `error.message`, never raw JSON.

### P4. `<InfoDot>` + `<Legend>`
- `<InfoDot label="...">` — a small muted `?`/info affordance (war-room styled) that shows a tooltip on hover **and** focus, keyboard-reachable, linked via `aria-describedby`. Touch: tap toggles.
- `<Legend items={...}>` — a compact reusable key (symbol/shape/color → name → meaning), used for move classifications and metric groups.

This is the highest-leverage clarity primitive.

### P5. `<LiveAnnouncer>`
A single visually-hidden `aria-live="polite" aria-atomic="true"` region near the app root. A small context/store lets the active game push **debounced** plain-language updates: e.g. "Move 14, Black Nf6, blunder. White +2.3." Announces only the latest move (not every centipawn) to avoid screen-reader spam. `EvalBar` is **not** made a live region.

---

## Workstream 0 — Live Navbar Counter

### Data availability (verified)
- **Live games** — already available: `GET /api/games/queue-status` → `active` (= `len(GameManager._running_games)`).
- **Total games** — a `SELECT count(*)` over `games` (no existing endpoint returns the all-status total cheaply; `/api/games` returns a filtered `total_count`).
- **Global spectators** — **does not exist.** Spectators are tracked per-game in `GameManager.event_queues: dict[game_id, list[Queue]]`. Needs a new aggregate.

### Backend changes
- Add `GameManager.total_spectators()` → `sum(len(qs) for qs in self.event_queues.values())`.
- Extend `queue_status()` (and the `/api/games/queue-status` response in `routers/games.py`) to include `total_spectators` and `total_games` (count query via a session). Keep it cheap; this endpoint is polled.

### Frontend
- New `useLiveStats()` hook polling `/api/games/queue-status` every **10s**, **paused when `document.hidden`** (visibilitychange listener), with backoff on error.
- `Header.tsx` renders a counter cluster next to the logo. On any fetch error the counter simply hides — it must never break the persistent header.
- Numbers use `tabular-nums`. The "live" dot reuses `pulse-glow` (already reduced-motion-safe) and pulses only when `active > 0`.
- "live" count links to `/?status=active`.

### Appearance (approved mockup)
```
┌────────────────────────────────────────────────────────────────────┐
│  ♞ LLM Chess Arena   ● 3 live · 12 watching · 1,284 played    Games …│
└────────────────────────────────────────────────────────────────────┘
        amber serif          ↑ amber dot pulses only when live>0
                             muted text · tabular-nums · hidden <640px
```
- Collapses gracefully: hidden below 640px (the logo + nav take priority on mobile).

### Edge cases
- Backend unreachable → counter hidden, header intact.
- `active === 0` → dot static (no pulse), text "0 live".
- Counts are eventually-consistent (10s poll); acceptable for ambient stats.

---

## Workstream 1 — Stability & Resilience

Dominant problem: the frontend's `.catch(() => {})` pattern turns every backend failure into an empty state, and several backend terminal-state paths are non-atomic and unguarded.

### Frontend
1. **Real async states** (P2/P3) on `LeaderboardPage`, `OpeningExplorerPage`, `GameListPage`, `HeadToHeadPage`, `ModelDetailPage`, `CostDashboardPage`, `EloHistoryChart` — distinguish error (with Retry) from empty.
2. **Live-connection banner** — whenever `useGameWebSocket` reports `connectionStatus === "disconnected"` while `status` is `active`/`queued`, show a persistent "Live connection lost — reconnecting…" banner; when `reconnectAttempts` (10) is exhausted, show a manual **Reconnect** button. Do **not** gate this on `!gameId` (current bug: an already-loaded active game shows nothing on disconnect).
3. **GameList polling hygiene** — pause poll on `document.hidden`; exponential backoff on failure; don't fall through to the empty state when the last fetch errored.
4. **Dedup merge** — in the `MOVE_PLAYED` reducer, on a `(moveNumber,color)` dup, **merge** preferring the entry with non-null `evalAfter`/`engine_lines` rather than discarding (fixes empty Engine Lines on reconnect).

### Backend
5. **Move-persist resilience** — wrap the `move_callbacks` loop (`game_engine.py:353`) in try/except (log + continue) like the illegal/chaos callback loops already do; retry `_persist_move` on SQLite `OperationalError: database is locked`. A transient lock must never abort a game or zero out its result.
6. **Idempotent terminal state** — `stop_game`, `_persist_result`, and the error handler all write terminal state to the same row; guard each with `if game.status in {"completed","stopped"}: return`. Fold `_update_elo` into the same transaction/session as the result persist, and only apply ELO once (gate on not-yet-rated).
7. **No silent viewer freeze** — on slow-subscriber eviction (`_broadcast`, `game_manager.py:744`), push a `None` sentinel (or close) to that queue so `_send_events` terminates and the client reconnects + re-catches-up, instead of blocking forever on `queue.get()`.
8. **Human-move queue safety** — bound `human_move_queues` (maxsize 1–2); reject submissions when `_awaiting_human_move[game_id]` doesn't match the sender's color or when the game is still `queued`; send an `error` event back so the UI re-enables the board.
9. **Honest orphan recovery** — record orphaned games as `outcome="*"`, `termination="server_restart"` (like `stopped`) instead of fake `draw`, so analytics don't count aborted games as real draws.
10. **Migration robustness** — in `_migrate_add_columns`, detect existing columns via `PRAGMA table_info` rather than substring-matching the error string; re-raise on non-duplicate errors so a half-migrated schema fails loudly at startup.

---

## Workstream 2 — Accessibility

1. **Modals** (P1) — focus trap, Escape, restore-focus, `role="dialog"`/`aria-modal`/`aria-labelledby` on all three overlays.
2. **Keyboard-playable board** — `ChessboardPanel` gains a keyboard layer: focusable board, arrow keys move a roving square cursor, Enter selects/places, Escape deselects — reusing existing `selectedSquare`/`legalTargets`/`tryMove`. Board container gets an `aria-label` describing turn/last move. (Critical: a human on keyboard is currently fully blocked.)
3. **Live regions** (P5) — `<LiveAnnouncer>` for the latest move; `role="status"` on the "thinking…"/`statusMessage` blocks.
4. **Eval bar semantics** — always provide `aria-valuetext` ("White 62% win probability, +1.4" / "Even") and render a subtle "=" label at parity (today both labels are empty when even → color-only).
5. **Classification redundancy + contrast** — give every classification a unique non-color glyph (today `good` renders nothing and `excellent`/`best` look alike); raise badge text contrast to ≥4.5:1 (brilliant `#fff` on `#26c2a3` is 2.25:1 today).
6. **Win-prob graph** — encode critical-moment dots by **shape** as well as color (e.g. triangle=blunder, diamond=brilliant); add an `aria-label`/`<title>` summary; make dots keyboard-reachable.
7. **Real buttons** — convert clickable `<div>`s to `<button>` (or add full role/tabindex/keyhandlers) in `TableTalkPanel` move bubbles and critical-moment items (currently mouse-only).
8. **Forms & headings** — associate every `NewGameDialog` control with a `<label>`/`aria-label` and give sliders `aria-valuetext` (temperature, Stockfish ELO); add `aria-label="Search games"` to the GameList search input; promote section-title `<div>`s to `<h2>/<h3>` (keep classes); point dialog `aria-labelledby` at the real heading.
9. **Dropdown dismissal** — `BoardThemeSelector` closes on Escape + outside-click (match `ModelSelector`), and its popup gets a labelled `role`.
10. **Contrast token nudges** — bump the values used as small readable text: `--text-muted`, `--amber-dim` (used as text in `model-selector__option-ctx`), and error red — one step brighter each; palette character preserved.

---

## Workstream 3 — UX Clarity / Onboarding

There is no tooltip/legend infrastructure today; every chess + LLM term is presented assuming expertise.

1. **Explain the jargon** (P4) — apply `<InfoDot>`/`<Legend>` to: ELO, ACPL ("Average Centipawn Loss — avg eval lost vs the engine's best; lower is better"), accuracy %, eval/pawns + mate-in-N, the move-classification legend, win probability, temperature, reasoning effort, chaos mode, table-talk vs commentary, and the queued state. Targets: `LeaderboardPage`, `ModelDetailPage`, `AnalysisPanel`, `HeadToHeadPage`, `EvalBar`, `NewGameDialog`, `WinProbGraph`, `EngineLinesPanel`.
2. **Fix the classification taxonomy bug** — `ClassificationBadge`/`CLASS_ORDER` use `best/excellent` while `WinProbGraph` dot colors use `brilliant/great`. Unify to a single vocabulary (align with the backend `MoveClassification` enum: best/excellent/good/inaccuracy/mistake/blunder) so the legend is coherent.
3. **Feedback loops** —
   - Show *why* "Start Game" is disabled (inline hint: "Select a model for each LLM side").
   - Human-move rejection feedback ("Move not accepted — try again"); stop labeling the "Move Errors" panel with a model name for human players.
   - Replace the bare copy-link checkmark with a brief "Copied!" pill (timeout already exists).
   - Queued status: "Server is busy — your game will start automatically (position 2 of 3)."
4. **Actionable empty states** — put a "New Game" button inside the GameList empty state; add "Start a game" links in Leaderboard/Costs/Openings empty states so users aren't dead-ended.
5. **Discoverability & microcopy** — visible-on-first-hover/touch labels or tooltips for icon-only controls (PGN/mute/copy/shortcuts); a mobile caption on the leaderboard ("Tap a model for accuracy, ACPL, cost") since 5 columns are hidden ≤900px; panel titles for the win-prob and engine-lines panels; expand Stockfish-ELO / draw-adjudication / max-moves microcopy.

---

## Workstream 4 — New-Features Backlog

All confirmed non-duplicative against current routes/services/pages. Each larger feature gets its own spec when picked; the two **quick wins** are designed for inclusion in this pass.

### Promoted quick wins (implement in this initiative)
- **Rematch + series score** (S, FE-only) — game-over button POSTs a new game with colors swapped + same settings; viewer already remounts on `gameId`; show "Series: A 2 – 1 B" via the existing `/compare` H2H endpoint.
- **"Value" leaderboard** (S, FE-only) — derived columns ELO-per-dollar and accuracy-per-dollar from fields already in `EnhancedModelStats` (`elo_rating`, `avg_cost_per_game`, `avg_accuracy`, `avg_response_ms`); a Strength / Value / Speed sort toggle. (Verify the exact field names in `types/api.ts` during implementation; if a token-average field exists, add ELO-per-1k-tokens too.)

### Backlog (spec individually when picked), ranked by impact-to-effort
1. **Animated highlight GIF/clip** (M, BE) — `GET /api/games/{id}/clip.gif?from=&to=`, rendering frames via `generate_board_png` per `Move.fen_after`, with eval + `table_talk` overlay; default = top critical moment. Upgrades the static OG/embed sharing.
2. **Model persona cards** (M, FE+BE) — playstyle tag + favorite opening + "greatest hits" table-talk wall on `ModelDetailPage`, from `Move.table_talk`/`classification`/`win_probability` already aggregated.
3. **Tournaments & brackets** (L, FE+BE) — `tournaments` table + `Game.tournament_id` (via the existing migration pattern); `GameManager` already serializes matches; live bracket page.
4. **Live "Call It" prediction** (S–M, FE) — spectators predict winner/next-blunder, scored against incoming `classification`/`win_probability` over the existing WS; localStorage score.
5. **Smack-talk / banter board** (M, FE+BE) — score models on confidence-vs-results from table-talk; optionally feed opponent's last line into the agent prompt for clap-backs.
6. **Blunder & brilliancy reel** (M, FE+BE) — `GET /api/stats/highlights` over `moves`, with `board.png` thumbnails + `?move=N` deep links.
7. **Post-game AI "press conference" recap** (M, BE) — cached `Game.recap` from `compute_game_analysis`, in the winner/loser's voice; doubles as OG description.
8. **Spectator emoji reactions** (M, FE+BE) — ephemeral `reaction` WS message reusing `_broadcast` + rate limiter.
9. **Per-model opening repertoire** (S–M, FE+BE) — `?model=` filter on `compute_opening_stats`.
10. **Game-finish notifications** (S, FE) — browser Notification API tied to the WS `game_over` event.

---

## Cross-Cutting

### Testing & verification
- The repo has **no test suite or linter**; `npm run build` (`tsc -b` + vite) is the only automated gate.
- Backend changes verified by running a game locally (per `CLAUDE.md`): start a game, watch live, force a disconnect, stop a game, restart mid-game (orphan recovery).
- Accessibility verified by: keyboard-only walkthrough of each modal + a full human-vs-LLM game; VoiceOver pass on a live game; contrast spot-checks on the nudged tokens.
- Each workstream ends green on `npm run build` before it's considered done.

### Sequencing
Recommended order **0 → 1 → 2 → 3 → 4-quick-wins**, but the user picks each next. Shared primitives (P1–P5) are built at the start of the first workstream that needs them and reused thereafter (P1 → WS2, P2/P3 → WS1, P4 → WS3, P5 → WS2).

### Risks & mitigations
- **Scope is large.** Mitigated by workstream isolation and shared primitives; each workstream is independently shippable and verifiable.
- **`tabular-nums` already on body** inherits into serif headings (from the prior pass). Acceptable; revisit only if heading numerals look off.
- **Backend terminal-state changes touch the hot path.** Mitigated by idempotency guards and keeping the in-memory pub/sub model unchanged (only adding a sentinel on eviction).
- **No automated tests** means manual verification discipline per the checklist above is essential.

## Open Questions

None blocking. Feature deep-designs (WS4 backlog beyond the two quick wins) are deferred to per-feature specs when selected.
