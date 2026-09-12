/**
 * ownership-api.ts — the data seam for the MSP Console's Ownership / RACI
 * module page (Git #2594, Feature #1686). Mounts at `/tenants/:id/raci`
 * (`Design/MSP_Console/design_handoff_msp_console/Ownership.dc.html`, README
 * screen 37), wiring the real endpoint set behind #1491 (Portal, closed
 * completed) plus the MSP-side additions this issue adds:
 *
 *   `GET  /msp/ownership/mine`              — already live (#1521)
 *   `POST /msp/ownership/:customerId/assign`  — already live (#2162)
 *   `POST /msp/ownership/:customerId/accept`  — already live (#2162)
 *   `POST /msp/ownership/:customerId/decline` — already live (#2162)
 *   `GET  /msp/ownership/:customerId`         — NEW (#2594) — one customer's
 *       full matrix, the MSP-scoped equivalent of the customer-facing
 *       `GET /portal/ownership`. Calls the identical server-side assembly
 *       (`assembleOwnershipPayload`) — the read is shared, not forked.
 *   `GET  /msp/ownership/:customerId/events`  — NEW (#2594) — one cell's
 *       append-only history (#1522), the MSP-scoped equivalent of
 *       `GET /portal/ownership/events`, same shared query underneath.
 *   `POST /msp/ownership/:customerId/chase`   — NEW (#2594) — resend the
 *       pending-acceptance nudge for a cell. Writes no row and appends no
 *       event; only a real accept/decline changes state.
 *
 * Real, honest departures from the design's fixture-driven mock
 * (`Ownership.dc.html`'s own `renderVals()`):
 *   - The design's own state carries an internal `tenant` field the operator
 *     switches with tab chips inside the "One customer" tab. This app's real
 *     navigation model is "every selection has a real URL" (console/nav.ts) —
 *     the tenant this module reads for its matrix tab is the CURRENT route's
 *     tenant (`/tenants/:id/raci`), not internal component state. Choosing a
 *     different customer from "What we hold" / "Across the book" navigates
 *     the URL to that customer's own `raci` page instead of mutating a local
 *     `tenant` string.
 *   - Per #1524's real decision, there is no delegation affordance here at
 *     all — read or write. The design's own drawer never showed one either.
 *   - "Chase" is new, real, added functionality this console adds on top of
 *     the design's mock (whose own `honestNote` says plainly "nothing chases
 *     these" — true of the state before this issue, not a ban on adding it).
 *   - No add-a-row / custom-row affordance — #1686's own scope list names
 *     assign / accept / chase / event log / missing-owner list; adding rows
 *     stays the customer's own `/portal/ownership/rows` affordance.
 *   - `people` already carries the MSP's own staff (side "MSP") for this
 *     customer — see `gatherOwnershipObjects`'s header — so "who can be
 *     placed" for a propose action needs no separate roster call.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export class OwnershipApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new OwnershipApiError(res.status, message);
  }
  return (await res.json()) as T;
}

// ── Real wire shapes (column-for-column from lib/portal-ownership.ts) ────────

export type OwnRoleKey = "r" | "a" | "c" | "i";
export type OwnObjectType = "service" | "change" | "cr" | "control" | "freeze" | "incident" | "announce" | "workload";
export type OwnershipGateMode = "strict" | "loose";

export interface WireOwnPerson {
  readonly id: string;
  readonly name: string;
  readonly role: string;
  readonly side: string;
  readonly kind: "Person" | "Group" | "Vendor";
  readonly away: string;
  readonly deputy: string;
}

export interface WireOwnObject {
  readonly type: OwnObjectType;
  readonly id: string;
  readonly name: string;
  readonly sub: string;
  readonly r: string;
  readonly a: string;
  readonly c: string;
  readonly i: string;
  readonly svc?: string;
  readonly when?: string;
  readonly over?: boolean;
  readonly link: string;
}

export interface WireOwnSource {
  readonly type: OwnObjectType;
  readonly live: boolean;
  readonly count: number;
  readonly note: string;
}

export interface WireOwnAssignment {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly acceptance: string;
  readonly setBy: string;
  readonly setAt: string;
  readonly setWhy: string;
  readonly order: number;
  readonly respondedBy: string;
  readonly respondedAt: string;
  readonly declineReason: string;
}

export interface WireOwnershipOverlay {
  readonly assignments: readonly WireOwnAssignment[];
  readonly delegations: readonly unknown[];
  readonly rows: readonly unknown[];
}

export interface WireOwnershipPayload {
  readonly customer: { readonly id: number; readonly name: string };
  readonly sides: readonly string[];
  readonly people: readonly WireOwnPerson[];
  readonly objects: readonly WireOwnObject[];
  readonly sources: readonly WireOwnSource[];
  readonly currentUserId: string;
  readonly currentUserName: string;
  readonly tenantScoped: boolean;
  readonly overlay: WireOwnershipOverlay;
  readonly gateMode: OwnershipGateMode;
}

export type OwnEventType = "assigned" | "accepted" | "declined" | "cleared" | "reassigned";

export interface WireOwnEvent {
  readonly objectId: string;
  readonly roleKey: string;
  readonly ownerPersonId: string;
  readonly eventType: OwnEventType;
  readonly actor: string;
  readonly reason: string;
  readonly at: string;
}

// ── Cross-customer "what we hold" (GET /msp/ownership/mine) ──────────────────

export interface WireMspOwnHolding {
  readonly customerId: number;
  readonly customerName: string;
  readonly objectType: OwnObjectType;
  readonly objectId: string;
  readonly objectName: string;
  readonly sub: string;
  readonly link: string;
  readonly roleKey: OwnRoleKey;
  readonly holderPersonId: string;
  readonly holderPersonName: string;
  readonly acceptance: string;
  readonly order: number;
  readonly declineReason: string;
}

export interface WireMspOwnCustomerCoverage {
  readonly customerId: number;
  readonly customerName: string;
  readonly count: number;
}

export interface WireMspOwnershipBook {
  readonly mspPersonCount: number;
  readonly customerCount: number;
  readonly holdings: readonly WireMspOwnHolding[];
  readonly byCustomer: readonly WireMspOwnCustomerCoverage[];
}

// ── Query keys ─────────────────────────────────────────────────────────────

const K = {
  mine: ["msp", "ownership", "mine"] as const,
  matrix: (customerId: number) => ["msp", "ownership", customerId] as const,
  events: (customerId: number, objectId: string, roleKey: OwnRoleKey, ownerPersonId?: string) =>
    ["msp", "ownership", customerId, "events", objectId, roleKey, ownerPersonId ?? ""] as const,
};

function useAuthedFetch() {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return { fetchWithAuth, ready: !isLoading && !!accessToken };
}

// ── GET /msp/ownership/mine ────────────────────────────────────────────────

export function useOwnershipMine(): UseQueryResult<WireMspOwnershipBook, OwnershipApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.mine,
    queryFn: async () => parseJsonOrThrow<WireMspOwnershipBook>(await fetchWithAuth("/api/msp/ownership/mine")),
    enabled: ready,
    staleTime: 15_000,
  });
}

// ── GET /msp/ownership/:customerId ────────────────────────────────────────

export function useOwnershipMatrix(customerId: number | null): UseQueryResult<WireOwnershipPayload, OwnershipApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.matrix(customerId ?? -1),
    queryFn: async () =>
      parseJsonOrThrow<WireOwnershipPayload>(await fetchWithAuth(`/api/msp/ownership/${customerId}`)),
    enabled: ready && customerId != null,
    staleTime: 10_000,
  });
}

// ── GET /msp/ownership/:customerId/events ─────────────────────────────────

export function useOwnershipEvents(
  customerId: number | null,
  cell: { objectId: string; roleKey: OwnRoleKey; ownerPersonId?: string } | null,
): UseQueryResult<{ events: WireOwnEvent[] }, OwnershipApiError> {
  const { fetchWithAuth, ready } = useAuthedFetch();
  return useQuery({
    queryKey: K.events(customerId ?? -1, cell?.objectId ?? "", cell?.roleKey ?? "r", cell?.ownerPersonId),
    queryFn: async () => {
      const params = new URLSearchParams({ objectId: cell!.objectId, roleKey: cell!.roleKey });
      if (cell!.ownerPersonId) params.set("ownerPersonId", cell!.ownerPersonId);
      return parseJsonOrThrow<{ events: WireOwnEvent[] }>(
        await fetchWithAuth(`/api/msp/ownership/${customerId}/events?${params.toString()}`),
      );
    },
    enabled: ready && customerId != null && !!cell,
    staleTime: 5_000,
  });
}

// ── Mutations ──────────────────────────────────────────────────────────────

function invalidateCustomer(qc: ReturnType<typeof useQueryClient>, customerId: number) {
  void qc.invalidateQueries({ queryKey: K.matrix(customerId) });
  void qc.invalidateQueries({ queryKey: K.mine });
}

export function useAssignMspOwnership(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId: string }) => {
      const res = await fetchWithAuth(`/api/msp/ownership/${customerId}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: true; orderRank: number }>(res);
    },
    onSuccess: () => invalidateCustomer(qc, customerId),
  });
}

export function useAcceptMspOwnership(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId?: string }) => {
      const res = await fetchWithAuth(`/api/msp/ownership/${customerId}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: true; matched: boolean }>(res);
    },
    onSuccess: () => invalidateCustomer(qc, customerId),
  });
}

export function useDeclineMspOwnership(customerId: number) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId?: string; reason: string }) => {
      const res = await fetchWithAuth(`/api/msp/ownership/${customerId}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: true; matched: boolean }>(res);
    },
    onSuccess: () => invalidateCustomer(qc, customerId),
  });
}

export function useChaseMspOwnership(customerId: number) {
  const { fetchWithAuth } = useAuth();
  return useMutation({
    mutationFn: async (body: { objectId: string; roleKey: OwnRoleKey; ownerPersonId: string }) => {
      const res = await fetchWithAuth(`/api/msp/ownership/${customerId}/chase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ ok: true }>(res);
    },
  });
}
