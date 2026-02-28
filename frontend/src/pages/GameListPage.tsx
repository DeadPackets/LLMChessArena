import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { listGames } from "../api/client";
import type { GameSummary } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import NewGameDialog from "../components/gamelist/NewGameDialog";

const PAGE_SIZE = 20;

type Filter = "all" | "active" | "completed";
type Outcome = "" | "white" | "black" | "draw";

export default function GameListPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  // Read filters from URL
  const filter = (searchParams.get("status") as Filter) || "all";
  const searchQuery = searchParams.get("q") || "";
  const outcome = (searchParams.get("outcome") as Outcome) || "";
  const opening = searchParams.get("opening") || "";

  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Local search input (debounced before pushing to URL)
  const [searchInput, setSearchInput] = useState(searchQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Sync searchInput when URL param changes externally
  useEffect(() => {
    setSearchInput(searchParams.get("q") || "");
  }, [searchParams]);

  // Update URL params (replaces history entry for filters)
  const updateParams = useCallback(
    (updates: Record<string, string>) => {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(updates)) {
          if (value) {
            next.set(key, value);
          } else {
            next.delete(key);
          }
        }
        // Always reset offset when filters change
        next.delete("offset");
        return next;
      }, { replace: true });
    },
    [setSearchParams],
  );

  const setFilter = useCallback(
    (f: Filter) => updateParams({ status: f === "all" ? "" : f }),
    [updateParams],
  );

  const setOutcome = useCallback(
    (o: Outcome) => updateParams({ outcome: o }),
    [updateParams],
  );

  const setOpening = useCallback(
    (eco: string) => updateParams({ opening: eco }),
    [updateParams],
  );

  const handleSearchInput = useCallback(
    (value: string) => {
      setSearchInput(value);
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateParams({ q: value });
      }, 350);
    },
    [updateParams],
  );

  // Build API params from URL state
  const buildApiParams = useCallback(() => {
    const params: Record<string, string | number> = { limit: PAGE_SIZE, offset: 0 };
    if (filter !== "all") params.status = filter;
    if (searchQuery) params.q = searchQuery;
    if (outcome) params.outcome = outcome;
    if (opening) params.opening = opening;
    return params;
  }, [filter, searchQuery, outcome, opening]);

  // Keep a ref so polling sees latest filters
  const filtersRef = useRef({ filter, searchQuery, outcome, opening });
  filtersRef.current = { filter, searchQuery, outcome, opening };

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

  // Initial fetch + filter change
  useEffect(() => {
    setLoading(true);
    setGames([]);
    fetchFirstPage();
  }, [fetchFirstPage]);

  // Tick counter to force timeAgo re-renders even when data hasn't changed
  const [, setTick] = useState(0);

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

  const handleLoadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    try {
      const params = buildApiParams();
      params.offset = games.length;
      const data = await listGames(params as Parameters<typeof listGames>[0]);
      setGames((prev) => [...prev, ...data.games]);
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [buildApiParams, games.length, loadingMore]);

  const hasActiveFilters = searchQuery || outcome || opening;

  const clearFilters = useCallback(() => {
    setSearchInput("");
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("q");
      next.delete("outcome");
      next.delete("opening");
      next.delete("offset");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  return (
    <div className="game-list-page">
      <div className="hero">
        <h1 className="hero__title">LLM Chess Arena</h1>
        <p className="hero__subtitle">
          Pit LLMs against each other, against humans, or against Stockfish in real-time chess.
        </p>
        <p className="hero__description">
          Every move is evaluated by Stockfish, classified for quality, and accompanied by live table talk.
          Track ELO ratings, accuracy, and costs across all players on a unified leaderboard.
        </p>
      </div>

      <div className="game-list-page__header">
        <h2 className="game-list-page__title">Games</h2>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
          <div className="game-list-page__filters">
            {(["all", "active", "completed"] as Filter[]).map((f) => (
              <button
                key={f}
                className={`filter-btn${filter === f ? " filter-btn--active" : ""}`}
                onClick={() => setFilter(f)}
              >
                {f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button className="btn btn--primary" onClick={() => setDialogOpen(true)}>
            New Game
          </button>
        </div>
      </div>

      {/* Search & filter bar */}
      <div className="game-list-page__search-bar">
        <input
          className="game-list-page__search-input"
          type="text"
          placeholder="Search by model or opening..."
          value={searchInput}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
        <select
          className="game-list-page__filter-select"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value as Outcome)}
        >
          <option value="">Any outcome</option>
          <option value="white">White wins</option>
          <option value="black">Black wins</option>
          <option value="draw">Draw</option>
        </select>
        {hasActiveFilters && (
          <button className="btn btn--ghost btn--sm" onClick={clearFilters}>
            Clear
          </button>
        )}
      </div>

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
        <>
          <div className="game-list">
            {games.map((game) => (
              <GameCard key={game.id} game={game} />
            ))}
          </div>

          <div className="game-list-page__pagination">
            <span className="game-list-page__count">
              Showing {games.length} of {totalCount} games
            </span>
            {hasMore && (
              <button
                className="btn btn--ghost"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? "Loading..." : "Load More"}
              </button>
            )}
          </div>
        </>
      )}

      <NewGameDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
