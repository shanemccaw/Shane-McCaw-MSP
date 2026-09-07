// Real Postgres access. One pool, parameterised queries only.

import pg from "pg";
import { config } from "./config.mjs";

// Postgres returns bigint/numeric as strings by default to avoid precision loss. The only
// bigints here are bigserial log ids, which are safely inside Number range for this app.
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  ssl: config.databaseSsl ? { rejectUnauthorized: false } : undefined,
  max: Number(process.env.PGPOOL_MAX || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  // A pooled client dying in the background must not take the process down.
  console.error("[db] idle client error:", err.message);
});

export async function query(text, params) {
  return pool.query(text, params);
}

export async function one(text, params) {
  const { rows } = await pool.query(text, params);
  return rows[0] ?? null;
}

export async function many(text, params) {
  const { rows } = await pool.query(text, params);
  return rows;
}

/** Run fn inside a real transaction, rolling back on any throw. */
export async function transaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // the client is already broken; the outer throw is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool() {
  await pool.end();
}
