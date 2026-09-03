import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { PortalNotification, PortalNotificationSseEvent } from "./types";

const MAX_LIST = 50;
const MAX_ACTIVITY = 100;

interface FeedState {
  readonly items: readonly PortalNotification[];
  readonly loading: boolean;
  /** True once a request for this feed has resolved (success or failure) at least once. */
  readonly loaded: boolean;
}

const EMPTY_FEED: FeedState = { items: [], loading: false, loaded: false };

/**
 * #1821 — the alerts dropdown's own data layer. Reads the real endpoints in
 * `artifacts/api-server/src/routes/notifications.ts`:
 *   - `GET /api/portal/notifications/unread-count` — the bell badge (personal only).
 *   - `GET /api/portal/notifications` — the "Personal" tab.
 *   - `GET /api/portal/notifications/activity-feed` — the "All activity" tab
 *     (customer_tenant-scoped `all_activity` rows, not a cross-tenant feed —
 *     `requireAuth` + `eq(userId, ...)` in the route, not `requireAdmin`).
 *   - `PATCH /api/portal/notifications/:id/read`, `POST
 *     /api/portal/notifications/read-all`.
 *   - `GET /api/portal/notifications/stream` (SSE) for live push — same
 *     reconnect/backoff shape as `admin-panel/src/hooks/useLiveStream.ts`
 *     (this repo's other portal EventSource consumer).
 *
 * Every list row's `linkPath` arrives already resolved (`deepLink`) by the
 * server through `portal-deep-links.ts` — this hook never guesses a href.
 */
export function useNotifications() {
  const { fetchWithAuth, accessToken, user } = useAuth();
  const [unreadCount, setUnreadCount] = useState<number | null>(null);
  const [personal, setPersonal] = useState<FeedState>(EMPTY_FEED);
  const [activity, setActivity] = useState<FeedState>(EMPTY_FEED);
  const [live, setLive] = useState(false);

  const loadUnreadCount = useCallback(async () => {
    const res = await fetchWithAuth("/api/portal/notifications/unread-count", undefined, { silent: true });
    if (!res.ok) return;
    const data = (await res.json()) as { unreadCount: number };
    setUnreadCount(data.unreadCount);
  }, [fetchWithAuth]);

  const loadPersonal = useCallback(async () => {
    setPersonal((s) => ({ ...s, loading: true }));
    try {
      const res = await fetchWithAuth(`/api/portal/notifications?limit=${MAX_LIST}`, undefined, { silent: true });
      const items = res.ok ? ((await res.json()) as PortalNotification[]) : [];
      setPersonal({ items, loading: false, loaded: true });
    } catch {
      setPersonal((s) => ({ ...s, loading: false, loaded: true }));
    }
  }, [fetchWithAuth]);

  const loadActivity = useCallback(async () => {
    setActivity((s) => ({ ...s, loading: true }));
    try {
      const res = await fetchWithAuth(`/api/portal/notifications/activity-feed?limit=${MAX_ACTIVITY}`, undefined, {
        silent: true,
      });
      const items = res.ok ? ((await res.json()) as PortalNotification[]) : [];
      setActivity({ items, loading: false, loaded: true });
    } catch {
      setActivity((s) => ({ ...s, loading: false, loaded: true }));
    }
  }, [fetchWithAuth]);

  // Unread count is cheap and drives the chrome badge — load it as soon as
  // there's a user, independent of whether the dropdown has ever been opened.
  useEffect(() => {
    if (!user) return;
    void loadUnreadCount();
  }, [user, loadUnreadCount]);

  // Live push — same reconnect/backoff pattern as useLiveStream.ts.
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;
  useEffect(() => {
    if (!accessToken) {
      setLive(false);
      return;
    }
    const tokenAtMount = accessToken;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let mounted = true;

    const connect = () => {
      if (!mounted || accessTokenRef.current !== tokenAtMount) return;
      es = new EventSource(
        `/api/portal/notifications/stream?token=${encodeURIComponent(tokenAtMount)}`,
      );
      es.onopen = () => setLive(true);
      es.onmessage = (event) => {
        try {
          backoff = 1000;
          const payload = JSON.parse(event.data as string) as PortalNotificationSseEvent;
          if (payload.type === "unread_count") {
            setUnreadCount(payload.unreadCount);
          } else if (payload.type === "notification") {
            const n = payload.notification;
            if (n.feedType === "personal") {
              setPersonal((s) => (s.loaded ? { ...s, items: [n, ...s.items].slice(0, MAX_LIST) } : s));
            } else {
              setActivity((s) => (s.loaded ? { ...s, items: [n, ...s.items].slice(0, MAX_ACTIVITY) } : s));
            }
          }
        } catch {
          // malformed frame — ignore, next push (or the next poll) recovers
        }
      };
      es.onerror = () => {
        es?.close();
        es = null;
        setLive(false);
        if (!mounted || accessTokenRef.current !== tokenAtMount) return;
        reconnectTimer = setTimeout(() => {
          backoff = Math.min(backoff * 2, 30_000);
          connect();
        }, backoff);
      };
    };
    connect();

    return () => {
      mounted = false;
      es?.close();
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, [accessToken]);

  const markRead = useCallback(
    async (id: number) => {
      setPersonal((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
      setActivity((s) => ({ ...s, items: s.items.map((n) => (n.id === id ? { ...n, read: true } : n)) }));
      setUnreadCount((c) => (c && c > 0 ? c - 1 : c));
      await fetchWithAuth(`/api/portal/notifications/${id}/read`, { method: "PATCH" }, { silent: true });
    },
    [fetchWithAuth],
  );

  const markAllRead = useCallback(async () => {
    setPersonal((s) => ({ ...s, items: s.items.map((n) => ({ ...n, read: true })) }));
    setActivity((s) => ({ ...s, items: s.items.map((n) => ({ ...n, read: true })) }));
    setUnreadCount(0);
    await fetchWithAuth("/api/portal/notifications/read-all", { method: "POST" }, { silent: true });
  }, [fetchWithAuth]);

  return {
    unreadCount,
    live,
    personal,
    activity,
    loadPersonal,
    loadActivity,
    markRead,
    markAllRead,
  };
}
