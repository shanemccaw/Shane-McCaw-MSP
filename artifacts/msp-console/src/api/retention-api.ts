/**
 * Retention Queue module's own data (Git #3817, screen 44). Backed by three
 * real routes in `artifacts/api-server/src/routes/msp-retention-queue.ts`,
 * all `requireRole("MSPOperator")`-gated and scoped to the caller's own MSP
 * (and, if the caller is a scoped staff member, to their assigned tenants) —
 * see `docs/msp-console/retention-queue-msp-console-contract-pack.md` for the
 * full wire contract this file is built against.
 *
 * `GET /api/msp/retention/queue` returns the whole pending-acceleration queue
 * in one response — no paging, no query params.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

async function getJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "GET", signal });
  if (!res.ok) {
    const err = new Error(`Request failed: ${res.status}`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

async function sendJson<T>(
  fetchWithAuth: (i: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  url: string,
  body: unknown,
): Promise<T> {
  const res = await fetchWithAuth(url, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) {
    let message = `Request failed: ${res.status}`;
    try {
      const data = (await res.json()) as { error?: string; message?: string };
      message = data.error || data.message || message;
    } catch { /* body wasn't JSON — keep the status-based message */ }
    const err = new Error(message) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

// ── GET /api/msp/retention/queue ─────────────────────────────────────────────

export type RetentionStage = "soft" | "semi_hard" | "purged" | "restored";
export type RetentionDeleteSide = "customer" | "operator" | "system";
export type RetentionAccelerationState = "none" | "pending" | "approved" | "declined";
export type RetentionReasonKind = "superseded_by" | "no_longer_needed";

export interface AccelerationQueueItem {
  deletionId: number;
  recordType: string;
  recordId: string;
  recordLabel: string | null;
  tenantId: number;
  tenantName: string | null;
  stage: RetentionStage;
  deletedAt: string;
  deletedBy: string;
  deletedBySide: RetentionDeleteSide;
  deleteReason: string;
  accelerationState: RetentionAccelerationState;
  accelerationRequestedAt: string;
  accelerationRequestedBy: string;
  accelerationReasonKind: RetentionReasonKind;
  accelerationReason: string;
  supersededByRecordType: string | null;
  supersededByRecordId: string | null;
}

export interface RetentionQueueResponse {
  queue: AccelerationQueueItem[];
  total: number;
}

export function useRetentionQueue(): UseQueryResult<RetentionQueueResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "retention", "queue"],
    queryFn: ({ signal }) =>
      getJson<RetentionQueueResponse>(fetchWithAuth, "/api/msp/retention/queue", signal),
    enabled: !isLoading && !!accessToken,
    staleTime: 15_000,
  });
}

// ── POST /api/msp/retention/queue/:deletionId/decide ─────────────────────────

/** The raw ledger row, unmapped — same camelCase-from-schema shape the route returns. */
export interface RecordDeletion {
  id: number;
  [key: string]: unknown;
}

export interface DecideInput {
  deletionId: number;
  approve: boolean;
  note?: string;
}

export function useDecideAcceleration() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deletionId, ...body }: DecideInput) =>
      sendJson<{ deletion: RecordDeletion }>(
        fetchWithAuth, `/api/msp/retention/queue/${deletionId}/decide`, body,
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "retention", "queue"] }); },
  });
}

// ── POST /api/msp/retention/queue/:deletionId/discuss ────────────────────────

export interface DiscussInput {
  deletionId: number;
  reason: string;
}

export function useDiscussRestore() {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ deletionId, reason }: DiscussInput) =>
      sendJson<{ deletion: RecordDeletion }>(
        fetchWithAuth, `/api/msp/retention/queue/${deletionId}/discuss`, { reason },
      ),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["msp", "retention", "queue"] }); },
  });
}
