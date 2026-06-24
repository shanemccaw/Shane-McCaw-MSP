/**
 * migration-status.ts
 *
 * Reads the Drizzle journal and queries __drizzle_migrations in the production
 * database, then outputs a JSON object to stdout.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migration-status
 *
 * Env vars:
 *   PROD_DATABASE_URL | DATABASE_URL_PROD  — production connection string (required)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIZZLE_DIR = path.resolve(__dirname, "../../lib/db/drizzle");
const JOURNAL_PATH = path.join(DRIZZLE_DIR, "meta/_journal.json");

interface JournalEntry {
  idx: number;
  tag: string;
  when?: number;
}

interface Journal {
  entries: JournalEntry[];
}

interface Result {
  ok: boolean;
  error?: string;
  journalCount: number;
  appliedCount: number;
  lastAppliedTag: string | null;
  lastAppliedAt: string | null;
  pendingCount: number;
  pendingTags: string[];
}

async function main(): Promise<void> {
  const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];

  let journalEntries: JournalEntry[] = [];
  if (fs.existsSync(JOURNAL_PATH)) {
    const j: Journal = JSON.parse(fs.readFileSync(JOURNAL_PATH, "utf-8"));
    journalEntries = j.entries ?? [];
  }

  if (!prodUrl) {
    const result: Result = {
      ok: false,
      error: "PROD_DATABASE_URL not set",
      journalCount: journalEntries.length,
      appliedCount: 0,
      lastAppliedTag: null,
      lastAppliedAt: null,
      pendingCount: 0,
      pendingTags: [],
    };
    process.stdout.write(JSON.stringify(result) + "\n");
    return;
  }

  const pool = new Pool({ connectionString: prodUrl, connectionTimeoutMillis: 8000 });
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        "tag"        text        PRIMARY KEY,
        "applied_at" timestamptz NOT NULL DEFAULT now()
      )
    `);
    const { rows } = await client.query<{ tag: string; applied_at: string }>(
      "SELECT tag, applied_at::text FROM __drizzle_migrations ORDER BY tag"
    );

    const appliedSet = new Set(rows.map(r => r.tag));
    const pending = journalEntries.filter(e => !appliedSet.has(e.tag));
    const lastRow = rows[rows.length - 1] ?? null;

    const result: Result = {
      ok: true,
      journalCount: journalEntries.length,
      appliedCount: rows.length,
      lastAppliedTag: lastRow?.tag ?? null,
      lastAppliedAt: lastRow?.applied_at ?? null,
      pendingCount: pending.length,
      pendingTags: pending.map(e => e.tag),
    };
    process.stdout.write(JSON.stringify(result) + "\n");
  } catch (err) {
    const result: Result = {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      journalCount: journalEntries.length,
      appliedCount: 0,
      lastAppliedTag: null,
      lastAppliedAt: null,
      pendingCount: 0,
      pendingTags: [],
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
