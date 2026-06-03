# Quick-Win Features (Workstream 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the two frontend-only Workstream 4 quick wins — one-click colors-swapped **Rematch** with a live head-to-head **series score** on the game-over banner, and a **Value** (ELO-per-dollar, accuracy-per-dollar) leaderboard with a Strength / Value / Speed sort toggle.

**Architecture:** Pure frontend changes against three already-existing endpoints (`POST /api/games` via `createGame`, `GET /api/models/compare` via `compareModels`, `GET /api/models/leaderboard` via `getLeaderboard`) — no backend or API-shape changes. The Rematch button POSTs a new game built from the live `GameState` config with white/black settings swapped, stores any returned `player_secret`, and `navigate()`s to `/game/{id}` (the viewer remounts on the `gameId` route param). The series score reuses the `/compare` H2H endpoint, keyed on the two model IDs. The leaderboard gains a client-side derived-metric layer and a sort toggle over the existing `EnhancedModelStats` array.

**Tech Stack:** React 19 + TypeScript + Vite (frontend-only; no backend changes). No test framework exists; verification is `cd frontend && npm run build` (`tsc -b` gate) plus manual checks. node_modules is installed.

**Spec:** `docs/superpowers/specs/2026-06-03-polish-to-100-design.md` (Workstream 4 — quick wins).

---

## File Structure

```
frontend/src/
  components/game/
    GameOverBanner.tsx        # MODIFY — add series score + one-click swapped rematch button
  pages/
    GameViewerPage.tsx        # MODIFY — wire banner rematch handler (direct POST + navigate);
                              #          keep existing NewGameDialog as the "customize" path
  pages/
    LeaderboardPage.tsx       # MODIFY — sort toggle + derived Value/Speed columns
  App.css                     # MODIFY — series-score + sort-toggle styling (war-room tokens)
```

Pre-flight facts verified against the current code (do not re-derive — cited inline):

- `frontend/src/api/client.ts:51` `createGame(req: CreateGameRequest): Promise<GameCreatedResponse>`; line 93 `compareModels(modelA, modelB): Promise<HeadToHeadComparison>`; line 69 `getLeaderboard(): Promise<EnhancedModelStats[]>`. All three already exist.
- `frontend/src/types/api.ts:102-108` `EnhancedModelStats` adds `avg_acpl: number | null`, `avg_accuracy: number | null`, `avg_cost_per_game: number`, `avg_response_ms: number`, `illegal_move_rate: number`; it extends `ModelStats` (lines 90-100) which has `id`, `display_name`, `elo_rating: number`, `games_played`, `wins`, `draws`, `losses`, `win_rate: number`, `total_illegal_moves`.
- `frontend/src/types/api.ts:150-166` `HeadToHeadComparison` has `model_a`, `model_b`, `model_a_display`, `model_b_display`, `model_a_elo`, `model_b_elo`, `model_a_wins`, `model_b_wins`, `draws`, `total_games` (and accuracy/acpl/recent_games).
- `frontend/src/types/api.ts:192-209` `CreateGameRequest` fields (all the `white_*`/`black_*` config + `max_moves`, `chaos_mode`, `move_time_limit`, `draw_adjudication`).
- `frontend/src/hooks/useGameWebSocket.ts` `GameState` (typed in `types/websocket.ts:69-102`) carries `whiteModel`, `blackModel`, `whiteTemperature`, `blackTemperature`, `whiteReasoningEffort`, `blackReasoningEffort`, `whiteIsHuman`, `blackIsHuman`, `whiteIsStockfish`, `blackIsStockfish`, `whiteStockfishElo`, `blackStockfishElo`, `chaosMode`, `moveTimeLimit`, `drawAdjudication`.
- `frontend/src/pages/GameViewerPage.tsx:246` already has `rematchOpen` state and `:483-510` already opens a pre-filled `<NewGameDialog>` (currently with **un-swapped** colors). `:114` destructures `state` from `useGameWebSocket`; `:318-321` renders `<GameOverBanner onRematch={isCompleted ? () => setRematchOpen(true) : undefined}>`.
- `frontend/src/components/gamelist/NewGameDialog.tsx:324` already does `navigate(\`/game/\${resp.id}\`)` and `:320-322` stores `player_secret` in `localStorage` under `chess_player_secret_${id}` — mirror exactly for the one-click path.
- `frontend/src/utils/formatModel.ts:6` `formatModelName(modelId, displayName?)`.
- CSS: `.btn`/`.btn--primary`/`.btn--ghost` (`App.css:1582,1593,1607`), `.filter-btn`/`.filter-btn--active` (`App.css:794-805`), `.game-over-banner*` (`App.css:697-741`, rematch button `:377`), `.leaderboard-table--enhanced` (`App.css:2017-2021`) with responsive column-hiding by `:nth-child` (`App.css:3245-3254`).

**Derived metrics used (all source fields confirmed present in `types/api.ts`):**
- **Value → ELO-per-dollar** = `elo_rating / avg_cost_per_game` (both fields exist; guarded against `avg_cost_per_game <= 0`).
- **Value → Accuracy-per-dollar** = `avg_accuracy / avg_cost_per_game` (both exist; `avg_accuracy` is `number | null` so guarded for null).
- **Speed** = ascending `avg_response_ms` (field exists).
- **Dropped:** ELO-per-1k-tokens — `EnhancedModelStats` has **no** token-average field (it has none; per-move tokens live only on `MoveDetail`/`PlatformOverview`, not on the leaderboard row), so this metric is intentionally omitted to avoid inventing a field. Noted in Self-Review.

---

### Task 1: Series score on the game-over banner

Add a head-to-head "series" line to `GameOverBanner` that fetches `compareModels(whiteModel, blackModel)` and renders "Series: {A} {wins} – {losses} {B}" using the existing `/compare` data. The banner already receives `whiteModel`/`blackModel`.

**Files:**
- Modify: `frontend/src/components/game/GameOverBanner.tsx`

- [ ] **Step 1: Replace the whole `GameOverBanner.tsx` file**

The component currently (verified) imports only `GameOverData` + `formatModelName`, takes `{ data, whiteModel, blackModel, onRematch }`, and renders title/termination/stats + an optional Rematch button. Replace it with the version below, which adds a `SeriesScore` sub-component (fetches `/compare` on mount when both models are present) and keeps every existing class name.

```tsx
import { useEffect, useState } from "react";
import type { GameOverData } from "../../types/websocket";
import type { HeadToHeadComparison } from "../../types/api";
import { compareModels } from "../../api/client";
import { formatModelName } from "../../utils/formatModel";

interface Props {
  data: GameOverData;
  whiteModel: string | null;
  blackModel: string | null;
  onRematch?: () => void;
  rematchPending?: boolean;
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

function SeriesScore({ whiteModel, blackModel }: { whiteModel: string; blackModel: string }) {
  const [h2h, setH2h] = useState<HeadToHeadComparison | null>(null);

  useEffect(() => {
    let cancelled = false;
    compareModels(whiteModel, blackModel)
      .then((res) => {
        if (!cancelled) setH2h(res);
      })
      .catch(() => {
        if (!cancelled) setH2h(null);
      });
    return () => {
      cancelled = true;
    };
  }, [whiteModel, blackModel]);

  if (!h2h || h2h.total_games === 0) return null;

  const aName = formatModelName(h2h.model_a, h2h.model_a_display);
  const bName = formatModelName(h2h.model_b, h2h.model_b_display);

  return (
    <div className="game-over-banner__series" aria-label="Head-to-head series record">
      <span className="game-over-banner__series-label">Series</span>
      <span className="game-over-banner__series-name">{aName}</span>
      <span className="game-over-banner__series-score">{h2h.model_a_wins}</span>
      <span className="game-over-banner__series-dash">&ndash;</span>
      <span className="game-over-banner__series-score">{h2h.model_b_wins}</span>
      <span className="game-over-banner__series-name">{bName}</span>
      {h2h.draws > 0 && (
        <span className="game-over-banner__series-draws">({h2h.draws} drawn)</span>
      )}
    </div>
  );
}

export default function GameOverBanner({ data, whiteModel, blackModel, onRematch, rematchPending }: Props) {
  const { title, cls } = outcomeDisplay(data.outcome, whiteModel, blackModel);

  return (
    <div className="game-over-banner panel--elevated" role="alert">
      <div className={`game-over-banner__title ${cls}`}>{title}</div>
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
      {whiteModel && blackModel && (
        <SeriesScore whiteModel={whiteModel} blackModel={blackModel} />
      )}
      {onRematch && (
        <button
          className="btn btn--primary game-over-banner__rematch"
          onClick={onRematch}
          disabled={rematchPending}
        >
          {rematchPending ? "Starting rematch…" : "Rematch (swap colors)"}
        </button>
      )}
    </div>
  );
}
```

Notes (verified):
- `compareModels` returns the H2H keyed to `model_a`/`model_b` exactly as `HeadToHeadPage.tsx:96-119` consumes it; we pass `whiteModel` as A and `blackModel` as B (these are model IDs, which `/compare` expects — `client.ts:93-96` puts them in `model_a`/`model_b` query params). The endpoint may normalize ordering, so we always render names from the returned `model_a_display`/`model_b_display`, never assume A==white.
- `total_games === 0` (e.g. brand-new pairing, human/stockfish opponent with no model id) hides the line — no empty "0 – 0".
- The new `rematchPending` prop is optional; Task 2 supplies it.

- [ ] **Step 2: Add `.game-over-banner__series*` styles to `App.css`**

Insert immediately after the existing `.game-over-banner__stat-value { … }` block (ends at `App.css:741`):

```css
.game-over-banner__series {
  display: flex;
  align-items: baseline;
  justify-content: center;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin-top: 0.9rem;
  font-family: var(--font-mono);
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.game-over-banner__series-label {
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-size: 0.68rem;
  color: var(--text-muted);
}

.game-over-banner__series-name {
  color: var(--text-secondary);
}

.game-over-banner__series-score {
  font-weight: 700;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}

.game-over-banner__series-dash {
  color: var(--text-muted);
}

.game-over-banner__series-draws {
  color: var(--text-muted);
  font-size: 0.7rem;
}
```

- [ ] **Step 3: Verify build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + vite succeed, no errors. (The `rematchPending` prop is optional, so this compiles even before Task 2 wires it.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/game/GameOverBanner.tsx frontend/src/App.css
git commit -m "feat(game): show head-to-head series score on game-over banner"
```

---

### Task 2: One-click colors-swapped rematch (direct POST + navigate)

Make the banner's **Rematch** button POST a new game built from the live `GameState`, with white/black swapped, store any `player_secret`, and navigate to the new game — instead of (re)opening the dialog with un-swapped colors. Keep the existing `NewGameDialog` available as a secondary "customize" path so nothing regresses.

**Files:**
- Modify: `frontend/src/pages/GameViewerPage.tsx`

- [ ] **Step 1: Add `useNavigate` + `createGame` imports**

`GameViewerPage.tsx:1-2` currently imports `useParams, useSearchParams` from `react-router-dom` and (line 5) `getGame, stopGame` from `../api/client`. Change those two lines to add `useNavigate` and `createGame`:

```tsx
import { useParams, useSearchParams, useNavigate } from "react-router-dom";
```

```tsx
import { getGame, stopGame, createGame } from "../api/client";
```

- [ ] **Step 2: Get the navigate function**

Immediately after `const { gameId } = useParams<{ gameId: string }>();` (currently `GameViewerPage.tsx:112`), add:

```tsx
  const navigateRoute = useNavigate();
```

(Named `navigateRoute` to avoid colliding with the `navigate` move-stepper already destructured from `useGameWebSocket` on line 114.)

- [ ] **Step 3: Add the swapped-rematch handler**

The page already has `const [rematchOpen, setRematchOpen] = useState(false);` at `GameViewerPage.tsx:246`. Directly after that line, add a pending flag and the handler:

```tsx
  const [rematchPending, setRematchPending] = useState(false);
  const handleRematch = useCallback(async () => {
    if (rematchPending) return;
    if (!state.whiteModel || !state.blackModel) return;
    setRematchPending(true);
    try {
      // Swap white <-> black: previous black plays white next, and vice versa.
      const resp = await createGame({
        white_model: state.blackModel,
        black_model: state.whiteModel,
        max_moves: 200,
        white_temperature: state.blackTemperature,
        black_temperature: state.whiteTemperature,
        white_reasoning_effort: state.blackReasoningEffort,
        black_reasoning_effort: state.whiteReasoningEffort,
        white_is_human: state.blackIsHuman,
        black_is_human: state.whiteIsHuman,
        white_is_stockfish: state.blackIsStockfish,
        black_is_stockfish: state.whiteIsStockfish,
        white_stockfish_elo: state.blackStockfishElo,
        black_stockfish_elo: state.whiteStockfishElo,
        chaos_mode: state.chaosMode,
        move_time_limit: state.moveTimeLimit,
        draw_adjudication: state.drawAdjudication,
      });
      if (resp.player_secret) {
        localStorage.setItem(`chess_player_secret_${resp.id}`, resp.player_secret);
      }
      navigateRoute(`/game/${resp.id}`);
    } catch {
      setRematchPending(false);
    }
  }, [rematchPending, state, navigateRoute]);
```

Notes (verified):
- Every field read off `state` exists on `GameState` (`types/websocket.ts:69-102`) and every key written exists on `CreateGameRequest` (`types/api.ts:192-209`). The swap mirrors `NewGameDialog.tsx:302-319`'s `createGame` call and its `localStorage`/`navigate` pattern (`:320-324`).
- `max_moves: 200` matches the default the existing rematch path already used (`GameViewerPage.tsx:491`). On success we navigate (viewer remounts via the `gameId` route param) and deliberately leave `rematchPending` true so the button stays disabled during the route transition; it resets only on error.
- `useCallback` is already imported on `GameViewerPage.tsx:1`.

- [ ] **Step 4: Point the banner at the new handler**

`GameViewerPage.tsx:314-321` renders the banner. Replace that block:

```tsx
      {state.gameOverData && (
        <GameOverBanner
          data={state.gameOverData}
          whiteModel={state.whiteModel}
          blackModel={state.blackModel}
          onRematch={isCompleted ? () => setRematchOpen(true) : undefined}
        />
      )}
```

with (one-click swapped rematch as the primary action; pending state passed through):

```tsx
      {state.gameOverData && (
        <GameOverBanner
          data={state.gameOverData}
          whiteModel={state.whiteModel}
          blackModel={state.blackModel}
          onRematch={isCompleted ? handleRematch : undefined}
          rematchPending={rematchPending}
        />
      )}
```

- [ ] **Step 5: Keep the dialog as a secondary "customize" path**

The pre-filled `<NewGameDialog>` block at `GameViewerPage.tsx:483-510` and its `rematchOpen` state stay as-is so the customizable flow is preserved (it is no longer the banner's primary action, but other UI may open it and `rematchOpen` is still referenced). To make it discoverable, add a ghost "Customize…" button right after the closing `</GameOverBanner>`-bearing block — i.e. immediately after the `{state.gameOverData && ( … )}` block edited in Step 4, insert:

```tsx
      {state.gameOverData && isCompleted && (
        <div className="game-over-banner__secondary">
          <button
            className="btn btn--ghost game-over-banner__customize"
            onClick={() => setRematchOpen(true)}
          >
            Customize rematch…
          </button>
        </div>
      )}
```

Then add the styling to `App.css` (after the `.game-over-banner__series-draws` block added in Task 1):

```css
.game-over-banner__secondary {
  display: flex;
  justify-content: center;
  margin-top: -0.4rem;
}

.game-over-banner__customize {
  font-size: 0.78rem;
}
```

This keeps the existing un-swapped dialog flow intact (a user who wants to change models/settings clicks "Customize rematch…"), while the banner's primary button is now the one-click swap the spec asks for.

- [ ] **Step 6: Verify build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + vite succeed, no errors.

- [ ] **Step 7: Manual check**

Run the app per `CLAUDE.md`, open a completed game's viewer.
Expected: the banner shows "Series: A n – m B"; clicking **Rematch (swap colors)** disables the button ("Starting rematch…"), creates a new game with the two models swapped, and routes to `/game/{newId}` where the viewer remounts on the new live game; "Customize rematch…" opens the pre-filled dialog.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/GameViewerPage.tsx frontend/src/App.css
git commit -m "feat(game): one-click colors-swapped rematch from game-over banner"
```

---

### Task 3: "Value" leaderboard — derived columns + sort toggle

Add a Strength / Value / Speed sort toggle to `LeaderboardPage`. "Strength" keeps today's ELO-descending order and columns. "Value" sorts by ELO-per-dollar (descending) and surfaces ELO/$ and Accuracy/$ columns. "Speed" sorts by `avg_response_ms` (ascending). All metrics are derived in the browser from `EnhancedModelStats` fields that already exist.

**Files:**
- Modify: `frontend/src/pages/LeaderboardPage.tsx`
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Replace the whole `LeaderboardPage.tsx` file**

The current file (verified) fetches `getLeaderboard()`, has a `showHuman` toggle, computes an ELO bar range, and renders a fixed 9-column `.leaderboard-table--enhanced`. Replace with the version below, which adds a `sortMode` state, derived-metric helpers, a `.filter-btn` toggle group, and a small extra column for the active value metric. Existing columns/classes are preserved; only the sort order and one trailing metric column change with the mode.

```tsx
import { useState, useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";
import type { EnhancedModelStats } from "../types/api";
import { formatModelName } from "../utils/formatModel";

type SortMode = "strength" | "value" | "speed";

// ELO per dollar spent per game. Guards against zero/near-zero cost.
function eloPerDollar(m: EnhancedModelStats): number {
  if (!m.avg_cost_per_game || m.avg_cost_per_game <= 0) return 0;
  return m.elo_rating / m.avg_cost_per_game;
}

// Accuracy percentage per dollar spent per game. Null accuracy -> null.
function accuracyPerDollar(m: EnhancedModelStats): number | null {
  if (m.avg_accuracy == null) return null;
  if (!m.avg_cost_per_game || m.avg_cost_per_game <= 0) return null;
  return m.avg_accuracy / m.avg_cost_per_game;
}

export default function LeaderboardPage() {
  const [models, setModels] = useState<EnhancedModelStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [showHuman, setShowHuman] = useState(true);
  const [sortMode, setSortMode] = useState<SortMode>("strength");

  useEffect(() => {
    getLeaderboard()
      .then(setModels)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const baseModels = showHuman ? models : models.filter((m) => m.id !== "Human");

  const displayModels = useMemo(() => {
    const copy = [...baseModels];
    if (sortMode === "value") {
      copy.sort((a, b) => eloPerDollar(b) - eloPerDollar(a));
    } else if (sortMode === "speed") {
      // Fastest first; treat 0 (no data) as slowest so it sinks.
      copy.sort((a, b) => {
        const av = a.avg_response_ms > 0 ? a.avg_response_ms : Infinity;
        const bv = b.avg_response_ms > 0 ? b.avg_response_ms : Infinity;
        return av - bv;
      });
    } else {
      copy.sort((a, b) => b.elo_rating - a.elo_rating);
    }
    return copy;
  }, [baseModels, sortMode]);

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  const maxElo = displayModels.length > 0 ? Math.max(...displayModels.map((m) => m.elo_rating)) : 1500;
  const minElo = displayModels.length > 0 ? Math.min(...displayModels.map((m) => m.elo_rating)) : 1500;
  const eloRange = maxElo - minElo || 1;

  return (
    <div className="leaderboard-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem", gap: "1rem", flexWrap: "wrap" }}>
        <h1 className="leaderboard-page__title" style={{ marginBottom: 0 }}>Leaderboard</h1>
        <div className="leaderboard-page__controls">
          <div className="leaderboard-sort" role="group" aria-label="Sort leaderboard">
            <button
              className={`filter-btn${sortMode === "strength" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("strength")}
              aria-pressed={sortMode === "strength"}
            >
              Strength
            </button>
            <button
              className={`filter-btn${sortMode === "value" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("value")}
              aria-pressed={sortMode === "value"}
            >
              Value
            </button>
            <button
              className={`filter-btn${sortMode === "speed" ? " filter-btn--active" : ""}`}
              onClick={() => setSortMode("speed")}
              aria-pressed={sortMode === "speed"}
            >
              Speed
            </button>
          </div>
          <button
            className={`filter-btn${showHuman ? " filter-btn--active" : ""}`}
            onClick={() => setShowHuman(!showHuman)}
            aria-pressed={showHuman}
          >
            Include Human
          </button>
        </div>
      </div>
      {displayModels.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9813;</div>
          <div className="empty-state__text">
            No models ranked yet. Play some games first!
          </div>
        </div>
      ) : (
        <div className="panel">
          <div className="leaderboard-table-wrap">
          <table className="leaderboard-table leaderboard-table--enhanced">
            <thead>
              <tr>
                <th>#</th>
                <th>Model</th>
                <th>ELO</th>
                <th>W / D / L</th>
                <th>Win %</th>
                <th>Accuracy</th>
                <th>ACPL</th>
                <th>Avg Cost</th>
                <th>Avg Time</th>
                {sortMode === "value" && <th>ELO / $</th>}
                {sortMode === "value" && <th>Acc / $</th>}
              </tr>
            </thead>
            <tbody>
              {displayModels.map((model, i) => {
                const rank = i + 1;
                const barWidth = Math.max(4, ((model.elo_rating - minElo) / eloRange) * 80);
                const rankCls = rank <= 3 ? ` leaderboard__rank--${rank}` : "";
                const epd = eloPerDollar(model);
                const apd = accuracyPerDollar(model);
                return (
                  <tr key={model.id}>
                    <td>
                      <span className={`leaderboard__rank${rankCls}`}>{rank}</span>
                    </td>
                    <td>
                      <Link to={`/model/${model.id}`} className="leaderboard__model-link">
                        {formatModelName(model.id, model.display_name)}
                      </Link>
                    </td>
                    <td>
                      <span className="leaderboard__elo">
                        {Math.round(model.elo_rating)}
                      </span>
                      <span
                        className="leaderboard__elo-bar"
                        style={{ width: `${barWidth}px` }}
                      />
                    </td>
                    <td>
                      <span className="leaderboard__record">
                        {model.wins} / {model.draws} / {model.losses}
                      </span>
                    </td>
                    <td>
                      <span className="leaderboard__winrate">
                        {model.win_rate.toFixed(0)}%
                      </span>
                    </td>
                    <td>
                      <span className="leaderboard__winrate">
                        {model.avg_accuracy != null ? `${model.avg_accuracy.toFixed(1)}%` : "--"}
                      </span>
                    </td>
                    <td>
                      {model.avg_acpl != null ? model.avg_acpl.toFixed(1) : "--"}
                    </td>
                    <td>
                      ${model.avg_cost_per_game.toFixed(4)}
                    </td>
                    <td>
                      {(model.avg_response_ms / 1000).toFixed(1)}s
                    </td>
                    {sortMode === "value" && (
                      <td>
                        <span className="leaderboard__value">
                          {epd > 0 ? Math.round(epd).toLocaleString() : "--"}
                        </span>
                      </td>
                    )}
                    {sortMode === "value" && (
                      <td>
                        <span className="leaderboard__value">
                          {apd != null ? apd.toFixed(0) : "--"}
                        </span>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </div>
  );
}
```

Notes (verified):
- Every field read (`elo_rating`, `avg_cost_per_game`, `avg_accuracy`, `avg_response_ms`, `avg_acpl`, `win_rate`, `wins`/`draws`/`losses`, `id`, `display_name`) is declared on `EnhancedModelStats`/`ModelStats` (`types/api.ts:90-108`). No new fields invented.
- "Value" rank ordering uses ELO-per-dollar (descending) as the headline value metric; Accuracy/$ is shown alongside as a secondary column (not the sort key) so models with `null` accuracy still rank by ELO/$.
- "Speed" sorts ascending by `avg_response_ms`; rows with `0` (no timing data) sink to the bottom via `Infinity`.
- The two extra `<th>`/`<td>` cells only render in `value` mode, so Strength/Speed keep the original 9-column layout untouched.

- [ ] **Step 2: Add `.leaderboard-page__controls`, `.leaderboard-sort`, `.leaderboard__value` styles**

Insert after the existing `.leaderboard__model-link:hover { … }` block (ends at `App.css:2034`):

```css
.leaderboard-page__controls {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

.leaderboard-sort {
  display: inline-flex;
  gap: 0.4rem;
}

.leaderboard__value {
  font-family: var(--font-mono);
  font-size: 0.82rem;
  color: var(--amber);
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 3: Hide the two value columns on narrow screens (match existing responsive pattern)**

The existing media query hides enhanced columns by `:nth-child` around `App.css:3245-3254`. The two value columns are the 10th and 11th cells when present. Add a rule to that same `@media (max-width: 900px)` block (place it just before that block's closing brace, alongside the existing `:nth-child(9)` rule):

```css
  .leaderboard-table--enhanced th:nth-child(10),
  .leaderboard-table--enhanced td:nth-child(10),
  .leaderboard-table--enhanced th:nth-child(11),
  .leaderboard-table--enhanced td:nth-child(11) {
    display: none;
  }
```

(If the surrounding query's breakpoint differs from 900px when you open the file, add the rule inside whatever media block already contains the `:nth-child(9)` hide rule — keep the value columns grouped with the other secondary columns it hides.)

- [ ] **Step 4: Verify build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` + vite succeed, no errors.

- [ ] **Step 5: Manual check**

Run the app, open `/leaderboard`.
Expected: three pill buttons "Strength / Value / Speed". Strength = today's ELO order, 9 columns. Value = reorders by ELO/$ descending and shows two extra columns (ELO/$, Acc/$); models with `$0.0000` cost show "--". Speed = reorders fastest-`Avg Time`-first. "Include Human" still toggles independently. On a ≤900px viewport the value columns collapse with the other secondary columns.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/LeaderboardPage.tsx frontend/src/App.css
git commit -m "feat(leaderboard): add Strength/Value/Speed sort toggle with ELO-per-dollar columns"
```

---

## Self-Review

- **Spec coverage (Workstream 4 quick wins):**
  - *Rematch + series score* — game-over button POSTs a new game with **colors swapped + same settings** ✓ Task 2 Step 3 (direct `createGame` with white/black config swapped); navigates to it and viewer remounts on `gameId` ✓ Task 2 Step 3 (`navigateRoute(\`/game/\${resp.id}\`)`); stores `player_secret` like the dialog path ✓ Task 2 Step 3; running series score "A n – m B" via the existing `/compare` H2H endpoint ✓ Task 1 (`SeriesScore` → `compareModels`). Existing customizable rematch dialog preserved as "Customize rematch…" ✓ Task 2 Step 5.
  - *"Value" leaderboard* — derived ELO-per-dollar + accuracy-per-dollar columns from existing fields ✓ Task 3 (`eloPerDollar`, `accuracyPerDollar`); Strength / Value / Speed sort toggle ✓ Task 3 Step 1.
- **Frontend-only confirmed:** No backend or API-shape changes. The three endpoints used (`POST /api/games`, `GET /api/models/compare`, `GET /api/models/leaderboard`) and their client wrappers (`createGame` `client.ts:51`, `compareModels` `:93`, `getLeaderboard` `:69`) already exist and are already used elsewhere (`NewGameDialog`, `HeadToHeadPage`, `LeaderboardPage`).
- **Derived metrics & field existence (every referenced api field verified in `types/api.ts`):**
  - ELO-per-dollar = `elo_rating` (`ModelStats`, line 96) / `avg_cost_per_game` (`EnhancedModelStats`, line 105) — both exist; division guarded for `<= 0`.
  - Accuracy-per-dollar = `avg_accuracy` (line 104, `number | null`) / `avg_cost_per_game` — both exist; guarded for null and `<= 0`.
  - Speed = `avg_response_ms` (line 106) — exists.
  - Banner stats read from `GameOverData` (`websocket.ts:42-50`); series from `HeadToHeadComparison` fields `model_a`/`model_b`/`model_a_display`/`model_b_display`/`model_a_wins`/`model_b_wins`/`draws`/`total_games` (`api.ts:150-166`) — all exist and match `HeadToHeadPage` usage.
  - Rematch request keys all exist on `CreateGameRequest` (`api.ts:192-209`); rematch source fields all exist on `GameState` (`websocket.ts:69-102`).
  - **Dropped metric noted:** ELO-per-1k-tokens — `EnhancedModelStats` has no token-average field, so it is intentionally omitted (not invented). The spec's "if a token-average field exists, add it" condition is false here.
- **Type/name consistency:** new `rematchPending?: boolean` prop on `GameOverBanner` is optional, so Task 1 builds standalone before Task 2 wires it. `navigateRoute` (react-router) is renamed to avoid shadowing the `navigate` move-stepper from `useGameWebSocket` (`GameViewerPage.tsx:114`). `SortMode` is a local union type; no shared-type changes. The two value columns are cells 10/11 only in `value` mode, so the existing `:nth-child` responsive rules for cells 4/6/7/8/9 are unaffected and the new rule targets 10/11.
- **Placeholder scan:** none — every step contains complete, copy-paste code with exact insertion points (file + line refs) and exact commit commands.
- **War-room style preserved:** reuses `.btn`/`.btn--primary`/`.btn--ghost`, `.filter-btn`/`.filter-btn--active`, `.game-over-banner*`, `.leaderboard-table--enhanced`; new classes use existing CSS variables (`--amber`, `--text-muted`, `--text-secondary`, `--font-mono`) and `tabular-nums`. No palette/font/radius changes.
