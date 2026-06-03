import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type AnnounceFn = (message: string) => void;

const LiveAnnouncerContext = createContext<AnnounceFn>(() => {});

/**
 * Hook to push a polite, debounced screen-reader announcement.
 * Safe to call when no provider is mounted (no-op).
 */
export function useAnnounce(): AnnounceFn {
  return useContext(LiveAnnouncerContext);
}

/**
 * Renders one visually-hidden polite live region and provides `announce()`.
 * Debounces by 600ms so rapid updates collapse to the latest message only.
 */
export function LiveAnnouncer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const timer = useRef<number | null>(null);
  const pending = useRef<string>("");

  const announce = useCallback<AnnounceFn>((msg) => {
    pending.current = msg;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // Clear then set on next frame so identical-text repeats still announce.
      setMessage("");
      requestAnimationFrame(() => setMessage(pending.current));
    }, 600);
  }, []);

  useEffect(() => {
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  return (
    <LiveAnnouncerContext.Provider value={announce}>
      {children}
      <div className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {message}
      </div>
    </LiveAnnouncerContext.Provider>
  );
}
