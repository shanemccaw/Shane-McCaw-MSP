/**
 * manual-migration-status.ts
 *
 * Diffs lib/db/migrations/manual/*.sql against the `simulator_migration_runs`
 * table of a target database, and reports which manual migration files have
 * NOT yet run there — in filename (chronological) order.
 *
 * This exists because manual migrations are hand-run by Shane against Dev,
 * Staging, and Prod independently (see CLAUDE.md "Database" section) and each
 * migration file ends with a self-marking INSERT into simulator_migration_runs
 * (Git #497 convention). That table is therefore real per-environment truth
 * for "has this file run HERE" — this script just reads it, rather than
 * relying on a hand-maintained pending list that goes stale the moment a new
 * migration lands (Git #1199 — the issue's own list was stale after 2 items).
 *
 * Run:
 *   pnpm --filter @workspace/scripts run manual-migration-status
 *
 * Env vars:
 *   DATABASE_URL — connection string for the target environment (required).
 *   When run locally this is Dev. When run via SSH on the Replit workspace
 *   (see ReplitSshService), the remote process's own DATABASE_URL Secret is
 *   Staging's — so the same script/command works unmodified against either
 *   environment, it just inherits whichever DB the process it runs in points at.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MANUAL_DIR = path.resolve(__dirname, "../../lib/db/migrations/manual");

interface Result {
  ok: boolean;
  error?: string;
  totalFiles: number;
  appliedCount: number;
  pendingCount: number;
  pending: string[];
}

function listManualMigrationFiles(): string[] {
  if (!fs.existsSync(MANUAL_DIR)) return [];
  return fs
    .readdirSync(MANUAL_DIR, { withFileTypes: true })
    .filter(e => e.isFile() && e.name.endsWith(".sql"))
    .map(e => e.name)
    .sort(); // filenames are YYYY-MM-DD-prefixed, so lexical sort == chronological order
}

async function main(): Promise<void> {
  const dbUrl = process.env["DATABASE_URL"];
  const files = listManualMigrationFiles();

  if (!dbUrl) {
    const result: Result = {
      ok: false,
      error: "DATABASE_URL not set",
      totalFiles: files.length,
      appliedCount: 0,
      pendingCount: 0,
      pending: [],
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 8000 });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS simulator_migration_runs (
        filename text PRIMARY KEY,
        ran_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM simulator_migration_runs"
    );
    const appliedSet = new Set(rows.map(r => r.filename));
    const pending = files.filter(f => !appliedSet.has(f)).sort();

    const result: Result = {
      ok: true,
      totalFiles: files.length,
      appliedCount: files.length - pending.length,
      pendingCount: pending.length,
      pending,
    };
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    const result: Result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      totalFiles: files.length,
      appliedCount: 0,
      pendingCount: 0,
      pending: [],
    };
    process.stdout.write(JSON.stringify(result) + "\n");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  process.stderr.write(String(err) + "\n");
  process.exit(1);
});
