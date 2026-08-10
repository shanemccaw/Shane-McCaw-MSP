/**
 * The SQL Runner's shared state — a plain external store, not React state.
 *
 * Same reason `deployStore.ts`/`moneyStore.ts` are one (see either file's doc
 * comment): the ribbon buttons this screen contributes to the fixed `run` tab
 * ("Saved scripts" gallery, "New query", "Migrations to run") are built once,
 * at `registerScreen()` module-load time, outside any component, so they
 * cannot call `useAdminFetch()`. `SqlFetchBridge` (always mounted, see
 * `AdminV2.tsx`) hands over the current `adminFetch` on every render and
 * warms the scripts/migrations/schema lists once, so the ribbon's gallery has
 * real rows before `/sql` has ever been opened.
 *
 * What is deliberately *not* here: in-progress editor text. That lives in
 * `SqlEditorBody`'s own component state, keyed by open doc id — nothing
 * outside React ever needs to read an unsaved keystroke, and the dirty dot on
 * the doc tab is driven through `useShell().setDocDirty`, which is already
 * global. Keeping edits local avoids a store update on every keystroke.
 */

import {
  createSqlScript,
  deleteSqlScript,
  executeMigrationFile,
  executeSql,
  fetchDbSchema,
  fetchMigrationContent,
  fetchMigrationFiles,
  fetchSqlScripts,
  markMigrationRan,
  updateSqlScript,
  type SqlScriptInput,
} from "./sqlApi";
import { EMPTY_SQL_OUTPUT, type MigrationFile, type SavedScript, type SchemaTable, type SqlOutput, type SqlStatementResult } from "./sqlTypes";
// The "run" tab's Auto copy group needs its toggle/format buttons to update
// the instant you click them, not on the next incidental ribbon re-render —
// see that file's doc comment. `screens/money/moneyStore.ts` is the other
// user of this same overlay.
import { setLiveRibbonValue } from "../../shell/liveRibbon";
// The run itself is recorded SERVER-side, by the execute routes, before they
// answer (api-server lib/run-history.ts). This only tells the Run History
// screen there is something new to re-read - same one-way dependency the
// Deploy Console has (`screens/git/deployStore.ts`).
import { runHistoryChanged } from "../run-history/runHistoryStore";

export type ResultView = "table" | "json";

export type FloatingSqlStatus = "running" | "ok" | "failed";

/**
 * One run made from the floating SQL console — its own lightweight
 * transcript, same shape/purpose as `deployStore.ts`'s `DeployTranscriptEntry`
 * for the floating Deploy Console. Deliberately not the same thing as
 * `SqlStoreState.output` (the docked editor's *last* run only) — the floating
 * console can run several queries in a row without ever opening a doc, and
 * wants to show all of them, the same way the Deploy Console's own floating
 * transcript does.
 */
export interface FloatingSqlEntry {
  id: string;
  query: string;
  status: FloatingSqlStatus;
  statements: SqlStatementResult[] | null;
  error: string | null;
  startedAt: number;
}

export interface SqlStoreState {
  scripts: SavedScript[];
  scriptsLoading: boolean;
  scriptsError: string | null;

  migrations: MigrationFile[];
  migrationsLoading: boolean;
  migrationsError: string | null;
  /** The real file text, keyed by filename — fetched on demand, once, when the editor opens one. */
  migrationContent: Record<string, string>;
  migrationContentLoading: Record<string, boolean>;

  schema: SchemaTable[];
  schemaLoading: boolean;

  /** True after "New query" — the editor shows an unsaved draft rather than a saved record. */
  draftActive: boolean;
  draftQuery: string;

  output: SqlOutput;
  resultView: ResultView;

  /** The "run" tab's Auto copy toggle — mirrors Deploy Console's own (`screens/git/deployStore.ts`). */
  autoCopy: boolean;
  autoCopyFormat: ResultView;

  saving: boolean;
  deletingId: number | null;
  lastMessage: string | null;

  /** The floating quick-query console — see `FloatingSqlConsole.tsx`'s doc comment. */
  floatingOpen: boolean;
  floatingInput: string;
  floatingTranscript: FloatingSqlEntry[];
}

/** Keys this store owns in the shared live-ribbon overlay. See `screens/sql/index.tsx`'s `liveKey` usage. */
export const SQL_RIBBON_KEYS = {
  autoCopyToggle: "sql:auto-copy-toggle",
  autoCopyTable: "sql:auto-copy-table",
  autoCopyJson: "sql:auto-copy-json",
} as const;

type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type Listener = () => void;

let adminFetchRef: AdminFetch | null = null;

/** Called by `SqlFetchBridge` on every render — see file doc comment. */
export function configureSqlFetch(fetch: AdminFetch): void {
  adminFetchRef = fetch;
}

let state: SqlStoreState = {
  scripts: [],
  scriptsLoading: false,
  scriptsError: null,

  migrations: [],
  migrationsLoading: false,
  migrationsError: null,
  migrationContent: {},
  migrationContentLoading: {},

  schema: [],
  schemaLoading: false,

  draftActive: false,
  draftQuery: "",

  output: EMPTY_SQL_OUTPUT,
  resultView: "table",

  autoCopy: false,
  autoCopyFormat: "table",

  saving: false,
  deletingId: null,
  lastMessage: null,

  floatingOpen: false,
  floatingInput: "",
  floatingTranscript: [],
};

const listeners = new Set<Listener>();

function setState(patch: Partial<SqlStoreState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): SqlStoreState {
  return state;
}

// ── Loads ────────────────────────────────────────────────────────────────────

export async function loadScripts(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ scriptsLoading: true, scriptsError: null });
  try {
    const scripts = await fetchSqlScripts(adminFetchRef);
    setState({ scriptsLoading: false, scripts });
  } catch (err) {
    setState({ scriptsLoading: false, scriptsError: err instanceof Error ? err.message : String(err) });
  }
}

export async function loadMigrations(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ migrationsLoading: true, migrationsError: null });
  try {
    const migrations = await fetchMigrationFiles(adminFetchRef);
    setState({ migrationsLoading: false, migrations });
  } catch (err) {
    setState({ migrationsLoading: false, migrationsError: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Fetches one migration file's real text, once, and caches it by filename —
 * safe to call every time the editor opens a migration doc, since a repeat
 * call for an already-cached (or in-flight) filename is a no-op.
 */
export async function loadMigrationContent(filename: string): Promise<void> {
  if (!adminFetchRef) return;
  if (state.migrationContent[filename] !== undefined || state.migrationContentLoading[filename]) return;
  setState({ migrationContentLoading: { ...state.migrationContentLoading, [filename]: true } });
  try {
    const content = await fetchMigrationContent(adminFetchRef, filename);
    setState({
      migrationContentLoading: { ...state.migrationContentLoading, [filename]: false },
      migrationContent: { ...state.migrationContent, [filename]: content },
    });
  } catch (err) {
    setState({
      migrationContentLoading: { ...state.migrationContentLoading, [filename]: false },
      lastMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function loadSchema(): Promise<void> {
  if (!adminFetchRef) return;
  setState({ schemaLoading: true });
  try {
    const schema = await fetchDbSchema(adminFetchRef);
    setState({ schemaLoading: false, schema });
  } catch {
    // Autocomplete degrades to keywords-only if the schema fetch fails.
    setState({ schemaLoading: false });
  }
}

let warmed = false;

/** Warm load — see file doc comment. Safe to call more than once. */
export function warmSql(): void {
  if (warmed || !adminFetchRef) return;
  warmed = true;
  void loadScripts();
  void loadMigrations();
  void loadSchema();
}

// ── Draft (unsaved "New query") ─────────────────────────────────────────────

export function startDraft(): void {
  setState({ draftActive: true, draftQuery: "" });
}

export function setDraftQuery(text: string): void {
  setState({ draftQuery: text });
}

function clearDraft(): void {
  setState({ draftActive: false, draftQuery: "" });
}

// ── Execution ────────────────────────────────────────────────────────────────

/**
 * The one choke point both `runQueryText` and `runMigrationFile` go through,
 * which is why the Run History refresh lives here rather than in each caller:
 * a future third way to execute SQL gets it for free instead of being the one
 * path that quietly does not.
 *
 * It carries no run details, because it is not what records the run — the
 * execute routes do that server-side, before answering. Passing the query text
 * back down from here would be a second, disagreeing account of the same run.
 */
async function runStatements(run: () => Promise<import("./sqlTypes").SqlStatementResult[]>): Promise<void> {
  setState({ output: { isExecuting: true, statements: null, error: null } });
  try {
    const statements = await run();
    setState({ output: { isExecuting: false, statements, error: null } });
  } catch (err) {
    setState({ output: { isExecuting: false, statements: null, error: err instanceof Error ? err.message : String(err) } });
  } finally {
    // Both paths: a failed query is still a run the server wrote a row for.
    runHistoryChanged();
    // Auto copy fires here rather than at each call site so it covers every
    // way a query can run — the toolbar Run button, a gutter play button, a
    // saved script's "Run it" (Explorer/contextual tab/peek) — the same
    // reason Run History's refresh lives in this one choke point instead of
    // being duplicated per caller.
    if (state.autoCopy) copyOutput(state.autoCopyFormat === "json");
  }
}

export async function runQueryText(query: string): Promise<void> {
  if (!adminFetchRef || !query.trim()) return;
  await runStatements(() => executeSql(adminFetchRef!, query));
}

export async function runMigrationFile(filename: string): Promise<void> {
  if (!adminFetchRef) return;
  await runStatements(() => executeMigrationFile(adminFetchRef!, filename));
  // The file's own trailing self-mark INSERT (#497) just changed `ranAt` server-side.
  void loadMigrations();
}

/**
 * For the migration files that never got their trailing self-mark INSERT
 * written into them — Shane already ran the real SQL by hand, this just
 * writes the tracking row directly so the Migrations tree stops showing it
 * as pending. Does not execute anything.
 */
export async function markMigrationAsRan(filename: string): Promise<boolean> {
  if (!adminFetchRef) return false;
  try {
    const ranAt = await markMigrationRan(adminFetchRef, filename);
    setState({
      migrations: state.migrations.map((m) => (m.filename === filename ? { ...m, ranAt } : m)),
      lastMessage: "Marked as run.",
    });
    return true;
  } catch (err) {
    setState({ lastMessage: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export function setResultView(view: ResultView): void {
  setState({ resultView: view });
}

// ── Floating quick-query console ────────────────────────────────────────────
// Same open/close/toggle/input shape as `deployStore.ts`'s floating console —
// a hover-anywhere way to run one query without navigating to `/sql` first.

export function openFloatingSql(): void {
  setState({ floatingOpen: true });
}

export function closeFloatingSql(): void {
  setState({ floatingOpen: false });
}

export function toggleFloatingSql(): void {
  setState({ floatingOpen: !state.floatingOpen });
}

export function setFloatingInput(value: string): void {
  setState({ floatingInput: value });
}

function updateFloatingEntry(id: string, patch: Partial<FloatingSqlEntry>): void {
  setState({ floatingTranscript: state.floatingTranscript.map((e) => (e.id === id ? { ...e, ...patch } : e)) });
}

let nextFloatingId = 0;

/**
 * Runs one query from the floating console — its own transcript, not the
 * docked editor's single `output`/`resultView` (see `FloatingSqlEntry`'s doc
 * comment). Still reports into Run History exactly like every other way SQL
 * runs here (`runStatements`'s own comment on why that choke point exists),
 * so a query fired from the floating console shows up in Run History and the
 * sidekick the same as one run from the editor.
 */
export async function runFloatingQuery(queryText?: string): Promise<void> {
  const query = (queryText ?? state.floatingInput).trim();
  if (!query || !adminFetchRef) return;

  const id = `float-${++nextFloatingId}`;
  const entry: FloatingSqlEntry = { id, query, status: "running", statements: null, error: null, startedAt: Date.now() };
  setState({
    floatingOpen: true,
    floatingInput: queryText === undefined ? "" : state.floatingInput,
    floatingTranscript: [...state.floatingTranscript, entry],
  });

  try {
    const statements = await executeSql(adminFetchRef, query);
    updateFloatingEntry(id, { status: "ok", statements });
  } catch (err) {
    updateFloatingEntry(id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
  } finally {
    runHistoryChanged();
  }
}

export function clearFloatingTranscript(): void {
  setState({ floatingTranscript: [] });
}

function syncAutoCopyRibbon(): void {
  setLiveRibbonValue(SQL_RIBBON_KEYS.autoCopyToggle, { active: state.autoCopy });
  setLiveRibbonValue(SQL_RIBBON_KEYS.autoCopyTable, { active: state.autoCopy && state.autoCopyFormat === "table" });
  setLiveRibbonValue(SQL_RIBBON_KEYS.autoCopyJson, { active: state.autoCopy && state.autoCopyFormat === "json" });
}

export function setAutoCopy(value: boolean): void {
  setState({ autoCopy: value });
  syncAutoCopyRibbon();
}

/** Picking a format turns Auto copy on — same convenience `deployStore.ts` offers. */
export function setAutoCopyFormat(format: ResultView): void {
  setState({ autoCopy: true, autoCopyFormat: format });
  syncAutoCopyRibbon();
}

// ── Saved scripts CRUD ─────────────────────────────────────────────────────────

/** Creates a real script row from the draft and clears the draft. Returns null on failure. */
export async function createScriptFromDraft(input: SqlScriptInput): Promise<SavedScript | null> {
  if (!adminFetchRef) return null;
  setState({ saving: true });
  try {
    const created = await createSqlScript(adminFetchRef, input);
    setState({ saving: false, scripts: [created, ...state.scripts], lastMessage: "Saved." });
    clearDraft();
    return created;
  } catch (err) {
    setState({ saving: false, lastMessage: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export async function duplicateScript(source: SavedScript): Promise<SavedScript | null> {
  return createScriptFromDraft({
    name: `${source.name} copy`,
    category: source.category,
    query: source.query,
    isDestructive: source.isDestructive,
    isResetScript: false,
  });
}

/**
 * Merges `patch` onto the script's current stored row and writes it straight
 * through — same "no save step" convention peek edits use. `patch.query`
 * defaults to the row's own stored query (not an in-editor draft — the editor
 * owns its own unsaved text and passes it explicitly when saving).
 */
export async function patchScript(id: number, patch: Partial<SqlScriptInput>): Promise<boolean> {
  if (!adminFetchRef) return false;
  const current = state.scripts.find((s) => s.id === id);
  if (!current) return false;
  setState({ saving: true });
  try {
    const updated = await updateSqlScript(adminFetchRef, id, {
      name: patch.name ?? current.name,
      category: patch.category ?? current.category,
      query: patch.query ?? current.query,
      isDestructive: patch.isDestructive ?? current.isDestructive,
      isResetScript: patch.isResetScript ?? current.isResetScript,
    });
    setState({ saving: false, scripts: state.scripts.map((s) => (s.id === id ? updated : s)), lastMessage: "Saved." });
    return true;
  } catch (err) {
    setState({ saving: false, lastMessage: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

export async function deleteScriptById(id: number): Promise<boolean> {
  if (!adminFetchRef) return false;
  setState({ deletingId: id });
  try {
    await deleteSqlScript(adminFetchRef, id);
    setState({ deletingId: null, scripts: state.scripts.filter((s) => s.id !== id), lastMessage: "Deleted." });
    return true;
  } catch (err) {
    setState({ deletingId: null, lastMessage: err instanceof Error ? err.message : String(err) });
    return false;
  }
}

function copyToClipboard(text: string): void {
  if (!text || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(text).catch(() => {
    /* clipboard access denied — not worth surfacing an error for */
  });
}

/** The bottom panel's "Copy all" — whatever the last run actually returned. */
export function copyOutput(asJson: boolean): void {
  const statements = state.output.statements;
  if (!statements) return;
  const text = asJson
    ? JSON.stringify(statements, null, 2)
    : statements
        .map((s) => (s.success ? [s.fields.join("\t"), ...s.rows.map((r) => s.fields.map((f) => String(r[f])).join("\t"))].join("\n") : `-- error: ${s.error}`))
        .join("\n\n");
  copyToClipboard(text);
  setState({ lastMessage: "Copied." });
}

/** Test seam. Not used by the app. */
export function resetSqlStore(): void {
  adminFetchRef = null;
  warmed = false;
  state = {
    scripts: [],
    scriptsLoading: false,
    scriptsError: null,
    migrations: [],
    migrationsLoading: false,
    migrationsError: null,
    migrationContent: {},
    migrationContentLoading: {},
    schema: [],
    schemaLoading: false,
    draftActive: false,
    draftQuery: "",
    output: EMPTY_SQL_OUTPUT,
    resultView: "table",
    autoCopy: false,
    autoCopyFormat: "table",
    saving: false,
    deletingId: null,
    lastMessage: null,
    floatingOpen: false,
    floatingInput: "",
    floatingTranscript: [],
  };
}
