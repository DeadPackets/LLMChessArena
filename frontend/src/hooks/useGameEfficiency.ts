import { useEffect, useState } from "react";
import { getGameEfficiency } from "../api/client";
import type { GameEfficiency } from "../types/api";
import type { GameState } from "../types/websocket";

export function useGameEfficiency(gameId: string, status: GameState["status"]) {
  const [snapshot, setSnapshot] = useState<{
    gameId: string;
    data: GameEfficiency | null;
    error: string | null;
    refreshing: boolean;
  }>({ gameId, data: null, error: null, refreshing: false });
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;
    const isVisible = () => document.visibilityState !== "hidden";

    async function load() {
      if (inFlight || controller.signal.aborted || !isVisible()) return;
      clearTimeout(timer);
      inFlight = true;
      setSnapshot((previous) => ({
        gameId,
        data: previous.gameId === gameId ? previous.data : null,
        error: previous.gameId === gameId ? previous.error : null,
        refreshing: true,
      }));
      try {
        const data = await getGameEfficiency(gameId, controller.signal);
        if (!controller.signal.aborted) setSnapshot({ gameId, data, error: null, refreshing: false });
      } catch {
        if (!controller.signal.aborted) {
          setSnapshot((previous) => ({ ...previous, error: "Could not update request usage.", refreshing: false }));
        }
      } finally {
        inFlight = false;
        if (!controller.signal.aborted && isVisible() && (status === "active" || status === "queued")) {
          timer = setTimeout(load, 10_000);
        }
      }
    }

    function onVisibilityChange() {
      clearTimeout(timer);
      if (isVisible()) void load();
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [gameId, status, refresh]);

  return {
    data: snapshot.gameId === gameId ? snapshot.data : null,
    error: snapshot.gameId === gameId ? snapshot.error : null,
    refreshing: snapshot.gameId === gameId && snapshot.refreshing,
    retry: () => setRefresh((value) => value + 1),
  };
}
