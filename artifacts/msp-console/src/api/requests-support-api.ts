/**
 * requests-support-api.ts — the data seam for the MSP Console's Requests and
 * Support Chat module page (#2650, Feature #2570). The operator counterpart
 * to the Portal-side customer requests surface, backed by #2672's real
 * routes (`artifacts/api-server/src/routes/msp-support.ts`) — confirmed live
 * and under test before this file was written. See
 * `docs/msp-console/requests-and-support-chat-msp-console-contract-pack.md`
 * for the full, real wire contract this wraps.
 *
 *   GET  /api/msp/support/requests               — org-scoped ticket list
 *   GET  /api/msp/support/requests/:ticketId      — one ticket + full thread,
 *                                                    including private notes
 *   POST /api/msp/support/requests/:ticketId/reply — public reply or internal note
 *
 * `mspId` is resolved entirely server-side from the caller's own session —
 * there is no client-side override anywhere in this file, same discipline
 * the backend route enforces.
 *
 * Both a customer-opened request and a ShaneBot chat escalation land in this
 * same list — there is no structured field distinguishing them, only the
 * `subject` convention ("Support escalation from <name>") the contract pack
 * documents. No fixture module — every row is a real server response.
 */
import { useQuery, useMutation, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export interface CustomerTicketSummary {
  id: string;
  ticketNumber: string | null;
  subject: string;
  status: string | null;
  statusType: string | null;
  createdTime: string | null;
  modifiedTime: string | null;
  webUrl: string | null;
}

export interface CustomerTicketThreadEntry {
  id: string;
  kind: "thread" | "comment";
  direction: "in" | "out" | null;
  author: string | null;
  isPublic: boolean;
  content: string;
  createdTime: string | null;
}

export interface RequestsListResult {
  configured: boolean;
  requests: CustomerTicketSummary[];
  count: number;
}

export interface RequestDetailResult {
  request: CustomerTicketSummary;
  thread: CustomerTicketThreadEntry[];
}

export class SupportApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string };
      if (typeof body?.error === "string") message = body.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new SupportApiError(res.status, message);
  }
  return (await res.json()) as T;
}

export function useSupportRequests(params: { limit: number; offset: number }): UseQueryResult<RequestsListResult, SupportApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "support-requests", params.limit, params.offset],
    queryFn: async () => {
      const qs = new URLSearchParams({ limit: String(params.limit), offset: String(params.offset) });
      const res = await fetchWithAuth(`/api/msp/support/requests?${qs.toString()}`);
      return parseJsonOrThrow<RequestsListResult>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export function useSupportRequestDetail(ticketId: string | null): UseQueryResult<RequestDetailResult, SupportApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "support-requests", "detail", ticketId],
    queryFn: async () => {
      const res = await fetchWithAuth(`/api/msp/support/requests/${encodeURIComponent(ticketId as string)}`);
      return parseJsonOrThrow<RequestDetailResult>(res);
    },
    enabled: !isLoading && !!accessToken && ticketId != null,
    staleTime: 5_000,
  });
}

export function useReplyToRequest(ticketId: string | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: { message: string; isPublic: boolean }) => {
      const res = await fetchWithAuth(`/api/msp/support/requests/${encodeURIComponent(ticketId as string)}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      return parseJsonOrThrow<{ queued: boolean; message: string }>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["msp", "support-requests"] });
    },
  });
}

/**
 * An escalated ticket has no structured field of its own — the backend
 * conflates it with a customer-opened request in the same list (contract
 * pack §4). This is the same `subject`-text convention the real
 * `escalateToAdmin()` writer uses, documented here rather than a fabricated
 * enum.
 */
export function isEscalation(subject: string): boolean {
  return subject.startsWith("Support escalation from");
}
