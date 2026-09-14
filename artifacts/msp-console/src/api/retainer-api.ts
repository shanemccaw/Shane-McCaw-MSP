/**
 * Retainer Hours module's own data (Git #2618, part of Feature #2560's real
 * remaining scope — Status Reports, the other half of #2560's original
 * description, already shipped separately). Backed by
 * `artifacts/api-server/src/routes/msp-retainer.ts` (11 routes, Git
 * #4020/#4026/#4098), all `requireCapability("ladder.msp-operator")` +
 * `requireMspScope("params")` gated — except reopen, the "adjust after close"
 * route, and the pending-entry approve/reject routes, which floor at
 * `ladder.msp-admin`. See
 * `docs/msp-console/retainer-hours-msp-console-contract-pack.md` for the full
 * wire contract this file is built against.
 *
 * Wire shapes (`SettingsWire`, `WireEntry`, `WireBucket`, `WireClose`,
 * `WireAdjustmentNote`) are re-declared here to match `admin-retainer.ts`'s own
 * exported mappers verbatim — one wire shape across AdminV2, MSP Console and
 * Portal, per the contract pack's own §4/§9.
 *
 * Deliberately NOT here: writing `retainer_settings` (allotment, hourly rate,
 * architect name) — that stays AdminV2-only. This surface reads settings but
 * never writes them.
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
): Promise<T> {
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
  return (await res.json()) as T;
}

// ── Wire shapes ───────────────────────────────────────────────────────────────

export type RetainerWorkState = "in_progress" | "closed" | "in_review" | "scheduled";
export type RetainerWorkSource = "change_control" | "remediation_tracker" | "unscoped";
export type RetainerAdjustmentAction = "create" | "update" | "delete";

export interface SettingsWire {
  customerId: number;
  retainedHours: number;
  hourlyRateCents: number;
  architectName: string | null;
  active: boolean;
  configured: boolean;
}

export interface WireEntry {
  id: number;
  periodMonth: string;
  week: string | null;
  item: string;
  hours: number;
  minutes: number;
  pillar: string | null;
  pillarColor: string;
  finding: string | null;
  outcome: string | null;
  state: string;
  stateStored: RetainerWorkState;
  source: RetainerWorkSource;
  sourceRefId: string | null;
  occurredAt: string;
}

export interface EntryWithLock extends WireEntry {
  periodClosed: boolean;
}

export interface WireBucket {
  period: string;
  retainedHours: number;
  rolledHours: number;
  usedHours: number;
  remainingHours: number;
  /** Honest, UNCAPPED over-allotment signal — never infer over-month from remainingHours === 0. */
  overHours: number;
  isOverMonth: boolean;
}

export interface WireAdjustmentNote {
  id: number;
  periodKey: string;
  workLogEntryId: number;
  action: RetainerAdjustmentAction;
  reason: string;
  item: string;
  beforeHours: number | null;
  afterHours: number | null;
  createdAt: string;
}

export interface WireClose {
  periodKey: string;
  anchorDay: number;
  hourlyRateCents: number;
  entryCount: number;
  note: string | null;
  closedByUserId: number | null;
  closedAt: string;
  bucket: WireBucket;
}

export interface RetainerPeriod {
  periodKey: string;
  endsAt: string;
  isCurrent: boolean;
  hasEnded: boolean;
  entryCount: number;
  bucket: WireBucket;
  closed: boolean;
  close: WireClose | null;
  adjustmentNotes: WireAdjustmentNote[];
}

// ── GET /msp/:mspId/retainer/customers ───────────────────────────────────────

export interface RetainerCustomerSummary {
  customerId: number;
  name: string;
  onRetainer: boolean;
  configured: boolean;
  architectName: string | null;
  entryCount: number;
  latestClosedPeriod: string | null;
  bucket: WireBucket;
}

export interface RetainerCustomersResponse {
  customers: RetainerCustomerSummary[];
}

const customersKey = (mspId: number) => ["msp", mspId, "retainer", "customers"] as const;

export function useRetainerCustomers(mspId: number | null): UseQueryResult<RetainerCustomersResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: mspId != null ? customersKey(mspId) : ["msp", "retainer", "customers", "unscoped"],
    queryFn: ({ signal }) =>
      getJson<RetainerCustomersResponse>(fetchWithAuth, `/api/msp/${mspId}/retainer/customers`, signal),
    enabled: !isLoading && !!accessToken && mspId != null,
    staleTime: 15_000,
  });
}

// ── GET /msp/:mspId/customers/:customerId/retainer ───────────────────────────

export interface RetainerDetailResponse {
  customer: { customerId: number; name: string };
  settings: SettingsWire;
  anchorDay: number;
  currentPeriod: string;
  bucket: WireBucket;
  periods: RetainerPeriod[];
  entries: EntryWithLock[];
}

const detailKey = (mspId: number, customerId: number) =>
  ["msp", mspId, "retainer", "customer", customerId] as const;

export function useRetainerDetail(
  mspId: number | null,
  customerId: number | null,
): UseQueryResult<RetainerDetailResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: mspId != null && customerId != null ? detailKey(mspId, customerId) : ["msp", "retainer", "customer", "unscoped"],
    queryFn: ({ signal }) =>
      getJson<RetainerDetailResponse>(fetchWithAuth, `/api/msp/${mspId}/customers/${customerId}/retainer`, signal),
    enabled: !isLoading && !!accessToken && mspId != null && customerId != null,
    staleTime: 10_000,
  });
}

function invalidateRetainer(
  queryClient: ReturnType<typeof useQueryClient>,
  mspId: number | null,
  customerId: number | null,
) {
  if (mspId == null) return;
  void queryClient.invalidateQueries({ queryKey: customersKey(mspId) });
  if (customerId != null) void queryClient.invalidateQueries({ queryKey: detailKey(mspId, customerId) });
}

// ── POST .../retainer/entries ────────────────────────────────────────────────

export interface LogHoursInput {
  item: string;
  hours: number;
  pillar?: string | null;
  finding?: string | null;
  outcome?: string | null;
  state?: RetainerWorkState;
  occurredAt?: string;
}

export function useLogRetainerHours(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LogHoursInput) =>
      sendJson<{ entry: EntryWithLock }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/customers/${customerId}/retainer/entries`, input,
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── PATCH .../retainer/entries/:entryId ──────────────────────────────────────

export interface AdjustEntryInput {
  entryId: number;
  item?: string;
  hours?: number;
  pillar?: string | null;
  finding?: string | null;
  outcome?: string | null;
  state?: RetainerWorkState;
  week?: string | null;
  occurredAt?: string;
}

export function useAdjustRetainerEntry(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, ...body }: AdjustEntryInput) =>
      sendJson<{ entry: EntryWithLock }>(
        fetchWithAuth, "PATCH", `/api/msp/${mspId}/customers/${customerId}/retainer/entries/${entryId}`, body,
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── DELETE .../retainer/entries/:entryId ─────────────────────────────────────

export function useDeleteRetainerEntry(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (entryId: number) =>
      sendJson<{ ok: true; id: number }>(
        fetchWithAuth, "DELETE", `/api/msp/${mspId}/customers/${customerId}/retainer/entries/${entryId}`,
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── POST .../periods/:periodKey/close ────────────────────────────────────────

export function useCloseRetainerPeriod(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ periodKey, note }: { periodKey: string; note?: string | null }) =>
      sendJson<{ close: WireClose }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/customers/${customerId}/retainer/periods/${periodKey}/close`,
        note !== undefined ? { note } : {},
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── POST .../periods/:periodKey/reopen (ladder.msp-admin) ───────────────────

export function useReopenRetainerPeriod(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (periodKey: string) =>
      sendJson<{ ok: true; periodKey: string }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/customers/${customerId}/retainer/periods/${periodKey}/reopen`,
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── POST .../periods/:periodKey/adjustments (ladder.msp-admin, #4026) ───────
// The ONE deliberate override for a closed period — requires a real reason on
// every call, and writes a customer-visible `retainer_adjustment_notes` row.

export interface AdjustClosedPeriodInput {
  periodKey: string;
  reason: string;
  action: RetainerAdjustmentAction;
  entryId?: number;
  item?: string;
  hours?: number;
  pillar?: string | null;
  finding?: string | null;
  outcome?: string | null;
  state?: RetainerWorkState;
  occurredAt?: string;
}

export function useAdjustClosedRetainerPeriod(mspId: number | null, customerId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ periodKey, ...body }: AdjustClosedPeriodInput) =>
      sendJson<{ note: WireAdjustmentNote; entry: EntryWithLock | null }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/customers/${customerId}/retainer/periods/${periodKey}/adjustments`, body,
      ),
    onSuccess: () => invalidateRetainer(queryClient, mspId, customerId),
  });
}

// ── GET /msp/:mspId/retainer/pending (ladder.msp-operator, #4098) ───────────
// The tracker byproduct hook's approval queue: `logRetainerWorkFromTracker`
// queues here instead of silently writing past a closed period's lock, or
// silently skipping, when its target period is already closed. Default
// `status` filter is "pending" — the review queue's normal shape.

export type RetainerPendingEntryStatus = "pending" | "approved" | "rejected";

export interface PendingEntryWire {
  id: number;
  customerId: number;
  customerName: string | null;
  periodKey: string;
  week: string | null;
  item: string;
  hours: number;
  minutes: number;
  pillar: string | null;
  finding: string | null;
  outcome: string | null;
  source: RetainerWorkSource;
  sourceRefId: number | null;
  occurredAt: string;
  status: RetainerPendingEntryStatus;
  reviewedByUserId: number | null;
  reviewedAt: string | null;
  reviewReason: string | null;
  workLogEntryId: number | null;
  createdAt: string;
}

export interface PendingEntriesResponse {
  entries: PendingEntryWire[];
}

const pendingKey = (mspId: number, customerId: number | null, status: RetainerPendingEntryStatus) =>
  ["msp", mspId, "retainer", "pending", customerId ?? "all", status] as const;

export function usePendingRetainerEntries(
  mspId: number | null,
  customerId: number | null,
  status: RetainerPendingEntryStatus = "pending",
): UseQueryResult<PendingEntriesResponse, Error> {
  const { fetchWithAuth, isLoading, accessToken } = useAuth();
  return useQuery({
    queryKey: mspId != null ? pendingKey(mspId, customerId, status) : ["msp", "retainer", "pending", "unscoped"],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ status });
      if (customerId != null) params.set("customerId", String(customerId));
      return getJson<PendingEntriesResponse>(fetchWithAuth, `/api/msp/${mspId}/retainer/pending?${params.toString()}`, signal);
    },
    enabled: !isLoading && !!accessToken && mspId != null,
    staleTime: 10_000,
  });
}

function invalidatePending(queryClient: ReturnType<typeof useQueryClient>, mspId: number | null) {
  if (mspId == null) return;
  void queryClient.invalidateQueries({ queryKey: ["msp", mspId, "retainer"] });
}

// ── POST /msp/:mspId/retainer/pending/:entryId/approve (ladder.msp-admin, #4098) ─
// Writes the real row into retainer_work_log plus a retainer_adjustment_notes
// reason — the same mechanism `useAdjustClosedRetainerPeriod` (#4026) uses.

export function useApprovePendingRetainerEntry(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: number; reason: string }) =>
      sendJson<{ entry: PendingEntryWire; ledgerEntry: EntryWithLock | null }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/retainer/pending/${entryId}/approve`, { reason },
      ),
    onSuccess: () => invalidatePending(queryClient, mspId),
  });
}

// ── POST /msp/:mspId/retainer/pending/:entryId/reject (ladder.msp-admin, #4098) ─
// Marks the entry rejected. Never touches retainer_work_log.

export function useRejectPendingRetainerEntry(mspId: number | null) {
  const { fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ entryId, reason }: { entryId: number; reason: string }) =>
      sendJson<{ entry: PendingEntryWire }>(
        fetchWithAuth, "POST", `/api/msp/${mspId}/retainer/pending/${entryId}/reject`, { reason },
      ),
    onSuccess: () => invalidatePending(queryClient, mspId),
  });
}
