/**
 * Document Viewer's store.
 *
 * A plain external store, same reasoning as `runHistoryStore`/`servicesStore`:
 * the Home-tab ribbon gallery and the Watch-tab failed count are built at
 * `registerScreen()` module-load time, outside any component, so they cannot
 * call `useAdminFetch()` — `DocumentsFetchBridge`, always mounted in
 * `AdminV2.tsx`, hands over a live `adminFetch` every render.
 *
 * Filtering is client-side over the loaded window (`HISTORY_FETCH_LIMIT` rows,
 * newest first) — the real route only takes a `docType`/`limit` query, not a
 * free-text search or a category filter, so there is nothing server-side to
 * send. The Watch tab's failed count is therefore honestly scoped to "within
 * the most recent N", not the whole table.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import { archiveDocument, fetchDocumentHistory, fetchDocumentHtml, type AdminFetch } from "./documentsApi";
import { subjectLabel, type DocCategoryFilter, type DocumentEntry } from "./documentsTypes";

const log = logger.child({ channel: "admin.shell" });

export interface DocumentsState {
  entries: DocumentEntry[];
  loading: boolean;
  error: string | null;
  /** True once a load has completed, so "nothing yet" reads differently from "not asked yet". */
  loaded: boolean;

  search: string;
  category: DocCategoryFilter;
  selectedId: string | null;

  /** Set while the selected document's real HTML is in flight. */
  contentLoading: boolean;
  contentError: string | null;
}

type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `DocumentsFetchBridge` on every render — see its doc comment. */
export function configureDocumentsFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let state: DocumentsState = {
  entries: [],
  loading: false,
  error: null,
  loaded: false,
  search: "",
  category: "All",
  selectedId: null,
  contentLoading: false,
  contentError: null,
};

const listeners = new Set<Listener>();

/**
 * The Watch tab's "Generations that failed" button.
 *
 * Scoped to the most recent `HISTORY_FETCH_LIMIT` rows, not the whole table —
 * the real route has no separate failed-count query, and pulling the entire
 * table just to count it would cost more than the number is worth. The
 * ribbon button's `title` says so explicitly, same discipline Run History's
 * `WATCH_FAILED_KEY` was held to for its own (real, whole-table) count.
 */
export const WATCH_FAILED_KEY = "documents:failed";

function syncWatchCount(entries: DocumentEntry[]): void {
  const failed = entries.filter((e) => e.status === "failed").length;
  setLiveRibbonValue(
    WATCH_FAILED_KEY,
    failed > 0 ? { label: "Generations that failed", live: String(failed), color: ACCENT.danger } : null,
  );
}

function setState(patch: Partial<DocumentsState>): void {
  state = { ...state, ...patch };
  if (patch.entries) syncWatchCount(patch.entries);
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): DocumentsState {
  return state;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/** Guards against an out-of-order response overwriting a newer one. */
let loadSeq = 0;

export async function loadDocuments(): Promise<void> {
  if (!adminFetchRef) return;
  const seq = ++loadSeq;
  setState({ loading: true, error: null });

  try {
    const entries = await fetchDocumentHistory(adminFetchRef);
    if (seq !== loadSeq) return;
    setState({ loading: false, loaded: true, entries });
  } catch (err) {
    if (seq !== loadSeq) return;
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ message }, "document history could not be read");
    setState({ loading: false, loaded: true, error: message });
  }
}

let warmed = false;

/** First load. Safe to call more than once — `DocumentsExplorer` and the ribbon both do. */
export function warmDocuments(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadDocuments();
}

// ── Filtering (client-side — see file doc comment) ─────────────────────────

export function setSearch(search: string): void {
  setState({ search });
}

export function setCategory(category: DocCategoryFilter): void {
  setState({ category });
}

export function visibleDocuments(snapshot: DocumentsState = state): DocumentEntry[] {
  const needle = snapshot.search.trim().toLowerCase();
  return snapshot.entries.filter((e) => {
    if (snapshot.category !== "All" && e.category !== snapshot.category) return false;
    if (!needle) return true;
    return `${e.title} ${subjectLabel(e)} ${e.projectTitle ?? ""} ${e.docTypeLabel ?? e.docType}`
      .toLowerCase()
      .includes(needle);
  });
}

// ── Selection & content ─────────────────────────────────────────────────────

/** Full HTML bodies, by id — the list response omits them, so they are fetched per selection. */
const htmlCache = new Map<string, string>();

export function selectDocument(id: string | null): void {
  setState({ selectedId: id, contentError: null });
  if (id) void loadContent(id);
}

async function loadContent(id: string): Promise<void> {
  if (!adminFetchRef || htmlCache.has(id)) return;
  setState({ contentLoading: true });
  try {
    const html = await fetchDocumentHtml(adminFetchRef, id);
    htmlCache.set(id, html);
    // Merge into the list row so a re-render sees it, same pattern runHistoryStore uses for `output`.
    setState({ contentLoading: false, entries: state.entries.map((e) => (e.id === id ? { ...e, html } : e)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ id, message }, "document content could not be read");
    setState({ contentLoading: false, contentError: message });
  }
}

export function entryById(id: string): DocumentEntry | undefined {
  const listed = state.entries.find((e) => e.id === id);
  if (!listed) return undefined;
  const cached = htmlCache.get(id);
  return cached ? { ...listed, html: cached } : listed;
}

export function selectedEntry(): DocumentEntry | undefined {
  return state.selectedId ? entryById(state.selectedId) : undefined;
}

// ── Writes ───────────────────────────────────────────────────────────────────

/**
 * Archives the document — the one real mutation this screen exposes. The row
 * stays (`status` flips to `"archived"`), matching the route's own soft-delete
 * convention; there is no hard-delete endpoint to call instead.
 */
export async function archiveSelected(id: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await archiveDocument(adminFetchRef, id);
    setState({ entries: state.entries.map((e) => (e.id === id ? { ...e, status: "archived" } : e)) });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ error: `That document was not archived — ${message}` });
  }
}

export function copyText(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** See `WATCH_FAILED_KEY`'s doc comment for the "most recent N" scoping. */
export function failedCount(snapshot: DocumentsState = state): number {
  return snapshot.entries.filter((e) => e.status === "failed").length;
}

/** Test seam. Not used by the app. */
export function resetDocumentsStore(): void {
  adminFetchRef = null;
  warmed = false;
  loadSeq = 0;
  htmlCache.clear();
  setLiveRibbonValue(WATCH_FAILED_KEY, null);
  state = {
    entries: [],
    loading: false,
    error: null,
    loaded: false,
    search: "",
    category: "All",
    selectedId: null,
    contentLoading: false,
    contentError: null,
  };
}
