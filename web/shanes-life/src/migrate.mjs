// Real migration runner, sharing one real database and one real ledger with ShanesSurvival's
// own MigrationRunner.cs: every migrations/*.sql file applied in filename order, once, tracked
// in the real schema_migrations table. Re-running is always a safe no-op. It runs automatically
// on server boot so a redeploy can never serve a build against a schema that has not caught up.
//
// The two runners share the ledger but NOT the directory. This one only ever executes files from
// web/shanes-life/migrations (013+); the WPF one only ever executes files from
// desktop/ShanesSurvival/migrations (001-012). Each skips whatever the other recorded, because
// the ledger is keyed on filename and neither directory contains the other's files. That is why
// the numbering is continuous across both -- the next free number must be checked against BOTH
// directories before a new migration is named. assertNoDuplicateMigrationNumbers (Git #3118)
// turns that "check both directories" convention into a real guard instead of just a comment.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.mjs";
import { pool } from "./db.mjs";
import { assertNoDuplicateMigrationNumbers } from "../../../scripts/check-migration-numbers.mjs";

const MIGRATIONS_DIR = resolve(config.root, "migrations");

// The ShanesSurvival tables 013+ is built on top of. 017's vehicles.loan_bill_id is a real
// foreign key into accounts, so this is a hard requirement, not a nicety.
const REQUIRED_BASE_TABLES = ["accounts", "transactions", "plaid_items", "debts"];

/**
 * Fail closed if DATABASE_URL points somewhere that is not the real ShanesSurvival database.
 *
 * This exists because of the exact mistake #3107 was filed to correct: #3087 pointed the app at
 * an empty database of its own, and nothing noticed until a design audit. Applying 013+ to a
 * bare database would produce a half-app -- Shane's Life tables with no Money underneath them --
 * and it would look like it worked.
 */
async function assertSharedDatabase(client) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ANY($1)`,
    [REQUIRED_BASE_TABLES],
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missing = REQUIRED_BASE_TABLES.filter((t) => !present.has(t));
  if (missing.length === 0) return;

  const { rows: dbRows } = await client.query("SELECT current_database() AS db");
  throw new Error(
    `DATABASE_URL points at "${dbRows[0].db}", which is not the real ShanesSurvival database: ` +
      `${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} missing. Shane's Life ` +
      `migrations start at 013 and extend ShanesSurvival's own 001-012 in ONE Postgres ` +
      `(design contract Section 1). Point DATABASE_URL at the database the WPF app really uses ` +
      `-- it is the connection string in %AppData%\\ShanesSurvival\\settings.json -- or run that ` +
      `app once against this database first so 001-012 are applied.`,
  );
}

export async function runMigrations({ log = console.log } = {}) {
  // Fail closed before touching the database at all if the two directories' number spaces
  // have collided (Git #3118) -- a fresh-database run would otherwise apply either runner's
  // files first with no way to tell that the order was ambiguous.
  assertNoDuplicateMigrationNumbers();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    // Same shape MigrationRunner.cs creates (filename, applied_at), so whichever runner sees a
    // fresh database first leaves a ledger the other can read and write.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await assertSharedDatabase(client);

    const { rows } = await client.query("SELECT filename FROM schema_migrations");
    const done = new Set(rows.map((r) => r.filename));

    for (const file of files) {
      if (done.has(file)) {
        skipped.push(file);
        continue;
      }
      const sql = readFileSync(resolve(MIGRATIONS_DIR, file), "utf8");
      // One transaction per file: a half-applied migration is never left behind.
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING",
          [file],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${file} failed: ${err.message}`);
      }
      applied.push(file);
      log(`[migrate] applied ${file}`);
    }
  } finally {
    client.release();
  }

  if (applied.length === 0) log(`[migrate] up to date (${skipped.length} already applied)`);
  return { applied, skipped };
}
