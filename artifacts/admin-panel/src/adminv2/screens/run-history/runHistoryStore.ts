/**
 * Run History's store.
 *
 * A plain external store like `deployStore`/`sqlStore`, for the same reason
 * (ribbon closures are built at `registerScreen()` module-load time and cannot
 * call a hook), plus one of its own: the two things that cause a row to exist
 * — the Deploy Console and the SQL Runner — need to be able to say "something
 * new happened" whether or not `/run-history` has ever been opened.
 *
 * ## The log is server-side
 *
 * Rows live in `simulator_run_history` and are written by the routes that
 * actually run things (`admin-deploy-console.ts`, `admin-engines.ts`'s SQL and
 * migration executors). This store only reads, annotates and forgets. Nothing
 * here can create a run, and that is deliberate: a log the client could write
 * to would be worth less than no log.
 *
 * Consequences worth knowing:
 *
 * - A run is kept even if the tab is closed mid-`pnpm install`, and a second
 *   admin's runs appear in yours.
 * - `search` and `filter` are applied **server-side**, because searching the
 *   output is the point (`ILIKE` over a column the list response does not
 *   return) and shipping every transcript to the browser to grep locally is
 *   not viable. Typing is therefore debounced — see `SEARCH_DEBOUNCE_MS`.
 * - `output` is absent from list rows and loaded per selection. `undefined`
 *   means "not fetched", never "it printed nothing"; `hasOutput` is the
 *   authority on the latter.
 *
 * ## Before the migration is run
 *
 * The table is provisioned by a manual migration Shane runs himself
 * (CLAUDE.md). Until then the routes answer with `tableMissing`, which the
 * screen states plainly instead of showing a broken error.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  deleteAllRuns,
  deleteRun,
  fetchRun,
  fetchRunHistory,
  saveRunNote,
  type AdminFetch,
} from "./runHistoryApi";
import { durationLabel, filterToKind, type RunFilter, type RunHistoryEntry } from "./runHistoryTypes";

const log = logger.child({ channel: "admin.shell" });

/** Long enough that a typed word is one request, short enough to feel live. */
export const SEARCH_DEBOUNCE_MS = 250;

export interface RunHistoryState {
  entries: RunHistoryEntry[];
  /** Every row in the table, not just the loaded page. */
  total: number;
  failed: number;
  loading: boolean;
  error: string | null;
  /** True when the manual migration has not been run yet. */
  tableMissing: boolean;
  migration: string | null;
  /** True once a load has completed, so "nothing yet" is distinguishable from "not asked yet". */
  loaded: boolean;

  search: string;
  filter: RunFilter;
  selectedId: string | null;
}

type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `RunHistoryFetchBridge` on every render — see its doc comment. */
export function configureRunHistoryFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let state: RunHistoryState = {
  entries: [],
  total: 0,
  failed: 0,
  loading: false,
  error: null,
  tableMissing: false,
  migration: null,
  loaded: false,
  search: "",
  filter: "All",
  selectedId: null,
};

const listeners = new Set<Listener>();

/**
 * The Watch tab's "Runs that failed" button, kept current.
 *
 * A screen's `ribbon` array is frozen at module-load time, so a real count has
 * to come through `liveRibbon`. This is the only count this screen publishes,
 * and it clears itself the moment nothing is failing — a badge that means "you
 * must act" has to be able to say "you need not". The number is the table's
 * own total, not this page's, so it never quietly means "failures on screen".
 */
export const WATCH_FAILED_KEY = "run-history:failed";

function syncWatchCount(failed: number): void {
  setLiveRibbonValue(
    WATCH_FAILED_KEY,
    failed > 0 ? { label: "Runs that failed", live: String(failed), color: ACCENT.danger } : null,
  );
}

function setState(patch: Partial<RunHistoryState>): void {
  state = { ...state, ...patch };
  if (patch.failed !== undefined) syncWatchCount(patch.failed);
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): RunHistoryState {
  return state;
}

// ── Loading ──────────────────────────────────────────────────────────────────

/**
 * Guards against an out-of-order response overwriting a newer one — the
 * classic search race, where "sel" lands after "select" and the list snaps
 * back to the wrong result.
 */
let loadSeq = 0;

export async function loadRuns(): Promise<void> {
  if (!adminFetchRef) return;
  const seq = ++loadSeq;
  setState({ loading: true, error: null });

  try {
    const page = await fetchRunHistory(adminFetchRef, {
      kind: filterToKind(state.filter),
      q: state.search.trim(),
    });
    if (seq !== loadSeq) return;
    setState({
      loading: false,
      loaded: true,
      entries: page.runs,
      total: page.total,
      failed: page.failed,
      tableMissing: Boolean(page.tableMissing),
      migration: page.migration ?? null,
    });
  } catch (err) {
    if (seq !== loadSeq) return;
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ message }, "run history could not be read");
    setState({ loading: false, loaded: true, error: message });
  }
}

let warmed = false;

/** First load. Safe to call more than once — `RunHistoryBody` and the ribbon both do. */
export function warmRunHistory(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadRuns();
}

/**
 * Called by `deployStore`/`sqlStore` the moment a run finishes. The row was
 * already written by the server on the way through; this only re-reads it.
 *
 * Fire-and-forget on purpose: nothing about a deploy or a query should wait on
 * the history list refreshing, and a failure here is a stale list, not a lost
 * run.
 */
export function runHistoryChanged(): void {
  if (!adminFetchRef) return;
  warmed = true;
  void loadRuns();
}

// ── Selection ────────────────────────────────────────────────────────────────

/** Full rows, by id — the list response omits `output`, so it is fetched per selection. */
const outputCache = new Map<string, RunHistoryEntry>();

export function selectRun(id: string | null): void {
  setState({ selectedId: id });
  if (id) void loadFullRun(id);
}

async function loadFullRun(id: string): Promise<void> {
  if (!adminFetchRef || outputCache.has(id)) return;
  try {
    const run = await fetchRun(adminFetchRef, id);
    if (!run) return;
    outputCache.set(id, run);
    // Merge the fetched output into the list row so a re-render sees it.
    setState({ entries: state.entries.map((e) => (e.id === id ? { ...e, output: run.output } : e)) });
  } catch (err) {
    log.warn({ id, message: err instanceof Error ? err.message : String(err) }, "run output could not be read");
  }
}

export function entryById(id: string): RunHistoryEntry | undefined {
  const listed = state.entries.find((e) => e.id === id);
  if (!listed) return outputCache.get(id);
  const cached = outputCache.get(id);
  return cached ? { ...listed, output: cached.output } : listed;
}

/** The selected run, falling back to the newest — so the panels are never blank while rows exist. */
export function selectedEntry(): RunHistoryEntry | undefined {
  return (state.selectedId ? entryById(state.selectedId) : undefined) ?? state.entries[0];
}

// ── Writes ───────────────────────────────────────────────────────────────────

let searchTimer: ReturnType<typeof setTimeout> | null = null;

/** Updates the box immediately; the request that follows it is debounced. */
export function setSearch(search: string): void {
  setState({ search });
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    searchTimer = null;
    void loadRuns();
  }, SEARCH_DEBOUNCE_MS);
}

export function setFilter(filter: RunFilter): void {
  if (state.filter === filter) return;
  setState({ filter });
  void loadRuns();
}

/**
 * The note writes straight through — SHELL.md section 3, no save step.
 *
 * Optimistic: the field shows what you typed at once and the PATCH follows.
 * If it fails, the stored value is put back rather than left looking saved.
 */
export async function setNote(id: string, note: string): Promise<void> {
  if (!adminFetchRef) return;
  const previous = entryById(id)?.note ?? "";
  if (previous === note) return;

  applyNote(id, note);
  try {
    await saveRunNote(adminFetchRef, id, note);
  } catch (err) {
    applyNote(id, previous);
    const message = err instanceof Error ? err.message : String(err);
    log.warn({ id, message }, "run note could not be saved");
    setState({ error: `That note did not save — ${message}` });
  }
}

function applyNote(id: string, note: string): void {
  const cached = outputCache.get(id);
  if (cached) outputCache.set(id, { ...cached, note });
  setState({ entries: state.entries.map((e) => (e.id === id ? { ...e, note } : e)) });
}

export async function forgetRun(id: string): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteRun(adminFetchRef, id);
    outputCache.delete(id);
    setState({ selectedId: state.selectedId === id ? null : state.selectedId });
    await loadRuns();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ error: `That run was not forgotten — ${message}` });
  }
}

export async function clearRunHistory(): Promise<void> {
  if (!adminFetchRef) return;
  try {
    await deleteAllRuns(adminFetchRef);
    outputCache.clear();
    setState({ selectedId: null });
    await loadRuns();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    setState({ error: `The log was not cleared — ${message}` });
  }
}

export function copyText(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** Unfiltered, straight off the table — see `syncWatchCount`. */
export function failedCount(): number {
  return state.failed;
}

/** Re-exported so the panels have one import for the whole screen's vocabulary. */
export { durationLabel };

/** Test seam. Not used by the app. */
export function resetRunHistoryStore(): void {
  adminFetchRef = null;
  warmed = false;
  loadSeq = 0;
  outputCache.clear();
  if (searchTimer) {
    clearTimeout(searchTimer);
    searchTimer = null;
  }
  setLiveRibbonValue(WATCH_FAILED_KEY, null);
  state = {
    entries: [],
    total: 0,
    failed: 0,
    loading: false,
    error: null,
    tableMissing: false,
    migration: null,
    loaded: false,
    search: "",
    filter: "All",
    selectedId: null,
  };
}
