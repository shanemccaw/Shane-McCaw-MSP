/**
 * useRemediationTracker.ts — the Full Remediation Guide's persistent tick state
 * (Git #730, Phase A of epic #647; widened in #731, Phase B; verification in
 * #732, Phase C).
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
 * THE VOCABULARY (#731). A step is no longer just done or not: it can be
 * `completed` (the reader did it themselves), `already_handled`,
 * `not_applicable`, `deferred`, or `shane_handles` — the design's own real
 * per-step action set. `statuses` is therefore a map from step id to whichever
 * of those it holds, not a set of "done" ids; a step with no entry is
 * `not_started`, same absence convention Phase A established.
 *
 * VERIFICATION IS A SEPARATE FACT (#732). `verification` answers "has a real
 * rescan actually checked this claim" — `unverified` (the default: a claim
 * nobody has confirmed or contradicted yet, same as "nothing verified yet" in
 * the design), `verified` (a rescan found no problem), or `drift` (a rescan
 * found the underlying issue is still there despite the claim). Only the
 * server ever sets `verified`/`drift` — this hook resets a step's entry to
 * `unverified` OPTIMISTICALLY the instant `status` changes, matching exactly
 * what `portal-remediation-tracker.ts`'s PUT handler does for real: a changed
 * claim invalidates whatever the last scan said about the old one, and the
 * badge must not keep showing a verdict about a claim that no longer exists.
 *
 * OPTIMISTIC, WITH A REAL ROLLBACK. A change paints immediately and the write
 * follows; a write that fails puts the step back where it was and says so,
 * rather than leaving a status showing over a server that never stored it.
 * That is the whole reason `error` exists on this hook: silently keeping a
 * status the platform did not persist is exactly the "unverified record of
 * remediation" the guide's own header warns about.
 *
 * THE STEP CATALOGUE IS NOT HERE AND NEVER COMES FROM THE SERVER. This hook
 * holds STATE, keyed by step id; the steps themselves stay
 * `previewRemediationGuide.ts` / `remediationLiveGuide.ts`, and the caller
 * counts what it renders.
 *
 * PREVIEW IS UNTOUCHED. `?preview=design` renders the design's Halden Materials
 * fixture against a tenant that does not exist; it keeps its own session-only
 * state and never calls this hook.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";
import { reportClientEvent } from "@/lib/report-client-event";

const TRACKER_URL = "/api/portal/remediation-tracker";

/** Same channel the rest of the journey beacons on (see useCopilotJourney.ts). */
const JOURNEY_CHANNEL = "engine.dashboard";

/**
 * Mirrors `REMEDIATION_TRACKER_STEP_STATUS` in `lib/db/src/schema/msp.ts`.
 * Duplicated rather than imported because the portal frontend carries no dependency on
 * `@workspace/db` (a frontend app, not a server) — the same reason
 * `portal-remediation-tracker.ts` keeps its own copy of the step id list
 * rather than importing the guide. `portal-remediation-tracker.test.ts` reads
 * this file directly to guard the two vocabularies from drifting apart, the
 * same way it already guards the step-id list against the guide.
 */
export const REMEDIATION_TRACKER_STEP_STATUS = [
  "not_started",
  "completed",
  "already_handled",
  "not_applicable",
  "deferred",
  "shane_handles",
  // #1542 — set ONLY by the server alongside a real signed msp_risk_decisions
  // row (POST .../steps/:stepId/decline-to-risk), never a bare claim. Vocabulary
  // mirror only: no page consumes this value yet (SCOPE STOP, #1542 ends at the
  // wire contract). Do not fold this into RT_ACCEPTED_STATUSES in
  // remediationLive.ts — that bucket is the softer, unsigned Accepted-as-is
  // (not_applicable/deferred); this is the stronger, signed register exit.
  "accepted_risk",
] as const;
export type RemediationTrackerStepStatus = (typeof REMEDIATION_TRACKER_STEP_STATUS)[number];

/**
 * Mirrors `REMEDIATION_TRACKER_VERIFICATION_STATE` in `lib/db/src/schema/msp.ts`
 * (#732). Same reason as the status vocabulary above — no `@workspace/db`
 * dependency here — and `remediation-tracker-verification.test.ts` reads this
 * file to guard against drift the same way it guards `STEP_CHECK_KEYS`.
 */
export const REMEDIATION_TRACKER_VERIFICATION_STATE = ["unverified", "verified", "drift"] as const;
export type RemediationTrackerVerificationState = (typeof REMEDIATION_TRACKER_VERIFICATION_STATE)[number];

/** One step's verification, as of the last GET or the last optimistic reset. */
export interface RemediationTrackerVerification {
  readonly state: RemediationTrackerVerificationState;
  readonly verifiedAt: string | null;
}

const UNVERIFIED: RemediationTrackerVerification = { state: "unverified", verifiedAt: null };

/** One stored step, as the route serves it. */
interface WireTrackerStep {
  readonly stepId: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly updatedAt: string | null;
  readonly verificationState: string;
  readonly verifiedAt: string | null;
}

interface WireTrackerPayload {
  readonly steps?: readonly WireTrackerStep[];
}

const STATUS_SET: ReadonlySet<string> = new Set(REMEDIATION_TRACKER_STEP_STATUS);
const VERIFICATION_STATE_SET: ReadonlySet<string> = new Set(REMEDIATION_TRACKER_VERIFICATION_STATE);

function isKnownStatus(value: string): value is RemediationTrackerStepStatus {
  return STATUS_SET.has(value);
}

function isKnownVerificationState(value: string): value is RemediationTrackerVerificationState {
  return VERIFICATION_STATE_SET.has(value);
}

export interface RemediationTrackerState {
  /** Every step currently holding a non-`not_started` status, keyed by step id. */
  readonly statuses: ReadonlyMap<string, RemediationTrackerStepStatus>;
  /**
   * Every step's verification, keyed by step id. A step with no entry is
   * `unverified` — same absence convention `statuses` uses, and the honest
   * default for a step nobody has claimed anything about yet.
   */
  readonly verification: ReadonlyMap<string, RemediationTrackerVerification>;
  /** True once a first payload has arrived — success or failure. */
  readonly loaded: boolean;
  /** True while at least one write is in flight. */
  readonly saving: boolean;
  /**
   * Set when the last read or write failed outright, so the guide can say the
   * progress is not being saved rather than imply it is.
   */
  readonly error: string | null;
  /** The checkbox: toggles between `completed` and `not_started`. */
  readonly toggleComplete: (stepId: string) => void;
  /** The action picker and its Undo: sets any status directly, including back to `not_started`. */
  readonly setAction: (stepId: string, status: RemediationTrackerStepStatus) => void;
}

export function useRemediationTracker(options?: { readonly enabled?: boolean }): RemediationTrackerState {
  const enabled = options?.enabled !== false;
  const { fetchWithAuth, accessToken } = useAuth();

  const [statuses, setStatuses] = useState<ReadonlyMap<string, RemediationTrackerStepStatus>>(() => new Map());
  const [verification, setVerification] = useState<ReadonlyMap<string, RemediationTrackerVerification>>(
    () => new Map(),
  );
  const [loaded, setLoaded] = useState(false);
  const [inFlight, setInFlight] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // A passive mirror of `statuses`, kept current on every render. `toggleComplete`
  // reads it rather than nesting a second `setStatuses` call inside `write`'s own
  // functional updater — nested updater calls run under React's own scheduling,
  // not this hook's, and are not something to build a rollback's correctness on.
  const statusesRef = useRef(statuses);
  statusesRef.current = statuses;
  const verificationRef = useRef(verification);
  verificationRef.current = verification;

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
        const nextStatuses = new Map<string, RemediationTrackerStepStatus>();
        const nextVerification = new Map<string, RemediationTrackerVerification>();
        for (const step of body?.steps ?? []) {
          if (step.status !== "not_started" && isKnownStatus(step.status)) nextStatuses.set(step.stepId, step.status);
          if (step.verificationState !== "unverified" && isKnownVerificationState(step.verificationState)) {
            nextVerification.set(step.stepId, { state: step.verificationState, verifiedAt: step.verifiedAt });
          }
        }
        setStatuses(nextStatuses);
        setVerification(nextVerification);
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

  /** Shared by the checkbox and the action picker: optimistic write, real rollback on failure. */
  const write = useCallback(
    (stepId: string, nextStatus: RemediationTrackerStepStatus) => {
      if (!enabled) return;

      // What this step held before the click, so a failed write has something
      // real to roll back to rather than guessing `not_started`. Read via the
      // refs (not a functional updater) — the verification rollback has to
      // restore the SAME snapshot the status rollback does, and reading both
      // from one place is what keeps them from disagreeing.
      const previousStatus: RemediationTrackerStepStatus = statusesRef.current.get(stepId) ?? "not_started";
      const previousVerification: RemediationTrackerVerification = verificationRef.current.get(stepId) ?? UNVERIFIED;

      setStatuses((prev) => {
        const next = new Map(prev);
        if (nextStatus === "not_started") next.delete(stepId);
        else next.set(stepId, nextStatus);
        return next;
      });
      // Optimistic reset (#732): a new claim has no verdict yet, exactly what
      // the server's own PUT handler does for real. Painted immediately so the
      // UI never shows a stale "Verified"/"Drifted" badge over a claim that
      // just changed.
      setVerification((prev) => {
        const next = new Map(prev);
        next.delete(stepId);
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
          // Roll back to what the server still holds. A status left standing
          // over a failed write is a claim the platform never stored — and its
          // verification never actually changed either, so that rolls back
          // right along with it rather than staying reset to `unverified`.
          setStatuses((prev) => {
            const next = new Map(prev);
            if (previousStatus === "not_started") next.delete(stepId);
            else next.set(stepId, previousStatus);
            return next;
          });
          setVerification((prev) => {
            const next = new Map(prev);
            if (previousVerification.state === "unverified") next.delete(stepId);
            else next.set(stepId, previousVerification);
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

  const toggleComplete = useCallback(
    (stepId: string) => {
      // Mirrors the design's own toggle: clicking the checkbox from ANY
      // non-complete state — including one of the other four actions — marks
      // it complete; clicking it again resets to not started. The action
      // picker never offers `completed` itself for the same reason: there is
      // exactly one control for "I did this", and it is the checkbox.
      const current = statusesRef.current.get(stepId) ?? "not_started";
      write(stepId, current === "completed" ? "not_started" : "completed");
    },
    [write],
  );

  const setAction = useCallback(
    (stepId: string, status: RemediationTrackerStepStatus) => write(stepId, status),
    [write],
  );

  return { statuses, verification, loaded, saving: inFlight > 0, error, toggleComplete, setAction };
}
