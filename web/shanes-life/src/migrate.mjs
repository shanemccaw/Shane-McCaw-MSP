// Real migration runner, same shape ShanesSurvival already uses: every migrations/*.sql file
// applied in filename order, once, tracked in a real schema_migrations table. Re-running is
// always a safe no-op. It runs automatically on server boot so a Replit redeploy can never
// serve a build against a schema that has not caught up.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { config } from "./config.mjs";
import { pool } from "./db.mjs";

const MIGRATIONS_DIR = resolve(config.root, "migrations");

export async function runMigrations({ log = console.log } = {}) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const client = await pool.connect();
  const applied = [];
  const skipped = [];
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename text PRIMARY KEY,
        ran_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
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
