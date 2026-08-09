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
  fetchMigrationFiles,
  fetchSqlScripts,
  updateSqlScript,
  type SqlScriptInput,
} from "./sqlApi";
import { EMPTY_SQL_OUTPUT, type MigrationFile, type SavedScript, type SchemaTable, type SqlOutput } from "./sqlTypes";
// Every executed query and migration is logged to the Run History screen —
// same one-way dependency the Deploy Console has (`screens/git/deployStore.ts`):
// that screen owns the log, this one only reports what it just ran.
import { recordSqlRun } from "../run-history/runHistoryStore";

export type ResultView = "table" | "json";

export interface SqlStoreState {
  scripts: SavedScript[];
  scriptsLoading: boolean;
  scriptsError: string | null;

  migrations: MigrationFile[];
  migrationsLoading: boolean;
  migrationsError: string | null;

  schema: SchemaTable[];
  schemaLoading: boolean;

  /** True after "New query" — the editor shows an unsaved draft rather than a saved record. */
  draftActive: boolean;
  draftQuery: string;

  output: SqlOutput;
  resultView: ResultView;

  saving: boolean;
  deletingId: number | null;
  lastMessage: string | null;
}

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

  schema: [],
  schemaLoading: false,

  draftActive: false,
  draftQuery: "",

  output: EMPTY_SQL_OUTPUT,
  resultView: "table",

  saving: false,
  deletingId: null,
  lastMessage: null,
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
 * which is why the Run History write lives here rather than in each caller:
 * a future third way to execute SQL gets logged for free instead of being the
 * one path that quietly is not.
 */
async function runStatements(
  run: () => Promise<import("./sqlTypes").SqlStatementResult[]>,
  record: { cmd: string; label?: string; migrationFile?: string },
): Promise<void> {
  const startedAt = Date.now();
  setState({ output: { isExecuting: true, statements: null, error: null } });
  try {
    const statements = await run();
    setState({ output: { isExecuting: false, statements, error: null } });
    recordSqlRun({ ...record, startedAt, statements, error: null });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    setState({ output: { isExecuting: false, statements: null, error } });
    recordSqlRun({ ...record, startedAt, statements: null, error });
  }
}

export async function runQueryText(query: string): Promise<void> {
  if (!adminFetchRef || !query.trim()) return;
  await runStatements(() => executeSql(adminFetchRef!, query), { cmd: query });
}

export async function runMigrationFile(filename: string): Promise<void> {
  if (!adminFetchRef) return;
  // `cmd` is the repo path, not SQL: the file is read off the server
  // filesystem and its text never reaches the browser.
  await runStatements(() => executeMigrationFile(adminFetchRef!, filename), {
    cmd: `lib/db/migrations/manual/${filename}`,
    label: filename,
    migrationFile: filename,
  });
  // The file's own trailing self-mark INSERT (#497) just changed `ranAt` server-side.
  void loadMigrations();
}

export function setResultView(view: ResultView): void {
  setState({ resultView: view });
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
    schema: [],
    schemaLoading: false,
    draftActive: false,
    draftQuery: "",
    output: EMPTY_SQL_OUTPUT,
    resultView: "table",
    saving: false,
    deletingId: null,
    lastMessage: null,
  };
}
