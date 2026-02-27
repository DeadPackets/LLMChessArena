import { useState, useEffect } from "react";
import type { OpenRouterModel } from "../types/api";
import { fetchOpenRouterModels } from "../api/client";

export function useOpenRouterModels() {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
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
  }, []);

  return { models, loading, error };
}
