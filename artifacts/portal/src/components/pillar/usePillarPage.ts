import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import type { PillarSummaryPayloadWire } from "./types";

const PILLARS_URL = "/api/portal/pillars";

export interface PillarPageState {
  readonly payload: PillarSummaryPayloadWire | null;
  readonly loading: boolean;
  /** True once a request has resolved (success or failure) at least once. */
  readonly loaded: boolean;
  /** True only on a genuine read failure (non-2xx or thrown) — never set for an honest-empty payload. */
  readonly error: boolean;
  readonly refetch: () => void;
}

/**
 * The real `GET /api/portal/pillars` read backing the six pillar pages
 * (#1749, Feature #1621). One shared fetch of the full payload — every
 * pillar page reads the SAME response and picks its own card out of
 * `payload.pillars`, so switching pillars via the tab strip never refetches
 * and two pillar pages can never disagree about `scannedCheckKeys` /
 * `findingsRunId` / `activeRunId`, which are tenant-wide, not per-pillar.
 *
 * Same shape as `useOverviewDashboard` / `usePillarSummaryShell`: no
 * fixture fallback on a failed or empty read — a real read failure renders
 * the honest error state, and a genuinely never-scanned tenant renders the
 * honest never-scanned state, never a fabricated card.
 */
export function usePillarPage(): PillarPageState {
  const { fetchWithAuth, user } = useAuth();
  const [payload, setPayload] = useState<PillarSummaryPayloadWire | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setLoading(true);

    void fetchWithAuth(PILLARS_URL, undefined, { silent: true })
      .then(async (res) => {
        if (!res.ok) throw new Error(`pillars ${res.status}`);
        return (await res.json()) as PillarSummaryPayloadWire;
      })
      .then((body) => {
        if (cancelled) return;
        setPayload(body);
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

  return { payload, loading, loaded, error, refetch };
}
