/**
 * useRemediationTracker.ts — the Full Remediation Guide's persistent tick state
 * (Git #730, Phase A of epic #647).
 *
 *   GET /api/portal/remediation-tracker
 *   PUT /api/portal/remediation-tracker/steps/:stepId
 *
 * Before #730 the guide's ticks were `useState` inside `RemediationGuideBody`
 * and died with the tab, which the document's own standfirst admitted ("your
 * progress is kept while this page is open"). They now live in
 * `remediation_tracker_steps`, scoped to the CUSTOMER rather than the user, so
 * a reload, a re-login, a second admin on the account and Shane all see one
 * tracker.
 *
 * OPTIMISTIC, WITH A REAL ROLLBACK. A tick paints immediately and the write
 * follows; a write that fails puts the tick back where it was and says so,
 * rather than leaving the box ticked over a server that never stored it. That
 * is the whole reason `error` exists on this hook: silently keeping a tick the
 * platform did not persist is exactly the "unverified record of remediation"
 * the guide's own header warns about.
 *
 * THE STEP CATALOGUE IS NOT HERE AND NEVER COMES FROM THE SERVER. This hook
 * holds STATE, keyed by step id; the steps themselves stay
 * `previewRemediationGuide.ts` / `remediationLiveGuide.ts`, and the caller
 * counts what it renders. A step with no stored row is simply not in `doneIds`,
 * which is what an untouched step is.
 *
 * PREVIEW IS UNTOUCHED. `?preview=design` renders the design's Halden Materials
 * fixture against a tenant that does not exist; it keeps the old session-only
 * ticks and never calls this hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

const TRACKER_URL = "/api/portal/remediation-tracker";

/** Same channel the rest of the journey beacons on (see useCopilotJourney.ts). */
const JOURNEY_CHANNEL = "engine.dashboard";

/** One stored step, as the route serves it. */
interface WireTrackerStep {
  readonly stepId: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
}

interface WireTrackerPayload {
  readonly steps?: readonly WireTrackerStep[];
}

export interface RemediationTrackerState {
  /** Step ids currently stored as `completed`. */
  readonly doneIds: ReadonlySet<string>;
  /** True once a first payload has arrived — success or failure. */
  readonly loaded: boolean;
  /** True while at least one write is in flight. */
  readonly saving: boolean;
  /**
   * Set when the last read or write failed outright, so the guide can say the
   * progress is not being saved rather than imply it is.
   */
  readonly error: string | null;
  readonly toggle: (stepId: string) => void;
}

export function useRemediationTracker(options?: { readonly enabled?: boolean }): RemediationTrackerState {
  const enabled = options?.enabled !== false;
  const { fetchWithAuth, accessToken } = useAuth();

  const [doneIds, setDoneIds] = useState<ReadonlySet<string>>(() => new Set());
  const [loaded, setLoaded] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // `fetchWithAuth` is rebuilt on every access-token refresh; reading it through
  // a ref keeps a refresh from re-firing the load. Same discipline
  // useCopilotJourney.ts uses.
  const fetchRef = useRef(fetchWithAuth);
  useEffect(() => {
    fetchRef.current = fetchWithAuth;
  }, [fetchWithAuth]);

  const tokenRef = useRef(accessToken);
  useEffect(() => {
    tokenRef.current = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!enabled) {
      setLoaded(true);
      return;
    }
    let cancelled = false;

    void (async () => {
      try {
        // `silent` for the same reason the journey's own fetches are: this
        // surface renders its own "not being saved" line, and a global toast on
        // top of it would double-report the same failure.
        const res = await fetchRef.current(TRACKER_URL, undefined, { silent: true });
        if (!res.ok) throw new Error(`remediation tracker ${res.status}`);
        const body = (await res.json()) as WireTrackerPayload;
        if (cancelled) return;
        const next = new Set<string>();
        for (const step of body?.steps ?? []) {
          if (step.status === "completed") next.add(step.stepId);
        }
        setDoneIds(next);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        const message = e instanceof Error ? e.message : String(e);
        setError(message);
        reportClientEvent(tokenRef.current, "RemediationTrackerLoadFailed", message, JOURNEY_CHANNEL);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const toggle = useCallback(
    (stepId: string) => {
      if (!enabled) return;

      // The value this click is asking for, decided against the state the user
      // is actually looking at rather than a stale closure.
      let nextStatus: "completed" | "not_started" = "completed";
      setDoneIds((prev) => {
        const next = new Set(prev);
        if (next.has(stepId)) {
          next.delete(stepId);
          nextStatus = "not_started";
        } else {
          next.add(stepId);
          nextStatus = "completed";
        }
        return next;
      });

      setInFlight((n) => n + 1);
      void (async () => {
        try {
          const res = await fetchRef.current(
            `${TRACKER_URL}/steps/${encodeURIComponent(stepId)}`,
            {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ status: nextStatus }),
            },
            { silent: true },
          );
          if (!res.ok) throw new Error(`remediation tracker save ${res.status}`);
          setError(null);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          // Roll the tick back to what the server still holds. A tick left
          // standing over a failed write is a claim the platform never stored.
          setDoneIds((prev) => {
            const next = new Set(prev);
            if (nextStatus === "completed") next.delete(stepId);
            else next.add(stepId);
            return next;
          });
          setError(message);
          reportClientEvent(tokenRef.current, "RemediationTrackerSaveFailed", message, JOURNEY_CHANNEL, {
            stepId,
            status: nextStatus,
          });
        } finally {
          setInFlight((n) => Math.max(0, n - 1));
        }
      })();
    },
    [enabled],
  );

  return { doneIds, loaded, saving: inFlight > 0, error, toggle };
}
