/**
 * migrate-mark-applied.ts
 *
 * Records a Drizzle migration tag in `__drizzle_migrations` WITHOUT executing
 * its SQL.
 *
 * This is the other half of the destructive-migration gate (Git #2930). A file
 * marked `-- @migration-gate: manual` is never executed by migrate-dev or
 * migrate-prod, which means it stays pending forever and re-reports on every
 * merge until something tells the tracking table it has been dealt with. That
 * something is this script, run by the human who actually ran the SQL by hand.
 *
 * It deliberately does NOT run the migration. If you have not already executed
 * the SQL against the target database yourself, do not run this — you will mark
 * a change as applied that has not happened.
 *
 * Run:
 *   pnpm --filter @workspace/scripts run migrate-mark-applied <tag>
 *   pnpm --filter @workspace/scripts run migrate-mark-applied <tag> --prod
 *
 * Targets:
 *   (default)  DATABASE_URL                                  — the dev database
 *   --prod     PROD_DATABASE_URL ?? DATABASE_URL_PROD        — production
 *
 * Exit codes:
 *   0 — recorded (or already recorded)
 *   1 — bad arguments, unknown tag, or a database error
 *   2 — the target connection string is not set
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DRIZZLE_DIR = process.env["DRIZZLE_MIGRATIONS_DIR"]
  ? path.resolve(process.env["DRIZZLE_MIGRATIONS_DIR"])
  : path.resolve(__dirname, "../../lib/db/drizzle");

interface JournalEntry {
  idx: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function usage(): never {
  console.error("Usage: migrate-mark-applied <tag> [--prod]");
  console.error("");
  console.error("  <tag>   A journal tag, e.g. 0201_drop_service_page_trigger_keys");
  console.error("          (a .sql suffix is accepted and stripped)");
  console.error("  --prod  Target production instead of dev");
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const prod = args.includes("--prod");
  const positional = args.filter((a) => !a.startsWith("--"));

  if (positional.length !== 1) usage();
  const tag = positional[0]!.replace(/\.sql$/i, "");

  const url = prod
    ? process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"]
    : process.env["DATABASE_URL"];

  if (!url) {
    console.error(
      prod
        ? "ERROR: Neither PROD_DATABASE_URL nor DATABASE_URL_PROD is set."
        : "ERROR: DATABASE_URL is not set."
    );
    process.exit(2);
  }

  // Refuse an unknown tag — marking a typo as applied is silent, permanent and
  // invisible, exactly the failure mode this whole gate exists to prevent.
  const journalPath = path.join(DRIZZLE_DIR, "meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.error(`ERROR: journal not found at ${journalPath}`);
    process.exit(1);
  }
  const journal: Journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const known = new Set((journal.entries ?? []).map((e) => e.tag));
  if (!known.has(tag)) {
    console.error(`ERROR: "${tag}" is not a tag in ${journalPath}.`);
    console.error("       Register the migration in the journal first, then mark it applied.");
    process.exit(1);
  }

  const target = prod ? "production" : "dev";
  const pool = new Pool({ connectionString: url });
  try {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
          "tag"        text        PRIMARY KEY,
          "applied_at" timestamptz NOT NULL DEFAULT now()
        )
      `);

      const existing = await client.query<{ applied_at: Date }>(
        "SELECT applied_at FROM __drizzle_migrations WHERE tag = $1",
        [tag]
      );
      if ((existing.rowCount ?? 0) > 0) {
        console.log(
          `[mark-applied] ${tag} is already recorded against ${target} ` +
            `(applied_at ${existing.rows[0]!.applied_at.toISOString()}). Nothing to do.`
        );
        return;
      }

      await client.query("INSERT INTO __drizzle_migrations (tag) VALUES ($1)", [tag]);
      console.log(`[mark-applied] Recorded ${tag} against ${target}.`);
      console.log(
        "[mark-applied] NOTE: no SQL was executed. This only asserts that you ran it yourself."
      );
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("migrate-mark-applied failed:", err);
  process.exit(1);
});
