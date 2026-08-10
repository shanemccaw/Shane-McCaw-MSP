/**
 * SQL Runner — API client.
 *
 * Every function takes `adminFetch` (AuthContext's `fetchWithAuth`, surfaced
 * via `useAdminFetch()`) as its first argument, same convention as
 * `screens/ad/adApi.ts`, so both real components and `sqlStore`'s
 * module-scope calls (ribbon closures run outside React — see
 * `sqlStore.ts`'s doc comment) can use the same client.
 *
 * Every endpoint is real and already shipped against the old admin panel's
 * `SqlQueryCanvas.tsx`/`SimulatorLeftTree.tsx` (`admin-engines.ts`'s
 * `/simulator/sql/*`, `/simulator/migrations/*`, `/simulator/db-schema`
 * routes) — this is the adminv2-shell front end for it, not a new backend.
 */

import type { MigrationFile, SavedScript, SchemaTable, SqlStatementResult } from "./sqlTypes";

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  return body as T;
}

function postJson(adminFetch: AdminFetch, path: string, body: unknown) {
  return adminFetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Reads ────────────────────────────────────────────────────────────────────

export async function fetchSqlScripts(adminFetch: AdminFetch): Promise<SavedScript[]> {
  const data = await json<{ scripts: SavedScript[] }>(await adminFetch("/api/simulator/sql/scripts"));
  return data.scripts ?? [];
}

export async function fetchMigrationFiles(adminFetch: AdminFetch): Promise<MigrationFile[]> {
  const data = await json<{ files: MigrationFile[] }>(await adminFetch("/api/simulator/migrations/files"));
  return data.files ?? [];
}

export async function fetchDbSchema(adminFetch: AdminFetch): Promise<SchemaTable[]> {
  const data = await json<{ tables: SchemaTable[] }>(await adminFetch("/api/simulator/db-schema"));
  return data.tables ?? [];
}

/** The file's real text off the server filesystem — no execution, no DB hit. */
export async function fetchMigrationContent(adminFetch: AdminFetch, filename: string): Promise<string> {
  const data = await json<{ filename: string; content: string }>(
    await adminFetch(`/api/simulator/migrations/${encodeURIComponent(filename)}/content`),
  );
  return data.content ?? "";
}

// ── Execution ────────────────────────────────────────────────────────────────

export async function executeSql(adminFetch: AdminFetch, query: string): Promise<SqlStatementResult[]> {
  const data = await json<{ statements: SqlStatementResult[] }>(
    await postJson(adminFetch, "/api/simulator/sql/execute", { query }),
  );
  return data.statements ?? [];
}

export async function executeMigrationFile(adminFetch: AdminFetch, filename: string): Promise<SqlStatementResult[]> {
  const data = await json<{ statements: SqlStatementResult[] }>(
    await postJson(adminFetch, "/api/simulator/migrations/execute", { filename }),
  );
  return data.statements ?? [];
}

/** Writes the self-mark INSERT directly, without running the rest of the file. See the route's own doc comment. */
export async function markMigrationRan(adminFetch: AdminFetch, filename: string): Promise<string> {
  const data = await json<{ ranAt: string }>(await postJson(adminFetch, "/api/simulator/migrations/mark-ran", { filename }));
  return data.ranAt;
}

// ── Saved scripts CRUD ─────────────────────────────────────────────────────────

export interface SqlScriptInput {
  name: string;
  category: string;
  query: string;
  isDestructive: boolean;
  isResetScript: boolean;
}

export async function createSqlScript(adminFetch: AdminFetch, input: SqlScriptInput): Promise<SavedScript> {
  const data = await json<{ script: SavedScript }>(await postJson(adminFetch, "/api/simulator/sql/scripts", input));
  return data.script;
}

export async function updateSqlScript(adminFetch: AdminFetch, id: number, input: SqlScriptInput): Promise<SavedScript> {
  const res = await adminFetch(`/api/simulator/sql/scripts/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const data = await json<{ script: SavedScript }>(res);
  return data.script;
}

export async function deleteSqlScript(adminFetch: AdminFetch, id: number): Promise<void> {
  await json<{ success: boolean }>(await adminFetch(`/api/simulator/sql/scripts/${id}`, { method: "DELETE" }));
}
