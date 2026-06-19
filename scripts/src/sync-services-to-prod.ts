/**
 * sync-services-to-prod.ts
 *
 * Reads all rows from the `services` table in the dev database (DATABASE_URL)
 * and upserts them into the production database (PROD_DATABASE_URL).
 * Uses onConflictDoUpdate on `slug` so re-running is safe.
 *
 * Run once after deploying to push the current service catalogue to production:
 *
 *   pnpm --filter @workspace/scripts run sync-services
 *
 * Required env vars:
 *   DATABASE_URL      — dev/source Postgres connection string (already set)
 *   PROD_DATABASE_URL — production Postgres connection string (add to Replit Secrets)
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { servicesTable } from "@workspace/db/schema";

const { Pool } = pg;

const devUrl = process.env["DATABASE_URL"];
const prodUrl = process.env["PROD_DATABASE_URL"];

if (!devUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(2);
}

if (!prodUrl) {
  console.error("ERROR: PROD_DATABASE_URL is not set.");
  console.error("Set PROD_DATABASE_URL in Replit Secrets to the production database connection string.");
  process.exit(2);
}

const devPool = new Pool({ connectionString: devUrl });
const prodPool = new Pool({ connectionString: prodUrl });
const devDb = drizzle(devPool);
const prodDb = drizzle(prodPool);

async function main(): Promise<void> {
  console.log("Fetching services from dev database…");
  const services = await devDb.select().from(servicesTable);

  if (services.length === 0) {
    console.log("No services found in dev database. Nothing to sync.");
    await devPool.end();
    await prodPool.end();
    return;
  }

  console.log(`Found ${services.length} service(s). Upserting into production…`);

  for (const svc of services) {
    const { id: _id, ...rest } = svc;
    await prodDb
      .insert(servicesTable)
      .values(rest)
      .onConflictDoUpdate({
        target: servicesTable.slug,
        set: rest,
      });
    console.log(`  synced: ${svc.slug} — ${svc.name}`);
  }

  console.log(`\nDone. ${services.length} service(s) synced to production.`);

  await devPool.end();
  await prodPool.end();
}

main().catch((err) => {
  console.error("sync-services failed:", err);
  process.exit(1);
});
