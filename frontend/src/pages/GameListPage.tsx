import { useState, useEffect, useCallback, useRef } from "react";
import { listGames } from "../api/client";
import type { GameSummary } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import NewGameDialog from "../components/gamelist/NewGameDialog";

const PAGE_SIZE = 20;

type Filter = "all" | "active" | "completed";

export default function GameListPage() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalCount, setTotalCount] = useState(0);
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const filterRef = useRef(filter);
  filterRef.current = filter;

  const fetchFirstPage = useCallback(async () => {
    try {
      const params = filter === "all" ? {} : { status: filter };
      const data = await listGames({ ...params, limit: PAGE_SIZE, offset: 0 });
      setGames(data.games);
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
    } catch {
      // silently fail, keep stale data
    } finally {
      setLoading(false);
    }
  }, [filter]);

  // Initial fetch + filter change
  useEffect(() => {
    setLoading(true);
    setGames([]);
    fetchFirstPage();
  }, [fetchFirstPage]);

  // Poll for updates every 10s — refresh first page only
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const params = filterRef.current === "all" ? {} : { status: filterRef.current };
        const data = await listGames({ ...params, limit: PAGE_SIZE, offset: 0 });
        setGames((prev) => {
          // Merge: replace the first PAGE_SIZE entries, keep any "load more" entries
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
      const params = filter === "all" ? {} : { status: filter };
      const data = await listGames({ ...params, limit: PAGE_SIZE, offset: games.length });
      setGames((prev) => [...prev, ...data.games]);
      setTotalCount(data.total_count);
      setHasMore(data.has_more);
    } catch {
      // ignore
    } finally {
      setLoadingMore(false);
    }
  }, [filter, games.length, loadingMore]);

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

      {loading ? (
        <div className="spinner-page">
          <div className="spinner-lg" />
        </div>
      ) : games.length === 0 ? (
        <div className="empty-state panel">
          <div className="empty-state__icon">&#9816;</div>
          <div className="empty-state__text">
            {filter === "all"
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
