import { useState, useEffect, useCallback } from "react";
import { listGames } from "../api/client";
import type { GameSummary } from "../types/api";
import GameCard from "../components/gamelist/GameCard";
import NewGameDialog from "../components/gamelist/NewGameDialog";

type Filter = "all" | "active" | "completed";

export default function GameListPage() {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);

  const fetchGames = useCallback(async () => {
    try {
      const params = filter === "all" ? {} : { status: filter };
      const data = await listGames({ ...params, limit: 50 });
      setGames(data);
    } catch {
      // silently fail, keep stale data
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    setLoading(true);
    fetchGames();
  }, [fetchGames]);

  // Poll for updates every 10s
  useEffect(() => {
    const interval = setInterval(fetchGames, 10000);
    return () => clearInterval(interval);
  }, [fetchGames]);

  return (
    <div className="game-list-page">
      <div className="game-list-page__header">
        <h1 className="game-list-page__title">Games</h1>
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
        <div className="game-list">
          {games.map((game) => (
            <GameCard key={game.id} game={game} />
          ))}
        </div>
      )}

      <NewGameDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
    </div>
  );
}
