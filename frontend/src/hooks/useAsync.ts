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
