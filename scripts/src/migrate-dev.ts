/**
 * migrate-dev.ts
 *
 * Applies pending Drizzle-generated SQL migrations to the development database
 * (DATABASE_URL). Mirrors the Phase 2 logic from migrate-prod.ts but targets
 * the dev database.
 *
 * Dev-specific: wraps each migration in a savepoint so that "already exists"
 * errors (column/table/constraint) are treated as "already applied" — common
 * when the dev DB was patched by hand before tracking started.
 *
 * Destructive-migration gate (Git #2930): before executing anything, every
 * pending migration is passed through `evaluateMigrationGate`. A file marked
 * `-- @migration-gate: manual`, or one containing an irreversible statement with
 * no gate header at all, is HELD — not executed, not recorded — and reported.
 * See scripts/src/lib/destructive-migration-gate.ts for the full convention.
 *
 * Exit codes:
 *   0 — all pending migrations applied (or nothing to do)
 *   1 — a migration failed
 *   2 — DATABASE_URL is not set
 *   3 — ran cleanly, but one or more migrations were HELD at the gate
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate-dev
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import type { PoolClient } from "pg";
import {
  GATE_HELD_EXIT_CODE,
  evaluateMigrationGate,
  formatHeldSummary,
  formatHoldNotice,
  type MigrationGateVerdict,
} from "./lib/destructive-migration-gate";

const { Pool } = pg;

const devUrl = process.env["DATABASE_URL"];

if (!devUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(2);
}

const pool = new Pool({ connectionString: devUrl });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * DRIZZLE_MIGRATIONS_DIR is a test seam: the gate harness
 * (`pnpm --filter @workspace/scripts run test-gate`) points this runner at a
 * throwaway directory of synthetic migrations so the gate can be exercised for
 * real against a real database without touching lib/db/drizzle.
 */
const DRIZZLE_DIR = process.env["DRIZZLE_MIGRATIONS_DIR"]
  ? path.resolve(process.env["DRIZZLE_MIGRATIONS_DIR"])
  : path.resolve(__dirname, "../../lib/db/drizzle");

/** Postgres error codes that mean "this thing already exists" — safe to skip. */
const ALREADY_EXISTS_CODES = new Set([
  "42701", // duplicate_column
  "42P07", // duplicate_table
  "42710", // duplicate_object (constraint)
  "23505", // unique_violation (INSERT ... ON CONFLICT for existing rows)
]);

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

async function applyDrizzleMigrations(client: PoolClient): Promise<MigrationGateVerdict[]> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      "tag"        text        PRIMARY KEY,
      "applied_at" timestamptz NOT NULL DEFAULT now()
    )
  `);

  const journalPath = path.join(DRIZZLE_DIR, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.log("[drizzle] No journal found at lib/db/drizzle/meta/_journal.json — skipping.");
    return [];
  }

  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const entries = journal.entries ?? [];

  const { rows } = await client.query<{ tag: string }>(
    "SELECT tag FROM __drizzle_migrations ORDER BY tag"
  );
  const appliedTags = new Set(rows.map((r) => r.tag));

  let appliedCount = 0;
  let skippedCount = 0;
  const held: MigrationGateVerdict[] = [];
  for (const entry of entries) {
    if (appliedTags.has(entry.tag)) {
      console.log(`[drizzle] ${entry.tag} — already applied.`);
      continue;
    }

    const sqlPath = path.join(DRIZZLE_DIR, `${entry.tag}.sql`);
    if (!fs.existsSync(sqlPath)) {
      throw new Error(
        `[drizzle] SQL file missing for journal entry "${entry.tag}": ${sqlPath}\n` +
        `  Run: pnpm --filter @workspace/db run generate`
      );
    }

    const rawSql = fs.readFileSync(sqlPath, "utf-8");

    // Destructive-migration gate (#2930) — decided from the RAW file, before any
    // rewriting, and before a single statement reaches the database.
    const verdict = evaluateMigrationGate(entry.tag, rawSql);
    if (verdict.action === "hold") {
      console.warn(formatHoldNotice(verdict));
      held.push(verdict);
      continue;
    }

    const sql = rawSql.replace(/--> statement-breakpoint/g, "");

    console.log(`[drizzle] Applying ${entry.tag}…`);

    // Use a savepoint so an "already exists" error doesn't abort the transaction.
    const sp = `sp_${entry.tag.replace(/\W/g, "_")}`;
    await client.query(`SAVEPOINT "${sp}"`);
    try {
      await client.query(sql);
      await client.query(`RELEASE SAVEPOINT "${sp}"`);
      await client.query(
        "INSERT INTO __drizzle_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
        [entry.tag]
      );
      console.log(`[drizzle]   done.`);
      appliedCount++;
    } catch (err: unknown) {
      const pgErr = err as { code?: string; message?: string };
      if (pgErr.code && ALREADY_EXISTS_CODES.has(pgErr.code)) {
        // Schema already present in dev — roll back and mark as applied.
        await client.query(`ROLLBACK TO SAVEPOINT "${sp}"`);
        await client.query(`RELEASE SAVEPOINT "${sp}"`);
        await client.query(
          "INSERT INTO __drizzle_migrations (tag) VALUES ($1) ON CONFLICT DO NOTHING",
          [entry.tag]
        );
        console.log(`[drizzle]   skipped (already exists in dev): ${pgErr.message}`);
        skippedCount++;
      } else {
        // Genuine error — release savepoint and re-throw.
        await client.query(`ROLLBACK TO SAVEPOINT "${sp}"`);
        await client.query(`RELEASE SAVEPOINT "${sp}"`);
        throw err;
      }
    }
  }

  if (appliedCount === 0 && skippedCount === 0 && held.length === 0) {
    console.log("[drizzle] All Drizzle SQL migrations are already applied to dev.");
  } else {
    if (appliedCount > 0) console.log(`[drizzle] Applied ${appliedCount} new migration(s).`);
    if (skippedCount > 0) console.log(`[drizzle] Skipped ${skippedCount} migration(s) (schema already present).`);
    if (held.length > 0) console.log(`[drizzle] Held ${held.length} migration(s) at the destructive gate.`);
  }

  return held;
}

async function main(): Promise<void> {
  const client = await pool.connect();
  let held: MigrationGateVerdict[] = [];
  try {
    await client.query("BEGIN");
    console.log("=== Drizzle-generated SQL migrations → dev database ===");
    held = await applyDrizzleMigrations(client);
    await client.query("COMMIT");
    console.log("\nDone.");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }

  if (held.length > 0) {
    // Not a failure: everything that was allowed to run ran and committed. The
    // held files are a real, unfinished action that needs a human — post-merge.sh
    // treats this exit code as a loud warning rather than a broken merge.
    console.warn(formatHeldSummary(held, "dev"));
    process.exit(GATE_HELD_EXIT_CODE);
  }
}

main().catch((err) => {
  console.error("migrate-dev failed:", err);
  process.exit(1);
});
