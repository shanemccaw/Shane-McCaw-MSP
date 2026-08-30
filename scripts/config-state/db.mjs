/**
 * #1794 — direct local Postgres access for the config-state pipeline.
 *
 * Per the project's Database convention, a build session connects straight to the
 * real local PostgreSQL 18 instance via `DATABASE_URL` for reads and for the additive,
 * reversible writes that are a normal part of the task — rather than routing through
 * BuildConsole's HTTP SQL pipe, which exists for Replit/staging debugging.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function resolveDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const file of [".env.local", ".env"]) {
    try {
      const txt = await readFile(path.join(repoRoot, file), "utf8");
      const m = /^DATABASE_URL\s*=\s*(.+)$/m.exec(txt);
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch { /* try the next candidate */ }
  }
  throw new Error("DATABASE_URL not set and not found in .env.local");
}

export async function connect() {
  const client = new pg.Client({ connectionString: await resolveDatabaseUrl() });
  await client.connect();
  return client;
}

/**
 * Multi-row INSERT in chunks. Postgres caps a statement at 65535 bound parameters, so
 * the chunk size is derived from the column count rather than guessed.
 */
export async function insertRows(client, table, columns, rows, { onConflict = "" } = {}) {
  if (rows.length === 0) return 0;
  const perChunk = Math.max(1, Math.floor(60000 / columns.length));
  let written = 0;
  for (let i = 0; i < rows.length; i += perChunk) {
    const chunk = rows.slice(i, i + perChunk);
    const values = [];
    const tuples = chunk.map((row, r) => {
      const placeholders = columns.map((_, c) => `$${r * columns.length + c + 1}`);
      values.push(...columns.map((col) => row[col] ?? null));
      return `(${placeholders.join(",")})`;
    });
    const sql = `INSERT INTO ${table} (${columns.join(",")}) VALUES ${tuples.join(",")} ${onConflict}`;
    const res = await client.query(sql, values);
    written += res.rowCount ?? 0;
  }
  return written;
}
