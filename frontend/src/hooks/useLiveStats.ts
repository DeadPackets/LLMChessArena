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
