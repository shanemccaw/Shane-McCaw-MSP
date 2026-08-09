/**
 * Run History — API client.
 *
 * Every function takes `adminFetch` first, same convention as
 * `screens/sql/sqlApi.ts`, so both React components and `runHistoryStore`'s
 * module-scope calls (ribbon closures run outside React) use one client.
 *
 * There is no `create`. Rows are written server-side by the routes that
 * actually run things — see `artifacts/api-server/src/lib/run-history.ts` —
 * and a client that could invent a history row would make the log worth less
 * than no log at all.
 */

import type { RunHistoryEntry, RunKind } from "./runHistoryTypes";

export type AdminFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const BASE = "/api/admin/simulator/run-history";

/**
 * Set when the manual migration
 * (`lib/db/migrations/manual/2026-08-09-simulator-run-history.sql`) has not
 * been run yet. The routes answer 200 with an empty log rather than 500, and
 * the screen says so plainly instead of looking broken.
 */
export interface RunHistoryPage {
  runs: RunHistoryEntry[];
  /** Every row in the table, not just this page — so "12 of 480" is honest. */
  total: number;
  failed: number;
  tableMissing?: boolean;
  migration?: string;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  return body as T;
}

export async function fetchRunHistory(
  adminFetch: AdminFetch,
  options: { kind?: RunKind | null; q?: string; limit?: number } = {},
): Promise<RunHistoryPage> {
  const params = new URLSearchParams();
  if (options.kind) params.set("kind", options.kind);
  if (options.q) params.set("q", options.q);
  if (options.limit) params.set("limit", String(options.limit));
  const query = params.toString();

  const data = await json<RunHistoryPage>(await adminFetch(query ? `${BASE}?${query}` : BASE));
  return {
    runs: data.runs ?? [],
    total: data.total ?? 0,
    failed: data.failed ?? 0,
    tableMissing: data.tableMissing,
    migration: data.migration,
  };
}

/** The full row, output included — the list deliberately omits it. */
export async function fetchRun(adminFetch: AdminFetch, id: string): Promise<RunHistoryEntry | null> {
  const data = await json<{ run: RunHistoryEntry | null }>(await adminFetch(`${BASE}/${id}`));
  return data.run ?? null;
}

export async function saveRunNote(adminFetch: AdminFetch, id: string, note: string): Promise<void> {
  await json(
    await adminFetch(`${BASE}/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note }),
    }),
  );
}

export async function deleteRun(adminFetch: AdminFetch, id: string): Promise<void> {
  await json(await adminFetch(`${BASE}/${id}`, { method: "DELETE" }));
}

export async function deleteAllRuns(adminFetch: AdminFetch): Promise<void> {
  await json(await adminFetch(BASE, { method: "DELETE" }));
}
