import { useState, useEffect } from "react";
import type { OpenRouterModel } from "../types/api";
import { fetchOpenRouterModels } from "../api/client";

export function useOpenRouterModels(enabled = true) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    fetchOpenRouterModels()
      .then((data) => {
        if (!cancelled) {
          setModels(data);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load models");
          setLoading(false);
        }
      });
    return () => { cancelled = true; };
  }, [enabled]);

  return { models, loading, error };
}
