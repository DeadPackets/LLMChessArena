# Live Navbar Counter (Workstream 0) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a live "N live · N watching · N played" activity counter next to the logo in the navbar, updating on a polite poll.

**Architecture:** Extend the existing `GET /api/games/queue-status` endpoint with two new fields (`total_spectators`, aggregated from `GameManager.event_queues`; `total_games`, a `COUNT(*)` over the `games` table). A new `useLiveStats` hook polls that endpoint every 10s, pausing when the tab is hidden and hiding the counter on error. `Header` renders the counts.

**Tech Stack:** FastAPI + SQLModel (backend), React 19 + TypeScript + Vite (frontend). No test framework exists in this repo; verification is `npm run build` (`tsc -b`) plus runtime checks (curl the endpoint, view the header). Run the backend from `backend/` (the SQLite path is cwd-relative).

**Spec:** `docs/superpowers/specs/2026-06-03-polish-to-100-design.md` (Workstream 0).

---

### Task 1: Backend — aggregate global spectators

**Files:**
- Modify: `backend/app/services/game_manager.py` (add method near `get_spectator_count`, ~line 185)

- [ ] **Step 1: Add `total_spectators()` to `GameManager`**

Insert this method directly after the existing `get_spectator_count` method (around line 186):

```python
    def total_spectators(self) -> int:
        """Total live WebSocket spectators across all games."""
        return sum(len(queues) for queues in self.event_queues.values())
```

- [ ] **Step 2: Sanity-check it imports**

Run: `cd backend && python -c "from app.services.game_manager import GameManager; print('ok')"`
Expected: prints `ok` (no import/syntax error).

- [ ] **Step 3: Commit**

```bash
git add backend/app/services/game_manager.py
git commit -m "feat(stats): add GameManager.total_spectators aggregate"
```

---

### Task 2: Backend — extend the queue-status endpoint

**Files:**
- Modify: `backend/app/routers/games.py:237-241` (the `queue_status` endpoint)

The endpoint currently is:

```python
@router.get("/queue-status")
async def queue_status(request: Request):
    """Return the current game queue state."""
    manager = request.app.state.game_manager
    return manager.queue_status()
```

- [ ] **Step 1: Replace it with the version that adds live counts**

The needed imports already exist at the top of this file: `Depends`, `Request` (fastapi), `func` (sqlalchemy), `select` (sqlmodel), `Game`, `get_session`, and `AsyncSession`. Replace the endpoint body:

```python
@router.get("/queue-status")
async def queue_status(
    request: Request, session: AsyncSession = Depends(get_session)
):
    """Return the current game queue state plus live activity counts."""
    manager = request.app.state.game_manager
    state = manager.queue_status()
    total_games = (
        await session.exec(select(func.count()).select_from(Game))
    ).one()
    state["total_spectators"] = manager.total_spectators()
    state["total_games"] = int(total_games)
    return state
```

- [ ] **Step 2: Verify the imports are present** (only if Step 1's edit raised a NameError later)

Run: `cd backend && grep -nE "from sqlalchemy import func|from sqlmodel import select|get_session|AsyncSession" app/routers/games.py`
Expected: matches for `func`, `select`, `get_session`, and `AsyncSession`. If `func` is missing, add `from sqlalchemy import func` near the other sqlalchemy import.

- [ ] **Step 3: Start the backend and curl the endpoint**

Run (from `backend/`, with a `.env` present): `uvicorn app.main:app --port 8000 &` then `sleep 3 && curl -s localhost:8000/api/games/queue-status`
Expected JSON includes all of: `active`, `queued`, `max`, `max_queued`, `total_spectators`, `total_games` (e.g. `{"active":0,"queued":0,"max":3,"max_queued":25,"total_spectators":0,"total_games":0}`). Stop the server afterward (`kill %1`).

- [ ] **Step 4: Commit**

```bash
git add backend/app/routers/games.py
git commit -m "feat(api): include total_spectators and total_games in queue-status"
```

---

### Task 3: Frontend — types + API client function

**Files:**
- Modify: `frontend/src/types/api.ts` (append a `QueueStatus` interface)
- Modify: `frontend/src/api/client.ts` (add `getQueueStatus`)

- [ ] **Step 1: Add the `QueueStatus` type**

Append to the end of `frontend/src/types/api.ts`:

```ts
export interface QueueStatus {
  active: number;
  queued: number;
  max: number;
  max_queued: number;
  total_spectators: number;
  total_games: number;
}
```

- [ ] **Step 2: Add the client function**

In `frontend/src/api/client.ts`, add `QueueStatus` to the existing type import on line 1 (append `, QueueStatus` inside the `import type { ... }` list), then add this function (next to the other `request<...>` wrappers, e.g. after `getStatsOverview`):

```ts
export async function getQueueStatus(): Promise<QueueStatus> {
  return request<QueueStatus>("/games/queue-status");
}
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: completes with no errors. (If `node_modules` is missing, run `npm install` first.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/types/api.ts frontend/src/api/client.ts
git commit -m "feat(api-client): QueueStatus type and getQueueStatus fetch"
```

---

### Task 4: Frontend — `useLiveStats` polling hook

**Files:**
- Create: `frontend/src/hooks/useLiveStats.ts`

- [ ] **Step 1: Create the hook**

Create `frontend/src/hooks/useLiveStats.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { getQueueStatus } from "../api/client";
import type { QueueStatus } from "../types/api";

/**
 * Polls /api/games/queue-status for ambient live-activity counts.
 * Pauses while the tab is hidden; backs off and hides (returns null) on error.
 */
export function useLiveStats(intervalMs = 10_000): QueueStatus | null {
  const [stats, setStats] = useState<QueueStatus | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    let backoff = intervalMs;

    function schedule(ms: number) {
      if (cancelled) return;
      timer.current = window.setTimeout(tick, ms);
    }

    async function tick() {
      if (document.hidden) {
        schedule(intervalMs);
        return;
      }
      try {
        const s = await getQueueStatus();
        if (cancelled) return;
        setStats(s);
        backoff = intervalMs;
      } catch {
        if (cancelled) return;
        setStats(null); // hide the counter rather than show stale/broken data
        backoff = Math.min(backoff * 2, 60_000);
      }
      schedule(backoff);
    }

    tick();

    const onVisible = () => {
      if (document.hidden) return;
      if (timer.current) window.clearTimeout(timer.current);
      tick();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [intervalMs]);

  return stats;
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/useLiveStats.ts
git commit -m "feat(header): useLiveStats polling hook"
```

---

### Task 5: Frontend — render the counter in the Header

**Files:**
- Modify: `frontend/src/components/layout/Header.tsx`
- Modify: `frontend/src/App.css` (add header counter styles after the `.app-header__logo-icon` block, ~line 112)

- [ ] **Step 1: Wire the hook + markup into `Header.tsx`**

Add the import at the top:

```ts
import { useLiveStats } from "../../hooks/useLiveStats";
```

Replace the opening of the component (the `<header>` … `</NavLink>` for the logo) so the logo and counter sit in a left "brand" group. Change:

```tsx
export default function Header() {
  return (
    <header className="app-header">
      <NavLink to="/" className="app-header__logo">
        <span className="app-header__logo-icon">&#9816;</span>
        LLM Chess Arena
      </NavLink>
      <nav className="app-header__nav">
```

to:

```tsx
export default function Header() {
  const stats = useLiveStats();
  return (
    <header className="app-header">
      <div className="app-header__brand">
        <NavLink to="/" className="app-header__logo">
          <span className="app-header__logo-icon">&#9816;</span>
          LLM Chess Arena
        </NavLink>
        {stats && (
          <div className="app-header__live-stats" aria-label="Live activity">
            <NavLink
              to="/?status=active"
              className="app-header__live-stat"
              title="Games in progress now"
            >
              <span
                className={`app-header__live-dot${
                  stats.active > 0 ? " app-header__live-dot--on" : ""
                }`}
              />
              {stats.active} live
            </NavLink>
            <span className="app-header__live-sep" aria-hidden="true">·</span>
            <span className="app-header__live-stat" title="People watching right now">
              {stats.total_spectators} watching
            </span>
            <span className="app-header__live-sep" aria-hidden="true">·</span>
            <span className="app-header__live-stat" title="Total games played">
              {stats.total_games.toLocaleString()} played
            </span>
          </div>
        )}
      </div>
      <nav className="app-header__nav">
```

Add the matching closing `</div>` for `.app-header__brand`: the existing JSX closes `</nav>` then `</header>`; insert `</div>` is NOT needed there because `.app-header__brand` wraps only the logo + stats and is closed right before `<nav>`. Concretely, ensure the structure is: `<div className="app-header__brand"> …logo + stats… </div>` then `<nav> … </nav>` then `</header>`. (The `</div>` belongs immediately before `<nav className="app-header__nav">`.)

- [ ] **Step 2: Add the CSS**

In `frontend/src/App.css`, immediately after the `.app-header__logo-icon { … }` rule (ends ~line 112), insert:

```css
.app-header__brand {
  display: flex;
  align-items: center;
  gap: 1rem;
  min-width: 0;
}

.app-header__live-stats {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.78rem;
  color: var(--text-muted);
  white-space: nowrap;
}

.app-header__live-stat {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  color: var(--text-muted);
}

a.app-header__live-stat:hover {
  color: var(--text-secondary);
}

.app-header__live-sep {
  color: var(--border-light);
}

.app-header__live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  display: inline-block;
}

.app-header__live-dot--on {
  background: var(--amber);
  animation: pulse-glow 2s ease-in-out infinite;
}

@media (max-width: 640px) {
  .app-header__live-stats {
    display: none;
  }
}
```

- [ ] **Step 3: Typecheck / build**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes and `vite build` completes with no errors.

- [ ] **Step 4: Runtime check**

Run backend (`cd backend && uvicorn app.main:app --port 8000 &`) and frontend (`cd frontend && npm run dev`). Open the dev URL.
Expected: the header shows "● N live · N watching · N played" next to the logo; the dot is grey when `active === 0`. Start a game in another tab → within ~10s "live" increments and the dot turns amber and pulses. Switch the tab to background for >10s → no network calls fire (polling paused); refocus → it resumes. Throttle/stop the backend → the counter disappears and the header stays intact. Stop servers when done.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layout/Header.tsx frontend/src/App.css
git commit -m "feat(header): live games/spectators/total-games counter"
```

---

## Self-Review

- **Spec coverage (Workstream 0):** live games (`active`) ✓ Task 2/5; global spectators (new aggregate) ✓ Task 1/2/5; total games (`COUNT(*)`) ✓ Task 2/5; 10s poll paused on hidden tab ✓ Task 4; hides on error, never breaks header ✓ Task 4/5; tabular-nums (inherited from body, set in the prior polish pass) ✓; amber dot pulses only when `active>0` and is reduced-motion-safe (global media query) ✓ Task 5; "live" links to `/?status=active` ✓ Task 5; collapses <640px ✓ Task 5.
- **Placeholder scan:** none — every step has exact code/commands.
- **Type consistency:** `QueueStatus` fields (`active`, `queued`, `max`, `max_queued`, `total_spectators`, `total_games`) match the backend dict keys set in Task 2 and the usage in Task 5 (`stats.active`, `stats.total_spectators`, `stats.total_games`). `getQueueStatus` return type matches the hook's `QueueStatus | null` state.
- **Note (verified):** `/?status=active` works — `GameListPage` already reads `searchParams.get("status")` (line 18) and uses it as the active filter, so the "live" link lands on the games list filtered to in-progress games.
