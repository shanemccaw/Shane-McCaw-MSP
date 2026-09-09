/**
 * React Query hooks for the customer-facing Ownership / RACI matrix
 * (#3040/#3041, Feature #1491).
 *
 * Wired to the real, live endpoints documented in
 * `docs/portal/ownership-raci-contract-pack.md`:
 *   GET  /api/portal/ownership              — matrix + saved overlay (§1a, #3040)
 *   POST /api/portal/ownership/assign        — set/clear one cell holder (§1b, #3041)
 *   POST /api/portal/ownership/accept        — mark a pending cell accepted
 *   POST /api/portal/ownership/decline       — mark a pending cell declined
 *   POST /api/portal/ownership/rows          — add a row (custom)
 *   POST /api/portal/ownership/delegations       — start a handover
 *   POST /api/portal/ownership/delegations/end   — end a handover
 *
 * `reorder` is real and live on the same route file but has no control
 * anywhere in the Design export for this page (confirmed — no
 * "reorder"/precedence-editing markup in
 * `Design/portal/design_handoff_full_site/screens/Ownership RACI.dc.html`),
 * and precedence carries no succession/activation logic anywhere in the
 * codebase (contract pack §4, "precedence is informational only") — so this
 * pass does not invent a control the design doesn't call for. See
 * `pages/ownership.tsx`'s own "what this page deliberately does not do"
 * note.
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page itself
 * renders honestly, and every write below is a real POST against the tables
 * `ownership-matrix.ts`'s own header documents.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  OwnRoleKey,
  WireOwnAssignment,
  WireOwnDelegation,
  WireOwnRow,
  WireOwnershipPayload,
} from "@/lib/ownership-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    try {
      const body = (await res.clone().json()) as ApiErrorBody;
      const err = body?.error;
      if (typeof err === "string") message = err;
      else if (err?.message) message = err.message;
      code = body?.code;
    } catch {
      // non-JSON error body — keep the generic message
    }
    // `requireTierFeature` (portal-tier-features.ts) answers 402 with
    // code: "TIER_UPGRADE_REQUIRED" when this customer's plan doesn't bundle
    // Ownership/RACI — a distinct, honest state from a failed read, not a
    // generic error (contract pack §1a's requireTierFeature gate).
    const httpErr = new Error(message) as Error & { status?: number; code?: string };
    httpErr.status = res.status;
    httpErr.code = code;
    throw httpErr;
  }
  return (await res.json()) as T;
}

const OWNERSHIP_QUERY_KEY = ["portal", "ownership"] as const;

export function useOwnership() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: OWNERSHIP_QUERY_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/ownership", undefined, { silent: true });
      return parseJsonOrThrow<WireOwnershipPayload>(res);
    },
  });
}

/**
 * Set or clear one cell holder (§1b, `POST /portal/ownership/assign`).
 * Invalidates the whole matrix on settle rather than patching optimistically
 * — the server recomputes acceptance, precedence and the event log
 * atomically, and a cell may already carry other holders this client
 * doesn't know the exact order of.
 */
export function useAssignOwnership() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/assign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: boolean; assignment: WireOwnAssignment }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}

export function useAcceptOwnership() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId?: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: boolean; matched: boolean }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}

/** Customer-side decline (§1b, #1519) — `reason` is optional; a decline escalates to the assigner instead. */
export function useDeclineOwnership() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId?: string; reason?: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/decline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: boolean; matched: boolean }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}

/** Add a row (§1b, `POST /portal/ownership/rows`, `source: "custom"`). */
export function useAddOwnershipRow() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { rowId: string; objType: string; name: string; sub?: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, source: "custom" }),
      });
      return parseJsonOrThrow<{ ok: boolean; row: WireOwnRow }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}

/** Start a dated handover (§1b, `POST /portal/ownership/delegations`). */
export function useStartDelegation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { fromPersonId: string; toPersonId: string; until: string; scope?: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/delegations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: boolean; delegation: WireOwnDelegation }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}

/** End the active handover(s) from a person (§1b, `POST /portal/ownership/delegations/end`) — flips `done`, never deletes. */
export function useEndDelegation() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: { fromPersonId: string }) => {
      const res = await fetchWithAuth("/api/portal/ownership/delegations/end", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: boolean; ended: number }>(res);
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: OWNERSHIP_QUERY_KEY }),
  });
}
