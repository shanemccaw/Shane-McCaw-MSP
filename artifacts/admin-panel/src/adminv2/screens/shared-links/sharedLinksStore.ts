/**
 * The Shared Links screen's shared state — a plain external store, not React
 * state, for the same reason `servicesStore.ts`/`fulfillmentStore.ts` are
 * one: the Home tab's "All shared links" gallery and the Watch tab's live
 * "expiring soon" count are built at `registerScreen()` module-load time,
 * outside any component, so they cannot call `useAdminFetch()`.
 * `SharedLinksFetchBridge` (always mounted, see `AdminV2.tsx`) hands over
 * the current `adminFetch` and warms the list once. The `share` peek
 * resolver is the hard constraint that matters most: `registry/types.ts`
 * makes `PeekResolver` synchronous, so anything a peek shows has to already
 * be sitting in `state.shares`.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { extendShare as apiExtendShare, listShares, revokeShare as apiRevokeShare, type AdminFetch } from "./sharedLinksApi";
import { isExpired, isExpiringSoon, isHighEngagement, isNeverOpened, type Share } from "./sharedLinksTypes";

export type StatusFilter = "all" | "active" | "expired" | "never-opened";
export type SortField = "views" | "client" | "expires";
export type SortDir = "asc" | "desc";

export interface SharedLinksState {
  shares: Share[];
  loading: boolean;
  error: string | null;

  /** The share the open doc names, id as a string (`OpenDoc.recordId`) — same pattern as `servicesStore.ts`'s `openId`. */
  openId: string | null;

  search: string;
  statusFilter: StatusFilter;
  sortField: SortField;
  sortDir: SortDir;

  /** Per-share in-flight save, so the peek/body can show "Working…" without a screen-wide spinner. */
  savingIds: Set<number>;

  /** Transient confirmation line — gone in a few seconds, same convention as `servicesStore.ts`'s `message`. */
  message: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let adminFetchRef: AdminFetch | null = null;

/** Called by `SharedLinksFetchBridge` on every render. */
export function configureSharedLinksFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

/** Test seam. */
export function getSharedLinksFetch(): AdminFetch | null {
  return adminFetchRef;
}

const INITIAL: SharedLinksState = {
  shares: [],
  loading: false,
  error: null,
  openId: null,
  search: "",
  statusFilter: "all",
  sortField: "views",
  sortDir: "desc",
  savingIds: new Set(),
  message: null,
};

let state: SharedLinksState = { ...INITIAL };

export const RIBBON_KEYS = {
  /** Home tab's "All shared links" label — real count, not frozen at module-load's zero. */
  total: "shared-links:total",
  /** Watch tab's live "expiring soon" count. */
  expiringWatch: "shared-links:expiring",
} as const;

function syncLiveRibbon(): void {
  setLiveRibbonValue(RIBBON_KEYS.total, { label: `${state.shares.length} link${state.shares.length === 1 ? "" : "s"}` });
  const expiring = state.shares.filter((s) => isExpiringSoon(s)).length;
  setLiveRibbonValue(
    RIBBON_KEYS.expiringWatch,
    expiring > 0 ? { label: `${expiring} expiring soon`, color: ACCENT.amber } : { label: "Nothing expiring soon" },
  );
}

function setState(patch: Partial<SharedLinksState>): void {
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

export function getSnapshot(): SharedLinksState {
  return state;
}

/** Test seam. Not used by the app. */
export function resetSharedLinksStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = { ...INITIAL, savingIds: new Set() };
  for (const key of Object.values(RIBBON_KEYS)) setLiveRibbonValue(key, null);
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

// ── Selection ────────────────────────────────────────────────────────────────

/** Called from `index.tsx`'s `render(ctx)` — see `openId`'s doc comment. */
export function selectShare(id: string | null): void {
  if (state.openId === id) return;
  setState({ openId: id });
}

// ── Selectors ────────────────────────────────────────────────────────────────

export function shareById(id: string | number | null, s: SharedLinksState = state): Share | null {
  if (id == null) return null;
  const numId = Number(id);
  return s.shares.find((share) => share.id === numId) ?? null;
}

export function expiringSoon(s: SharedLinksState = state): Share[] {
  return s.shares.filter((share) => isExpiringSoon(share));
}

export function activeShares(s: SharedLinksState = state): Share[] {
  return s.shares.filter((share) => !isExpired(share));
}

export function expiredShares(s: SharedLinksState = state): Share[] {
  return s.shares.filter((share) => isExpired(share));
}

export function totalViews(s: SharedLinksState = state): number {
  return s.shares.reduce((sum, share) => sum + share.viewCount, 0);
}

export function highEngagementCount(s: SharedLinksState = state): number {
  return s.shares.filter(isHighEngagement).length;
}

/** Filtered + sorted — same logic `DiagnosticShares.tsx` validated, moved server-state-free into the store so both the Explorer and the palette can share it. */
export function visibleShares(s: SharedLinksState = state): Share[] {
  let rows = [...s.shares];

  if (s.statusFilter === "active") rows = rows.filter((share) => !isExpired(share));
  else if (s.statusFilter === "expired") rows = rows.filter(isExpired);
  else if (s.statusFilter === "never-opened") rows = rows.filter(isNeverOpened);

  const q = s.search.trim().toLowerCase();
  if (q) {
    rows = rows.filter(
      (share) =>
        (share.client.name ?? "").toLowerCase().includes(q) ||
        share.client.email.toLowerCase().includes(q) ||
        (share.client.company ?? "").toLowerCase().includes(q),
    );
  }

  rows.sort((a, b) => {
    let cmp = 0;
    if (s.sortField === "views") cmp = a.viewCount - b.viewCount;
    else if (s.sortField === "client") cmp = (a.client.name ?? a.client.email).localeCompare(b.client.name ?? b.client.email);
    else if (s.sortField === "expires") cmp = a.expiresAt.localeCompare(b.expiresAt);
    return s.sortDir === "asc" ? cmp : -cmp;
  });

  return rows;
}

export function setSearch(search: string): void {
  setState({ search });
}

export function setStatusFilter(statusFilter: StatusFilter): void {
  setState({ statusFilter });
}

export function setSort(field: SortField): void {
  if (state.sortField === field) {
    setState({ sortDir: state.sortDir === "asc" ? "desc" : "asc" });
  } else {
    setState({ sortField: field, sortDir: "desc" });
  }
}

// ── Loading ──────────────────────────────────────────────────────────────────

let warmed = false;

/** Loads the list once per session. See `refreshShares` for the explicit re-read. */
export function warmShares(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void refreshShares();
}

export async function refreshShares(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  setState({ loading: true, error: null });
  try {
    const shares = await listShares(adminFetch);
    setState({ loading: false, shares });
  } catch (err) {
    setState({ loading: false, error: errText(err) });
  }
}

// ── Mutations ────────────────────────────────────────────────────────────────

function withSaving(id: number, saving: boolean): void {
  const next = new Set(state.savingIds);
  if (saving) next.add(id);
  else next.delete(id);
  setState({ savingIds: next });
}

/** Sets `expiresAt` to now — see `admin-quick-win.ts`'s route doc comment for why this is the real revoke. */
export async function revokeShareAction(id: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  withSaving(id, true);
  try {
    const { expiresAt } = await apiRevokeShare(adminFetch, id);
    setState({ shares: state.shares.map((s) => (s.id === id ? { ...s, expiresAt } : s)) });
    say("Revoked — the link stops working immediately.");
  } catch (err) {
    say(errText(err));
  } finally {
    withSaving(id, false);
  }
}

/** Pushes `expiresAt` out by `days` (default 14) — also the only way to bring back a revoked/expired link. */
export async function extendShareAction(id: number, days = 14): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  withSaving(id, true);
  try {
    const { expiresAt } = await apiExtendShare(adminFetch, id, days);
    setState({ shares: state.shares.map((s) => (s.id === id ? { ...s, expiresAt } : s)) });
    say(`Extended ${days} days.`);
  } catch (err) {
    say(errText(err));
  } finally {
    withSaving(id, false);
  }
}

// ── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

export function copyShareLink(url: string): void {
  copyToClipboard(url);
  say("Link copied.");
}

/** Test seam. Not used by the app. */
export function seedSharedLinksStore(patch: Partial<SharedLinksState>): void {
  setState(patch);
}
