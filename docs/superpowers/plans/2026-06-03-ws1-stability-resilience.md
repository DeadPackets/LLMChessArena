# Stability & Resilience (Workstream 1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every failure state legible and recoverable — typed API errors with a `useAsync`/`<AsyncBoundary>` Retry layer on the data pages, a live-connection reconnect banner in the viewer, and atomic, idempotent, lock-resilient terminal-state writes on the backend.

**Architecture:** The frontend gains two shared primitives — a typed `ApiError` thrown by `client.ts` and a `useAsync` hook rendered through a presentational `<AsyncBoundary>` — which replace the `.catch(() => {})` pattern across the read-only data pages so that *error ≠ empty* and every error offers Retry. The viewer surfaces WebSocket disconnects as a persistent banner (with a manual Reconnect once auto-attempts exhaust), and the move reducer merges duplicate moves instead of dropping richer data. On the backend, the move-callback loop becomes try/except + lock-retry, terminal-state writes (`stop_game`/`_persist_result`/error handler) are made idempotent with ELO folded into the result transaction, slow-subscriber eviction pushes a sentinel so the WS reader unblocks, the human-move queue is bounded and turn-aware, orphan recovery records `"*"`/`server_restart` instead of a fake draw, and migrations detect columns via `PRAGMA table_info` and re-raise on real errors.

**Tech Stack:** FastAPI + SQLModel (backend), React 19 + TypeScript + Vite (frontend). No test framework exists; verification is `npm run build` (`tsc -b`) for the frontend, `python3 -c "import ast; ast.parse(open('<file>').read())"` for backend syntax, plus runtime/manual checks. Backend deps may not be installed locally, so backend tasks verify by syntax + inspection; note this. Run the backend from `backend/` (cwd-relative SQLite path).

**Spec:** `docs/superpowers/specs/2026-06-03-polish-to-100-design.md` (Workstream 1).

---

## File Structure

**Created**
- `frontend/src/hooks/useAsync.ts` — P2 hook: returns `{ status, data, error, reload }` (`status: 'loading' | 'error' | 'empty' | 'ready'`), runs an async fetch with an `isEmpty` predicate and an abortable reload (Task 2).
- `frontend/src/components/shared/AsyncBoundary.tsx` — P2 presentational wrapper: renders skeleton/error+Retry/empty/children based on `status` using existing panel + spinner classes (Task 3).

**Modified (frontend)**
- `frontend/src/api/client.ts` — P3: add `ApiError` class; `request<T>` throws it (429 `Retry-After`, `AbortError` → timeout message) (Task 1).
- `frontend/src/App.css` — add `.async-skeleton`, `.async-error`, `.live-connection-banner` styles (Tasks 3 & 8).
- `frontend/src/pages/LeaderboardPage.tsx` — adopt `useAsync` + `<AsyncBoundary>` (Task 4).
- `frontend/src/pages/OpeningExplorerPage.tsx` — adopt `useAsync` + `<AsyncBoundary>` (Task 4).
- `frontend/src/pages/HeadToHeadPage.tsx` — replace ad-hoc error/empty with `<AsyncBoundary>` for the comparison fetch (Task 5).
- `frontend/src/pages/ModelDetailPage.tsx` — adopt `useAsync` + `<AsyncBoundary>` (Task 5).
- `frontend/src/pages/CostDashboardPage.tsx` — adopt `useAsync` + `<AsyncBoundary>` (Task 5).
- `frontend/src/components/model/EloHistoryChart.tsx` — distinguish error from "no rated games yet" (Task 6).
- `frontend/src/hooks/useGameWebSocket.ts` — `MOVE_PLAYED` dedup-merge; expose `reconnectExhausted` + `reconnect()`; don't gate reconnect on `!gameId` (Tasks 7 & 8).
- `frontend/src/pages/GameViewerPage.tsx` — render the live-connection banner (Task 8).
- `frontend/src/pages/GameListPage.tsx` — poll pause-on-hidden + backoff; don't fall through to empty on error (Task 9).

**Modified (backend)**
- `backend/app/services/game_engine.py` — wrap the `move_callbacks` loop in try/except (Task 10).
- `backend/app/services/game_manager.py` — `_persist_move` lock-retry; idempotent `stop_game`/`_persist_result`/error handler; ELO folded into result transaction + rated-once guard; `_broadcast` eviction sentinel; bounded turn-aware human queue + error event; honest orphan recovery (Tasks 10–14).
- `backend/app/routers/ws.py` — already terminates `_send_events` on a `None` sentinel (verified, line 29); no change needed (covered by Task 12 verification).
- `backend/app/database.py` — `_migrate_add_columns` uses `PRAGMA table_info` + re-raises non-duplicate errors (Task 15).

---

### Task 1: P3 — typed `ApiError` in the API client

**Files:**
- Modify: `frontend/src/api/client.ts:4-24` (the `request<T>` wrapper and module top)

- [ ] **Step 1: Add the `ApiError` class above `request`**

In `frontend/src/api/client.ts`, immediately after the `const DEFAULT_TIMEOUT_MS = 15_000;` line (line 4), insert:

```ts
export class ApiError extends Error {
  status: number;
  retryAfter?: number;
  body?: string;

  constructor(message: string, status: number, opts?: { retryAfter?: number; body?: string }) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfter = opts?.retryAfter;
    this.body = opts?.body;
  }
}
```

- [ ] **Step 2: Replace the body of `request<T>` to throw `ApiError`**

Replace the whole `request` function (lines 6-24) with:

```ts
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...init,
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      if (res.status === 429) {
        const header = res.headers.get("Retry-After");
        const retryAfter = header && !Number.isNaN(Number(header)) ? Number(header) : undefined;
        throw new ApiError(
          retryAfter != null
            ? `Rate limited — retrying in ${retryAfter}s`
            : "Rate limited — please wait a moment and try again",
          res.status,
          { retryAfter, body },
        );
      }
      throw new ApiError(
        `Request failed (${res.status})`,
        res.status,
        { body },
      );
    }
    return res.json();
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError("Request timed out — check your connection.", 0);
    }
    if (err instanceof TypeError) {
      throw new ApiError("Network error — could not reach the server.", 0);
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: completes with no errors. (If `node_modules` is missing, run `npm install` first.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/client.ts && git commit -m "feat(api-client): typed ApiError with 429 Retry-After and timeout mapping"
```

---

### Task 2: P2 — `useAsync` hook

**Files:**
- Create: `frontend/src/hooks/useAsync.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useAsync.ts`:

```ts
import { useCallback, useEffect, useState } from "react";

export type AsyncStatus = "loading" | "error" | "empty" | "ready";

export interface AsyncState<T> {
  status: AsyncStatus;
  data: T | null;
  error: Error | null;
  reload: () => void;
}

/**
 * Runs `fetcher` on mount and whenever any value in `deps` changes.
 * Distinguishes a genuinely-empty result (via `isEmpty`) from an error,
 * and exposes `reload` for a Retry button. Ignores results from a stale
 * run if `deps` change or the component unmounts before it resolves.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: ReadonlyArray<unknown>,
  isEmpty: (data: T) => boolean = () => false,
): AsyncState<T> {
  const [status, setStatus] = useState<AsyncStatus>("loading");
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setError(null);
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setStatus(isEmpty(result) ? "empty" : "ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { status, data, error, reload };
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useAsync.ts && git commit -m "feat(hooks): useAsync with loading/error/empty/ready states"
```

---

### Task 3: P2 — `<AsyncBoundary>` presentational wrapper

**Files:**
- Create: `frontend/src/components/shared/AsyncBoundary.tsx`
- Modify: `frontend/src/App.css` (add skeleton + error styles after the `.spinner-lg` block, ~line 1729)

- [ ] **Step 1: Create the component**

Create `frontend/src/components/shared/AsyncBoundary.tsx`:

```tsx
import type { ReactNode } from "react";
import type { AsyncState } from "../../hooks/useAsync";

interface Props<T> {
  state: AsyncState<T>;
  /** Rendered on success. Receives the non-null data. */
  children: (data: T) => ReactNode;
  /** Rendered when the fetch succeeds but the result is empty. */
  empty: ReactNode;
  /** Optional loading skeleton; defaults to a centered spinner in a panel. */
  skeleton?: ReactNode;
}

export default function AsyncBoundary<T>({ state, children, empty, skeleton }: Props<T>) {
  if (state.status === "loading") {
    return (
      <>
        {skeleton ?? (
          <div className="spinner-page">
            <div className="spinner-lg" />
          </div>
        )}
      </>
    );
  }

  if (state.status === "error") {
    return (
      <div className="empty-state panel async-error">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">
          {state.error?.message || "Something went wrong."}
        </div>
        <button className="btn btn--ghost btn--sm async-error__retry" onClick={state.reload}>
          Retry
        </button>
      </div>
    );
  }

  if (state.status === "empty") {
    return <>{empty}</>;
  }

  // status === "ready" — data is non-null here.
  return <>{children(state.data as T)}</>;
}
```

- [ ] **Step 2: Add the CSS**

In `frontend/src/App.css`, immediately after the `.spinner-lg { … }` rule (ends ~line 1729), insert:

```css
.async-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
}

.async-error__retry {
  margin-top: 0.25rem;
}

.async-skeleton {
  min-height: 120px;
  border-radius: 8px;
  background: linear-gradient(
    90deg,
    var(--bg-elevated) 25%,
    var(--border) 37%,
    var(--bg-elevated) 63%
  );
  background-size: 400% 100%;
  animation: async-shimmer 1.4s ease infinite;
}

@keyframes async-shimmer {
  0% { background-position: 100% 0; }
  100% { background-position: 0 0; }
}

@media (prefers-reduced-motion: reduce) {
  .async-skeleton { animation: none; }
}
```

- [ ] **Step 3: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes and `vite build` completes with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/components/shared/AsyncBoundary.tsx frontend/src/App.css && git commit -m "feat(ui): AsyncBoundary error!=empty wrapper with Retry"
```

---

### Task 4: Apply AsyncBoundary — Leaderboard & Opening Explorer

**Files:**
- Modify: `frontend/src/pages/LeaderboardPage.tsx`
- Modify: `frontend/src/pages/OpeningExplorerPage.tsx`

- [ ] **Step 1: Rewrite `LeaderboardPage.tsx`**

Replace the entire file `frontend/src/pages/LeaderboardPage.tsx` with:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { getLeaderboard } from "../api/client";
import type { EnhancedModelStats } from "../types/api";
import { formatModelName } from "../utils/formatModel";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";

export default function LeaderboardPage() {
  const [showHuman, setShowHuman] = useState(true);
  const state = useAsync<EnhancedModelStats[]>(
    getLeaderboard,
    [],
    (d) => d.length === 0,
  );

  return (
    <div className="leaderboard-page">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.25rem" }}>
        <h1 className="leaderboard-page__title" style={{ marginBottom: 0 }}>Leaderboard</h1>
        <button
          className={`filter-btn${showHuman ? " filter-btn--active" : ""}`}
          onClick={() => setShowHuman(!showHuman)}
        >
          Include Human
        </button>
      </div>

      <AsyncBoundary
        state={state}
        empty={
          <div className="empty-state panel">
            <div className="empty-state__icon">&#9813;</div>
            <div className="empty-state__text">
              No models ranked yet. <Link to="/" className="leaderboard__model-link">Start a game</Link> to populate the board.
            </div>
          </div>
        }
      >
        {(models) => {
          const displayModels = showHuman ? models : models.filter((m) => m.id !== "Human");
          const maxElo = displayModels.length > 0 ? Math.max(...displayModels.map((m) => m.elo_rating)) : 1500;
          const minElo = displayModels.length > 0 ? Math.min(...displayModels.map((m) => m.elo_rating)) : 1500;
          const eloRange = maxElo - minElo || 1;

          if (displayModels.length === 0) {
            return (
              <div className="empty-state panel">
                <div className="empty-state__icon">&#9813;</div>
                <div className="empty-state__text">No models match this filter.</div>
              </div>
            );
          }

          return (
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
                    </tr>
                  </thead>
                  <tbody>
                    {displayModels.map((model, i) => {
                      const rank = i + 1;
                      const barWidth = Math.max(4, ((model.elo_rating - minElo) / eloRange) * 80);
                      const rankCls = rank <= 3 ? ` leaderboard__rank--${rank}` : "";
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
                            <span className="leaderboard__elo">{Math.round(model.elo_rating)}</span>
                            <span className="leaderboard__elo-bar" style={{ width: `${barWidth}px` }} />
                          </td>
                          <td>
                            <span className="leaderboard__record">
                              {model.wins} / {model.draws} / {model.losses}
                            </span>
                          </td>
                          <td>
                            <span className="leaderboard__winrate">{model.win_rate.toFixed(0)}%</span>
                          </td>
                          <td>
                            <span className="leaderboard__winrate">
                              {model.avg_accuracy != null ? `${model.avg_accuracy.toFixed(1)}%` : "--"}
                            </span>
                          </td>
                          <td>{model.avg_acpl != null ? model.avg_acpl.toFixed(1) : "--"}</td>
                          <td>${model.avg_cost_per_game.toFixed(4)}</td>
                          <td>{(model.avg_response_ms / 1000).toFixed(1)}s</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
```

- [ ] **Step 2: Rewrite `OpeningExplorerPage.tsx`**

Replace the entire file `frontend/src/pages/OpeningExplorerPage.tsx` with:

```tsx
import { useState } from "react";
import { Link } from "react-router-dom";
import { getOpeningStats } from "../api/client";
import type { OpeningStats } from "../types/api";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";

export default function OpeningExplorerPage() {
  const [sortBy, setSortBy] = useState<"games" | "white_wr" | "eco">("games");
  const state = useAsync<OpeningStats[]>(
    getOpeningStats,
    [],
    (d) => d.length === 0,
  );

  return (
    <div className="opening-explorer-page">
      <h1 className="opening-explorer-page__title">Opening Explorer</h1>
      <p className="opening-explorer-page__subtitle">
        Win rates by opening across all completed games.
      </p>

      <AsyncBoundary
        state={state}
        empty={
          <div className="empty-state panel">
            <div className="empty-state__icon">&#9816;</div>
            <div className="empty-state__text">
              No completed games with opening data yet. <Link to="/" className="opening-explorer-page__eco-link">Start a game</Link>.
            </div>
          </div>
        }
      >
        {(openings) => {
          const sorted = [...openings].sort((a, b) => {
            if (sortBy === "games") return b.total_games - a.total_games;
            if (sortBy === "eco") return a.eco.localeCompare(b.eco);
            const wrA = a.total_games > 0 ? a.white_wins / a.total_games : 0;
            const wrB = b.total_games > 0 ? b.white_wins / b.total_games : 0;
            return wrB - wrA;
          });

          return (
            <div className="opening-explorer-page__table-wrap panel">
              <table className="opening-explorer-page__table">
                <thead>
                  <tr>
                    <th onClick={() => setSortBy("eco")} className="opening-explorer-page__th--sortable">
                      ECO {sortBy === "eco" && "▲"}
                    </th>
                    <th>Opening</th>
                    <th onClick={() => setSortBy("games")} className="opening-explorer-page__th--sortable">
                      Games {sortBy === "games" && "▼"}
                    </th>
                    <th onClick={() => setSortBy("white_wr")} className="opening-explorer-page__th--sortable">
                      White WR {sortBy === "white_wr" && "▼"}
                    </th>
                    <th>Draw</th>
                    <th>Black WR</th>
                    <th>Result Bar</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((o) => {
                    const wPct = o.total_games > 0 ? (o.white_wins / o.total_games) * 100 : 0;
                    const dPct = o.total_games > 0 ? (o.draws / o.total_games) * 100 : 0;
                    const bPct = o.total_games > 0 ? (o.black_wins / o.total_games) * 100 : 0;
                    return (
                      <tr key={o.eco}>
                        <td>
                          <Link to={`/?opening=${o.eco}`} className="opening-explorer-page__eco-link">
                            {o.eco}
                          </Link>
                        </td>
                        <td className="opening-explorer-page__name">{o.name}</td>
                        <td>{o.total_games}</td>
                        <td>{wPct.toFixed(0)}%</td>
                        <td>{dPct.toFixed(0)}%</td>
                        <td>{bPct.toFixed(0)}%</td>
                        <td>
                          <div className="opening-explorer-page__result-bar">
                            <div className="opening-explorer-page__bar-w" style={{ width: `${wPct}%` }} />
                            <div className="opening-explorer-page__bar-d" style={{ width: `${dPct}%` }} />
                            <div className="opening-explorer-page__bar-b" style={{ width: `${bPct}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        }}
      </AsyncBoundary>
    </div>
  );
}
```

- [ ] **Step 3: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: passes with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/LeaderboardPage.tsx frontend/src/pages/OpeningExplorerPage.tsx && git commit -m "feat(pages): AsyncBoundary error!=empty on Leaderboard and Opening Explorer"
```

---

### Task 5: Apply AsyncBoundary — ModelDetail, CostDashboard, HeadToHead

**Files:**
- Modify: `frontend/src/pages/ModelDetailPage.tsx:1-47`
- Modify: `frontend/src/pages/CostDashboardPage.tsx:49-103`
- Modify: `frontend/src/pages/HeadToHeadPage.tsx:8-91,162-168`

- [ ] **Step 1: `ModelDetailPage` — swap the fetch + early returns**

In `frontend/src/pages/ModelDetailPage.tsx`, change the imports block (lines 1-12). Replace:

```tsx
import { lazy, Suspense, useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getModelDetail } from "../api/client";
import type { ModelDetailStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import HeadToHeadTable from "../components/model/HeadToHeadTable";
import ClassificationBadge from "../components/shared/ClassificationBadge";
import { formatModelName } from "../utils/formatModel";

const EloHistoryChart = lazy(() => import("../components/model/EloHistoryChart"));

const CLASS_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];
```

with:

```tsx
import { lazy, Suspense, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { getModelDetail } from "../api/client";
import type { ModelDetailStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import HeadToHeadTable from "../components/model/HeadToHeadTable";
import ClassificationBadge from "../components/shared/ClassificationBadge";
import { formatModelName } from "../utils/formatModel";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";

const EloHistoryChart = lazy(() => import("../components/model/EloHistoryChart"));

const CLASS_ORDER = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];
```

- [ ] **Step 2: `ModelDetailPage` — replace state/effect/early-returns with `useAsync` + boundary**

Replace lines 19-53 (from `const [model, setModel]` through the `const classEntries = …` definition) — i.e. everything from the state declarations down to just before `return (`. Replace this block:

```tsx
  const [model, setModel] = useState<ModelDetailStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getModelDetail(modelId)
      .then(setModel)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, [modelId]);

  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  if (error || !model) {
    return (
      <div className="empty-state panel">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">{error || "Model not found"}</div>
      </div>
    );
  }

  const classEntries = CLASS_ORDER.filter((c) => model.classifications[c]).map((c) => ({
    cls: c,
    count: model.classifications[c],
  }));

  return (
```

with:

```tsx
  const fetcher = useCallback(() => getModelDetail(modelId), [modelId]);
  const state = useAsync<ModelDetailStats>(fetcher, [modelId]);

  return (
    <AsyncBoundary
      state={state}
      empty={
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9888;</div>
          <div className="empty-state__text">Model not found.</div>
        </div>
      }
    >
      {(model) => {
        const classEntries = CLASS_ORDER.filter((c) => model.classifications[c]).map((c) => ({
          cls: c,
          count: model.classifications[c],
        }));
        return (
```

- [ ] **Step 3: `ModelDetailPage` — close the render-prop**

The component currently ends with the page `</div>` then `);` then `}`. Find the final lines (originally lines 161-163):

```tsx
    </div>
  );
}
```

Replace them with:

```tsx
          </div>
        );
      }}
    </AsyncBoundary>
  );
}
```

(Note: the existing top-level `<div className="model-detail-page">` is now nested one level deeper inside the render prop, so its closing tag gets two extra spaces of indentation — match the surrounding JSX. The build is the source of truth.)

- [ ] **Step 4: `CostDashboardPage` — swap the fetch + early returns**

In `frontend/src/pages/CostDashboardPage.tsx`, change the import line (line 1):

```tsx
import { useState, useEffect, useMemo } from "react";
```

to:

```tsx
import { useState, useMemo } from "react";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";
```

Then replace lines 49-61 (the state + effect):

```tsx
export default function CostDashboardPage() {
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  useEffect(() => {
    getStatsOverview()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load"))
      .finally(() => setLoading(false));
  }, []);
```

with:

```tsx
export default function CostDashboardPage() {
  const [sortKey, setSortKey] = useState<SortKey>("cost");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const state = useAsync<PlatformOverview>(
    getStatsOverview,
    [],
    (d) => d.total_completed === 0 && d.model_breakdowns.length === 0,
  );
  const data = state.data;
```

- [ ] **Step 5: `CostDashboardPage` — replace the loading + error early returns and gate the body on the boundary**

Replace lines 88-103 (both early-return blocks):

```tsx
  if (loading) {
    return (
      <div className="spinner-page">
        <div className="spinner-lg" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="empty-state panel">
        <div className="empty-state__icon">&#9888;</div>
        <div className="empty-state__text">{error || "No data available"}</div>
      </div>
    );
  }
```

with:

```tsx
  if (state.status !== "ready" || !data) {
    return (
      <div className="cost-dashboard">
        <h1 className="cost-dashboard__title">Cost & Performance</h1>
        <AsyncBoundary
          state={state}
          empty={
            <div className="empty-state panel">
              <div className="empty-state__icon">&#9816;</div>
              <div className="empty-state__text">No completed games yet — costs appear once games finish.</div>
            </div>
          }
        >
          {() => null}
        </AsyncBoundary>
      </div>
    );
  }
```

(`sortedBreakdowns` already guards on `!data` returning `[]`, so it is safe while loading; the early return above means the main JSX below only runs when `data` is non-null and ready.)

- [ ] **Step 6: `HeadToHeadPage` — model-list fetch keeps `.catch` (non-critical dropdown), but the comparison uses `useAsync`**

In `frontend/src/pages/HeadToHeadPage.tsx`, change the imports (lines 1-6):

```tsx
import { useState, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { compareModels, getLeaderboard } from "../api/client";
import type { HeadToHeadComparison, EnhancedModelStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import { formatModelName } from "../utils/formatModel";
```

to:

```tsx
import { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { compareModels, getLeaderboard } from "../api/client";
import type { HeadToHeadComparison, EnhancedModelStats } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import { formatModelName } from "../utils/formatModel";
import { useAsync } from "../hooks/useAsync";
import AsyncBoundary from "../components/shared/AsyncBoundary";
```

Then replace the comparison state/effect (lines 16-37):

```tsx
  const [comparison, setComparison] = useState<HeadToHeadComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch model list for dropdowns
  useEffect(() => {
    getLeaderboard().then(setModels).catch(() => {});
  }, []);

  // Auto-compare when URL params are set
  useEffect(() => {
    if (paramA && paramB) {
      setModelA(paramA);
      setModelB(paramB);
      setLoading(true);
      setError(null);
      compareModels(paramA, paramB)
        .then(setComparison)
        .catch((e) => setError(e instanceof Error ? e.message : "Failed"))
        .finally(() => setLoading(false));
    }
  }, [paramA, paramB]);
```

with:

```tsx
  // Fetch model list for dropdowns (non-critical; empty dropdown on failure)
  useEffect(() => {
    getLeaderboard().then(setModels).catch(() => {});
  }, []);

  // Sync the local selects to the URL params
  useEffect(() => {
    if (paramA && paramB) {
      setModelA(paramA);
      setModelB(paramB);
    }
  }, [paramA, paramB]);

  const fetcher = useCallback(
    () => compareModels(paramA, paramB),
    [paramA, paramB],
  );
  const compareState = useAsync<HeadToHeadComparison>(
    fetcher,
    [paramA, paramB],
    (c) => c.total_games === 0,
  );
  const comparison = paramA && paramB ? compareState.data : null;
```

- [ ] **Step 7: `HeadToHeadPage` — render through the boundary when params are set**

Replace lines 81-167 (everything from the `{loading && …}` block through the final `{!comparison && !loading && !error && (…)}` empty state). Replace this block:

```tsx
      {loading && (
        <div className="spinner-page"><div className="spinner-lg" /></div>
      )}

      {error && (
        <div className="empty-state panel">
          <div className="empty-state__text">{error}</div>
        </div>
      )}

      {comparison && !loading && (
        <>
```

…through the closing of the `comparison` block and the trailing empty state — i.e. replace from line 81 down to line 167 (the line with `</div>` that closes the final empty-state's `panel`, immediately before the page-closing `</div>` on line 168). Use this replacement:

```tsx
      {!paramA || !paramB ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">Select two models to compare their head-to-head record.</div>
        </div>
      ) : (
        <AsyncBoundary
          state={compareState}
          empty={
            <div className="empty-state panel">
              <div className="empty-state__icon">&#9816;</div>
              <div className="empty-state__text">These two models have not played each other yet.</div>
            </div>
          }
        >
          {(comparison) => {
            const total = comparison.total_games;
            return (
              <>
                {/* Score banner */}
                <div className="h2h-page__score panel">
                  <div className="h2h-page__score-side">
                    <div className="h2h-page__score-name">{formatModelName(comparison.model_a, comparison.model_a_display)}</div>
                    <div className="h2h-page__score-elo">{Math.round(comparison.model_a_elo)} ELO</div>
                  </div>
                  <div className="h2h-page__score-center">
                    <div className="h2h-page__score-record">
                      <span className="h2h-page__score-wins">{comparison.model_a_wins}</span>
                      <span className="h2h-page__score-draws">{comparison.draws}</span>
                      <span className="h2h-page__score-wins">{comparison.model_b_wins}</span>
                    </div>
                    <div className="h2h-page__score-labels">
                      <span>W</span><span>D</span><span>W</span>
                    </div>
                    {total > 0 && (
                      <div className="h2h-page__score-bar">
                        <div className="h2h-page__score-bar-a" style={{ width: `${(comparison.model_a_wins / total) * 100}%` }} />
                        <div className="h2h-page__score-bar-d" style={{ width: `${(comparison.draws / total) * 100}%` }} />
                        <div className="h2h-page__score-bar-b" style={{ width: `${(comparison.model_b_wins / total) * 100}%` }} />
                      </div>
                    )}
                    <div className="h2h-page__score-total">{total} game{total !== 1 ? "s" : ""}</div>
                  </div>
                  <div className="h2h-page__score-side">
                    <div className="h2h-page__score-name">{formatModelName(comparison.model_b, comparison.model_b_display)}</div>
                    <div className="h2h-page__score-elo">{Math.round(comparison.model_b_elo)} ELO</div>
                  </div>
                </div>

                {/* Stats comparison */}
                <div className="h2h-page__stats panel">
                  <div className="analysis-panel__title">Statistics</div>
                  <div className="analysis-panel__stats">
                    <div className="analysis-panel__stat-row">
                      <span className="analysis-panel__stat-val">
                        {comparison.model_a_avg_accuracy != null ? `${comparison.model_a_avg_accuracy.toFixed(1)}%` : "--"}
                      </span>
                      <span className="analysis-panel__stat-label">Accuracy</span>
                      <span className="analysis-panel__stat-val">
                        {comparison.model_b_avg_accuracy != null ? `${comparison.model_b_avg_accuracy.toFixed(1)}%` : "--"}
                      </span>
                    </div>
                    <div className="analysis-panel__stat-row">
                      <span className="analysis-panel__stat-val">
                        {comparison.model_a_avg_acpl != null ? comparison.model_a_avg_acpl.toFixed(1) : "--"}
                      </span>
                      <span className="analysis-panel__stat-label">Avg ACPL</span>
                      <span className="analysis-panel__stat-val">
                        {comparison.model_b_avg_acpl != null ? comparison.model_b_avg_acpl.toFixed(1) : "--"}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Recent games */}
                {comparison.recent_games.length > 0 && (
                  <div>
                    <div className="analysis-panel__title" style={{ marginBottom: "0.5rem" }}>Recent Games</div>
                    <div className="game-list">
                      {comparison.recent_games.map((g) => (
                        <GameCard key={g.id} game={g} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            );
          }}
        </AsyncBoundary>
      )}
```

(The `const total = comparison ? comparison.total_games : 0;` line at the old line 44 becomes dead — remove it if `tsc` flags it as unused; otherwise leave it. The `comparison` const from Step 6 is retained only so any remaining references compile; the build is the source of truth.)

- [ ] **Step 8: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: passes. Fix any unused-variable errors `tsc` reports (e.g. drop the now-unused `const total` at the top of `HeadToHeadPage` if flagged) until the build is green.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/ModelDetailPage.tsx frontend/src/pages/CostDashboardPage.tsx frontend/src/pages/HeadToHeadPage.tsx && git commit -m "feat(pages): AsyncBoundary on ModelDetail, CostDashboard, HeadToHead"
```

---

### Task 6: EloHistoryChart — distinguish error from "no rated games"

**Files:**
- Modify: `frontend/src/components/model/EloHistoryChart.tsx:1-24`

- [ ] **Step 1: Track an error and render a muted note instead of silently hiding**

Replace lines 1-24 (imports + state/effect + the two early returns). Replace:

```tsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { getEloHistory } from "../../api/client";
import type { EloHistoryPoint } from "../../types/api";

interface Props {
  modelId: string;
  currentElo: number;
}

export default function EloHistoryChart({ modelId, currentElo }: Props) {
  const [history, setHistory] = useState<EloHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getEloHistory(modelId)
      .then(setHistory)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [modelId]);

  if (loading) return null;
  if (history.length < 2) return null;
```

with:

```tsx
import { useState, useEffect } from "react";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { getEloHistory } from "../../api/client";
import type { EloHistoryPoint } from "../../types/api";

interface Props {
  modelId: string;
  currentElo: number;
}

export default function EloHistoryChart({ modelId, currentElo }: Props) {
  const [history, setHistory] = useState<EloHistoryPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getEloHistory(modelId)
      .then((h) => {
        if (!cancelled) setHistory(h);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load ELO history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelId]);

  if (loading) return null;

  if (error) {
    return (
      <div className="panel" style={{ padding: "1rem" }}>
        <div className="analysis-panel__title">ELO History</div>
        <div style={{ color: "var(--text-muted)", fontSize: "0.8rem", marginTop: "0.5rem" }}>
          {error}
        </div>
      </div>
    );
  }

  // Fewer than 2 rated games is a genuine empty state, not an error — stay hidden.
  if (history.length < 2) return null;
```

- [ ] **Step 2: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/model/EloHistoryChart.tsx && git commit -m "fix(model): EloHistoryChart shows error state, hides only on true-empty"
```

---

### Task 7: Dedup-merge in the MOVE_PLAYED reducer

**Files:**
- Modify: `frontend/src/hooks/useGameWebSocket.ts:184-204` (the `MOVE_PLAYED` case)

- [ ] **Step 1: Add a `mergeMove` helper above `gameReducer`**

In `frontend/src/hooks/useGameWebSocket.ts`, insert this function immediately before `function gameReducer(` (currently line 120):

```ts
/**
 * Merge a duplicate (moveNumber,color) move, preferring non-null eval/engine
 * data from either copy. A live move_played carries eval_after/engine_lines
 * that the DB-backed catch_up lacks, and vice-versa on reconnect — keep both.
 */
function mergeMove(existing: MoveData, incoming: MoveData): MoveData {
  const evalAfter = incoming.evalAfter ?? existing.evalAfter;
  const evalBefore = incoming.evalBefore ?? existing.evalBefore;
  return {
    ...existing,
    ...incoming,
    evalAfter,
    evalBefore,
    centipawns: incoming.centipawns ?? existing.centipawns,
    mateIn: incoming.mateIn ?? existing.mateIn,
    winProbability: incoming.winProbability ?? existing.winProbability,
    narration: incoming.narration ?? existing.narration,
    tableTalk: incoming.tableTalk ?? existing.tableTalk,
    classification: incoming.classification ?? existing.classification,
    bestMoveUci: incoming.bestMoveUci ?? existing.bestMoveUci,
  };
}
```

- [ ] **Step 2: Replace the `MOVE_PLAYED` case to merge instead of skip**

Replace the `MOVE_PLAYED` case (lines 184-204):

```ts
    case "MOVE_PLAYED": {
      const move = normalizeLiveMove(action.payload);
      // Deduplicate: if move already exists (from catch-up race), skip
      const exists = state.moves.some(
        (m) => m.moveNumber === move.moveNumber && m.color === move.color
      );
      if (exists) return state;

      const newMoves = [...state.moves, move];
      const newIdx = state.autoFollow ? newMoves.length - 1 : state.selectedIndex;
      return {
        ...state,
        moves: newMoves,
        currentFen: state.autoFollow ? move.fenAfter : state.currentFen,
        selectedIndex: newIdx,
        openingEco: move.openingEco ?? state.openingEco,
        openingName: move.openingName ?? state.openingName,
        awaitingHumanMove: null,
        statusMessage: null,
      };
    }
```

with:

```ts
    case "MOVE_PLAYED": {
      const move = normalizeLiveMove(action.payload);
      // Deduplicate on (moveNumber,color). If a duplicate exists (catch-up/live
      // race or reconnect), MERGE — preferring non-null eval/engine data from
      // either copy — instead of discarding the richer entry.
      const dupIdx = state.moves.findIndex(
        (m) => m.moveNumber === move.moveNumber && m.color === move.color
      );
      if (dupIdx !== -1) {
        const newMoves = state.moves.slice();
        newMoves[dupIdx] = mergeMove(newMoves[dupIdx], move);
        return { ...state, moves: newMoves };
      }

      const newMoves = [...state.moves, move];
      const newIdx = state.autoFollow ? newMoves.length - 1 : state.selectedIndex;
      return {
        ...state,
        moves: newMoves,
        currentFen: state.autoFollow ? move.fenAfter : state.currentFen,
        selectedIndex: newIdx,
        openingEco: move.openingEco ?? state.openingEco,
        openingName: move.openingName ?? state.openingName,
        awaitingHumanMove: null,
        statusMessage: null,
      };
    }
```

- [ ] **Step 2b: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useGameWebSocket.ts && git commit -m "fix(ws): merge duplicate moves so reconnect keeps engine lines and eval"
```

---

### Task 8: Live-connection banner with manual Reconnect

**Files:**
- Modify: `frontend/src/hooks/useGameWebSocket.ts:335-473` (hook body + return)
- Modify: `frontend/src/pages/GameViewerPage.tsx:114,310-322` (consume + render banner)
- Modify: `frontend/src/App.css` (add `.live-connection-banner` styles after the `.connecting-overlay__text` block, ~line 1744)

- [ ] **Step 1: Track reconnect exhaustion and expose a manual `reconnect`**

In `frontend/src/hooks/useGameWebSocket.ts`, replace the hook prologue (lines 335-345) — from `export function useGameWebSocket` through the line before the `useWebSocket(` call:

```ts
export function useGameWebSocket(gameId: string) {
  const [state, dispatch] = useReducer(gameReducer, initialState);

  // Use a ref for status to avoid stale closures in shouldReconnect
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/games/${gameId}`;

  const { readyState, sendJsonMessage } = useWebSocket(wsUrl, {
```

with:

```ts
export function useGameWebSocket(gameId: string) {
  const [state, dispatch] = useReducer(gameReducer, initialState);
  const [reconnectExhausted, setReconnectExhausted] = useState(false);
  // Bumping this nonce changes the WS URL, forcing react-use-websocket to
  // open a brand-new connection — our manual-reconnect mechanism.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  // Use a ref for status to avoid stale closures in shouldReconnect
  const statusRef = useRef(state.status);
  statusRef.current = state.status;

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/ws/games/${gameId}${
    reconnectNonce > 0 ? `?r=${reconnectNonce}` : ""
  }`;

  const { readyState, sendJsonMessage } = useWebSocket(wsUrl, {
```

- [ ] **Step 2: Add `useState` to the React import**

Change the first import line (line 1):

```ts
import { useReducer, useCallback, useEffect, useRef } from "react";
```

to:

```ts
import { useReducer, useCallback, useEffect, useRef, useState } from "react";
```

- [ ] **Step 3: Add `onReconnectStop` + clear-on-open to the options object**

Replace the options tail (lines 404-407):

```ts
    shouldReconnect: () => statusRef.current === "active" || statusRef.current === "queued" || statusRef.current === null,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
  });
```

with:

```ts
    shouldReconnect: () => statusRef.current === "active" || statusRef.current === "queued" || statusRef.current === null,
    reconnectAttempts: 10,
    reconnectInterval: 3000,
    onReconnectStop: () => setReconnectExhausted(true),
    onOpen: () => setReconnectExhausted(false),
  });
```

- [ ] **Step 4: Add the manual `reconnect` callback and export it**

Replace the return statement (line 472):

```ts
  return { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret };
```

with:

```ts
  const reconnect = useCallback(() => {
    setReconnectExhausted(false);
    setReconnectNonce((n) => n + 1);
  }, []);

  return { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret, reconnectExhausted, reconnect };
```

- [ ] **Step 5: Consume the new fields in `GameViewerPage`**

In `frontend/src/pages/GameViewerPage.tsx`, replace the hook destructure (line 114):

```tsx
  const { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret } = useGameWebSocket(gameId!);
```

with:

```tsx
  const { state, selectMove, navigate, toggleAutoFollow, submitMove, resign, isPlayer, playerSecret, reconnectExhausted, reconnect } = useGameWebSocket(gameId!);
```

- [ ] **Step 6: Render the banner — NOT gated on `!gameId`**

In `frontend/src/pages/GameViewerPage.tsx`, find the start of the main render (line 310-312):

```tsx
  return (
    <div className="game-viewer">
      <GameInfoHeader state={state} />
```

Replace it with (the banner shows for any disconnected-while-live game, including an already-loaded one):

```tsx
  const showReconnectBanner =
    state.connectionStatus === "disconnected" && (state.status === "active" || state.status === "queued");

  return (
    <div className="game-viewer">
      <GameInfoHeader state={state} />

      {showReconnectBanner && (
        <div className="live-connection-banner" role="status" aria-live="polite">
          <span className="live-connection-banner__dot" aria-hidden="true" />
          <span className="live-connection-banner__text">
            {reconnectExhausted
              ? "Live connection lost. Auto-reconnect gave up."
              : "Live connection lost — reconnecting…"}
          </span>
          {reconnectExhausted && (
            <button className="btn btn--ghost btn--sm live-connection-banner__btn" onClick={reconnect}>
              Reconnect
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 7: Add the CSS**

In `frontend/src/App.css`, immediately after the `.connecting-overlay__text { … }` rule (ends ~line 1744), insert:

```css
.live-connection-banner {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.55rem 0.9rem;
  margin-bottom: 0.75rem;
  border: 1px solid var(--border);
  border-left: 3px solid var(--amber);
  border-radius: 6px;
  background: var(--bg-elevated);
  font-size: 0.82rem;
  color: var(--text-secondary);
}

.live-connection-banner__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--amber);
  animation: pulse-glow 2s ease-in-out infinite;
}

.live-connection-banner__text {
  flex: 1;
}

.live-connection-banner__btn {
  white-space: nowrap;
}
```

- [ ] **Step 8: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: passes.

- [ ] **Step 9: Runtime check**

Start backend + frontend, start a game, open the viewer, then stop the backend.
Expected: within ~3s the amber "Live connection lost — reconnecting…" banner appears (and stays visible even though the game was already loaded — the old `!gameId` gate is gone). Restart the backend → the banner disappears on reconnect. To test exhaustion, leave the backend down >30s (10 attempts × 3s): the banner switches to "Auto-reconnect gave up." with a **Reconnect** button; clicking it (after the backend is back) re-opens the socket and re-runs catch-up.

- [ ] **Step 10: Commit**

```bash
git add frontend/src/hooks/useGameWebSocket.ts frontend/src/pages/GameViewerPage.tsx frontend/src/App.css && git commit -m "feat(viewer): reconnecting banner (not gated on !gameId) with manual Reconnect"
```

---

### Task 9: GameList polling hygiene — pause-on-hidden + backoff, no empty-on-error

**Files:**
- Modify: `frontend/src/pages/GameListPage.tsx:99-146,239-253`

- [ ] **Step 1: Track fetch errors on the first page**

In `frontend/src/pages/GameListPage.tsx`, add a `fetchError` state next to the other `useState` calls. After the line `const [dialogOpen, setDialogOpen] = useState(false);` (line 28), insert:

```tsx
  const [fetchError, setFetchError] = useState(false);
```

- [ ] **Step 2: Set/clear the error flag in `fetchFirstPage`**

Replace `fetchFirstPage` (lines 99-111):

```tsx
  const fetchFirstPage = useCallback(async () => {
    try {
      const params = buildApiParams();
      const data = await listGames(params as Parameters<typeof listGames>[0]);
      setGames(data.games);
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
    } catch {
      // silently fail, keep stale data
    } finally {
      setLoading(false);
    }
  }, [buildApiParams]);
```

with:

```tsx
  const fetchFirstPage = useCallback(async () => {
    try {
      const params = buildApiParams();
      const data = await listGames(params as Parameters<typeof listGames>[0]);
      setGames(data.games);
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
      setFetchError(false);
    } catch {
      setFetchError(true);
    } finally {
      setLoading(false);
    }
  }, [buildApiParams]);
```

- [ ] **Step 3: Replace the fixed-interval poll with a self-scheduling poll (pause-on-hidden + backoff)**

Replace the polling effect (lines 124-146):

```tsx
  // Poll for updates every 10s — refresh first page only
  useEffect(() => {
    const interval = setInterval(async () => {
      setTick((t) => t + 1);
      try {
        const f = filtersRef.current;
        const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: 0 };
        if (f.filter !== "all") params.status = f.filter;
        if (f.searchQuery) params.q = f.searchQuery;
        if (f.outcome) params.outcome = f.outcome;
        if (f.opening) params.opening = f.opening;
        const data = await listGames(params as Parameters<typeof listGames>[0]);
        setGames((prev) => {
          const loadedExtra = prev.slice(PAGE_SIZE);
          return [...data.games, ...loadedExtra];
        });
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
      } catch {
        // ignore
      }
    }, 10000);
    return () => clearInterval(interval);
  }, []);
```

with:

```tsx
  // Poll the first page on an interval, paused while the tab is hidden, with
  // exponential backoff on failure. Self-scheduling (setTimeout) so a hidden
  // tab fires no network calls and a failing backend doesn't hammer the API.
  useEffect(() => {
    const BASE_MS = 10_000;
    const MAX_MS = 60_000;
    let cancelled = false;
    let backoff = BASE_MS;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const schedule = (ms: number) => {
      if (cancelled) return;
      timer = setTimeout(tick, ms);
    };

    const tick = async () => {
      if (document.hidden) {
        schedule(BASE_MS);
        return;
      }
      setTick((t) => t + 1);
      try {
        const f = filtersRef.current;
        const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: 0 };
        if (f.filter !== "all") params.status = f.filter;
        if (f.searchQuery) params.q = f.searchQuery;
        if (f.outcome) params.outcome = f.outcome;
        if (f.opening) params.opening = f.opening;
        const data = await listGames(params as Parameters<typeof listGames>[0]);
        if (cancelled) return;
        setGames((prev) => {
          const loadedExtra = prev.slice(PAGE_SIZE);
          return [...data.games, ...loadedExtra];
        });
        setTotalCount(data.total_count);
        setHasMore(data.has_more);
        setFetchError(false);
        backoff = BASE_MS;
      } catch {
        if (cancelled) return;
        setFetchError(true);
        backoff = Math.min(backoff * 2, MAX_MS);
      }
      schedule(backoff);
    };

    schedule(BASE_MS);

    const onVisible = () => {
      if (document.hidden || cancelled) return;
      if (timer) clearTimeout(timer);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);
```

- [ ] **Step 4: Don't fall through to the empty state when the last fetch errored**

Replace the loading/empty render branch (lines 239-253):

```tsx
      {loading ? (
        <div className="spinner-page">
          <div className="spinner-lg" />
        </div>
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
        </div>
      ) : (
```

with:

```tsx
      {loading ? (
        <div className="spinner-page">
          <div className="spinner-lg" />
        </div>
      ) : games.length === 0 && fetchError ? (
        <div className="empty-state panel async-error">
          <div className="empty-state__icon">&#9888;</div>
          <div className="empty-state__text">Couldn't load games — the server may be unavailable.</div>
          <button className="btn btn--ghost btn--sm async-error__retry" onClick={() => { setLoading(true); fetchFirstPage(); }}>
            Retry
          </button>
        </div>
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
        </div>
      ) : (
```

- [ ] **Step 5: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: passes.

- [ ] **Step 6: Runtime check**

Open the games list. Switch the tab to background for >10s → no `GET /api/games` requests fire (check Network tab); refocus → a fetch fires immediately. Stop the backend with the list empty → the page shows an error panel with Retry (not the "No games yet" empty state) and poll intervals widen toward 60s.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/GameListPage.tsx && git commit -m "fix(gamelist): pause poll on hidden tab, backoff on error, error!=empty"
```

---

### Task 10: Backend — move-callback try/except + `_persist_move` lock-retry

**Files:**
- Modify: `backend/app/services/game_engine.py:353-354` (the `move_callbacks` loop)
- Modify: `backend/app/services/game_manager.py:617-654` (`_persist_move`)

- [ ] **Step 1: Wrap the move-callback dispatch in try/except (log + continue)**

In `backend/app/services/game_engine.py`, replace the callback loop (lines 353-354):

```python
            for cb in self.move_callbacks:
                await cb(record)
```

with (mirroring the illegal/chaos callback loops' resilience — a failing persistence/broadcast callback must never abort the game):

```python
            for cb in self.move_callbacks:
                try:
                    await cb(record)
                except Exception:
                    logger.exception(
                        "move_callback failed (move %d %s); continuing game",
                        record.move_number,
                        record.color,
                    )
```

- [ ] **Step 2: Confirm `logger` is defined in `game_engine.py`**

Run: `cd backend && grep -n "^logger = logging.getLogger" app/services/game_engine.py`
Expected: one match (a module-level `logger`). If absent, add `import logging` and `logger = logging.getLogger(__name__)` near the top; the file already logs (e.g. `logger.info` at lines 369/381/385), so this match should exist.

- [ ] **Step 3: Add a lock-retry to `_persist_move`**

In `backend/app/services/game_manager.py`, add the `OperationalError` import. Change line 11:

```python
from sqlalchemy import update as sa_update
```

to:

```python
from sqlalchemy import update as sa_update
from sqlalchemy.exc import OperationalError
```

Then replace the `_persist_move` method (lines 617-654). Replace:

```python
    async def _persist_move(self, game_id: str, record: MoveRecord) -> None:
        async with get_session_factory()() as session:
            move = Move(
```

…through its trailing `await session.commit()` (line 654). Use this replacement, which moves the insert into a helper and retries on `database is locked`:

```python
    async def _persist_move(self, game_id: str, record: MoveRecord) -> None:
        """Persist a move, retrying transient SQLite write-lock contention.

        A transient 'database is locked' must never abort the game; we retry
        a few times with a short backoff before giving up (and logging).
        """
        for attempt in range(1, 4):
            try:
                await self._persist_move_once(game_id, record)
                return
            except OperationalError as e:
                if "database is locked" in str(e).lower() and attempt < 3:
                    logger.warning(
                        "Game %s: move persist locked (attempt %d/3), retrying",
                        game_id,
                        attempt,
                    )
                    await asyncio.sleep(0.1 * attempt)
                    continue
                logger.exception("Game %s: move persist failed permanently", game_id)
                return

    async def _persist_move_once(self, game_id: str, record: MoveRecord) -> None:
        async with get_session_factory()() as session:
            move = Move(
                game_id=game_id,
                move_number=record.move_number,
                color=record.color,
                uci=record.uci,
                san=record.san,
                fen_after=record.fen_after,
                narration=record.narration,
                table_talk=record.table_talk,
                centipawns=record.eval_after.centipawns if record.eval_after else None,
                mate_in=record.eval_after.mate_in if record.eval_after else None,
                win_probability=record.eval_after.win_probability_white
                if record.eval_after
                else None,
                centipawns_before=record.eval_before.centipawns
                if record.eval_before
                else None,
                mate_in_before=record.eval_before.mate_in
                if record.eval_before
                else None,
                win_probability_before=record.eval_before.win_probability_white
                if record.eval_before
                else None,
                best_move_uci=record.best_move_uci,
                classification=record.classification,
                response_time_ms=record.response_time_ms,
                opening_eco=record.opening_eco,
                opening_name=record.opening_name,
                input_tokens=record.input_tokens,
                output_tokens=record.output_tokens,
                cost_usd=record.cost_usd,
                timestamp=datetime.now(timezone.utc),
                is_chaos_move=record.is_chaos_move,
            )
            session.add(move)
            await session.commit()
```

- [ ] **Step 4: Syntax-check both files**

Run:
```bash
cd backend && python3 -c "import ast; ast.parse(open('app/services/game_engine.py').read()); ast.parse(open('app/services/game_manager.py').read()); print('ok')"
```
Expected: prints `ok`. (Backend deps may not be installed locally — this is a syntax-only gate; the import-time check in later tasks confirms names resolve.)

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/game_engine.py backend/app/services/game_manager.py && git commit -m "fix(engine): guard move callbacks; retry _persist_move on db-locked"
```

---

### Task 11: Backend — idempotent terminal state + ELO folded into the result transaction

**Files:**
- Modify: `backend/app/services/game_manager.py:202-232` (`stop_game`)
- Modify: `backend/app/services/game_manager.py:488-564` (game-run success + error paths)
- Modify: `backend/app/services/game_manager.py:656-705` (`_persist_result`, `_update_elo`)

- [ ] **Step 1: Guard `stop_game` against double terminal writes**

In `backend/app/services/game_manager.py`, replace the DB-write block inside `stop_game` (lines 207-217):

```python
            total_moves = 0
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game:
                    game.status = "stopped"
                    game.outcome = "*"
                    game.termination = "stopped"
                    game.completed_at = datetime.now(timezone.utc)
                    total_moves = game.total_moves or 0
                    session.add(game)
                    await session.commit()
```

with:

```python
            total_moves = 0
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game:
                    # Idempotent: if a terminal write already landed, don't clobber it.
                    if game.status in {"completed", "stopped"}:
                        logger.info(
                            "Game %s: stop requested but already %s; skipping write",
                            game_id,
                            game.status,
                        )
                    else:
                        game.status = "stopped"
                        game.outcome = "*"
                        game.termination = "stopped"
                        game.completed_at = datetime.now(timezone.utc)
                        session.add(game)
                        await session.commit()
                    total_moves = game.total_moves or 0
```

- [ ] **Step 2: Make `_persist_result` idempotent and fold ELO into the same transaction**

Replace the `_persist_result` and `_update_elo` methods (lines 656-705). Replace this entire block:

```python
    async def _persist_result(self, game_id: str, result: GameResult) -> None:
        now = datetime.now(timezone.utc)
        async with get_session_factory()() as session:
            game = await session.get(Game, game_id)
            if game:
                game.status = "completed"
                game.outcome = result.outcome
                game.termination = result.termination
                game.opening_eco = result.opening_eco
                game.opening_name = result.opening_name
                game.pgn = result.pgn
                game.total_moves = result.total_moves
                game.total_cost_usd = result.total_cost_usd
                game.completed_at = now
                session.add(game)
                await session.commit()

    async def _update_elo(self, result: GameResult) -> None:
        """Update ELO ratings for both models after a game."""
        if "white_wins" in result.outcome:
            score_white = 1.0
        elif "black_wins" in result.outcome:
            score_white = 0.0
        else:
            score_white = 0.5

        async with get_session_factory()() as session:
            w = await session.get(LLMModel, result.white_model)
            b = await session.get(LLMModel, result.black_model)

            if not w or not b:
                return

            new_w, new_b = calculate_elo_change(w.elo_rating, b.elo_rating, score_white)

            w.elo_rating = new_w
            w.games_played += 1
            w.wins += 1 if score_white == 1.0 else 0
            w.draws += 1 if score_white == 0.5 else 0
            w.losses += 1 if score_white == 0.0 else 0
            session.add(w)

            b.elo_rating = new_b
            b.games_played += 1
            b.wins += 1 if score_white == 0.0 else 0
            b.draws += 1 if score_white == 0.5 else 0
            b.losses += 1 if score_white == 1.0 else 0
            session.add(b)

            await session.commit()
```

with (one transaction; `rated` flag guards ELO so it's applied at most once; returns `True` only when this call actually wrote the terminal state, so the caller can skip a redundant ELO update):

```python
    async def _persist_result(
        self, game_id: str, result: GameResult, apply_elo: bool = False
    ) -> bool:
        """Persist the terminal game state (idempotently) and optionally fold in
        the ELO update within the same transaction.

        Returns True only if this call performed the terminal write. If the row
        was already completed/stopped, returns False and does nothing — so ELO is
        applied at most once even if this path runs twice.
        """
        now = datetime.now(timezone.utc)
        async with get_session_factory()() as session:
            game = await session.get(Game, game_id)
            if not game:
                return False
            if game.status in {"completed", "stopped"}:
                logger.info(
                    "Game %s: result persist skipped (already %s)", game_id, game.status
                )
                return False

            game.status = "completed"
            game.outcome = result.outcome
            game.termination = result.termination
            game.opening_eco = result.opening_eco
            game.opening_name = result.opening_name
            game.pgn = result.pgn
            game.total_moves = result.total_moves
            game.total_cost_usd = result.total_cost_usd
            game.completed_at = now
            session.add(game)

            if apply_elo and not game.rated:
                await self._apply_elo(session, result)
                game.rated = True

            await session.commit()
            return True

    async def _apply_elo(self, session, result: GameResult) -> None:
        """Apply an ELO update to both models within the caller's session.

        Does not commit — the caller commits as part of the result transaction.
        """
        if "white_wins" in result.outcome:
            score_white = 1.0
        elif "black_wins" in result.outcome:
            score_white = 0.0
        else:
            score_white = 0.5

        w = await session.get(LLMModel, result.white_model)
        b = await session.get(LLMModel, result.black_model)
        if not w or not b:
            return

        new_w, new_b = calculate_elo_change(w.elo_rating, b.elo_rating, score_white)

        w.elo_rating = new_w
        w.games_played += 1
        w.wins += 1 if score_white == 1.0 else 0
        w.draws += 1 if score_white == 0.5 else 0
        w.losses += 1 if score_white == 0.0 else 0
        session.add(w)

        b.elo_rating = new_b
        b.games_played += 1
        b.wins += 1 if score_white == 0.0 else 0
        b.draws += 1 if score_white == 0.5 else 0
        b.losses += 1 if score_white == 1.0 else 0
        session.add(b)
```

- [ ] **Step 3: Add the `rated` column to the `Game` model**

`game.rated` must exist on the SQLModel. In `backend/app/database.py`, locate the `Game` class field list (search for `class Game(`). Add a `rated` boolean field next to the other terminal-state fields. Run first:

Run: `cd backend && grep -n "class Game\|total_cost_usd\|completed_at" app/database.py | head`
Expected: shows the `Game` class line and the `total_cost_usd` / `completed_at` field lines. Add this line immediately after the `completed_at` field declaration inside `class Game`:

```python
    rated: bool = Field(default=False)
```

(`Field` is already imported in `database.py` — it's used by every column. Confirm with `grep -n "from sqlmodel import" app/database.py`.)

- [ ] **Step 4: Register the `rated` column migration**

In `backend/app/database.py`, in the `migrations` list inside `_migrate_add_columns` (lines 137-156), append one entry after the last `("moves", …)` row:

```python
        ("games", "rated", "BOOLEAN DEFAULT 0"),
```

- [ ] **Step 5: Update the success path to use `apply_elo` and drop the separate `_update_elo` call**

In `_run_game_inner`, replace the success block (lines 498-525):

```python
            await self._persist_result(game_id, result)
            # Normalize model IDs for non-LLM sides before ELO update
            if config.white_is_stockfish:
                result.white_model = "Stockfish"
            elif config.white_is_human:
                result.white_model = "Human"
            if config.black_is_stockfish:
                result.black_model = "Stockfish"
            elif config.black_is_human:
                result.black_model = "Human"
            has_limited_sf = (
                config.white_stockfish_elo is not None
                or config.black_stockfish_elo is not None
            )
            skip_elo = config.chaos_mode or has_limited_sf
            reason = ""
            if skip_elo:
                reason = (
                    "chaos mode" if config.chaos_mode else "strength-limited Stockfish"
                )
                logger.info("Game %s: skipping ELO update (%s)", game_id, reason)
            else:
                await self._update_elo(result)
            logger.info(
                "Game %s: results persisted%s",
                game_id,
                f" (ELO skipped — {reason})" if skip_elo else " and ELO updated",
            )
```

with (normalize the model IDs *before* persisting, decide `skip_elo` first, then write result + ELO atomically):

```python
            # Normalize model IDs for non-LLM sides before persist/ELO
            if config.white_is_stockfish:
                result.white_model = "Stockfish"
            elif config.white_is_human:
                result.white_model = "Human"
            if config.black_is_stockfish:
                result.black_model = "Stockfish"
            elif config.black_is_human:
                result.black_model = "Human"
            has_limited_sf = (
                config.white_stockfish_elo is not None
                or config.black_stockfish_elo is not None
            )
            skip_elo = config.chaos_mode or has_limited_sf
            reason = ""
            if skip_elo:
                reason = (
                    "chaos mode" if config.chaos_mode else "strength-limited Stockfish"
                )
                logger.info("Game %s: skipping ELO update (%s)", game_id, reason)
            wrote = await self._persist_result(
                game_id, result, apply_elo=not skip_elo
            )
            logger.info(
                "Game %s: results persisted%s%s",
                game_id,
                "" if wrote else " (already terminal — skipped)",
                f" (ELO skipped — {reason})" if skip_elo else " and ELO updated",
            )
```

- [ ] **Step 6: Make the error handler idempotent too**

Replace the `except Exception:` DB block (lines 543-553):

```python
        except Exception:
            logger.exception("Game %s failed", game_id)
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game:
                    game.status = "completed"
                    game.outcome = "draw"
                    game.termination = "error"
                    game.completed_at = datetime.now(timezone.utc)
                    session.add(game)
                    await session.commit()
```

with:

```python
        except Exception:
            logger.exception("Game %s failed", game_id)
            async with get_session_factory()() as session:
                game = await session.get(Game, game_id)
                if game and game.status not in {"completed", "stopped"}:
                    game.status = "completed"
                    game.outcome = "*"
                    game.termination = "error"
                    game.completed_at = datetime.now(timezone.utc)
                    session.add(game)
                    await session.commit()
```

(Also flips the error outcome from a fake `"draw"` to `"*"`, consistent with stop/orphan — an errored game is aborted, not a real draw. The `game_over` broadcast below already sends `outcome: "draw"`; change that broadcast's `"draw"` to `"*"` and `total_moves` stays `0` — see next step.)

- [ ] **Step 7: Align the error `game_over` broadcast outcome**

Replace the error-path broadcast (lines 554-564):

```python
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": "draw",
                        "termination": "error",
                        "total_moves": 0,
                    },
                },
            )
```

with:

```python
            await self._broadcast(
                game_id,
                {
                    "type": "game_over",
                    "data": {
                        "outcome": "*",
                        "termination": "error",
                        "total_moves": 0,
                    },
                },
            )
```

- [ ] **Step 8: Syntax-check**

Run:
```bash
cd backend && python3 -c "import ast; ast.parse(open('app/services/game_manager.py').read()); ast.parse(open('app/database.py').read()); print('ok')"
```
Expected: prints `ok`.

- [ ] **Step 9: Commit**

```bash
git add backend/app/services/game_manager.py backend/app/database.py && git commit -m "fix(gamemanager): idempotent terminal writes; ELO folded into result txn, rated once"
```

---

### Task 12: Backend — slow-subscriber eviction sentinel

**Files:**
- Modify: `backend/app/services/game_manager.py:734-761` (`_broadcast`)

- [ ] **Step 1: Push a `None` sentinel to each evicted queue so the WS reader unblocks**

In `backend/app/services/game_manager.py`, replace the `_broadcast` method body — the `stale`-handling section (lines 748-753):

```python
        if stale:
            for q in stale:
                try:
                    self.event_queues.get(game_id, []).remove(q)
                except ValueError:
                    pass
```

with (the WS `_send_events` loop blocks on `queue.get()`; an evicted-but-full queue never receives another item, so the client hangs forever. Pushing `None` makes `_send_events` break out (see `ws.py:29`), closing the socket so the client reconnects and re-catches-up):

```python
        if stale:
            for q in stale:
                try:
                    self.event_queues.get(game_id, []).remove(q)
                except ValueError:
                    pass
                # Wake the WS reader blocked on queue.get() so it terminates and
                # the client reconnects + re-catches-up, instead of hanging.
                try:
                    q.get_nowait()  # drain one slot so the sentinel fits
                except asyncio.QueueEmpty:
                    pass
                try:
                    q.put_nowait(None)
                except asyncio.QueueFull:
                    pass
```

- [ ] **Step 2: Verify the WS reader already honors the `None` sentinel**

Run: `cd backend && grep -n "if event is None" app/routers/ws.py`
Expected: a match in `_send_events` (around line 29) — `if event is None: … break`. This confirms no change is needed in `ws.py`; the sentinel terminates the forwarder cleanly. (`asyncio.QueueEmpty`/`asyncio.QueueFull` are already available — `asyncio` is imported at the top of `game_manager.py`.)

- [ ] **Step 3: Syntax-check**

Run: `cd backend && python3 -c "import ast; ast.parse(open('app/services/game_manager.py').read()); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/game_manager.py && git commit -m "fix(broadcast): push None sentinel to evicted slow subscribers so WS reader unblocks"
```

---

### Task 13: Backend — bounded, turn-aware human-move queue with error event

**Files:**
- Modify: `backend/app/services/game_manager.py:245-252` (`submit_human_move`)
- Modify: `backend/app/services/game_manager.py:384-387` (human queue creation in `_run_game_inner`)
- Modify: `backend/app/routers/ws.py:51-71` (relay the result + send an `error` event back)

- [ ] **Step 1: Bound the human-move queue**

In `backend/app/services/game_manager.py`, replace the queue creation (lines 385-387) inside `_run_game_inner`:

```python
        if config.white_is_human or config.black_is_human:
            human_queue = asyncio.Queue()
            self.human_move_queues[game_id] = human_queue
```

with (a small bound prevents a flood of queued submissions from piling up; a human only ever has one move pending):

```python
        if config.white_is_human or config.black_is_human:
            human_queue = asyncio.Queue(maxsize=2)
            self.human_move_queues[game_id] = human_queue
```

- [ ] **Step 2: Make `submit_human_move` turn-aware and bounded; return a typed reason**

Replace the `submit_human_move` method (lines 245-252):

```python
    async def submit_human_move(self, game_id: str, uci: str) -> bool:
        """Submit a human move for an active game. Returns True if queued."""
        queue = self.human_move_queues.get(game_id)
        if queue is None:
            logger.warning("Game %s: human move submitted but no queue exists", game_id)
            return False
        await queue.put(uci)
        return True
```

with (rejects when the game isn't running, isn't awaiting a human, or the queue is saturated; `"resign"` is always allowed through if the game is awaiting a human):

```python
    async def submit_human_move(
        self, game_id: str, uci: str, color: str | None = None
    ) -> tuple[bool, str | None]:
        """Submit a human move for an active game.

        Returns (accepted, reason). `reason` is a short message to relay back to
        the client when rejected, so the UI can re-enable the board.
        """
        queue = self.human_move_queues.get(game_id)
        if queue is None:
            logger.warning("Game %s: human move submitted but no queue exists", game_id)
            return False, "This game is not accepting moves."

        # The game must currently be awaiting a human move.
        awaiting = self._awaiting_human_move.get(game_id)
        if awaiting is None:
            return False, "It is not your turn yet."

        # If the caller's color is known, it must match the side to move.
        if color is not None and color != awaiting and uci != "resign":
            return False, "It is not your turn yet."

        try:
            queue.put_nowait(uci)
        except asyncio.QueueFull:
            logger.warning("Game %s: human move queue full, rejecting", game_id)
            return False, "A move is already being processed — try again."
        return True, None
```

- [ ] **Step 3: Relay the rejection back over the WebSocket as an `error` event**

In `backend/app/routers/ws.py`, replace the `human_move` handling block (lines 64-71):

```python
            uci = msg.get("uci", "").strip()
            if uci:
                logger.info(
                    "WebSocket human move received: game=%s, uci=%s", game_id, uci
                )
                await manager.submit_human_move(game_id, uci)
            else:
                logger.warning("WebSocket human_move missing uci: game=%s", game_id)
```

with:

```python
            uci = msg.get("uci", "").strip()
            if uci:
                logger.info(
                    "WebSocket human move received: game=%s, uci=%s", game_id, uci
                )
                accepted, reason = await manager.submit_human_move(game_id, uci)
                if not accepted:
                    await websocket.send_text(
                        json.dumps(
                            {
                                "type": "error",
                                "data": {"message": reason or "Move not accepted"},
                            }
                        )
                    )
            else:
                logger.warning("WebSocket human_move missing uci: game=%s", game_id)
```

- [ ] **Step 4: Update the `resign` call to the new return shape**

In `backend/app/routers/ws.py`, replace the resign relay (line 86):

```python
            await manager.submit_human_move(game_id, "resign")
```

with (resignation is always allowed if a human move is pending; ignore the reason):

```python
            await manager.submit_human_move(game_id, "resign")  # tuple result ignored
```

(No behavioral change needed for resign — it returns a tuple now but the value is discarded. If a stricter check is desired later, inspect the `accepted` flag.)

- [ ] **Step 5: Reject submissions while the game is still `queued`**

The turn-aware guard in Step 2 already rejects when `_awaiting_human_move[game_id]` is `None`, which is the case for a `queued` game (the engine only sets it once running and awaiting a human). No extra code needed; this step is a verification:

Run: `cd backend && grep -n "_awaiting_human_move\[game_id\] = color\|self._awaiting_human_move.pop" app/services/game_manager.py`
Expected: shows the callback sets `_awaiting_human_move[game_id] = color` (in `on_awaiting_human_move`, ~line 434) and pops it on each move (`on_move`, ~line 411) / cleanup. Confirms a queued game has no awaiting entry, so submissions are rejected with "It is not your turn yet."

- [ ] **Step 6: Add an `error` case to the frontend WS handler so the board re-enables**

In `frontend/src/hooks/useGameWebSocket.ts`, in the `onMessage` switch (after the `spectator_count` case, ~line 398), add:

```ts
          case "error":
            // Server rejected a move (wrong turn, not running, queue full) or
            // auth failed. Surface it as a status message and clear any
            // awaiting-human latch so the board re-enables for another try.
            dispatch({ type: "STATUS_UPDATE", payload: { message: msg.data?.message ?? "Move not accepted" } });
            break;
```

(`STATUS_UPDATE` already exists and is shown in the viewer's status panel. The `awaiting_human_move` server event re-fires on rejection from the engine path; this just makes the spectator-visible message clear. No new action type or reducer change is required.)

- [ ] **Step 7: Syntax-check backend + typecheck frontend**

Run:
```bash
cd backend && python3 -c "import ast; ast.parse(open('app/services/game_manager.py').read()); ast.parse(open('app/routers/ws.py').read()); print('ok')"
```
Expected: prints `ok`. Then:

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add backend/app/services/game_manager.py backend/app/routers/ws.py frontend/src/hooks/useGameWebSocket.ts && git commit -m "fix(human-move): bounded turn-aware queue; error event re-enables the board"
```

---

### Task 14: Backend — honest orphan recovery (`"*"` / `server_restart`, not fake draw)

**Files:**
- Modify: `backend/app/services/game_manager.py:74-89` (`recover_orphaned_games`)

- [ ] **Step 1: Record orphaned games as aborted, not as a draw**

In `backend/app/services/game_manager.py`, replace the orphan write (lines 83-85):

```python
                    game.status = "completed"
                    game.outcome = "draw"
                    game.termination = "server_restart"
```

with (a server restart aborts the game; counting it as a real `draw` corrupts analytics. Use the same `"*"` no-result outcome as `stop_game`, and mark it `stopped` so it is excluded from rated/win-rate stats just like a manual stop):

```python
                    game.status = "stopped"
                    game.outcome = "*"
                    game.termination = "server_restart"
```

- [ ] **Step 2: Verify the analytics/stats paths already exclude non-`completed` or `"*"` games**

Run: `cd backend && grep -rn "outcome ==\|status == \"completed\"\|!= \"\\*\"\|outcome != " app/services/stats_service.py app/routers/models.py | head -20`
Expected: stats/leaderboard queries filter on `status == "completed"` and/or real outcomes (`white_wins`/`black_wins`/`draw`). Marking orphans `stopped`/`"*"` keeps them out of those aggregates. If any query counts `status == "completed"` regardless of outcome and would now miss these (previously they were `completed`), note it — but the intent (don't count aborted games as draws) is satisfied by the `"*"` outcome regardless.

- [ ] **Step 3: Syntax-check**

Run: `cd backend && python3 -c "import ast; ast.parse(open('app/services/game_manager.py').read()); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/app/services/game_manager.py && git commit -m "fix(recovery): orphaned games recorded as */server_restart, not fake draw"
```

---

### Task 15: Backend — robust migrations via PRAGMA + re-raise on real errors

**Files:**
- Modify: `backend/app/database.py:133-171` (`_migrate_add_columns`)

- [ ] **Step 1: Detect existing columns via `PRAGMA table_info` and re-raise non-duplicate errors**

In `backend/app/database.py`, replace the body of `_migrate_add_columns` from the `for table, column, col_type in migrations:` loop (line 157) through the end of the function (line 171). Replace:

```python
    for table, column, col_type in migrations:
        try:
            await conn.execute(
                sqlalchemy.text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
            )
        except Exception as e:
            err_msg = str(e).lower()
            if "duplicate column" in err_msg or "already exists" in err_msg:
                pass  # Column already exists — expected
            else:
                import logging

                logging.getLogger(__name__).warning(
                    "Migration failed for %s.%s: %s", table, column, e
                )
```

with (query the live schema first; only ADD COLUMN when truly missing; let any genuine error propagate so a half-migrated schema fails loudly at startup instead of silently):

```python
    logger = logging.getLogger(__name__)

    # Cache existing columns per table via PRAGMA table_info (row index 1 = name).
    existing_columns: dict[str, set[str]] = {}

    async def columns_for(table: str) -> set[str]:
        if table not in existing_columns:
            result = await conn.execute(
                sqlalchemy.text(f"PRAGMA table_info({table})")
            )
            existing_columns[table] = {row[1] for row in result.fetchall()}
        return existing_columns[table]

    for table, column, col_type in migrations:
        cols = await columns_for(table)
        if column in cols:
            continue  # Already present — nothing to do.
        try:
            await conn.execute(
                sqlalchemy.text(f"ALTER TABLE {table} ADD COLUMN {column} {col_type}")
            )
            cols.add(column)
            logger.info("Migration: added %s.%s (%s)", table, column, col_type)
        except Exception:
            # A non-duplicate failure means the schema is half-migrated; fail
            # loudly at startup rather than limping along.
            logger.exception("Migration failed for %s.%s — aborting", table, column)
            raise
```

- [ ] **Step 2: Ensure `logging` is imported at module scope**

The original code did `import logging` inside the `except`. The replacement uses `logging` at the top of the function. Confirm a module-level import exists:

Run: `cd backend && grep -n "^import logging\|^import sqlalchemy" app/database.py`
Expected: a top-level `import logging`. If only the in-function `import sqlalchemy` exists (line 135) and there's no module-level `import logging`, add `import logging` to the top imports of `database.py`. (`sqlalchemy` is imported inside `_migrate_add_columns` at line 135 — keep that; the PRAGMA + ALTER both use `sqlalchemy.text`.)

- [ ] **Step 3: Syntax-check**

Run: `cd backend && python3 -c "import ast; ast.parse(open('app/database.py').read()); print('ok')"`
Expected: prints `ok`.

- [ ] **Step 4: Runtime check (if backend deps installed)**

Run (from `backend/`, with a `.env`): start the server once (`uvicorn app.main:app --port 8000 &`), let it init, then stop it (`kill %1`). Start it a second time.
Expected: both startups succeed with no "Migration failed" errors; the second startup logs no "added …" lines (all columns already present, detected via PRAGMA). If deps are not installed, skip — the syntax check + inspection is the gate (note this in the task log).

- [ ] **Step 5: Commit**

```bash
git add backend/app/database.py && git commit -m "fix(db): PRAGMA-based migration detection; re-raise on non-duplicate errors"
```

---

## Self-Review

**Spec coverage (Workstream 1) — every item mapped to a task:**

- **P2 `useAsync` + `<AsyncBoundary>`** (Shared Primitive owned by WS1) → Tasks 2 & 3. `useAsync` returns the exact `{ status: 'loading'|'error'|'empty'|'ready', data, error, reload }` shape; `<AsyncBoundary>` renders skeleton/error+Retry/empty/children using existing `.panel`, `.spinner-lg`, `.empty-state`, `.btn--ghost`/`.btn--sm` classes (no restyle).
- **P3 typed `ApiError`** (Shared Primitive owned by WS1) → Task 1. `ApiError extends Error { status; retryAfter?; body? }`; reads `Retry-After` on 429 ("Rate limited — retrying in Ns"); maps `AbortError` → "Request timed out — check your connection."; pages render `error.message`.
- **WS1.1 Real async states on the listed pages** → Leaderboard + OpeningExplorer (Task 4), ModelDetail + CostDashboard + HeadToHead (Task 5), EloHistoryChart (Task 6). Each distinguishes error (with Retry) from empty.
- **WS1.2 Live-connection banner, not gated on `!gameId`, manual Reconnect on exhaustion** → Task 8. Banner shows whenever `connectionStatus === "disconnected"` while `status` is `active`/`queued`; `onReconnectStop` sets `reconnectExhausted` → shows a **Reconnect** button that bumps a URL nonce to force a fresh socket. The old `!state.gameId` overlay gate is bypassed for the banner.
- **WS1.3 GameList polling hygiene** → Task 9. Self-scheduling poll paused on `document.hidden`; exponential backoff (10s→60s) on failure; `fetchError` flag prevents falling through to the "No games" empty state (shows an error panel with Retry instead).
- **WS1.4 Dedup MERGE in `MOVE_PLAYED`** → Task 7. On a `(moveNumber,color)` dup, `mergeMove` keeps non-null `evalAfter`/`evalBefore` (hence `engine_lines`) and other richer fields from either copy instead of discarding.
- **WS1.5 Move-persist resilience** → Task 10. Move-callback loop wrapped in try/except (log + continue), mirroring the illegal/chaos loops; `_persist_move` retries `_persist_move_once` on `OperationalError` containing "database is locked".
- **WS1.6 Idempotent terminal state + ELO in result txn, rated once** → Task 11. `stop_game`, `_persist_result`, and the error handler each guard `if game.status in {"completed","stopped"}`; `_persist_result(apply_elo=...)` folds `_apply_elo` into the same session/commit and gates on `not game.rated`, setting `game.rated = True` (new column + migration added).
- **WS1.7 Slow-subscriber eviction sentinel** → Task 12. On eviction, drain one slot and `put_nowait(None)`; `ws.py:29` already breaks on `None`, so `_send_events` terminates and the client reconnects + re-catches-up instead of blocking on `queue.get()`.
- **WS1.8 Bounded, turn-aware human-move queue + error event** → Task 13. Queue is `maxsize=2`; `submit_human_move` rejects when not awaiting a human (covers the `queued` state), when color mismatches the side to move, or when the queue is full, returning `(accepted, reason)`; `ws.py` relays an `error` event; the frontend `error` case surfaces it so the board re-enables.
- **WS1.9 Honest orphan recovery** → Task 14. Orphans recorded as `outcome="*"`, `termination="server_restart"`, `status="stopped"` (not a fake `draw`), keeping aborted games out of draw analytics.
- **WS1.10 Migration robustness** → Task 15. `_migrate_add_columns` detects columns via `PRAGMA table_info` and `raise`s on any non-duplicate error so a half-migrated schema fails loudly at startup.

**Placeholder scan:** None. Every code step shows complete, runnable code; every backend task has a syntax-check gate and every frontend task a `tsc -b`/`npm run build` gate; each task ends with an exact `git add … && git commit` step.

**Type / name consistency:**
- `ApiError` (Task 1) is the error surfaced via `useAsync`'s `error: Error | null` (Task 2) and rendered as `state.error?.message` by `<AsyncBoundary>` (Task 3) — `ApiError extends Error`, so the type lines up.
- `AsyncState<T>` (`status`/`data`/`error`/`reload`) is produced by `useAsync` and consumed by `<AsyncBoundary state={…}>` and by `CostDashboardPage`'s `state.status !== "ready"` check — identical field names.
- `useAsync` `isEmpty` predicates match the real types: `EnhancedModelStats[]` (`d.length === 0`), `OpeningStats[]` (`d.length === 0`), `PlatformOverview` (`total_completed`/`model_breakdowns` — verified fields in `CostDashboardPage`), `HeadToHeadComparison` (`total_games` — verified field), `ModelDetailStats` (no empty predicate; "not found" is the error/empty path).
- `useGameWebSocket` return adds `reconnectExhausted: boolean` and `reconnect: () => void`; `GameViewerPage` destructures both with matching names (Task 8). The merge helper uses `MoveData` field names exactly as defined in `frontend/src/types/websocket.ts` (`evalAfter`, `evalBefore`, `centipawns`, `mateIn`, `winProbability`, `narration`, `tableTalk`, `classification`, `bestMoveUci`).
- Backend: `submit_human_move` now returns `tuple[bool, str | None]`; both call sites in `ws.py` (Tasks 13.3/13.4) are updated. `_persist_result(game_id, result, apply_elo=...)` and the new `_apply_elo(session, result)` replace the old `_update_elo`; the only caller (`_run_game_inner`, Task 11.5) is updated and no other reference to `_update_elo` remains (verify with `grep -n "_update_elo" app/services/game_manager.py` returning no hits after edits). `game.rated` is backed by the new `rated` SQLModel field + migration (Task 11.3/11.4).
- The `None` sentinel pushed in `_broadcast` (Task 12) is exactly what `_send_events` checks for in `ws.py` (`if event is None: … break`, verified line 29).

**War-room style preserved:** All new states reuse existing classes (`.panel`, `.empty-state`, `.empty-state__icon`, `.empty-state__text`, `.spinner-lg`, `.spinner-page`, `.btn--ghost`, `.btn--sm`). New CSS (`.async-error`, `.async-skeleton`, `.live-connection-banner`) uses existing design tokens (`--amber`, `--border`, `--bg-elevated`, `--text-muted`/`--text-secondary`) and the existing reduced-motion-safe `pulse-glow` keyframe; no colors, fonts, radii, or borders are restyled.
