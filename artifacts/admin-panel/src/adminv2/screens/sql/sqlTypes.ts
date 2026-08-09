/**
 * SQL Runner — shared types.
 *
 * Mirrors the real shapes the backend already returns
 * (`artifacts/api-server/src/routes/admin-engines.ts`'s `/simulator/sql/*` and
 * `/simulator/migrations/*` routes, and `lib/db/src/schema/msp.ts`'s
 * `savedSqlScripts` table) — nothing here is invented. The old admin panel's
 * `SqlQueryCanvas.tsx`/`SqlQueryOutput.tsx` already consume the same shapes;
 * this is the adminv2-shell port, not a new backend.
 */

export interface SavedScript {
  id: number;
  name: string;
  category: string;
  query: string;
  isDestructive: boolean;
  isResetScript: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** One `.sql` file under `lib/db/migrations/manual/`, read off the server filesystem. */
export interface MigrationFile {
  filename: string;
  /** Last time this file's own trailing self-mark INSERT recorded a run (#497), or never. */
  ranAt: string | null;
}

export interface SchemaColumn {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPk: boolean;
  foreignKey: string | null;
}

export interface SchemaTable {
  name: string;
  columns: SchemaColumn[];
}

/** One entry per statement in a submitted script — the backend splits on top-level semicolons. */
export interface SqlStatementResult {
  statementIndex: number;
  /** Truncated preview, not necessarily the full statement text. */
  statementText: string;
  success: boolean;
  rows: Record<string, unknown>[];
  rowCount: number;
  fields: string[];
  executionMs: number;
  error?: string;
}

export interface SqlOutput {
  isExecuting: boolean;
  statements: SqlStatementResult[] | null;
  /** Transport-level failure (network/auth) — distinct from a per-statement SQL error. */
  error: string | null;
}

export const EMPTY_SQL_OUTPUT: SqlOutput = { isExecuting: false, statements: null, error: null };

/**
 * Client-side safety net, independent of a script's stored `isDestructive`
 * flag — a brand-new draft or an edited script has no stored flag yet, and a
 * flag can go stale if the text changes without anyone re-marking it. Same
 * keyword list the design's own SQL syntax highlighter uses for its "danger"
 * token class.
 */
const DANGEROUS_KEYWORD = /\b(delete|drop|truncate|alter)\b/i;

export function containsDangerousKeyword(queryText: string): boolean {
  return DANGEROUS_KEYWORD.test(queryText);
}

export function relativeTime(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diff = Date.now() - ms;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}
