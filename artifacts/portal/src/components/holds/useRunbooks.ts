/**
 * useRunbooks.ts — the one data seam for `/portal-v2/runbooks`.
 *
 * Wraps `GET /api/portal/runbooks` (api-server `routes/portal-runbooks.ts`),
 * which is customer-scoped from the JWT, and adds the piece the README asks for
 * that no endpoint can provide: a live clock.
 *
 * ── The tick, and why it is not a poll ─────────────────────────────────────
 * "Use the real clock in production, and re-derive state on an interval so T-24
 * fires without a reload." A window at T-25h when the page loads must become
 * `closing` an hour later on a tab nobody has touched.
 *
 * Re-fetching every minute to learn that would be a request per minute per open
 * tab for something the browser can derive from a timestamp it already holds.
 * So `nowTick` advances every 30 seconds and the components re-derive from
 * `closesAt` through `holdState.ts`; a full re-fetch happens far less often,
 * because only the SCAN VERDICT can change server-side, and that changes on the
 * scan's cadence (hourly at best), not on the clock's.
 *
 * ── fetchWithAuth in a ref ─────────────────────────────────────────────────
 * BUILD_PLAN §5.4: it is rebuilt on every 13-minute silent token refresh, so
 * holding it in a dependency array tears down the polling loop mid-flight.
 * Every existing polling hook in this codebase holds it in a ref; this one does
 * too, and that matters more here than usual because the interval is the point.
 *
 * ── loadHoldEvents — the audit trail, on demand ──────────────────────────────
 * `GET /api/portal/hold-windows/:holdId/events` (Git #1619/#1620) is the
 * per-window decision history — every extend/close-early/release/prepare-cr,
 * with its reason and the real CR code it raised, newest first. It is not part
 * of the periodic `/runbooks` payload: a window's history is only worth a
 * request once someone actually opens it, not on every 10-minute refetch for
 * every window whether or not it's looked at. `loadHoldEvents` fetches on
 * demand and returns `null` on failure so a caller can tell "no events" from
 * "the request failed" without inventing a third state.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "@/lib/auth-context";

const RUNBOOKS_URL = "/api/portal/runbooks";

/** How often the derived clock advances. 30s keeps an hours-granularity readout honest. */
export const HOLD_TICK_MS = 30_000;

/**
 * How often the payload itself is re-read. Ten minutes: the only server-side
 * value that can move underneath the page is the scan verdict, and scans run
 * hourly at best.
 */
export const RUNBOOKS_REFETCH_MS = 600_000;

export interface RunbookStep {
  readonly position: number;
  readonly text: string;
  readonly checked: boolean;
  readonly isCustom: boolean;
  readonly checkedAt: string | null;
}

export interface HoldWindow {
  readonly id: number;
  readonly holdKey: string;
  readonly title: string;
  readonly gates: string;
  readonly gatesStepPosition: number | null;
  readonly pillar: string;
  readonly why: string;
  readonly state: "running" | "closing" | "due" | "early";
  readonly tone: string;
  readonly badge: string;
  readonly tMinus: string;
  readonly daysLeft: number;
  readonly daysSaved: number;
  readonly hoursLeft: number;
  readonly totalDays: number;
  readonly waitDays: number;
  readonly extendedDays: number;
  readonly startedAt: string;
  readonly closesAt: string;
  readonly closedAt: string | null;
  readonly ticks: ReadonlyArray<"done" | "partial" | "todo">;
  readonly scanVerdict: "clear" | "signals" | "watch";
  readonly scanLabel: string;
  readonly scanTone: string;
  readonly scanLine: string;
  readonly scanProvenance: string;
  readonly primaryAction: { readonly kind: string; readonly label: string };
  readonly notificationsDue: readonly string[];
}

export interface Runbook {
  readonly id: number;
  readonly runbookKey: string;
  readonly title: string;
  readonly context: string;
  readonly pillar: string;
  readonly startedOn: string;
  readonly cycleDays: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  readonly checkedSteps: number;
  readonly totalSteps: number;
  readonly pct: number;
  readonly statusLabel: string;
  readonly steps: readonly RunbookStep[];
  readonly hold: HoldWindow | null;
}

/** One decision taken on a hold window — a row of the audit trail. */
export interface HoldWindowEvent {
  readonly kind: "extended" | "closed_early" | "released" | "cr_prepared";
  /** Days added, only for `kind === "extended"`. `null` for every other kind. */
  readonly daysDelta: number | null;
  readonly reason: string | null;
  /** The CR this decision raised, formatted (`formatChangeRequestCode`), or `null` for `extended`. */
  readonly changeRequestCode: string | null;
  readonly createdAt: string;
}

export interface HoldSummary {
  readonly running: number;
  readonly closing: number;
  readonly due: number;
  readonly early: number;
  readonly openCount: number;
  readonly text: string;
}

export interface RunbooksPayload {
  readonly runbooks: readonly Runbook[];
  readonly holds: readonly HoldWindow[];
  readonly summary: HoldSummary;
}

export interface RunbooksState {
  readonly payload: RunbooksPayload | null;
  readonly loaded: boolean;
  readonly error: string | null;
  /** Advances on HOLD_TICK_MS so hold cards can re-derive without a request. */
  readonly now: Date;
  readonly reload: () => void;
  readonly setStepChecked: (runbookId: number, position: number, checked: boolean) => Promise<boolean>;
  readonly addStep: (runbookId: number, text: string) => Promise<boolean>;
  readonly extendHold: (holdId: number, days: number, reason: string) => Promise<boolean>;
  readonly decideHold: (
    holdId: number,
    decision: "close-early" | "release" | "prepare-cr",
    body?: { note?: string; route?: string; window?: string },
  ) => Promise<{ changeRequestCode: string } | null>;
  /** The audit trail for one hold window, newest first. `null` on failure. */
  readonly loadHoldEvents: (holdId: number) => Promise<readonly HoldWindowEvent[] | null>;
}

export function useRunbooks(): RunbooksState {
  const { fetchWithAuth } = useAuth();
  const fetchRef = useRef(fetchWithAuth);
  fetchRef.current = fetchWithAuth;

  const [payload, setPayload] = useState<RunbooksPayload | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [now, setNow] = useState(() => new Date());

  // The live clock. Independent of fetching on purpose — see the header.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), HOLD_TICK_MS);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const res = await fetchRef.current(RUNBOOKS_URL, {}, { silent: true });
        if (!active) return;
        if (!res.ok) {
          setError("Your runbooks could not be loaded.");
          setLoaded(true);
          return;
        }
        const body = (await res.json()) as RunbooksPayload;
        if (!active) return;
        setPayload({
          runbooks: Array.isArray(body.runbooks) ? body.runbooks : [],
          holds: Array.isArray(body.holds) ? body.holds : [],
          summary: body.summary,
        });
        setError(null);
        setLoaded(true);
      } catch {
        if (!active) return;
        setError("Your runbooks could not be loaded.");
        setLoaded(true);
      }
    };

    void load();
    const id = setInterval(() => void load(), RUNBOOKS_REFETCH_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  const setStepChecked = useCallback(
    async (runbookId: number, position: number, checked: boolean): Promise<boolean> => {
      // Optimistic, because a tick box that waits on a round trip feels broken.
      // A failure reloads from the server rather than leaving the optimistic
      // value on screen: the stored state is the record, not what was clicked.
      setPayload((p) =>
        p
          ? {
              ...p,
              runbooks: p.runbooks.map((r) =>
                r.id === runbookId
                  ? {
                      ...r,
                      steps: r.steps.map((s) => (s.position === position ? { ...s, checked } : s)),
                      checkedSteps: r.steps.filter((s) =>
                        s.position === position ? checked : s.checked,
                      ).length,
                    }
                  : r,
              ),
            }
          : p,
      );
      try {
        const res = await fetchRef.current(`${RUNBOOKS_URL}/${runbookId}/steps/${position}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ checked }),
        });
        if (!res.ok) {
          setReloadKey((k) => k + 1);
          return false;
        }
        // Re-read so the derived progress, percentage and status label come from
        // the server rather than being recomputed twice with different rules.
        setReloadKey((k) => k + 1);
        return true;
      } catch {
        setReloadKey((k) => k + 1);
        return false;
      }
    },
    [],
  );

  const addStep = useCallback(async (runbookId: number, text: string): Promise<boolean> => {
    try {
      const res = await fetchRef.current(`${RUNBOOKS_URL}/${runbookId}/steps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) return false;
      setReloadKey((k) => k + 1);
      return true;
    } catch {
      return false;
    }
  }, []);

  const extendHold = useCallback(
    async (holdId: number, days: number, reason: string): Promise<boolean> => {
      try {
        const res = await fetchRef.current(`/api/portal/hold-windows/${holdId}/extend`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ days, reason }),
        });
        if (!res.ok) return false;
        setReloadKey((k) => k + 1);
        return true;
      } catch {
        return false;
      }
    },
    [],
  );

  const decideHold = useCallback(
    async (
      holdId: number,
      decision: "close-early" | "release" | "prepare-cr",
      body: { note?: string; route?: string; window?: string } = {},
    ): Promise<{ changeRequestCode: string } | null> => {
      try {
        const res = await fetchRef.current(`/api/portal/hold-windows/${holdId}/${decision}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const parsed = (await res.json()) as { changeRequestCode?: string };
        setReloadKey((k) => k + 1);
        return parsed.changeRequestCode ? { changeRequestCode: parsed.changeRequestCode } : null;
      } catch {
        return null;
      }
    },
    [],
  );

  const loadHoldEvents = useCallback(
    async (holdId: number): Promise<readonly HoldWindowEvent[] | null> => {
      try {
        const res = await fetchRef.current(`/api/portal/hold-windows/${holdId}/events`, {}, { silent: true });
        if (!res.ok) return null;
        const body = (await res.json()) as { events?: HoldWindowEvent[] };
        return Array.isArray(body.events) ? body.events : [];
      } catch {
        return null;
      }
    },
    [],
  );

  return {
    payload,
    loaded,
    error,
    now,
    reload,
    setStepChecked,
    addStep,
    extendHold,
    decideHold,
    loadHoldEvents,
  };
}
