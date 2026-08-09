/**
 * The Services screen's shared state — a plain external store, not React
 * state, for the same reason `moneyStore.ts`/`endpointsStore.ts` are one: the
 * ribbon this screen contributes (the Home tab's catalog gallery, the Watch
 * tab's live "no price set" count) is built once, at `registerScreen()`
 * module-load time, outside any component, so its commands cannot call
 * `useAdminFetch()`. `ServicesFetchBridge` (always mounted, see
 * `AdminV2.tsx`) hands over the current `adminFetch` and warms the catalog
 * once, so those surfaces have real rows before `/services` has ever been
 * opened. The `service` peek resolver is the hard constraint that matters
 * most: `registry/types.ts` makes `PeekResolver` synchronous, so anything a
 * peek shows has to already be sitting in `state.services`.
 */

import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { createService as apiCreateService, deleteService as apiDeleteService, exportCatalog, generateServicePdf, listServices, updateService as apiUpdateService, type AdminFetch } from "./servicesApi";
import { effectivePriceCents, hasNoPrice, suggestSlug, type Service } from "./servicesTypes";

export interface ServicesState {
  services: Service[];
  loading: boolean;
  error: string | null;

  /**
   * The service the open doc names, id as a string (`OpenDoc.recordId`).
   * Adopted from `ScreenRenderContext.recordId` in `index.tsx`'s `render` —
   * `PanelSpec.render` takes no arguments (`registry/types.ts`), so
   * `ServiceProperties` has no other way to know which record is open, the
   * same reason `endpointsStore.ts`'s `selectedKey` exists.
   */
  openId: string | null;

  /** Explorer panel's filter box. */
  filter: string;
  /** Explorer panel's category chip filter — a `topCategory()` value, or "all". */
  category: string;

  /** Per-service in-flight save, so the peek/dialog can show "Saving…" without a screen-wide spinner. */
  savingIds: Set<number>;

  editorOpenId: number | null;

  /** The design's transient confirmation line — gone in a few seconds. */
  message: string | null;
}

type Listener = () => void;

const listeners = new Set<Listener>();
let adminFetchRef: AdminFetch | null = null;

/** Called by `ServicesFetchBridge` on every render — see file doc comment. */
export function configureServicesFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

/** Test seam. */
export function getServicesFetch(): AdminFetch | null {
  return adminFetchRef;
}

const INITIAL: ServicesState = {
  services: [],
  loading: false,
  error: null,
  openId: null,
  filter: "",
  category: "all",
  savingIds: new Set(),
  editorOpenId: null,
  message: null,
};

let state: ServicesState = { ...INITIAL };

/**
 * The Watch tab's "No price set" button's live key.
 *
 * `RibbonCommand.live` (the small badge number) is read straight off the
 * static command object — `RibbonBody.tsx`'s `CommandButton` never consults
 * the `liveKey` overlay for it, only for `label`/`color`/`active` — so a
 * `live: unpricedServices().length` computed at `registerScreen()` module-load
 * time (before any fetch has resolved) would be frozen at 0 forever, the same
 * trap `moneyStore.ts`'s doc comment describes. Folding the count into the
 * LABEL instead, through the overlay, is the path that is actually read live.
 */
export const WATCH_UNPRICED_KEY = "services:watch-unpriced";

function syncLiveRibbon(): void {
  const count = unpricedServices().length;
  setLiveRibbonValue(WATCH_UNPRICED_KEY, count > 0 ? { label: `${count} no price`, color: ACCENT.amber } : { label: "No price set" });
}

function setState(patch: Partial<ServicesState>): void {
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

export function getSnapshot(): ServicesState {
  return state;
}

/** Test seam. Not used by the app. */
export function resetServicesStore(): void {
  adminFetchRef = null;
  catalogWarmed = false;
  state = { ...INITIAL, savingIds: new Set() };
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

let messageTimer: ReturnType<typeof setTimeout> | null = null;

export function say(message: string | null): void {
  setState({ message });
  if (messageTimer) clearTimeout(messageTimer);
  if (message) {
    messageTimer = setTimeout(() => setState({ message: null }), 3400);
  }
}

// ── Selection ─────────────────────────────────────────────────────────────────

/** Called from `index.tsx`'s `render(ctx)` — see `openId`'s doc comment. */
export function selectService(id: string | null): void {
  if (state.openId === id) return;
  setState({ openId: id });
}

// ── Selectors ─────────────────────────────────────────────────────────────────

export function serviceById(id: string | number | null, s: ServicesState = state): Service | null {
  if (id == null) return null;
  const numId = Number(id);
  return s.services.find((svc) => svc.id === numId) ?? null;
}

/** Public catalog entries nobody can actually buy — the Watch tab's live count. */
export function unpricedServices(s: ServicesState = state): Service[] {
  return s.services.filter(hasNoPrice);
}

export function totalCatalogValueCents(s: ServicesState = state): number {
  return s.services.reduce((sum, svc) => sum + effectivePriceCents(svc), 0);
}

// ── Catalog ───────────────────────────────────────────────────────────────────

let catalogWarmed = false;

/** Loads the catalog once per session. See `refreshCatalog` for the explicit re-read. */
export function warmCatalog(): void {
  if (catalogWarmed || !adminFetchRef) return;
  catalogWarmed = true;
  void refreshCatalog();
}

export async function refreshCatalog(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  setState({ loading: true, error: null });
  try {
    const services = await listServices(adminFetch);
    setState({ loading: false, services });
  } catch (err) {
    setState({ loading: false, error: errText(err) });
  }
}

export function setFilter(filter: string): void {
  setState({ filter });
}

export function setCategory(category: string): void {
  setState({ category });
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Prompts for a name and a slug, the same `window.prompt` flow
 * `screens/ad/index.tsx`'s `onNewMsp` uses — this shell has no generic
 * creation dialog, and a two-field prompt is honest about how little a new
 * catalog row needs before it can be opened and filled in properly.
 */
export async function createServiceInteractive(): Promise<Service | null> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return null;
  const name = window.prompt("New service name:");
  if (!name?.trim()) return null;
  const slug = window.prompt("Slug (used in URLs, cannot change afterwards):", suggestSlug(name));
  if (!slug?.trim()) return null;
  try {
    const created = await apiCreateService(adminFetch, { name: name.trim(), slug: slug.trim() });
    setState({ services: [...state.services, created] });
    say(`Created "${created.name}".`);
    return created;
  } catch (err) {
    window.alert(errText(err));
    return null;
  }
}

/** Contextual tab's "Duplicate" — a real copy, landed private so it can't be bought by accident before it's reviewed. */
export async function duplicateService(id: number): Promise<Service | null> {
  const adminFetch = adminFetchRef;
  const source = serviceById(id);
  if (!adminFetch || !source) return null;
  const name = `${source.name} (copy)`;
  let slug = `${source.slug ?? suggestSlug(source.name)}-copy`;
  if (state.services.some((s) => s.slug === slug)) slug = `${slug}-${Date.now()}`;
  try {
    const created = await apiCreateService(adminFetch, { name, slug });
    const merged = await apiUpdateService(adminFetch, {
      ...source,
      id: created.id,
      slug: created.slug,
      name,
      visibility: "private",
      isPublic: false,
      overviewPdfKey: null,
      overviewPdfGeneratedAt: null,
    });
    setState({ services: [...state.services, merged] });
    say(`Duplicated as "${merged.name}", set to private.`);
    return merged;
  } catch (err) {
    say(errText(err));
    return null;
  }
}

// ── Update ────────────────────────────────────────────────────────────────────

function withSaving(id: number, saving: boolean): void {
  const next = new Set(state.savingIds);
  if (saving) next.add(id);
  else next.delete(id);
  setState({ savingIds: next });
}

/**
 * Writes a patch to one service. Always sends the FULL merged record — see
 * `toUpdatePayload`'s doc comment for why a partial body would NULL every
 * field this screen didn't mention.
 */
export async function updateServiceField(id: number, patch: Partial<Service>): Promise<void> {
  const adminFetch = adminFetchRef;
  const current = serviceById(id);
  if (!adminFetch || !current) return;
  const merged: Service = { ...current, ...patch };
  withSaving(id, true);
  try {
    const saved = await apiUpdateService(adminFetch, merged);
    setState({ services: state.services.map((s) => (s.id === id ? saved : s)) });
  } catch (err) {
    say(errText(err));
  } finally {
    withSaving(id, false);
  }
}

// ── Delete ────────────────────────────────────────────────────────────────────

export async function removeService(id: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    await apiDeleteService(adminFetch, id);
    setState({ services: state.services.filter((s) => s.id !== id), editorOpenId: state.editorOpenId === id ? null : state.editorOpenId });
    say("Deleted.");
  } catch (err) {
    say(errText(err));
  }
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export async function generatePdf(id: number): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  withSaving(id, true);
  try {
    await generateServicePdf(adminFetch, id);
    void refreshCatalog();
    say("PDF generated.");
  } catch (err) {
    say(errText(err));
  } finally {
    withSaving(id, false);
  }
}

// ── Export ────────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

export async function exportCatalogToClipboard(): Promise<void> {
  const adminFetch = adminFetchRef;
  if (!adminFetch) return;
  try {
    const payload = await exportCatalog(adminFetch);
    copyToClipboard(JSON.stringify(payload, null, 2));
    say("Catalog copied as JSON.");
  } catch (err) {
    say(errText(err));
  }
}

// ── The full editor dialog ────────────────────────────────────────────────────

export function openEditor(id: number): void {
  setState({ editorOpenId: id });
}

export function closeEditor(): void {
  setState({ editorOpenId: null });
}
