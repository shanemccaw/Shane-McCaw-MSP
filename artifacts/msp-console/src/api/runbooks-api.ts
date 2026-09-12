/**
 * runbooks-api.ts — the data seam for the MSP Console's Runbooks module page
 * (#2585, wiring #2669's real MSP-operator routes).
 *
 * Wraps the four real routes in `artifacts/api-server/src/routes/msp-runbooks.ts`:
 *
 *   GET  /api/msp/runbooks?customerId=                       — a customer's runbooks + run history
 *   PUT  /api/msp/runbooks/:runbookId/steps/:position         — mark a step complete on a live run
 *   POST /api/msp/hold-windows/:holdId/extend                 — extend a hold window, with a reason
 *   GET  /api/msp/hold-windows/:holdId/events?customerId=     — a hold window's decision audit trail
 *
 * The wire shapes are copied field-for-field from `portal-runbook-wire.ts` (the
 * shared lib both the customer-facing `/portal/runbooks` routes and these
 * MSP routes read from) — same shape the customer sees, an operator viewing it
 * from the console must see identically.
 *
 * `msp-runbooks.ts`'s own header is explicit about scope: #1683 (Feature:
 * Runbooks MSP Console) names five operator actions but is marked NOT
 * ARCHITECTED for the full surface. Only two of those five have a real,
 * built endpoint — marking a step, and extending a hold window — which is
 * exactly what this file (and the module page it feeds) wires. Authoring a
 * runbook definition, reordering its steps, and recording a run's outcome are
 * deliberately not represented here; there is no endpoint to call for them.
 */
import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

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
  readonly runId: number | null;
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
  readonly ticks: readonly ("done" | "partial" | "todo")[];
  readonly scanVerdict: "clear" | "signals" | "watch";
  readonly scanLabel: string;
  readonly scanTone: string;
  readonly scanLine: string;
  readonly scanProvenance: string;
  readonly primaryAction: { readonly kind: string; readonly label: string };
  readonly notificationsDue: readonly string[];
}

export interface RunbookRunSummary {
  readonly id: number;
  readonly cycleNumber: number;
  readonly startedOn: string;
  readonly status: string;
  readonly completedAt: string | null;
  readonly checkedSteps: number;
  readonly totalSteps: number;
}

export interface Runbook {
  readonly id: number;
  readonly runbookKey: string;
  readonly title: string;
  readonly context: string;
  readonly pillar: string;
  readonly recurring: boolean;
  readonly currentRunId: number | null;
  readonly cycleNumber: number;
  readonly startedOn: string | null;
  readonly cycleDays: number;
  readonly daysElapsed: number;
  readonly daysLeft: number;
  readonly checkedSteps: number;
  readonly totalSteps: number;
  readonly pct: number;
  readonly statusLabel: string;
  readonly steps: readonly RunbookStep[];
  readonly hold: HoldWindow | null;
  readonly runHistory: readonly RunbookRunSummary[];
}

export interface HoldWindowEvent {
  readonly kind: "extended" | "closed_early" | "released" | "cr_prepared";
  readonly daysDelta: number | null;
  readonly reason: string | null;
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

/** A fetch that failed reports its real HTTP status so the page can tell
 * "not in this MSP's book" (403) apart from a generic failure. */
export class RunbooksApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) throw new RunbooksApiError(res.status, `Request failed: ${res.status}`);
  return (await res.json()) as T;
}

export function useMspRunbooks(customerId: number | null): UseQueryResult<RunbooksPayload, RunbooksApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "runbooks", customerId],
    queryFn: ({ signal }) =>
      getJson<RunbooksPayload>(fetchWithAuth, `/api/msp/runbooks?customerId=${customerId}`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 30_000,
  });
}

export function useSetRunbookStep(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ runbookId, position, checked }: { runbookId: number; position: number; checked: boolean }) => {
      if (customerId === null) throw new RunbooksApiError(400, "No customer selected");
      const res = await fetchWithAuth(`/api/msp/runbooks/${runbookId}/steps/${position}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, checked }),
      });
      if (!res.ok) throw new RunbooksApiError(res.status, `Request failed: ${res.status}`);
      return (await res.json()) as { ok: boolean; position: number; checked: boolean };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "runbooks", customerId] });
    },
  });
}

export function useExtendHoldWindow(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ holdId, days, reason }: { holdId: number; days: number; reason: string }) => {
      if (customerId === null) throw new RunbooksApiError(400, "No customer selected");
      const res = await fetchWithAuth(`/api/msp/hold-windows/${holdId}/extend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ customerId, days, reason }),
      });
      if (!res.ok) throw new RunbooksApiError(res.status, `Request failed: ${res.status}`);
      return (await res.json()) as { extendedDays: number };
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "runbooks", customerId] });
    },
  });
}

/**
 * The audit trail for one hold window, fetched on demand (only once someone
 * actually opens the History drawer) rather than folded into the periodic
 * `/runbooks` payload — mirrors the portal's own `loadHoldEvents` reasoning.
 * Returns `null` on failure so a caller can tell "no events" from "the request
 * failed" without inventing a third state.
 */
export function useLoadHoldEvents(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  return useCallback(
    async (holdId: number): Promise<readonly HoldWindowEvent[] | null> => {
      if (customerId === null) return null;
      try {
        const res = await fetchWithAuth(`/api/msp/hold-windows/${holdId}/events?customerId=${customerId}`, { method: "GET" });
        if (!res.ok) return null;
        const body = (await res.json()) as { events?: HoldWindowEvent[] };
        return Array.isArray(body.events) ? body.events : [];
      } catch {
        return null;
      }
    },
    [customerId, fetchWithAuth],
  );
}
