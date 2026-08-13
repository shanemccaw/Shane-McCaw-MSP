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
 *
 * `syncLiveRibbon()` pushes the screen's live figures (profit on the fixed
 * tab, revenue/cost/sales-count on the "Where you stand" group, the current
 * view's name on the "Go to" trigger) into `shell/liveRibbon.ts` every time
 * this store's state changes — see that file's doc comment for why a plain
 * `RibbonCommand.label` can't show these on its own.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { usd, type MoneyBusiness, type MoneyGoals, type MoneyRamp, type MoneySummary } from "./moneyTypes";

export type MoneyView = "month" | "business" | "ramp";

const VIEW_LABEL: Record<MoneyView, string> = {
  month: "This month",
  business: "The business",
  ramp: "The ramp",
};

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

  goalsDialogOpen: boolean;
  goalsSaving: boolean;

  logSaleDialogOpen: boolean;
  logSaleSubmitting: boolean;
  logSaleError: string | null;
  /** Set briefly after a real sale is logged, so the UI can flourish honestly — it names a sale that really was just recorded. */
  celebrateSale: { who: string; what: string; amountCents: number } | null;

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

  goalsDialogOpen: false,
  goalsSaving: false,

  logSaleDialogOpen: false,
  logSaleSubmitting: false,
  logSaleError: null,
  celebrateSale: null,

  lastMessage: null,
};

const listeners = new Set<Listener>();

/** Keys this store owns in the shared live-ribbon overlay. See `screens/money/index.tsx`'s `liveKey` usage. */
const RIBBON_KEYS = {
  tab: "tab:money",
  goto: "money:goto",
  gotoMonth: "money:goto-month",
  gotoBusiness: "money:goto-business",
  gotoRamp: "money:goto-ramp",
  standProfit: "money:stand-profit",
  standIn: "money:stand-in",
  standOut: "money:stand-out",
  standSales: "money:stand-sales",
} as const;

function syncLiveRibbon(): void {
  const s = state.summary;

  setLiveRibbonValue(RIBBON_KEYS.tab, s ? { label: usd(s.profit.cents), color: ACCENT.greenSoft } : null);
  setLiveRibbonValue(RIBBON_KEYS.goto, { label: VIEW_LABEL[state.view] });
  setLiveRibbonValue(RIBBON_KEYS.gotoMonth, { active: state.view === "month" });
  setLiveRibbonValue(RIBBON_KEYS.gotoBusiness, { active: state.view === "business" });
  setLiveRibbonValue(RIBBON_KEYS.gotoRamp, { active: state.view === "ramp" });

  if (s) {
    setLiveRibbonValue(RIBBON_KEYS.standProfit, { label: `${usd(s.profit.cents)} profit` });
    setLiveRibbonValue(RIBBON_KEYS.standIn, { label: `${usd(s.revenue.cents)} in` });
    setLiveRibbonValue(RIBBON_KEYS.standOut, { label: `${usd(s.cost.cents)} out` });
    setLiveRibbonValue(RIBBON_KEYS.standSales, { label: `${s.sales.count} of ${s.sales.goal} sales` });
  } else {
    setLiveRibbonValue(RIBBON_KEYS.standProfit, null);
    setLiveRibbonValue(RIBBON_KEYS.standIn, null);
    setLiveRibbonValue(RIBBON_KEYS.standOut, null);
    setLiveRibbonValue(RIBBON_KEYS.standSales, null);
  }
}

function setState(patch: Partial<MoneyStoreState>): void {
  state = { ...state, ...patch };
  syncLiveRibbon();
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

/** The ramp view's own +/- target editor writes straight through, then reloads. */
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

// ── Set your goals dialog ───────────────────────────────────────────────────

export function openGoalsDialog(): void {
  setState({ goalsDialogOpen: true });
}

export function closeGoalsDialog(): void {
  setState({ goalsDialogOpen: false });
}

/** "Applies as you type" (design convention) — the dialog debounces its own calls; this just writes through and reloads. */
export async function saveGoals(patch: { goalSales?: number; mrrGoalCents?: number }): Promise<void> {
  if (!adminFetchRef) return;
  setState({ goalsSaving: true });
  try {
    const res = await adminFetchRef("/api/admin/money/goals", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setState({ goalsSaving: false });
      void loadSummary();
      if (state.ramp) void loadRamp();
    } else {
      setState({ goalsSaving: false, lastMessage: data?.error ?? "Save failed." });
    }
  } catch (err) {
    setState({ goalsSaving: false, lastMessage: err instanceof Error ? err.message : String(err) });
  }
}

// ── Log a sale ───────────────────────────────────────────────────────────────
//
// Real, not a fabricated celebration — see admin-money.ts's `ManualSale` doc
// comment. A sale logged here is a genuine, disclosed record merged into the
// same revenue/streak/trend figures everywhere else on this screen.

export function openLogSaleDialog(): void {
  setState({ logSaleDialogOpen: true, logSaleError: null });
}

export function closeLogSaleDialog(): void {
  setState({ logSaleDialogOpen: false, logSaleError: null });
}

export async function logSale(who: string, what: string, amountCents: number): Promise<void> {
  if (!adminFetchRef) return;
  setState({ logSaleSubmitting: true, logSaleError: null });
  try {
    const res = await adminFetchRef("/api/admin/money/sales", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ who, what, amountCents }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      setState({
        logSaleSubmitting: false,
        logSaleDialogOpen: false,
        celebrateSale: { who, what, amountCents },
      });
      void loadSummary();
      if (state.ramp) void loadRamp();
      if (state.business) void loadBusiness();
      setTimeout(() => setState({ celebrateSale: null }), 4000);
    } else {
      setState({ logSaleSubmitting: false, logSaleError: data?.error ?? "Could not log the sale." });
    }
  } catch (err) {
    setState({ logSaleSubmitting: false, logSaleError: err instanceof Error ? err.message : String(err) });
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

/**
 * Row-level copy for the sales/retainers/clients/ramp right-click menus —
 * same clipboard mechanism as `copyFigures`, just scoped to one row's real
 * text instead of the whole loaded payload.
 */
export function copyMoneyRow(text: string): void {
  copyToClipboard(text);
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
    goalsDialogOpen: false,
    goalsSaving: false,
    logSaleDialogOpen: false,
    logSaleSubmitting: false,
    logSaleError: null,
    celebrateSale: null,
    lastMessage: null,
  };
}
