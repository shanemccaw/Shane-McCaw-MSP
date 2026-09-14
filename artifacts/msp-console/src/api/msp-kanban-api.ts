/**
 * Projects — Simple Kanban (Phase 1, Git #3773) client hooks (#2621, Feature
 * #2561). Backed by `artifacts/api-server/src/routes/msp-kanban.ts` — see
 * `docs/msp-console/projects-msp-console-contract-pack.md` for the full wire
 * contract this file follows verbatim.
 *
 * Real, current absences carried straight through from the pack (not gaps
 * this file invents): no card `type`/`status` field (Phase 2), no bulk/batch
 * routes (every mutation is one row), and position is never renumbered by the
 * server — a caller that wants clean positions after a delete/move has to
 * compute and send them itself, which this Phase-1 UI deliberately doesn't do
 * (append-to-end only, matching the design's own logic class).
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
  method: "POST" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T | undefined> {
  const res = await fetchWithAuth(url, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
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
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

export interface KanbanCard {
  id: number;
  bucketId: number;
  title: string;
  description: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface KanbanBucket {
  id: number;
  customerId: number;
  name: string;
  position: number;
  createdAt: string;
  updatedAt: string;
  cards: KanbanCard[];
}

function boardKey(customerId: number | null) {
  return ["msp", "kanban", "board", customerId] as const;
}

export function useKanbanBoard(customerId: number | null): UseQueryResult<KanbanBucket[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: boardKey(customerId),
    queryFn: ({ signal }) =>
      getJson<{ buckets: KanbanBucket[] }>(
        fetchWithAuth, `/api/msp/customers/${customerId}/kanban/buckets`, signal,
      ).then((r) => r.buckets),
    enabled: !isLoading && !!accessToken && customerId != null,
    staleTime: 10_000,
  });
}

export function useCreateBucket(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ name, position }: { name: string; position?: number }) =>
      sendJson<{ bucket: Omit<KanbanBucket, "cards"> }>(
        fetchWithAuth, "POST", `/api/msp/customers/${customerId}/kanban/buckets`, { name, position },
      ).then((r) => r!.bucket),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export function usePatchBucket(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name, position }: { id: number; name?: string; position?: number }) =>
      sendJson<{ bucket: Omit<KanbanBucket, "cards"> }>(
        fetchWithAuth, "PATCH", `/api/msp/kanban/buckets/${id}`, { name, position },
      ).then((r) => r!.bucket),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export function useDeleteBucket(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sendJson(fetchWithAuth, "DELETE", `/api/msp/kanban/buckets/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export function useCreateCard(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucketId, title, description, position }: {
      bucketId: number; title: string; description?: string; position?: number;
    }) =>
      sendJson<{ card: KanbanCard }>(
        fetchWithAuth, "POST", `/api/msp/kanban/buckets/${bucketId}/cards`, { title, description, position },
      ).then((r) => r!.card),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export function usePatchCard(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, title, description, bucketId, position }: {
      id: number; title?: string; description?: string | null; bucketId?: number; position?: number;
    }) =>
      sendJson<{ card: KanbanCard }>(
        fetchWithAuth, "PATCH", `/api/msp/kanban/cards/${id}`, { title, description, bucketId, position },
      ).then((r) => r!.card),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export function useDeleteCard(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => sendJson(fetchWithAuth, "DELETE", `/api/msp/kanban/cards/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}
