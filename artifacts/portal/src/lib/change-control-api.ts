/**
 * React Query hooks for the customer-facing Change Control module (#1717,
 * Feature #1486), wired to the real, live endpoints documented in
 * `docs/portal/change-control-contract-pack.md` (#2989):
 *
 *   GET  /api/portal/change-control
 *   POST /api/portal/change-control
 *   GET  /api/portal/change-control/freeze-windows
 *   GET  /api/portal/change-control/maintenance-windows
 *   POST /api/portal/change-control/:code/decline
 *   POST /api/portal/change-control/:code/approve
 *   POST /api/portal/change-control/:code/reject
 *   GET  /api/portal/change-control/:code/timeline
 *   POST /api/portal/change-control/:code/comments
 *   POST /api/portal/change-control/:code/attachments
 *   GET  /api/portal/change-control/metrics
 *   GET  /api/portal/change-catalog
 *   POST /api/portal/change-catalog/:id/execute
 *
 * No fixture module, no fallback data — every read either resolves to a real
 * server response or surfaces as a failed/loading state the page renders
 * honestly. `scoped: false` on the register/catalog reads is the fail-closed
 * "no resolvable tenant" envelope, distinct from a genuinely empty result —
 * the page tells them apart (see `pages/change-control.tsx`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth-context";
import type {
  ApiErrorBody,
  AttachmentKind,
  RaiseChangeRequestBody,
  WireChangeControlRegister,
  WireChangeMetrics,
  WireCatalogItem,
  WireCrComment,
  WireCrTimeline,
  WireCrAttachment,
  WireFreezeOrMaintenanceWindow,
} from "@/lib/change-control-types";

async function parseJsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let body: unknown;
    try {
      body = await res.clone().json();
      const parsedBody = body as ApiErrorBody;
      if (parsedBody?.error) message = parsedBody.error;
    } catch {
      // non-JSON error body — keep the generic message
    }
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return (await res.json()) as T;
}

const REGISTER_KEY = ["portal", "change-control", "register"] as const;
const CATALOG_KEY = ["portal", "change-control", "catalog"] as const;
const FREEZE_KEY = ["portal", "change-control", "freeze-windows"] as const;
const MAINTENANCE_KEY = ["portal", "change-control", "maintenance-windows"] as const;
const METRICS_KEY = ["portal", "change-control", "metrics"] as const;

export function useChangeControlRegister() {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: REGISTER_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/change-control", undefined, { silent: true });
      return parseJsonOrThrow<WireChangeControlRegister>(res);
    },
  });
}

export function useFreezeWindows(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: FREEZE_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/change-control/freeze-windows", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ windows: WireFreezeOrMaintenanceWindow[] }>(res);
      return data.windows;
    },
    enabled,
  });
}

export function useMaintenanceWindows(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: MAINTENANCE_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/change-control/maintenance-windows", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ windows: WireFreezeOrMaintenanceWindow[] }>(res);
      return data.windows;
    },
    enabled,
  });
}

export function useChangeCatalog(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/change-catalog", undefined, { silent: true });
      return parseJsonOrThrow<{ items: WireCatalogItem[]; scoped: boolean }>(res);
    },
    enabled,
  });
}

/** 409s with no connected tenant — treated as "unavailable", not an error toast. */
export function useChangeMetrics(enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: METRICS_KEY,
    queryFn: async () => {
      const res = await fetchWithAuth("/api/portal/change-control/metrics", undefined, { silent: true });
      const data = await parseJsonOrThrow<{ metrics: WireChangeMetrics }>(res);
      return data.metrics;
    },
    enabled,
  });
}

export function useChangeTimeline(code: string | null, enabled: boolean) {
  const { fetchWithAuth } = useAuth();
  return useQuery({
    queryKey: ["portal", "change-control", "timeline", code],
    queryFn: async () => {
      const res = await fetchWithAuth(
        `/api/portal/change-control/${encodeURIComponent(code as string)}/timeline`,
        undefined,
        { silent: true },
      );
      return parseJsonOrThrow<WireCrTimeline>(res);
    },
    enabled: enabled && code !== null,
  });
}

export function useRaiseChangeRequest() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: RaiseChangeRequestBody) => {
      const res = await fetchWithAuth("/api/portal/change-control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return parseJsonOrThrow<{ code: string }>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
    },
  });
}

export function useApproveChange() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, note }: { code: string; note?: string }) => {
      const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note }),
      });
      return parseJsonOrThrow<{ code: string; approved: boolean; stage: number; complete: boolean }>(res);
    },
    onSettled: () => {
      // The server re-checks capability/stage-order/separation-of-duties on
      // every call — refetch rather than optimistically patch, since our
      // local canApproveNow may have gone stale (another approver acted, or
      // the requester matched after all).
      void queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
    },
  });
}

export function useRejectChange() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, reason }: { code: string; reason: string }) => {
      const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      return parseJsonOrThrow<{ code: string; rejected: boolean; riskAssigned: boolean }>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
    },
  });
}

export function useDeclineChange() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, fullName, statement }: { code: string; fullName: string; statement: string }) => {
      const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/decline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, statement }),
      });
      return parseJsonOrThrow<{ code: string; declined: boolean; riskAccepted: boolean }>(res);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
    },
  });
}

export function useAddChangeComment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, body }: { code: string; body: string }) => {
      const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body }),
      });
      return parseJsonOrThrow<{ code: string; comment: WireCrComment }>(res);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["portal", "change-control", "timeline", variables.code] });
    },
  });
}

export function useAddChangeAttachment() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, kind, label }: { code: string; kind: AttachmentKind; label: string }) => {
      const res = await fetchWithAuth(`/api/portal/change-control/${encodeURIComponent(code)}/attachments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, label }),
      });
      return parseJsonOrThrow<{ code: string; attachment: WireCrAttachment }>(res);
    },
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: ["portal", "change-control", "timeline", variables.code] });
    },
  });
}

export function useExecuteCatalogItem() {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (itemId: number) => {
      const res = await fetchWithAuth(`/api/portal/change-catalog/${itemId}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return parseJsonOrThrow<{ code: string; catalogItemId: number; title: string }>(res);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: REGISTER_KEY });
    },
  });
}
