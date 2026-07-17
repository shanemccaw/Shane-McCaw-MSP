import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { logger } from "./logger.ts";
const log = logger.child({ channel: "system.core" });

export function getProdDbUrl(): string | null {
  return process.env.DATABASE_URL_PROD ?? process.env.PROD_DATABASE_URL ?? null;
}

export function isProdDbConfigured(): boolean {
  return !!getProdDbUrl();
}

export function buildProdDb() {
  const url = getProdDbUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL_PROD is not configured — set the DATABASE_URL_PROD secret in Replit Secrets",
    );
  }
  const pool = new Pool({ connectionString: url, max: 2, idleTimeoutMillis: 30_000 });
  pool.on("error", (err: Error) => {
    log.warn({ err }, "prod-db: idle pool client error");
  });
  return { db: drizzle(pool), pool };
}
