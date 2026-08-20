/**
 * useChangeControl.ts — the one data seam for `/portal-v2/change-control`.
 *
 * Wraps `GET/POST /api/portal/change-control` (api-server
 * `routes/portal-change-control.ts`), which is customer-scoped from the JWT.
 * Components consume this hook and never a fixture module, per BUILD_PLAN's
 * "The fixture seam" note — and unlike holds or documents, this page needed no
 * fixture at all, because its backing table already exists.
 *
 * `fetchWithAuth` is held in a ref, not a dependency. BUILD_PLAN §5.4: it is
 * rebuilt on every 13-minute silent token refresh, so putting it in a dep array
 * tears the request down mid-flight.
 *
 * `fetchWithAuth` also globally toasts every non-OK, non-401 response unless
 * `{ silent: true }` is passed. The reads here pass it and surface the failure
 * in the page's own state instead — an empty register with an explanation reads
 * better than a toast over a blank page. The WRITE deliberately does not: a
 * failed submission is exactly the case where a toast is the right feedback.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const CHANGE_CONTROL_URL = "/api/portal/change-control";

/** Mirrors `WireChangeRequest` in api-server `routes/portal-change-control.ts`. */
export interface ChangeRequest {
  readonly code: string;
  readonly title: string;
  readonly changeClass: "Standard" | "Normal" | "Emergency";
  readonly status: string;
  readonly workload: string;
  readonly target: string;
  readonly ticket: string;
  readonly requester: string;
  readonly window: string;
  readonly risk: string;
  readonly impactedUsersCount: number;
  readonly rationale: string;
  readonly pre: string;
  readonly post: string;
  readonly approvals: readonly string[];
  readonly canApprove: boolean;
  readonly canRollback: boolean;
  readonly executedAt: string | null;
  readonly backupVerified: boolean;
  readonly createdAt: string;
}

export interface ChangeControlStats {
  readonly open: number;
  readonly awaitingApproval: number;
  readonly nextWindowCount: number;
  readonly nextWindowLabel: string;
  readonly emergencyCount: number;
  readonly emergencyLookbackDays: number;
  readonly snapshotsHeld: number;
  readonly snapshotRetentionDays: number;
}

export interface ChangeControlPayload {
  readonly requests: readonly ChangeRequest[];
  readonly stats: ChangeControlStats;
  /**
   * False when the account has no resolvable Microsoft 365 tenant identifier.
   * The server fails closed to an empty register in that case rather than
   * running a query that a blank identifier would widen — the page says so
   * rather than showing "no change requests", which would be a different and
   * misleading claim.
   */
  readonly scoped: boolean;
}

export interface NewChangeRequest {
  readonly title: string;
  readonly target: string;
  readonly ticket: string;
  readonly pre: string;
  readonly post: string;
  readonly changeClass: "Standard" | "Normal" | "Emergency";
  readonly impactedUsersCount: number;
  readonly window: string;
}

export interface ChangeControlState {
  readonly payload: ChangeControlPayload | null;
  readonly loaded: boolean;
  readonly error: string | null;
  readonly submit: (draft: NewChangeRequest) => Promise<{ code: string } | null>;
  readonly reload: () => void;
}

const EMPTY_STATS: ChangeControlStats = {
  open: 0,
  awaitingApproval: 0,
  nextWindowCount: 0,
  nextWindowLabel: "No window booked",
  emergencyCount: 0,
  emergencyLookbackDays: 90,
  snapshotsHeld: 0,
  snapshotRetentionDays: 90,
};

export function useChangeControl(): ChangeControlState {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [payload, setPayload] = useState<ChangeControlPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;
    let active = true;

    void (async () => {
      try {
        const res = await fetchRef.current(CHANGE_CONTROL_URL, {}, { silent: true });
        if (!active || cancelledRef.current) return;
        if (!res.ok) {
          setError("The change control register could not be loaded.");
          setLoaded(true);
          return;
        }
        const body = (await res.json()) as ChangeControlPayload;
        if (!active || cancelledRef.current) return;
        setPayload({
          requests: Array.isArray(body.requests) ? body.requests : [],
          stats: body.stats ?? EMPTY_STATS,
          scoped: body.scoped === true,
        });
        setError(null);
        setLoaded(true);
      } catch {
        if (!active || cancelledRef.current) return;
        setError("The change control register could not be loaded.");
        setLoaded(true);
      }
    })();

    return () => {
      active = false;
      cancelledRef.current = true;
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const submit = useCallback(
    async (draft: NewChangeRequest): Promise<{ code: string } | null> => {
      try {
        // No `silent` here on purpose — a failed submission should toast.
        const res = await fetchRef.current(CHANGE_CONTROL_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        });
        if (!res.ok) return null;
        const body = (await res.json()) as { code?: string };
        // Re-read rather than splicing the new row in locally: the server
        // computes the code, the risk and the workload, so the register has to
        // come back from the server to show what was really stored.
        setReloadKey((k) => k + 1);
        return body.code ? { code: body.code } : null;
      } catch {
        return null;
      }
    },
    [],
  );

  return { payload, loaded, error, submit, reload };
}
