import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { DashboardResponseWire } from "./types";

const DASHBOARD_URL = "/api/portal/dashboard";

export interface OverviewDashboardState {
  readonly data: DashboardResponseWire | null;
  readonly loading: boolean;
  /** True once a request has resolved (success or failure) at least once. */
  readonly loaded: boolean;
  /** True only on a genuine read failure (non-2xx or thrown) — never set for an honest-empty payload. */
  readonly error: boolean;
  readonly refetch: () => void;
}

/**
 * The real `GET /api/portal/dashboard` read backing Customer Home's Overview
 * page (#2921, contract pack §2). `requireAuth`, not `requireRole
 * (`Customer`)` — the route's own header comment (portal-customer-
 * engines.ts:402-411) — so this also serves Free-tier callers.
 */
export function useOverviewDashboard(): OverviewDashboardState {
  const { fetchWithAuth, user } = useAuth();
  const [data, setData] = useState<DashboardResponseWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth(DASHBOARD_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`dashboard ${res.status}`);
        return (await res.json()) as DashboardResponseWire;
      })
      .then((body) => {
        if (cancelled) return;
        setData(body);
        setError(false);
      })
      .catch(() => {
        if (cancelled) return;
        // Leave the previous payload (if any) in place on a retry failure —
        // only the initial load has nothing to fall back to.
        setError(true);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [user, fetchWithAuth, attempt]);

  const refetch = useCallback(() => setAttempt((n) => n + 1), []);

  return { data, loading, loaded, error, refetch };
}
