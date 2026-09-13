/**
 * dlq-api.ts — the data seam for the MSP Console's Dead Letter Queue module
 * page (Git #3816, screen 43,
 * `Design/MSP_Console/design_handoff_msp_console/DLQ.dc.html`), wiring the
 * real four-route surface documented in full at
 * `docs/msp-console/dlq-msp-console-contract-pack.md`:
 *
 *   GET   /api/msp/dlq                    — every parked item for this MSP
 *   POST  /api/msp/dlq/:dlqId/replay      — replay a single item
 *   PATCH /api/msp/dlq/:dlqId             — discard / mark handled-by-hand / edit payload
 *   POST  /api/msp/dlq/bulk-replay        — replay several items at once
 *
 * **Real, honest departure from the design's fixture-driven mock.** The
 * design's own copy describes Replay as "held closed unless the payload
 * carries a workflow key ... every live row fails that way (#3446)" and Bulk
 * Replay as "drawn disabled: registered one path level too deep and 404s
 * (#3445)." Both #3446 and #3445 were fixed and closed completed on
 * 2026-09-11, a day before this design was generated — confirmed again
 * directly against `artifacts/api-server/src/routes/msp-dlq.ts` on `main` in
 * this same build: `isReplayable()` guards both replay routes, `GET
 * /api/msp/dlq` now returns a real `replayable` boolean per row, and the
 * bulk-replay route is mounted at the correct relative path. This module
 * therefore builds Replay and Bulk Replay as real, working actions gated by
 * the server's own `replayable` field — not as permanently disabled UI
 * implying a still-broken backend.
 *
 * No fixture module, no fabricated row — every value here comes from a real
 * server response.
 */
import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";

export type DlqResolution = "replayed" | "discarded" | "manual";

export interface DlqItem {
  readonly id: number;
  readonly dlqId: string;
  readonly sourceEventId: string | null;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly errorMessage: string;
  readonly errorStack: string | null;
  readonly attemptCount: number;
  readonly lastAttemptAt: string;
  readonly resolvedAt: string | null;
  readonly resolution: DlqResolution | null;
  readonly mspId: number | null;
  readonly customerId: number | null;
  readonly createdAt: string;
  readonly tenantId: string | null;
  readonly tenantName: string | null;
  /** Real server-computed field (Git #3446 fix) — whether `payload` carries a
   * `workflowKey` the workflow engine can rebuild a run from. Both Replay
   * routes now refuse anything else with a clean 400 before ever calling
   * `replayDlqItem`, so this field is the same check the server itself runs. */
  readonly replayable: boolean;
}

export interface BulkReplayResult {
  readonly dlqId: string;
  readonly success: boolean;
  readonly newRunId?: string;
  readonly error?: string;
}

export interface BulkReplayResponse {
  readonly replayedCount: number;
  readonly results: BulkReplayResult[];
}

export class DlqApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
  }
}

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.clone().json()) as { error?: string | { message?: string } };
      if (typeof body?.error === "string") message = body.error;
      else if (body?.error?.message) message = body.error.message;
    } catch {
      // non-JSON error body — keep the generic message
    }
    throw new DlqApiError(res.status, message);
  }
  return (await res.json()) as T;
}

const listKey = ["msp", "dlq", "list"] as const;

export function useDlqItems(): UseQueryResult<DlqItem[], DlqApiError> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: listKey,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/msp/dlq");
      return parseJsonOrThrow<DlqItem[]>(res);
    },
    enabled: !isLoading && !!accessToken,
    staleTime: 10_000,
  });
}

export function useReplayDlqItem() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dlqId: string) => {
      const res = await fetchWithAuth(`/api/msp/dlq/${dlqId}/replay`, { method: "POST" });
      return parseJsonOrThrow<{ ok: true; dlqId: string; newRunId: string; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

export function useBulkReplayDlqItems() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (dlqIds: string[]) => {
      const res = await fetchWithAuth("/api/msp/dlq/bulk-replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dlqIds }),
      });
      return parseJsonOrThrow<BulkReplayResponse>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

export function useResolveDlqItem() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dlqId, resolution }: { dlqId: string; resolution: "discarded" | "manual" }) => {
      const res = await fetchWithAuth(`/api/msp/dlq/${dlqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolution }),
      });
      return parseJsonOrThrow<{ dlqId: string; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });
}

export function useSaveDlqPayload() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ dlqId, payload }: { dlqId: string; payload: Record<string, unknown> }) => {
      const res = await fetchWithAuth(`/api/msp/dlq/${dlqId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ payload }),
      });
      return parseJsonOrThrow<{ dlqId: string; message: string }>(res);
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: listKey }),
  });
}
