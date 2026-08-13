/**
 * The CRM screen's shared state — a plain external store, not React state.
 *
 * Same reason `deployStore.ts` is one (see that file's doc comment): the
 * "Pipeline"/"New lead"/"Refresh from Zoho" buttons this screen contributes
 * to the fixed `home` tab are built once, at `registerScreen()` module-load
 * time, outside any component — a screen's `ribbon` array has no hook to
 * call `useAdminFetch()` from, and those buttons are reachable from the Home
 * ribbon whether or not the CRM screen itself has ever mounted. `CrmFetchBridge`
 * (always mounted, see `AdminV2.tsx`) hands over the current `adminFetch` on
 * every render and eagerly loads leads/deals once, so palette `#` record
 * entries and peek lookups resolve even before `/crm` is ever opened.
 *
 * Reads (`/api/zoho/crm/:entity`, `/api/zoho/auth/status`, `/api/engagebay/status`,
 * `/api/engagebay/activity`) are real, synchronous passthroughs. Writes are
 * NOT applied on the request path — every write endpoint answers 202 with a
 * jobId, and the real change lands on the next 5-minute Zoho/EngageBay queue
 * drain. `queueWrite` below is what keeps that honest everywhere a write
 * happens: the local record is patched optimistically (so the UI does not
 * appear to ignore what you just typed) and a `TrackedWrite` row is polled
 * until the drain actually applies it — but this list is only ever what this
 * browser session itself queued. There is no server endpoint to browse the
 * whole `msp_job_queue`, so "queued writes" here means "since this tab was
 * opened", not "everything pending" — the Connections view says so.
 */

import type {
  EngageBayActivityEvent,
  EngageBayStatusResponse,
  JobStatus,
  QueuedWrite,
  TrackedWrite,
  ZohoAuthStatus,
  ZohoListResponse,
  ZohoRecord,
} from "./zohoTypes";
import { readZohoError } from "./zohoTypes";

export type CrmView = "pipeline" | "leads" | "connections";

export interface CrmStoreState {
  view: CrmView;

  leads: ZohoRecord[];
  leadsLoading: boolean;
  leadsError: string | null;

  deals: ZohoRecord[];
  dealsLoading: boolean;
  dealsError: string | null;
  selectedDealId: string | null;

  zohoStatus: ZohoAuthStatus | null;
  zohoStatusLoading: boolean;

  engagebayStatus: EngageBayStatusResponse | null;
  engagebayStatusLoading: boolean;

  engagebayActivity: EngageBayActivityEvent[];
  engagebayActivityLoading: boolean;

  /** This session's own queued writes, most-recent-first. */
  recentWrites: TrackedWrite[];
  /** Transient "queued — applies on the next sync" note, keyed by lead id. Clears itself. */
  noteByLeadId: Record<string, string>;

  newLeadFormOpen: boolean;
  lastMessage: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `CrmFetchBridge` on every render — see file doc comment. */
export function configureCrmFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

const RECENT_WRITES_MAX = 20;

let state: CrmStoreState = {
  view: "pipeline",

  leads: [],
  leadsLoading: false,
  leadsError: null,

  deals: [],
  dealsLoading: false,
  dealsError: null,
  selectedDealId: null,

  zohoStatus: null,
  zohoStatusLoading: false,

  engagebayStatus: null,
  engagebayStatusLoading: false,

  engagebayActivity: [],
  engagebayActivityLoading: false,

  recentWrites: [],
  noteByLeadId: {},

  newLeadFormOpen: false,
  lastMessage: null,
};

const listeners = new Set<Listener>();

function setState(patch: Partial<CrmStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CrmStoreState {
  return state;
}

export function setView(view: CrmView): void {
  setState({ view });
}

export function selectDeal(id: string | null): void {
  setState({ selectedDealId: id });
}

export function openNewLeadForm(): void {
  setState({ view: "leads", newLeadFormOpen: true });
}

export function closeNewLeadForm(): void {
  setState({ newLeadFormOpen: false });
}

function findLeadIndex(id: string): number {
  return state.leads.findIndex((l) => String(l.id) === id);
}

function findDealIndex(id: string): number {
  return state.deals.findIndex((d) => String(d.id) === id);
}

// ── Reads ──────────────────────────────────────────────────────────────────

export async function loadLeads(search?: string): Promise<void> {
  if (!adminFetchRef) return;
  setState({ leadsLoading: true, leadsError: null });
  try {
    const params = new URLSearchParams({ page: "1", perPage: "50" });
    if (search?.trim()) params.set("search", search.trim());
    const res = await adminFetchRef(`/api/zoho/crm/leads?${params.toString()}`);
    if (!res.ok) {
      setState({ leadsLoading: false, leadsError: await readZohoError(res, "Failed to load leads from Zoho") });
      return;
    }
    const data = (await res.json()) as ZohoListResponse;
    setState({ leads: data.records ?? [], leadsLoading: false });
  } catch {
    setState({ leadsLoading: false, leadsError: "Failed to load leads from Zoho" });
  }
}

export async function loadDeals(search?: string): Promise<void> {
  if (!adminFetchRef) return;
  setState({ dealsLoading: true, dealsError: null });
  try {
    const params = new URLSearchParams({ page: "1", perPage: "50" });
    if (search?.trim()) params.set("search", search.trim());
    const res = await adminFetchRef(`/api/zoho/crm/deals?${params.toString()}`);
    if (!res.ok) {
      setState({ dealsLoading: false, dealsError: await readZohoError(res, "Failed to load deals from Zoho") });
      return;
    }
    const data = (await res.json()) as ZohoListResponse;
    setState({ deals: data.records ?? [], dealsLoading: false });
  } catch {
    setState({ dealsLoading: false, dealsError: "Failed to load deals from Zoho" });
  }
}

export async function loadZohoStatus(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ zohoStatusLoading: true });
  try {
    const res = await adminFetchRef("/api/zoho/auth/status");
    if (res.ok) setState({ zohoStatus: (await res.json()) as ZohoAuthStatus });
  } catch {
    /* Connections view just shows nothing rather than a broken banner. */
  } finally {
    setState({ zohoStatusLoading: false });
  }
}

export async function loadEngageBayStatus(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ engagebayStatusLoading: true });
  try {
    const res = await adminFetchRef("/api/engagebay/status");
    if (res.ok) setState({ engagebayStatus: (await res.json()) as EngageBayStatusResponse });
  } catch {
    /* same as loadZohoStatus */
  } finally {
    setState({ engagebayStatusLoading: false });
  }
}

export async function loadEngageBayActivity(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ engagebayActivityLoading: true });
  try {
    const res = await adminFetchRef("/api/engagebay/activity?limit=20");
    if (res.ok) {
      const data = (await res.json()) as { events: EngageBayActivityEvent[] };
      setState({ engagebayActivity: data.events ?? [] });
    }
  } catch {
    /* same as loadZohoStatus */
  } finally {
    setState({ engagebayActivityLoading: false });
  }
}

export function refreshAll(): void {
  void loadLeads();
  void loadDeals();
  void loadZohoStatus();
  void loadEngageBayStatus();
  void loadEngageBayActivity();
}

export async function refreshLead(id: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const res = await adminFetchRef(`/api/zoho/crm/leads/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const data = (await res.json()) as { record: ZohoRecord };
    const index = findLeadIndex(id);
    const leads =
      index === -1 ? [...state.leads, data.record] : state.leads.map((l, i) => (i === index ? data.record : l));
    setState({ leads });
  } catch {
    /* the peek/record view just keeps showing what it already had */
  }
}

// ── Writes (queued — see file doc comment) ───────────────────────────────────

function pushTrackedWrite(entry: TrackedWrite): void {
  setState({ recentWrites: [entry, ...state.recentWrites].slice(0, RECENT_WRITES_MAX) });
}

function updateTrackedWrite(jobId: string, patch: Partial<TrackedWrite>): void {
  setState({
    recentWrites: state.recentWrites.map((w) => (w.jobId === jobId ? { ...w, ...patch } : w)),
  });
}

function pollJob(jobId: string): void {
  if (!adminFetchRef) return;
  setTimeout(() => {
    void (async () => {
      if (!adminFetchRef) return;
      try {
        const res = await adminFetchRef(`/api/zoho/crm/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const job = (await res.json()) as JobStatus;
        if (job.status === "completed") {
          updateTrackedWrite(jobId, { state: "synced", detail: "Synced to Zoho." });
          return;
        }
        if (job.status === "failed") {
          updateTrackedWrite(jobId, {
            state: "failed",
            detail: job.errorMessage ?? "The Zoho write failed.",
          });
          return;
        }
        updateTrackedWrite(jobId, { state: job.status === "running" ? "syncing" : "queued" });
        // The drain runs every 5 minutes — a tight poll loop just burns
        // requests against an endpoint that cannot change faster than that.
        pollJob(jobId);
      } catch {
        /* transient — the next tick retries */
      }
    })();
  }, 15_000);
}

/** Queues one write and starts tracking/polling it. Returns the jobId, or null if it could not be queued. */
async function queueWrite(
  path: string,
  method: "POST" | "PATCH",
  body: unknown,
  action: string,
): Promise<string | null> {
  if (!adminFetchRef) return null;
  try {
    const res = await adminFetchRef(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      setState({ lastMessage: await readZohoError(res, `Failed to queue: ${action}`) });
      return null;
    }
    const data = (await res.json()) as QueuedWrite;
    pushTrackedWrite({
      jobId: data.jobId,
      action,
      message: data.message ?? "Queued — applied on the next Zoho sync.",
      startedAt: Date.now(),
      state: "queued",
      detail: null,
    });
    setState({ lastMessage: data.message ?? "Queued — applied on the next Zoho sync." });
    pollJob(data.jobId);
    return data.jobId;
  } catch {
    setState({ lastMessage: `Failed to queue: ${action}` });
    return null;
  }
}

let noteTimer: ReturnType<typeof setTimeout> | null = null;

function noteLead(id: string, message: string): void {
  setState({ noteByLeadId: { ...state.noteByLeadId, [id]: message } });
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    const { [id]: _dropped, ...rest } = state.noteByLeadId;
    setState({ noteByLeadId: rest });
  }, 4000);
}

/** Optimistic local patch — the real Zoho record catches up on the next drain. */
export async function patchLead(id: string, fields: Record<string, unknown>): Promise<void> {
  const index = findLeadIndex(id);
  if (index !== -1) {
    setState({ leads: state.leads.map((l, i) => (i === index ? { ...l, ...fields } : l)) });
  }
  const jobId = await queueWrite(`/api/zoho/crm/leads/${encodeURIComponent(id)}`, "PATCH", { fields }, "Update lead");
  noteLead(id, jobId ? "Queued — applies on the next Zoho sync (~5 min)." : "Could not queue that change.");
}

export async function createLead(fields: Record<string, unknown>): Promise<boolean> {
  const jobId = await queueWrite("/api/zoho/crm/leads", "POST", { fields }, "Create lead");
  if (jobId) setState({ newLeadFormOpen: false });
  return jobId !== null;
}

export async function convertLead(id: string): Promise<void> {
  const jobId = await queueWrite(`/api/zoho/crm/leads/${encodeURIComponent(id)}/convert`, "POST", {}, "Convert lead");
  noteLead(id, jobId ? "Conversion queued — applies on the next Zoho sync (~5 min)." : "Could not queue the conversion.");
}

export async function addLeadNote(id: string, content: string): Promise<void> {
  const jobId = await queueWrite(
    `/api/zoho/crm/leads/${encodeURIComponent(id)}/notes`,
    "POST",
    { title: "Note", content },
    "Add note to lead",
  );
  noteLead(id, jobId ? "Note queued — applies on the next Zoho sync (~5 min)." : "Could not queue the note.");
}

export async function updateDealStage(id: string, stage: string): Promise<void> {
  const index = findDealIndex(id);
  if (index !== -1) setState({ deals: state.deals.map((d, i) => (i === index ? { ...d, Stage: stage } : d)) });
  await queueWrite(`/api/zoho/crm/deals/${encodeURIComponent(id)}/stage`, "POST", { stage }, "Update deal stage");
}

export async function updateDealAmount(id: string, amount: number): Promise<void> {
  const index = findDealIndex(id);
  if (index !== -1) setState({ deals: state.deals.map((d, i) => (i === index ? { ...d, Amount: amount } : d)) });
  await queueWrite(`/api/zoho/crm/deals/${encodeURIComponent(id)}/amount`, "POST", { amount }, "Update deal amount");
}

export function clearLastMessage(): void {
  setState({ lastMessage: null });
}

/** Test seam. Not used by the app. */
export function resetCrmStore(): void {
  adminFetchRef = null;
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = null;
  state = {
    view: "pipeline",
    leads: [],
    leadsLoading: false,
    leadsError: null,
    deals: [],
    dealsLoading: false,
    dealsError: null,
    selectedDealId: null,
    zohoStatus: null,
    zohoStatusLoading: false,
    engagebayStatus: null,
    engagebayStatusLoading: false,
    engagebayActivity: [],
    engagebayActivityLoading: false,
    recentWrites: [],
    noteByLeadId: {},
    newLeadFormOpen: false,
    lastMessage: null,
  };
}
