/**
 * Run History's store — the log itself.
 *
 * A plain external store like `deployStore`/`sqlStore`, for the same reason
 * (ribbon closures are built at `registerScreen()` module-load time and cannot
 * call a hook), plus one this screen has on its own: the two things that write
 * to it — `deployStore.execute` and `sqlStore.runStatements` — are not React
 * at all, and must be able to record a run whether or not `/run-history` has
 * ever been opened.
 *
 * ## Why this is localStorage and not a table
 *
 * There is no server-side record of these runs to read. `admin-deploy-console.ts`
 * shells out and returns the output without persisting anything, the
 * `/simulator/sql/execute` route is the same, and none of the platform's audit
 * tables (`audit_logs`, `msp_audit_logs`, ...) carry an admin console command.
 * Adding one would mean a schema change, which in this repo means hand-written
 * SQL that only Shane can run (CLAUDE.md) — so a DB-backed version of this
 * screen would ship dead and stay dead until that SQL was run.
 *
 * The honest thing it *can* be is the operator's own log, kept where the runs
 * were started from. That is a real tradeoff and worth stating plainly: this
 * history is per-browser-profile. It survives a reload, a redeploy and a
 * restart; it does not follow you to another machine, and it is not an audit
 * trail (the server's `admin.deploy` logger channel remains the audit record).
 * The screen says so in its own empty state rather than letting the omission
 * read as "nothing has been run".
 *
 * Search, filter and selection deliberately do **not** persist — same call the
 * shell makes for palette and peek state in `shellState.ts`.
 */

import { logger } from "@/lib/logger";
import { ACCENT } from "../../theme";
import { setLiveRibbonValue } from "../../shell/liveRibbon";
import {
  durationLabel,
  runTicket,
  runTitle,
  type RunFilter,
  type RunHistoryEntry,
  type RunKind,
} from "./runHistoryTypes";

const log = logger.child({ channel: "admin.shell" });

export const STORAGE_KEY = "adminv2_run_history";

/**
 * Enough to cover weeks of real use without turning a 5MB localStorage quota
 * into a problem the operator has to think about. Oldest fall off the end.
 */
export const MAX_ENTRIES = 200;

/** A `pnpm run build` transcript is the long one. Past this the tail is dropped, visibly. */
export const MAX_OUTPUT_CHARS = 8000;

export interface RunHistoryState {
  entries: RunHistoryEntry[];
  search: string;
  filter: RunFilter;
  /** The row whose detail the Properties panel and the Output tab are showing. */
  selectedId: string | null;
  /** Set when the log could not be persisted — surfaced rather than swallowed. */
  storageError: string | null;
}

type Listener = () => void;

let state: RunHistoryState = {
  entries: [],
  search: "",
  filter: "All",
  selectedId: null,
  storageError: null,
};

const listeners = new Set<Listener>();

/**
 * The Watch tab's "Runs that failed" button, kept current.
 *
 * A screen's `ribbon` array is frozen at module-load time, so a real count has
 * to come through `liveRibbon` (see that file). This is the only count this
 * screen publishes, and it clears itself the moment nothing is failing — a
 * badge that means "you must act" has to be able to say "you need not".
 */
export const WATCH_FAILED_KEY = "run-history:failed";

function syncWatchCount(): void {
  const failed = state.entries.filter((e) => !e.ok).length;
  setLiveRibbonValue(
    WATCH_FAILED_KEY,
    failed > 0 ? { label: "Runs that failed", live: String(failed), color: ACCENT.danger } : null,
  );
}

function setState(patch: Partial<RunHistoryState>): void {
  state = { ...state, ...patch };
  if (patch.entries) syncWatchCount();
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

// ── Persistence ──────────────────────────────────────────────────────────────

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Storage can throw on access alone under a blocked-cookies policy.
    return null;
  }
}

function isEntry(value: unknown): value is RunHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const e = value as Partial<RunHistoryEntry>;
  return (
    typeof e.id === "string" &&
    (e.kind === "deploy" || e.kind === "sql") &&
    typeof e.cmd === "string" &&
    typeof e.startedAt === "number"
  );
}

/**
 * Reads the log back. Rows that fail `isEntry` are dropped rather than
 * repaired — a half-shaped row from an older build would render as a run that
 * did not happen, which is worse than one that is missing.
 */
function load(): RunHistoryEntry[] {
  const store = storage();
  if (!store) return [];
  const raw = store.getItem(STORAGE_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isEntry).map((e) => ({
      ...e,
      title: typeof e.title === "string" ? e.title : "",
      ticket: typeof e.ticket === "string" ? e.ticket : "",
      durationMs: typeof e.durationMs === "number" ? e.durationMs : 0,
      ok: e.ok !== false,
      effect: Array.isArray(e.effect) ? e.effect.filter((x): x is string => typeof x === "string") : [],
      output: typeof e.output === "string" ? e.output : "",
      note: typeof e.note === "string" ? e.note : "",
    }));
  } catch (err) {
    log.warn({ message: err instanceof Error ? err.message : String(err) }, "run history could not be parsed; starting empty");
    return [];
  }
}

/**
 * Writes the log back, shedding the oldest half once on a quota failure. A
 * quota error is otherwise silent, and a silently-not-saving history is the
 * one failure mode this screen cannot have — if it still will not fit, the
 * message goes on `storageError` and the screen shows it.
 */
function persist(entries: RunHistoryEntry[]): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(entries));
    if (state.storageError) setState({ storageError: null });
  } catch {
    const halved = entries.slice(0, Math.floor(entries.length / 2));
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(halved));
      setState({ entries: halved });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn({ message }, "run history could not be saved");
      setState({ storageError: `This browser refused to save the run log — ${message}` });
    }
  }
}

let hydrated = false;

/** Reads the persisted log once. Safe to call more than once; `RunHistoryBody` and the ribbon both do. */
export function hydrateRunHistory(): void {
  if (hydrated) return;
  hydrated = true;
  const entries = load();
  if (entries.length > 0) setState({ entries });
}

// ── Recording ────────────────────────────────────────────────────────────────

let nextSeq = 0;

function newId(startedAt: number): string {
  return `${startedAt}-${++nextSeq}`;
}

function truncateOutput(output: string): string {
  if (output.length <= MAX_OUTPUT_CHARS) return output;
  return `${output.slice(0, MAX_OUTPUT_CHARS)}\n… ${output.length - MAX_OUTPUT_CHARS} more characters, not kept`;
}

function push(entry: RunHistoryEntry): void {
  hydrateRunHistory();
  const entries = [entry, ...state.entries].slice(0, MAX_ENTRIES);
  setState({ entries });
  persist(entries);
}

/** One step of a deploy run, structurally — see `deployStore.DeployStepResult`. */
export interface DeployStepLike {
  label: string;
  command: string;
  ok: boolean;
  output: string;
}

export interface DeployRunRecord {
  cmd: string;
  startedAt: number;
  ok: boolean;
  steps: DeployStepLike[];
  /**
   * The whitelisted operation's own kind, when the run came from one of the
   * six buttons. Undefined for a free-typed command — and it stays undefined
   * rather than being guessed from the text, because a wrong "read only" chip
   * on a command that wrote is the single most misleading thing this screen
   * could say.
   */
  opKind?: "read" | "write" | "heavy";
  error?: string;
}

/**
 * Records a Deploy Console run. Called from `deployStore.execute` on every
 * real completion — button or typed, success or failure.
 */
export function recordDeployRun(record: DeployRunRecord): void {
  const effect: string[] = [];
  if (record.opKind === "read") effect.push("read only");
  if (record.steps.length > 1) effect.push(`${record.steps.length} steps`);
  const failedStep = record.steps.find((s) => !s.ok);
  if (failedStep) effect.push(`stopped at ${failedStep.label}`);
  if (!record.ok && record.steps.length === 0) effect.push("did not run");

  const body = record.steps.map((s) => `$ ${s.command}\n${s.output}`.trimEnd()).join("\n\n");
  const output = record.error ? [body, `error: ${record.error}`].filter(Boolean).join("\n\n") : body;

  push({
    id: newId(record.startedAt),
    kind: "deploy",
    cmd: record.cmd,
    title: runTitle(record.cmd) || record.cmd,
    ticket: runTicket(record.cmd),
    startedAt: record.startedAt,
    durationMs: Math.max(0, Date.now() - record.startedAt),
    ok: record.ok,
    effect,
    output: truncateOutput(output),
    note: "",
  });
}

/** One statement result, structurally — see `screens/sql/sqlTypes.ts`'s `SqlStatementResult`. */
export interface SqlStatementLike {
  success: boolean;
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  executionMs: number;
  error?: string;
}

export interface SqlRunRecord {
  /** The query text, or the migration's repo path when `migrationFile` is set. */
  cmd: string;
  startedAt: number;
  statements: SqlStatementLike[] | null;
  /** Transport/auth failure — nothing reached the database. */
  error: string | null;
  /** A saved script's name or a migration's filename, when the run had one. Beats a derived title. */
  label?: string;
  migrationFile?: string;
}

/**
 * Records a SQL Runner run. Called from `sqlStore.runStatements`, which is the
 * one choke point both `runQueryText` and `runMigrationFile` go through.
 *
 * The effect chips are read off the results rather than off the query text:
 * a statement that came back with `fields` returned rows, one that came back
 * with a `rowCount` and no fields changed them. That distinction is the whole
 * "read only" vs "writes" claim, and guessing it from keywords would get
 * `insert ... returning` wrong in exactly the direction that matters.
 */
export function recordSqlRun(record: SqlRunRecord): void {
  const statements = record.statements ?? [];
  const effect: string[] = [];
  let ok: boolean;
  let output: string;
  let durationMs: number;

  if (record.error) {
    ok = false;
    effect.push("did not run");
    output = record.error;
    durationMs = Math.max(0, Date.now() - record.startedAt);
  } else {
    const failedIndex = statements.findIndex((s) => !s.success);
    ok = failedIndex < 0;
    durationMs = statements.reduce((total, s) => total + (Number.isFinite(s.executionMs) ? s.executionMs : 0), 0);

    if (statements.length > 1) effect.push(`${statements.length} statements`);

    const returning = statements.filter((s) => s.success && s.fields.length > 0);
    const changing = statements.filter((s) => s.success && s.fields.length === 0 && s.rowCount > 0);
    if (returning.length > 0) {
      const rows = returning.reduce((total, s) => total + s.rowCount, 0);
      effect.push(`${rows} row${rows === 1 ? "" : "s"}`);
    }
    if (changing.length > 0) {
      const rows = changing.reduce((total, s) => total + s.rowCount, 0);
      effect.push(`${rows} row${rows === 1 ? "" : "s"} changed`, "writes");
    } else if (returning.length > 0) {
      effect.push("read only");
    }
    if (returning.length === 0 && changing.length === 0 && statements.length > 0 && ok) {
      effect.push("no rows returned");
    }
    if (failedIndex >= 0) effect.push(`failed at statement ${failedIndex + 1}`);

    output = formatStatements(statements);
  }

  if (record.migrationFile) effect.unshift("migration file");

  push({
    id: newId(record.startedAt),
    kind: "sql",
    cmd: record.cmd,
    title: record.label || runTitle(record.cmd) || record.cmd,
    ticket: runTicket(record.cmd),
    startedAt: record.startedAt,
    durationMs,
    ok,
    effect,
    output: truncateOutput(output),
    note: "",
    ...(record.migrationFile ? { migrationFile: record.migrationFile } : {}),
  });
}

/** Tab-separated, the same shape `sqlStore.copyOutput` already puts on the clipboard. */
function formatStatements(statements: SqlStatementLike[]): string {
  return statements
    .map((s) => {
      if (!s.success) return `-- error: ${s.error ?? "failed"}`;
      if (s.fields.length === 0) return `-- ${s.rowCount} row${s.rowCount === 1 ? "" : "s"}, nothing returned`;
      return [s.fields.join("\t"), ...s.rows.map((row) => s.fields.map((f) => String(row[f])).join("\t"))].join("\n");
    })
    .join("\n\n");
}

// ── Reads ────────────────────────────────────────────────────────────────────

/** How many times this exact command appears in the whole log — the design's `runCount`. */
export function runCount(cmd: string): number {
  const key = cmd.trim();
  return state.entries.filter((e) => e.cmd.trim() === key).length;
}

export function entryById(id: string): RunHistoryEntry | undefined {
  return state.entries.find((e) => e.id === id);
}

/** The selected run, falling back to the newest — so the panels are never blank while rows exist. */
export function selectedEntry(): RunHistoryEntry | undefined {
  return (state.selectedId ? entryById(state.selectedId) : undefined) ?? state.entries[0];
}

/**
 * The current search + filter applied. Search covers title, command, ticket,
 * output and note — the design's five fields, and `output` is the one that
 * earns the box: finding the run by the error it printed is the reason you
 * come here.
 */
export function visibleEntries(): RunHistoryEntry[] {
  const query = state.search.trim().toLowerCase();
  const kind: RunKind | null = state.filter === "All" ? null : state.filter === "Deploy" ? "deploy" : "sql";
  return state.entries.filter((e) => {
    if (kind && e.kind !== kind) return false;
    if (!query) return true;
    return [e.title, e.cmd, e.ticket, e.output, e.note].join(" ").toLowerCase().includes(query);
  });
}

export function failedCount(): number {
  return state.entries.filter((e) => !e.ok).length;
}

// ── Writes from the UI ───────────────────────────────────────────────────────

export function setSearch(search: string): void {
  setState({ search });
}

export function setFilter(filter: RunFilter): void {
  setState({ filter });
}

export function selectRun(id: string | null): void {
  setState({ selectedId: id });
}

let notePersistTimer: ReturnType<typeof setTimeout> | null = null;
let pageHideBound = false;

/**
 * Writes a pending note straight away.
 *
 * Bound to `pagehide` the first time a note is edited, because the debounce
 * below opens a 250ms window in which closing the tab would lose what was just
 * typed — small, but "it did not save what I wrote" is not a failure this
 * screen gets to have.
 */
export function flushNotePersist(): void {
  if (!notePersistTimer) return;
  clearTimeout(notePersistTimer);
  notePersistTimer = null;
  persist(state.entries);
}

/**
 * Peek edits write straight through — SHELL.md section 3, no save step.
 *
 * State updates on the keystroke; only the localStorage write is coalesced,
 * because a peek's `onChange` fires per character and serialising the whole
 * log each time is the one place "no save step" would actually cost something.
 * Nothing user-visible waits on the timer.
 */
export function setNote(id: string, note: string): void {
  const entries = state.entries.map((e) => (e.id === id ? { ...e, note } : e));
  setState({ entries });
  if (!pageHideBound && typeof window !== "undefined") {
    pageHideBound = true;
    window.addEventListener("pagehide", flushNotePersist);
  }
  if (notePersistTimer) clearTimeout(notePersistTimer);
  notePersistTimer = setTimeout(() => {
    notePersistTimer = null;
    persist(state.entries);
  }, 250);
}

export function forgetRun(id: string): void {
  const entries = state.entries.filter((e) => e.id !== id);
  setState({ entries, selectedId: state.selectedId === id ? null : state.selectedId });
  persist(entries);
}

export function clearRunHistory(): void {
  setState({ entries: [], selectedId: null });
  persist([]);
}

export function copyText(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** "34 ms" etc., re-exported so the panels have one import for the whole screen's vocabulary. */
export { durationLabel };

/** Test seam. Not used by the app. */
export function resetRunHistoryStore(): void {
  hydrated = false;
  nextSeq = 0;
  if (notePersistTimer) {
    clearTimeout(notePersistTimer);
    notePersistTimer = null;
  }
  setLiveRibbonValue(WATCH_FAILED_KEY, null);
  state = { entries: [], search: "", filter: "All", selectedId: null, storageError: null };
  const store = storage();
  if (store) store.removeItem(STORAGE_KEY);
}
