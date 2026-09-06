import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { TimelineEventWire } from "./types";

const TIMELINE_URL = "/api/portal/customer/timeline";
const PAGE_SIZE = 8;

export interface OverviewTimelineState {
  readonly events: readonly TimelineEventWire[];
  readonly loading: boolean;
  readonly loaded: boolean;
  readonly error: boolean;
  /** Real `nextCursor` from the last page fetched — only non-null when a source hit its own fetch cap. */
  readonly hasMore: boolean;
  readonly loadingMore: boolean;
  readonly loadMore: () => void;
}

/**
 * The real `GET /api/portal/customer/timeline` read backing Customer Home's
 * "Happened" panel (#2921, contract pack §1). Cursor-paginates forward via
 * the endpoint's own `nextCursor` (last page item's timestamp) — never a
 * blind "always offer a next page" (§5).
 */
export function useOverviewTimeline(): OverviewTimelineState {
  const { fetchWithAuth, user } = useAuth();
  const [events, setEvents] = useState<TimelineEventWire[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  const fetchPage = useCallback(
    async (before: string | null, append: boolean) => {
      try {
        const url = before ? `${TIMELINE_URL}?limit=${PAGE_SIZE}&before=${encodeURIComponent(before)}` : `${TIMELINE_URL}?limit=${PAGE_SIZE}`;
        const res = await fetchWithAuth(url, undefined, { silent: true });
        if (!res.ok) throw new Error(`timeline ${res.status}`);
        const body = (await res.json()) as { events: TimelineEventWire[]; nextCursor: string | null };
        setEvents((prev) => (append ? [...prev, ...body.events] : body.events));
        setCursor(body.nextCursor);
        setHasMore(body.nextCursor !== null);
        setError(false);
      } catch {
        setError(true);
      }
    },
    [fetchWithAuth],
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);
    void fetchPage(null, false).finally(() => {
      if (cancelled) return;
      setLoading(false);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, fetchWithAuth]);

  const loadMore = useCallback(() => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    void fetchPage(cursor, true).finally(() => setLoadingMore(false));
  }, [cursor, loadingMore, fetchPage]);

  return { events, loading, loaded, error, hasMore, loadingMore, loadMore };
}
