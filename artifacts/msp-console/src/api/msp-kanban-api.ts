/**
 * Projects — Simple Kanban (Phase 1, Git #3773; typed cards Phase 2, Git
 * #4240) client hooks (#2621, Feature #2561). Backed by
 * `artifacts/api-server/src/routes/msp-kanban.ts` — see
 * `docs/msp-console/projects-msp-console-contract-pack.md` for the Phase 1
 * wire contract this file originally followed verbatim (now extended by
 * #4240's real `type`/linked-entity fields, not yet re-extracted into that
 * pack).
 *
 * Real, current absences carried straight through (not gaps this file
 * invents): no bulk/batch routes (every mutation is one row), and position
 * is never renumbered by the server — a caller that wants clean positions
 * after a delete/move has to compute and send them itself, which this UI
 * deliberately doesn't do (append-to-end only, matching the design's own
 * logic class).
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

export type KanbanCardType = "communications_push" | "training_session" | "automation_registry";

export interface CommunicationsPushSummary {
  id: number;
  title: string;
  effectiveDate: string;
  checkpointsTotal: number;
  checkpointsDone: number;
}

export interface TrainingSessionSummary {
  id: number;
  sessionType: string;
  sessionDate: string;
  topic: string;
}

export interface AutomationRegistrySummary {
  id: number;
  type: string;
  name: string;
  status: string;
}

export interface KanbanCard {
  id: number;
  bucketId: number;
  title: string;
  description: string | null;
  position: number;
  type: KanbanCardType | null;
  communicationsPushId: number | null;
  trainingSessionId: number | null;
  automationRegistryId: number | null;
  communicationsPush: CommunicationsPushSummary | null;
  trainingSession: TrainingSessionSummary | null;
  automationRegistry: AutomationRegistrySummary | null;
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

export interface CreateCardPayload {
  bucketId: number;
  title: string;
  description?: string;
  position?: number;
  type?: KanbanCardType;
  communicationsPushId?: number;
  trainingSessionId?: number;
  automationRegistryId?: number;
  newCommunicationsPush?: {
    title: string;
    description?: string;
    effectiveDate: string;
    offsetDays: number[];
  };
  newTrainingSession?: {
    sessionType: string;
    sessionDate: string;
    topic: string;
    notes?: string;
  };
}

export function useCreateCard(customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ bucketId, ...body }: CreateCardPayload) =>
      sendJson<{ card: KanbanCard }>(
        fetchWithAuth, "POST", `/api/msp/kanban/buckets/${bucketId}/cards`, body,
      ).then((r) => r!.card),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: boardKey(customerId) }); },
  });
}

export interface AutomationRegistryEntry {
  id: number;
  customerId: number;
  type: string;
  name: string;
  status: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export function useAutomationRegistryEntries(customerId: number | null): UseQueryResult<AutomationRegistryEntry[], Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: ["msp", "automation-registry", customerId] as const,
    queryFn: ({ signal }) =>
      getJson<{ entries: AutomationRegistryEntry[] }>(
        fetchWithAuth, `/api/msp/customers/${customerId}/automation-registry`, signal,
      ).then((r) => r.entries),
    enabled: !isLoading && !!accessToken && customerId != null,
    staleTime: 10_000,
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
