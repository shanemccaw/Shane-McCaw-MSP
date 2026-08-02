/**
 * useWarRoomScanPlan.ts — #340 (War Room epic #302).
 *
 * The real check PLAN of the run the War Room is watching: every check key the
 * run's monitoring package genuinely executes, from `GET /api/portal/scan-plan`
 * (api-server reuses the executor's own `loadOrderedPackageChecks`, so this is
 * the same list `executeMonitoringPackage` iterates — not a count derived from
 * one).
 *
 * Why the room needs it: the diagnostics SSE stream reports which checks HAVE
 * run, and nothing else. That is enough to light the pillar the run is reading,
 * but not to say a pillar has FINISHED — which is the state #331/#334 resolve
 * into a real score or an honest NO DATA. Before #340 the room answered that
 * question with "the first result that mapped to this pillar", so a pillar with
 * five real checks was declared finished after one, and pillars still being read
 * showed NO DATA. `deriveWarRoomScan` now compares reported checks against this
 * plan's per-pillar counts instead.
 *
 * ── Cadence ──────────────────────────────────────────────────────────────────
 * Once per run, not on a poll. A run's package — and therefore its check list —
 * is fixed for the life of the run, so re-fetching it on the shell's 3s scan
 * poll would re-run the same two queries dozens of times per scan for a value
 * that cannot have changed. The observed runId changing is the only thing that
 * can invalidate it, which is exactly what this refetches on.
 *
 * The plan is returned tagged with the runId the server resolved it for, and it
 * is handed onward with that tag: `deriveWarRoomScan` refuses to apply a plan to
 * a run it does not belong to rather than assuming the two match. A room with no
 * plan yet (first paint, an api-server without the route, a failed fetch) is a
 * real state and stays honest — pillars with results read "scanning" until their
 * run genuinely ends. It never falls back to guessing a count.
 */

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-context";
import { useScanStatus } from "@/lib/scan-status-context";

const SCAN_PLAN_URL = "/api/portal/scan-plan";

/** First retry delay after a failed fetch; doubles per consecutive failure. */
export const SCAN_PLAN_RETRY_BASE_MS = 2_000;

/** Consecutive failures to retry through before giving up until a new run appears. */
export const SCAN_PLAN_MAX_RETRIES = 3;

export interface WarRoomScanPlan {
  /** The run these check keys really belong to, or null when nothing is known yet. */
  runId: string | null;
  /** Every check key the run's package genuinely executes, in execution order. */
  checkKeys: string[];
}

const EMPTY_PLAN: WarRoomScanPlan = { runId: null, checkKeys: [] };

/**
 * The runId whose plan the room needs, in the same precedence
 * `deriveWarRoomScan` picks its run with: a stream is attached to the run being
 * watched, a triggered run is one this session started, and otherwise the poll's
 * active/most-recent run is the one on screen.
 */
function observedRunId(
  streamedRunId: string | null,
  triggeredRunId: string | null,
  activeRunId: string | null | undefined,
  lastRunId: string | null | undefined,
): string | null {
  return streamedRunId || triggeredRunId || activeRunId || lastRunId || null;
}

export function useWarRoomScanPlan(): WarRoomScanPlan {
  const { fetchWithAuth } = useAuth();
  const { data, streamedRunId, triggeredRunId } = useScanStatus();
  const [plan, setPlan] = useState<WarRoomScanPlan>(EMPTY_PLAN);

  // fetchWithAuth is re-created on every access-token refresh; read it through a
  // ref so a refresh mid-run cannot re-fire the fetch effect (same discipline as
  // useWarRoomPillarStats).
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const runId = observedRunId(
    streamedRunId,
    triggeredRunId,
    data?.active?.runId,
    data?.lastRunSummary?.runId,
  );

  useEffect(() => {
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let failures = 0;

    const load = async (): Promise<void> => {
      try {
        const res = await fetchRef.current(SCAN_PLAN_URL);
        if (cancelled) return;
        if (!res.ok) throw new Error(`scan-plan ${res.status}`);
        const body = (await res.json()) as { runId?: unknown; checkKeys?: unknown };
        if (cancelled) return;
        const keys = Array.isArray(body?.checkKeys)
          ? body.checkKeys.filter((k): k is string => typeof k === "string" && k.length > 0)
          : [];
        setPlan({
          runId: typeof body?.runId === "string" && body.runId ? body.runId : null,
          checkKeys: keys,
        });
        failures = 0;
      } catch {
        if (cancelled) return;
        // A plan that never arrives is a real state the room already handles
        // honestly, so this retries a few times and then stops rather than
        // hammering — it must never substitute an invented count.
        failures += 1;
        if (failures > SCAN_PLAN_MAX_RETRIES) return;
        retryTimer = setTimeout(load, SCAN_PLAN_RETRY_BASE_MS * 2 ** (failures - 1));
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
    // Refetch when the run being watched changes — a different run can be a
    // different package, and therefore a genuinely different check list.
  }, [runId]);

  return plan;
}
