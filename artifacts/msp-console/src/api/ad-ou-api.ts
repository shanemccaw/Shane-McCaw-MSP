/**
 * ad-ou-api.ts — the data seam for the MSP Console's AD OU Assignment module
 * page (#3818, wiring the real MSP-staff-gated CRUD).
 *
 * Wraps the routes in `artifacts/api-server/src/routes/msp-active-directory.ts`
 * (contract pack: `docs/msp-console/active-directory-ou-assignment-msp-console-
 * contract-pack.md`):
 *
 *   GET    /api/msp/active-directory/ous?customerId=                  — every
 *          OU that belongs to this customer (never the platform-wide
 *          null-tenant case — that is only readable by PlatformAdmin, via a
 *          different route this surface never calls)
 *   GET    /api/msp/active-directory/ou/:id/assignments                — every
 *          manual placement currently pointed at one OU
 *   POST   /api/msp/active-directory/ou/:id/assignments                — verify
 *          an address against the real directory, then place it (upserts —
 *          re-placing an already-placed object MOVES it, no second row)
 *   PATCH  /api/msp/active-directory/ou-assignments/:id                — move an
 *          EXISTING placement to a different OU; does not re-verify Graph
 *          (that asymmetry is real and load-bearing, not a bug to fix)
 *   DELETE /api/msp/active-directory/ou-assignments/:id                — clear a
 *          placement outright; the object falls back to the department-name
 *          guess for policy purposes
 *   GET    /api/msp/active-directory/ou-assignment-requests             — every
 *          customer-raised request in the caller's MSP book (not filterable by
 *          customer server-side, so this module filters client-side to the
 *          selected tenant), newest first, optional `?status=`
 *   PATCH  /api/msp/active-directory/ou-assignment-requests/:id         — answer
 *          one: approved/rejected/fulfilled. Approving/fulfilling a request
 *          that named a real `requestedOuId` immediately applies it (the same
 *          Graph-verified upsert the POST route uses) — a request naming a
 *          unit that no longer exists, or was only ever free text, moves to
 *          the chosen status and writes nothing.
 *
 * A manual placement always wins over the department-match guess for policy
 * evaluation; clearing one hands the object straight back to the guess. This
 * module never reads or writes the guess itself — only the manual overrides.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type OuAssignmentRequestStatus = "pending" | "approved" | "rejected" | "fulfilled";

export interface OrgUnit {
  readonly id: number;
  readonly name: string;
}

export interface OuAssignment {
  readonly id: number;
  readonly mspId: number;
  readonly ouId: number;
  readonly customerId: number;
  readonly tenantId: string;
  readonly objectId: string;
  readonly objectUpn: string;
  readonly objectDisplayName: string | null;
  readonly assignedByUserId: number | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface OuAssignmentRequest {
  readonly id: number;
  readonly mspId: number;
  readonly customerId: number;
  readonly tenantId: string;
  readonly objectUpn: string;
  readonly objectDisplayName: string | null;
  readonly currentOuId: number | null;
  readonly requestedOuId: number | null;
  readonly requestedOuName: string | null;
  readonly note: string;
  readonly status: OuAssignmentRequestStatus;
  readonly requestedByUserId: number | null;
  readonly resolvedByUserId: number | null;
  readonly resolvedAt: string | null;
  readonly resolutionNote: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResolveRequestResult {
  readonly request: OuAssignmentRequest;
  readonly appliedAssignment: OuAssignment | null;
}

/** A fetch that failed reports its real HTTP status and, when the server sent
 * one, its real error text — so the UI can show the directory's own refusal
 * message rather than a generic failure. */
export class AdOuApiError extends Error {
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
  if (!res.ok) throw new AdOuApiError(res.status, `Request failed: ${res.status}`);
  return (await res.json()) as T;
}

async function sendJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body?: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const parsed = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new AdOuApiError(res.status, (parsed as { error?: string }).error ?? `Request failed: ${res.status}`);
  }
  return parsed as T;
}

export function useOus(customerId: number | null): UseQueryResult<{ ous: OrgUnit[] }, AdOuApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "ad", "ous", customerId],
    queryFn: ({ signal }) =>
      getJson<{ ous: OrgUnit[] }>(fetchWithAuth, `/api/msp/active-directory/ous?customerId=${customerId}`, signal),
    enabled: !isLoading && !!accessToken && customerId !== null,
    staleTime: 20_000,
  });
}

export function useOuAssignments(ouId: number | null): UseQueryResult<OuAssignment[], AdOuApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "ad", "ou-assignments", ouId],
    queryFn: ({ signal }) =>
      getJson<OuAssignment[]>(fetchWithAuth, `/api/msp/active-directory/ou/${ouId}/assignments`, signal),
    enabled: !isLoading && !!accessToken && ouId !== null,
    staleTime: 10_000,
  });
}

/** Verify + place. Re-placing an already-placed object moves it — the caller
 * doesn't need to know which OU it was previously in. */
export function useAssignObject(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ ouId, objectUpn }: { ouId: number; objectUpn: string }) =>
      sendJson<OuAssignment>(fetchWithAuth, `/api/msp/active-directory/ou/${ouId}/assignments`, "POST", { customerId, objectUpn }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "ad", "ou-assignments"] });
    },
  });
}

/** Move an EXISTING placement to a different OU. Does not re-verify Graph —
 * the identity captured at first placement carries across untouched. */
export function useMoveAssignment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId, ouId }: { assignmentId: number; ouId: number }) =>
      sendJson<OuAssignment>(fetchWithAuth, `/api/msp/active-directory/ou-assignments/${assignmentId}`, "PATCH", { ouId }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "ad", "ou-assignments"] });
    },
  });
}

/** Clear a placement outright — a hard delete, no history. */
export function useClearAssignment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ assignmentId }: { assignmentId: number }) =>
      sendJson<void>(fetchWithAuth, `/api/msp/active-directory/ou-assignments/${assignmentId}`, "DELETE"),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "ad", "ou-assignments"] });
    },
  });
}

/** The server never accepts a `customerId` filter on this route — it returns
 * every request in the caller's MSP book (staff-scoped). This module filters
 * to the selected tenant client-side. */
export function useOuAssignmentRequests(): UseQueryResult<OuAssignmentRequest[], AdOuApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "ad", "ou-assignment-requests"],
    queryFn: ({ signal }) =>
      getJson<OuAssignmentRequest[]>(fetchWithAuth, "/api/msp/active-directory/ou-assignment-requests", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export function useResolveOuAssignmentRequest() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, status, resolutionNote }: { requestId: number; status: "approved" | "rejected" | "fulfilled"; resolutionNote?: string }) =>
      sendJson<ResolveRequestResult>(fetchWithAuth, `/api/msp/active-directory/ou-assignment-requests/${requestId}`, "PATCH", {
        status,
        ...(resolutionNote ? { resolutionNote } : {}),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "ad", "ou-assignment-requests"] });
      void queryClient.invalidateQueries({ queryKey: ["msp", "ad", "ou-assignments"] });
    },
  });
}
