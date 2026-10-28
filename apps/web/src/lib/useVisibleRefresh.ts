import { useEffect, useRef } from "react";

export const DEFAULT_VISIBLE_REFRESH_INTERVAL_MS = 30_000;

/** One visibility-aware read loop shared by live console screens. */
export function useVisibleRefresh(refresh: () => void, intervalMs = DEFAULT_VISIBLE_REFRESH_INTERVAL_MS): void {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);

  useEffect(() => {
    const refreshWhenVisible = (): void => {
      if (document.visibilityState === "visible") refreshRef.current();
    };
    refreshWhenVisible();
    const interval = window.setInterval(refreshWhenVisible, intervalMs);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [intervalMs]);
}
