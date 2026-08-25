/**
 * retainerStore.ts — the AdminV2 Retainer Hours screen's state (Git #1293).
 *
 * Plain external store (subscribe / getSnapshot), same shape as
 * contentStudioStore / aiPromptsStore. Every number the customer-facing "My
 * Architect" page (#1285) will read is produced by the API this talks to; the
 * store never invents a figure. The monthly bucket (retained / rolled / used
 * with rollover) is computed server-side and only displayed here.
 */

import { logger } from "@/lib/logger";
import { pushUndo as _pushUndo } from "../../shell/undoStore";

const log = logger.child({ channel: "billing" });

const SCREEN_ID = "retainer";

// ── Wire types (mirror routes/admin-retainer.ts) ────────────────────────────

export interface RetainerBucket {
  period: string;
  retainedHours: number;
  rolledHours: number;
  usedHours: number;
  remainingHours: number;
}

export interface RetainerCustomer {
  customerId: number;
  name: string;
  onRetainer: boolean;
  configured: boolean;
  architectName: string | null;
  entryCount: number;
  bucket: RetainerBucket;
}

export interface RetainerSettings {
  customerId: number;
  retainedHours: number;
  hourlyRateCents: number;
  architectName: string | null;
  active: boolean;
  configured: boolean;
}

export type RetainerEntrySource = "change_control" | "remediation_tracker" | "unscoped";

export interface RetainerEntry {
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
  /** Display form, "In progress" | "Closed" | "In review" | "Scheduled". */
  state: string;
  /** Stored form, in_progress | closed | in_review | scheduled. */
  stateStored: string;
  source: RetainerEntrySource;
  sourceRefId: number | null;
  occurredAt: string;
}

export interface RetainerDetail {
  customer: { customerId: number; name: string };
  settings: RetainerSettings;
  bucket: RetainerBucket;
  months: string[];
  entries: RetainerEntry[];
}

interface RetainerState {
  customers: RetainerCustomer[];
  customersLoading: boolean;
  customersLoaded: boolean;
  customersError: string | null;
  selectedCustomerId: number | null;
  detail: RetainerDetail | null;
  detailLoading: boolean;
  detailError: string | null;
}

// ── Store plumbing ──────────────────────────────────────────────────────────

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;
const listeners = new Set<Listener>();

let state: RetainerState = {
  customers: [],
  customersLoading: false,
  customersLoaded: false,
  customersError: null,
  selectedCustomerId: null,
  detail: null,
  detailLoading: false,
  detailError: null,
};

function setState(patch: Partial<RetainerState>): void {
  state = { ...state, ...patch };
  for (const l of listeners) l();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getSnapshot(): RetainerState {
  return state;
}

function pushUndo(entry: Parameters<typeof _pushUndo>[1]): void {
  _pushUndo(SCREEN_ID, entry);
}

export function configureRetainerFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let warmed = false;
export function warmRetainer(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadCustomers();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function failureOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown };
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch { /* not JSON */ }
  return `${res.status} ${res.statusText}`;
}

// ── Loads ───────────────────────────────────────────────────────────────────

export async function loadCustomers(force = false): Promise<void> {
  if (!adminFetchRef) return;
  if (!force && (state.customersLoading || state.customersLoaded)) return;
  setState({ customersLoading: true, customersError: null });
  try {
    const res = await adminFetchRef("/api/admin/retainer/customers");
    if (!res.ok) {
      setState({ customersLoading: false, customersError: await failureOf(res) });
      return;
    }
    const body = (await res.json()) as { customers: RetainerCustomer[] };
    setState({ customersLoading: false, customersLoaded: true, customers: body.customers });
  } catch (err) {
    log.warn({ err }, "retainer customers failed to load");
    setState({ customersLoading: false, customersError: errorText(err) });
  }
}

export async function loadDetail(customerId: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ detailLoading: true, detailError: null });
  try {
    const res = await adminFetchRef(`/api/admin/retainer/${customerId}`);
    if (!res.ok) {
      setState({ detailLoading: false, detailError: await failureOf(res) });
      return;
    }
    const detail = (await res.json()) as RetainerDetail;
    setState({ detailLoading: false, detail });
  } catch (err) {
    log.warn({ err, customerId }, "retainer detail failed to load");
    setState({ detailLoading: false, detailError: errorText(err) });
  }
}

export function selectCustomer(customerId: number): void {
  setState({ selectedCustomerId: customerId, detail: null });
  void loadDetail(customerId);
}

/** Return to the customer picker without fetching anything. */
export function clearSelection(): void {
  setState({ selectedCustomerId: null, detail: null, detailError: null });
}

/** Reload both the open detail and the customer list (for the gallery bucket). */
async function refreshAfterMutation(customerId: number): Promise<void> {
  await Promise.all([loadDetail(customerId), loadCustomers(true)]);
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface UnscopedInput {
  item: string;
  hours: number;
  pillar?: string | null;
  finding?: string | null;
  outcome?: string | null;
  state?: string;
}

export async function logUnscopedHours(customerId: number, input: UnscopedInput): Promise<RetainerEntry | null> {
  if (!adminFetchRef) return null;
  try {
    const res = await adminFetchRef(`/api/admin/retainer/${customerId}/unscoped`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return null;
    }
    const body = (await res.json()) as { entry: RetainerEntry };
    await refreshAfterMutation(customerId);
    pushUndo({
      label: `Log "${input.item.slice(0, 40)}"`,
      revert: async () => { await deleteEntry(customerId, body.entry.id, true); },
    });
    return body.entry;
  } catch (err) {
    log.warn({ err, customerId }, "log unscoped hours failed");
    setState({ detailError: errorText(err) });
    return null;
  }
}

export interface EntryPatch {
  item?: string;
  hours?: number;
  pillar?: string | null;
  finding?: string | null;
  outcome?: string | null;
  state?: string;
  week?: string | null;
}

export async function updateEntry(
  customerId: number,
  id: number,
  patch: EntryPatch,
  _skipUndo = false,
): Promise<void> {
  if (!adminFetchRef) return;
  const existing = state.detail?.entries.find((e) => e.id === id);
  if (!_skipUndo && existing) {
    const prev: EntryPatch = {};
    if (patch.item !== undefined) prev.item = existing.item;
    if (patch.hours !== undefined) prev.hours = existing.hours;
    if (patch.pillar !== undefined) prev.pillar = existing.pillar;
    if (patch.finding !== undefined) prev.finding = existing.finding;
    if (patch.outcome !== undefined) prev.outcome = existing.outcome;
    if (patch.state !== undefined) prev.state = existing.stateStored;
    if (patch.week !== undefined) prev.week = existing.week;
    pushUndo({
      label: `Edit "${existing.item.slice(0, 40)}"`,
      revert: async () => { await updateEntry(customerId, id, prev, true); },
    });
  }
  try {
    const res = await adminFetchRef(`/api/admin/retainer/entry/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return;
    }
    await refreshAfterMutation(customerId);
  } catch (err) {
    log.warn({ err, customerId, id }, "update retainer entry failed");
    setState({ detailError: errorText(err) });
  }
}

export async function deleteEntry(customerId: number, id: number, _skipUndo = false): Promise<void> {
  if (!adminFetchRef) return;
  const snapshot = state.detail?.entries.find((e) => e.id === id);
  try {
    const res = await adminFetchRef(`/api/admin/retainer/entry/${id}`, { method: "DELETE" });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return;
    }
    await refreshAfterMutation(customerId);
    // Undo re-logs the deleted work as an unscoped entry from the snapshot. A
    // tracker-derived row comes back as unscoped (its source link is gone once
    // deleted), which is the honest thing to restore — the data, not a fake link.
    if (!_skipUndo && snapshot) {
      pushUndo({
        label: `Delete "${snapshot.item.slice(0, 40)}"`,
        revert: async () => {
          await logUnscopedHours(customerId, {
            item: snapshot.item,
            hours: snapshot.hours,
            pillar: snapshot.pillar,
            finding: snapshot.finding,
            outcome: snapshot.outcome,
            state: snapshot.stateStored,
          });
        },
      });
    }
  } catch (err) {
    log.warn({ err, customerId, id }, "delete retainer entry failed");
    setState({ detailError: errorText(err) });
  }
}

export interface SettingsInput {
  retainedHours: number;
  hourlyRateCents?: number;
  architectName?: string | null;
  active?: boolean;
}

export async function saveSettings(customerId: number, input: SettingsInput): Promise<boolean> {
  if (!adminFetchRef) return false;
  const prev = state.detail?.settings;
  try {
    const res = await adminFetchRef(`/api/admin/retainer/${customerId}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      setState({ detailError: await failureOf(res) });
      return false;
    }
    await refreshAfterMutation(customerId);
    if (prev && prev.configured) {
      pushUndo({
        label: `Retainer settings for "${state.detail?.customer.name ?? customerId}"`,
        revert: async () => {
          await saveSettings(customerId, {
            retainedHours: prev.retainedHours,
            hourlyRateCents: prev.hourlyRateCents,
            architectName: prev.architectName,
            active: prev.active,
          });
        },
      });
    }
    return true;
  } catch (err) {
    log.warn({ err, customerId }, "save retainer settings failed");
    setState({ detailError: errorText(err) });
    return false;
  }
}

// ── Derived / selectors ──────────────────────────────────────────────────────

export function selectedDetail(): RetainerDetail | null {
  return state.detail;
}

export function entryById(id: number): RetainerEntry | undefined {
  return state.detail?.entries.find((e) => e.id === id);
}

/** Total hours used across every customer this month — a Watch/answer figure. */
export function totalUsedThisMonth(): number {
  return Math.round(state.customers.reduce((sum, c) => sum + c.bucket.usedHours, 0) * 10) / 10;
}

/** Customers whose remaining hours have run out or gone negative-territory low. */
export function lowOnHoursCount(): number {
  return state.customers.filter((c) => c.onRetainer && c.bucket.remainingHours <= 0).length;
}

/** Test seam. */
export function resetRetainerStore(): void {
  listeners.clear();
  adminFetchRef = null;
  warmed = false;
  state = {
    customers: [],
    customersLoading: false,
    customersLoaded: false,
    customersError: null,
    selectedCustomerId: null,
    detail: null,
    detailLoading: false,
    detailError: null,
  };
}
