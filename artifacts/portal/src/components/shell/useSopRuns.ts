import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";

/**
 * Minimal client-side mirror of the real `GET /api/portal/sop-runs` wire
 * shape (`WireSopRunsPayload` / `WireSopQueueItem`,
 * artifacts/api-server/src/routes/portal-sops.ts:198-236) — only the fields
 * the shell tray draws. Apps in this monorepo don't share types across the
 * artifacts/* boundary (see CLAUDE.md, "Workspace / monorepo"), so this is
 * typed independently rather than imported from the server package, same
 * pattern as `usePillarSummary.ts`.
 */
export interface SopQueueItemWire {
  readonly code: string;
  readonly title: string;
  readonly mode: string;
  readonly step: string;
  readonly pct: number;
  readonly started: string;
  readonly who: string;
  readonly state: "Running" | "Queued";
  readonly cr: string;
}

interface SopRunsPayloadWire {
  readonly queue: SopQueueItemWire[];
}

export interface SopRunsShellState {
  /** Live queue rows — running or queued runs against this tenant, oldest first. */
  readonly queue: readonly SopQueueItemWire[];
  readonly loading: boolean;
  /** True once a request has resolved (success or failure) at least once. */
  readonly loaded: boolean;
}

/**
 * The shell's own read of `/api/portal/sop-runs` — just the `queue` half of
 * the payload; the tray has no use for the audit history (that belongs to
 * the SOPs page itself, #1730). SOPs #1493's backend children (#1556-#1560,
 * #1620) are all closed and the contract pack (#1728) is regenerated, so an
 * empty queue here is a real "nothing running right now", not a stub with
 * nothing behind it.
 */
export function useSopRunsShell(): SopRunsShellState {
  const { fetchWithAuth, user } = useAuth();
  const [queue, setQueue] = useState<readonly SopQueueItemWire[]>([]);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth("/api/portal/sop-runs", undefined, { silent: true })
      .then((res) => (res.ok ? (res.json() as Promise<SopRunsPayloadWire>) : null))
      .then((data) => {
        if (cancelled || !data) return;
        setQueue(data.queue);
      })
      .catch(() => {
        // Leave the queue empty — an unreachable sop-runs read renders the
        // honest "nothing running" shape rather than a fabricated run.
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setLoaded(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth]);

  return { queue, loading, loaded };
}
