/**
 * The Money screen's shared state — a plain external store, not React state.
 *
 * Same reason `deployStore.ts`/`crmStore.ts` are one (see either file's doc
 * comment): the ribbon buttons this screen contributes to the fixed `money`
 * tab ("This month" / "The business" / "The ramp" / "Copy the figures") are
 * built once, at `registerScreen()` module-load time, outside any component,
 * so they cannot call `useAdminFetch()`. `MoneyFetchBridge` (always mounted,
 * see `AdminV2.tsx`) hands over the current `adminFetch` on every render and
 * warms the summary once, so the Money tab's own ribbon label — which shows
 * real profit, not the word "Money" (`SHELL.md`/the design's `moneyNums`
 * convention) — has a real number before `/money` has ever been opened.
 *
 * `view` picks which of the three sub-views `MoneyBody` renders; all three
 * live under the one registered "money" screen/route rather than as separate
 * docs, mirroring `crmStore.ts`'s `CrmView`.
 */

import type { MoneyBusiness, MoneyGoals, MoneyRamp, MoneySummary } from "./moneyTypes";

export type MoneyView = "month" | "business" | "ramp";

export interface MoneyStoreState {
  view: MoneyView;

  summary: MoneySummary | null;
  summaryLoading: boolean;
  summaryError: string | null;

  business: MoneyBusiness | null;
  businessLoading: boolean;
  businessError: string | null;

  ramp: MoneyRamp | null;
  rampLoading: boolean;
  rampError: string | null;
  rampSaving: boolean;

  lastMessage: string | null;
}

type AdminFetch = (path: string, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `MoneyFetchBridge` on every render — see file doc comment. */
export function configureMoneyFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let state: MoneyStoreState = {
  view: "month",

  summary: null,
  summaryLoading: false,
  summaryError: null,

  business: null,
  businessLoading: false,
  businessError: null,

  ramp: null,
  rampLoading: false,
  rampError: null,
  rampSaving: false,

  lastMessage: null,
};

const listeners = new Set<Listener>();

function setState(patch: Partial<MoneyStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): MoneyStoreState {
  return state;
}

export function setView(view: MoneyView): void {
  setState({ view });
  if (view === "business" && !state.business && !state.businessLoading) void loadBusiness();
  if (view === "ramp" && !state.ramp && !state.rampLoading) void loadRamp();
}

let summaryLoaded = false;

/** Warm load — see file doc comment. Safe to call more than once; only fetches while not already loaded/loading. */
export function warmSummary(): void {
  if (summaryLoaded || state.summaryLoading || !adminFetchRef) return;
  void loadSummary();
}

export async function loadSummary(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ summaryLoading: true, summaryError: null });
  try {
    const res = await adminFetchRef("/api/admin/money/summary");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setState({ summaryLoading: false, summaryError: data?.error ?? "Failed to load" });
      return;
    }
    summaryLoaded = true;
    setState({ summaryLoading: false, summary: data as MoneySummary });
  } catch (err) {
    setState({ summaryLoading: false, summaryError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadBusiness(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ businessLoading: true, businessError: null });
  try {
    const res = await adminFetchRef("/api/admin/money/business");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setState({ businessLoading: false, businessError: data?.error ?? "Failed to load" });
      return;
    }
    setState({ businessLoading: false, business: data as MoneyBusiness });
  } catch (err) {
    setState({ businessLoading: false, businessError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadRamp(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ rampLoading: true, rampError: null });
  try {
    const res = await adminFetchRef("/api/admin/money/ramp");
    const data = await res.json();
    if (!res.ok || !data.ok) {
      setState({ rampLoading: false, rampError: data?.error ?? "Failed to load" });
      return;
    }
    setState({ rampLoading: false, ramp: data as MoneyRamp });
  } catch (err) {
    setState({ rampLoading: false, rampError: err instanceof Error ? err.message : String(err) });
  }
}

/** Refreshes whichever views have already been loaded — used by the ribbon's "Refresh". */
export function refreshAll(): void {
  void loadSummary();
  if (state.business) void loadBusiness();
  if (state.ramp) void loadRamp();
}

/** The ramp view's +/- target editor writes straight through, then reloads. */
export async function saveRampTarget(month: string, target: number): Promise<void> {
  if (!adminFetchRef || !state.ramp) return;
  const current: MoneyGoals["ramp"] = state.ramp.rows.map((r) => ({ month: r.month, target: r.month === month ? target : r.target }));
  setState({ rampSaving: true });
  try {
    const res = await adminFetchRef("/api/admin/money/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ramp: current }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setState({ rampSaving: false, lastMessage: "Saved." });
      void loadRamp();
      void loadSummary();
    } else {
      setState({ rampSaving: false, lastMessage: data?.error ?? "Save failed." });
    }
  } catch (err) {
    setState({ rampSaving: false, lastMessage: err instanceof Error ? err.message : String(err) });
  }
}

export async function saveGoalSales(goalSales: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ rampSaving: true });
  try {
    const res = await adminFetchRef("/api/admin/money/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ goalSales }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setState({ rampSaving: false, lastMessage: "Saved." });
      void loadRamp();
      void loadSummary();
    } else {
      setState({ rampSaving: false, lastMessage: data?.error ?? "Save failed." });
    }
  } catch (err) {
    setState({ rampSaving: false, lastMessage: err instanceof Error ? err.message : String(err) });
  }
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** Ribbon's "Copy the figures" — real numbers only, whatever is currently loaded. */
export function copyFigures(): void {
  const payload = {
    summary: state.summary,
    business: state.business,
    ramp: state.ramp,
  };
  copyToClipboard(JSON.stringify(payload, null, 2));
  setState({ lastMessage: "Copied." });
}

/** Test seam. Not used by the app. */
export function resetMoneyStore(): void {
  adminFetchRef = null;
  summaryLoaded = false;
  state = {
    view: "month",
    summary: null,
    summaryLoading: false,
    summaryError: null,
    business: null,
    businessLoading: false,
    businessError: null,
    ramp: null,
    rampLoading: false,
    rampError: null,
    rampSaving: false,
    lastMessage: null,
  };
}
