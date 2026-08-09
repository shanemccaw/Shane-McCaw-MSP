/**
 * The Fulfillment screen's shared state — a plain external store, not React
 * state, for the same reason `packagesStore.ts`/`servicesStore.ts` are one:
 * the Home tab's "Queue" gallery and the Watch tab's live "overdue" count are
 * built at `registerScreen()` module-load time, outside any component, so
 * they cannot call `useAdminFetch()`. `FulfillmentFetchBridge` (always
 * mounted, see `AdminV2.tsx`) hands over the current `adminFetch` and warms
 * the queue once.
 *
 * ## Why the queue is fetched twice, in parallel, on every reload
 *
 * The Explorer's status/source/overdue/search filters are genuinely useful
 * for browsing, but the Watch tab's overdue count and gallery have to stay
 * correct regardless of what the Explorer is currently filtered to — an
 * operator filtering the Explorer down to "Blocked" must not make the
 * ribbon's overdue count silently read "0". So `reloadGlobal()` always asks
 * the server with **no** status/source/search/overdue filters (the query
 * params `admin-fulfillment.ts`'s `overdueRow` already computes independent
 * of the `overdue=1` toggle, confirmed by reading the route) and is the only
 * source `summary`/`overdueRows`/`blockedRows` ever come from.
 * `reloadFiltered()` is the Explorer's own browsing list and reflects
 * whatever the user has picked. The two never share one fetch.
 *
 * ## Scale assumption
 *
 * `pageSize` is fixed at 100 — the API's own hard cap — for every call here.
 * `reloadFiltered()`'s list is genuinely paged (`setPage`/`meta.page`) for
 * when the Explorer's own filtered view exceeds one page; `summary` /
 * `overdueRows` / `blockedRows` are not paged at all — they read `pageSize:
 * 100` unconditionally, on the assumption (stated, not silently relied on —
 * the Explorer shows `meta.total > items.length` when it's wrong) that a
 * solo consultancy's overdue/blocked count never actually exceeds 100 rows.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  createFulfillmentType,
  deleteFulfillmentType,
  exportFulfillmentTypes,
  listFulfillmentTypes,
  listQueue,
  listSlaConfig,
  patchDeliveryStatus,
  patchSlaConfig,
  resolveFulfillmentType,
  syncQueue,
  updateFulfillmentType,
  type AdminFetch,
  type CreateFulfillmentTypeInput,
} from "./fulfillmentApi";
import {
  EMPTY_FILTERS,
  keyFromLabel,
  PRESET_TYPES,
  type DeliveryRow,
  type DeliveryStatus,
  type FulfillmentTypeRow,
  type QueueFilters,
  type QueueMeta,
  type SlaConfigRow,
} from "./fulfillmentTypes";

export const RIBBON_KEYS = {
  queueTotal: "fulfillment:queue-total",
  overdueWatch: "fulfillment:overdue",
  blockedWatch: "fulfillment:blocked",
  typesCount: "fulfillment:types-count",
} as const;

type Listener = () => void;

export interface FulfillmentState {
  /** The Explorer's filtered/paginated browsing list. */
  items: DeliveryRow[];
  meta: QueueMeta | null;
  /** Always-unfiltered aggregate — see file doc comment. */
  summary: QueueMeta | null;
  /** Always-unfiltered — the Watch tab's "Overdue deliveries" gallery. */
  overdueRows: DeliveryRow[];
  /** Always-unfiltered — the Watch tab's "Blocked" gallery. */
  blockedRows: DeliveryRow[];

  slaConfigs: SlaConfigRow[];
  types: FulfillmentTypeRow[];

  filters: QueueFilters;
  page: number;

  openItemId: number | null;
  openTypeKey: string | null;

  loading: boolean;
  loadingTypes: boolean;
  error: string | null;
  saving: boolean;
  syncing: boolean;
  message: string | null;
}

const INITIAL: FulfillmentState = {
  items: [],
  meta: null,
  summary: null,
  overdueRows: [],
  blockedRows: [],
  slaConfigs: [],
  types: [],
  filters: { ...EMPTY_FILTERS },
  page: 1,
  openItemId: null,
  openTypeKey: null,
  loading: false,
  loadingTypes: false,
  error: null,
  saving: false,
  syncing: false,
  message: null,
};

let state: FulfillmentState = { ...INITIAL };
let adminFetchRef: AdminFetch | null = null;
let warmed = false;

const listeners = new Set<Listener>();

function setState(patch: Partial<FulfillmentState>): void {
  state = { ...state, ...patch };
  pushLiveRibbon();
  for (const listener of listeners) listener();
}

function pushLiveRibbon(): void {
  const summary = state.summary;
  if (summary) {
    setLiveRibbonValue(RIBBON_KEYS.queueTotal, {
      label: `${summary.total} item${summary.total === 1 ? "" : "s"}`,
    });
    const overdue = summary.overdue;
    setLiveRibbonValue(RIBBON_KEYS.overdueWatch, {
      label: overdue === 0 ? "Nothing overdue" : `${overdue} overdue`,
      live: overdue === 0 ? undefined : String(overdue),
      color: overdue === 0 ? undefined : ACCENT.amber,
    });
    const blocked = summary.byStatus.blocked ?? 0;
    setLiveRibbonValue(RIBBON_KEYS.blockedWatch, {
      label: blocked === 0 ? "Nothing blocked" : `${blocked} blocked`,
      live: blocked === 0 ? undefined : String(blocked),
      color: blocked === 0 ? undefined : ACCENT.danger,
    });
  }
  if (state.types.length > 0) {
    const active = state.types.filter((t) => t.isActive).length;
    setLiveRibbonValue(RIBBON_KEYS.typesCount, { label: `${active} type${active === 1 ? "" : "s"}` });
  }
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): FulfillmentState {
  return state;
}

/** Called by `FulfillmentFetchBridge` on every render — see file doc comment. */
export function configureFulfillmentFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let messageTimer: ReturnType<typeof setTimeout> | null = null;

export function say(message: string | null): void {
  setState({ message });
  if (messageTimer) clearTimeout(messageTimer);
  if (message) messageTimer = setTimeout(() => setState({ message: null }), 3400);
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** The Explorer's own filtered list. Reloaded on every filter/page change. */
export async function reloadFiltered(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loading: true, error: null });
  try {
    const { items, meta } = await listQueue(adminFetchRef, { ...state.filters, page: state.page });
    setState({ loading: false, items, meta });
  } catch (err) {
    setState({ loading: false, error: errText(err) });
  }
}

/** Always-unfiltered stats + Watch-tab rows — see file doc comment. */
export async function reloadGlobal(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const [summaryRes, overdueRes, blockedRes] = await Promise.all([
      listQueue(adminFetchRef, { pageSize: 1 }),
      listQueue(adminFetchRef, { overdue: true }),
      listQueue(adminFetchRef, { status: "blocked" }),
    ]);
    setState({ summary: summaryRes.meta, overdueRows: overdueRes.items, blockedRows: blockedRes.items });
  } catch (err) {
    setState({ error: errText(err) });
  }
}

export async function reloadSla(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    setState({ slaConfigs: await listSlaConfig(adminFetchRef) });
  } catch (err) {
    setState({ error: errText(err) });
  }
}

export async function reloadTypes(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ loadingTypes: true });
  try {
    setState({ loadingTypes: false, types: await listFulfillmentTypes(adminFetchRef) });
  } catch (err) {
    setState({ loadingTypes: false, error: errText(err) });
  }
}

/** Loads everything once. Safe to call more than once — only fetches while not already warmed. */
export async function warmFulfillment(): Promise<void> {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  await Promise.all([reloadFiltered(), reloadGlobal(), reloadSla(), reloadTypes()]);
}

/** Ribbon's explicit "Refresh" — always refetches, unlike `warmFulfillment`. */
export async function refreshAll(): Promise<void> {
  await Promise.all([reloadFiltered(), reloadGlobal(), reloadSla(), reloadTypes()]);
}

// ── Explorer filters ─────────────────────────────────────────────────────────

export function setFilterStatus(status: QueueFilters["status"]): void {
  setState({ filters: { ...state.filters, status }, page: 1 });
  void reloadFiltered();
}

export function setFilterSource(sourceType: QueueFilters["sourceType"]): void {
  setState({ filters: { ...state.filters, sourceType }, page: 1 });
  void reloadFiltered();
}

export function setFilterOverdue(overdue: boolean): void {
  setState({ filters: { ...state.filters, overdue }, page: 1 });
  void reloadFiltered();
}

export function setSearch(q: string): void {
  setState({ filters: { ...state.filters, q } });
  void reloadFiltered();
}

export function clearFilters(): void {
  setState({ filters: { ...EMPTY_FILTERS }, page: 1 });
  void reloadFiltered();
}

export function filtersActive(s: FulfillmentState = state): boolean {
  const f = s.filters;
  return Boolean(f.status || f.sourceType || f.overdue || f.q);
}

export function setPage(page: number): void {
  setState({ page });
  void reloadFiltered();
}

// ── Selection ────────────────────────────────────────────────────────────────

export function selectItem(id: number | null): void {
  if (state.openItemId === id) return;
  setState({ openItemId: id });
}

export function selectType(key: string | null): void {
  if (state.openTypeKey === key) return;
  setState({ openTypeKey: key });
}

export function deliveryById(id: number | string | null, s: FulfillmentState = state): DeliveryRow | null {
  if (id == null) return null;
  const numId = Number(id);
  return (
    s.items.find((d) => d.id === numId) ??
    s.overdueRows.find((d) => d.id === numId) ??
    s.blockedRows.find((d) => d.id === numId) ??
    null
  );
}

export function typeByKey(key: string | null, s: FulfillmentState = state): FulfillmentTypeRow | null {
  if (key == null) return null;
  return s.types.find((t) => t.key === key) ?? null;
}

// ── Delivery status ──────────────────────────────────────────────────────────

/** Peek/contextual-tab edits write straight through — `SHELL.md` section 3. */
export async function setDeliveryStatus(id: number, deliveryStatus: DeliveryStatus, statusNote?: string | null): Promise<void> {
  if (!adminFetchRef) return;
  const patch = statusNote === undefined ? { deliveryStatus } : { deliveryStatus, statusNote };
  const patchRow = (d: DeliveryRow): DeliveryRow => (d.id === id ? { ...d, ...patch } : d);
  setState({
    saving: true,
    items: state.items.map(patchRow),
    overdueRows: state.overdueRows.map(patchRow),
    blockedRows: state.blockedRows.map(patchRow),
  });
  try {
    await patchDeliveryStatus(adminFetchRef, id, patch);
    say("Delivery status updated.");
  } catch (err) {
    say(errText(err));
  } finally {
    setState({ saving: false });
    void reloadGlobal();
    void reloadFiltered();
  }
}

export async function setStatusNote(id: number, statusNote: string): Promise<void> {
  const row = deliveryById(id);
  if (!row) return;
  await setDeliveryStatus(id, row.deliveryStatus, statusNote);
}

export async function syncFromPurchases(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ syncing: true });
  try {
    const { added } = await syncQueue(adminFetchRef);
    say(`Sync complete — ${added} new item${added === 1 ? "" : "s"} added.`);
  } catch (err) {
    say(errText(err));
  } finally {
    setState({ syncing: false });
    await Promise.all([reloadFiltered(), reloadGlobal()]);
  }
}

// ── SLA config ───────────────────────────────────────────────────────────────

export async function saveSlaThreshold(key: string, thresholdDays: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ slaConfigs: state.slaConfigs.map((c) => (c.key === key ? { ...c, thresholdDays } : c)) });
  try {
    await patchSlaConfig(adminFetchRef, key, thresholdDays);
    say("SLA threshold saved.");
  } catch (err) {
    say(errText(err));
  }
}

// ── Fulfillment types ────────────────────────────────────────────────────────

export async function createType(input: CreateFulfillmentTypeInput): Promise<FulfillmentTypeRow | null> {
  if (!adminFetchRef) return null;
  setState({ saving: true });
  try {
    const created = await createFulfillmentType(adminFetchRef, input);
    setState({ saving: false, types: [created, ...state.types] });
    say(`Created "${created.label}".`);
    return created;
  } catch (err) {
    setState({ saving: false });
    say(errText(err));
    return null;
  }
}

/**
 * Prompts for a name and derives the key, the same `window.prompt` flow
 * `servicesStore.ts`'s `createServiceInteractive` uses — this shell has no
 * generic creation dialog, and a one-field prompt is honest about how little
 * a new type needs before the rest is filled in from its peek.
 */
export async function createTypeInteractive(): Promise<FulfillmentTypeRow | null> {
  if (typeof window === "undefined") return null;
  const label = window.prompt('Name the fulfillment type (e.g. "Onboarding Package"):');
  if (!label?.trim()) return null;
  const key = keyFromLabel(label);
  if (!key) return null;
  return createType({ key, label: label.trim(), firedWhen: [], recurring: false, isActive: true });
}

/** Registry create for the four standard kinds — one call per missing preset, skips ones already present. */
export async function seedPresetTypes(): Promise<void> {
  const have = new Set(state.types.map((t) => t.key));
  const missing = PRESET_TYPES.filter((p) => !have.has(p.key));
  if (missing.length === 0) {
    say("Every standard type already exists.");
    return;
  }
  for (const preset of missing) {
    await createType({
      key: preset.key,
      label: preset.label,
      description: preset.description ?? undefined,
      firedWhen: preset.firedWhen,
      recurring: preset.recurring,
      isActive: preset.isActive,
    });
  }
}

/** Peek edits write straight through — optimistic, matching `packagesStore.ts`'s `patchPackage`. */
export async function patchType(key: string, patch: Partial<Omit<CreateFulfillmentTypeInput, "key">>): Promise<void> {
  if (!adminFetchRef) return;
  setState({ types: state.types.map((t) => (t.key === key ? { ...t, ...patch } : t)) });
  try {
    await updateFulfillmentType(adminFetchRef, key, patch);
  } catch (err) {
    say(errText(err));
  }
}

export async function removeType(key: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteFulfillmentType(adminFetchRef, key);
    setState({
      types: state.types.filter((t) => t.key !== key),
      openTypeKey: state.openTypeKey === key ? null : state.openTypeKey,
    });
    say("Deleted.");
  } catch (err) {
    say(errText(err));
  }
}

export async function testResolveType(key: string, payload: Record<string, unknown>): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const result = await resolveFulfillmentType(adminFetchRef, key, payload);
    say(
      result.status === "emitted"
        ? `Event emitted: ${result.eventName}`
        : result.status === "duplicate"
          ? "Idempotency hit — already emitted (duplicate)."
          : `Status: ${result.status}`,
    );
  } catch (err) {
    say(errText(err));
  }
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** Copies the server's own canonical export — never the client's possibly-stale local copy. */
export async function copyTypesAsJson(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    const payload = await exportFulfillmentTypes(adminFetchRef);
    copyToClipboard(JSON.stringify(payload, null, 2));
    say("Copied as JSON.");
  } catch (err) {
    say(errText(err));
  }
}

/** Test seam. Not used by the app. */
export function resetFulfillmentStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = { ...INITIAL };
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
}

/** Test seam. Not used by the app. */
export function seedFulfillmentStore(patch: Partial<FulfillmentState>): void {
  setState(patch);
}
