import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";

export interface LiveStreamFrame {
  id: string;
  receivedAt: number;
  data: Record<string, unknown>;
}

const MAX_BUFFERED_FRAMES = 200;

/**
 * Subscribes to GET /api/admin/live-stream?channel=<channel>&token=<jwt> and
 * buffers incoming frames newest-first. Pass `null` for channel to stay
 * disconnected (e.g. no engine selected yet in the Engines tab picker).
 *
 * Reconnect/backoff/stale-token-guard logic mirrors the kanban-events
 * EventSource in pages/crm/ProjectDetail.tsx — same pattern, same repo.
 */
export function useLiveStream(channel: string | null) {
  const { accessToken } = useAuth();
  const [frames, setFrames] = useState<LiveStreamFrame[]>([]);
  const [connected, setConnected] = useState(false);
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  useEffect(() => {
    setFrames([]);
    if (!channel || !accessToken) {
      setConnected(false);
      return;
    }
    const tokenAtMount = accessToken;
    let es: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let backoff = 1000;
    let mounted = true;

    const connect = () => {
      if (!mounted) return;
      if (accessTokenRef.current !== tokenAtMount) return;
      es = new EventSource(
        `/api/admin/live-stream?channel=${encodeURIComponent(channel)}&token=${encodeURIComponent(tokenAtMount)}`,
      );

      es.onopen = () => setConnected(true);

      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          backoff = 1000;
          setFrames((prev) =>
            [{ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, receivedAt: Date.now(), data }, ...prev].slice(
              0,
              MAX_BUFFERED_FRAMES,
            ),
          );
        } catch {
          // ignore malformed frames
        }
      };

      es.onerror = () => {
        es?.close();
        es = null;
        setConnected(false);
        if (!mounted) return;
        if (accessTokenRef.current !== tokenAtMount) return;
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
  }, [channel, accessToken]);

  return { frames, connected };
}
