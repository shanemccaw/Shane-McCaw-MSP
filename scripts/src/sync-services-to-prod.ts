/**
 * sync-services-to-prod.ts
 *
 * Syncs the `services` table from dev (DATABASE_URL) to production
 * (PROD_DATABASE_URL or DATABASE_URL_PROD — whichever is set).
 *
 * After the sync, production has exactly the same service catalogue as dev:
 *   - Services present in dev are upserted (insert or update by slug).
 *   - Services present in production but absent in dev are deleted.
 *
 * Safe to re-run at any time. Uses onConflictDoUpdate on `slug`.
 *
 * Run manually:
 *   pnpm --filter @workspace/scripts run sync-services
 *
 * Required env vars:
 *   DATABASE_URL                 — dev/source Postgres connection string
 *   PROD_DATABASE_URL            — production connection string  ← preferred
 *     or DATABASE_URL_PROD       — alternative name (either/or)
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { servicesTable } from "@workspace/db/schema";
import { notInArray } from "drizzle-orm";

const { Pool } = pg;

const devUrl = process.env["DATABASE_URL"];
const prodUrl = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"];

if (!devUrl) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(2);
}

if (!prodUrl) {
  console.error("ERROR: Neither PROD_DATABASE_URL nor DATABASE_URL_PROD is set.");
  console.error("Add one of these to Replit Secrets pointing at the production database.");
  process.exit(2);
}

const devPool = new Pool({ connectionString: devUrl });
const prodPool = new Pool({ connectionString: prodUrl });
const devDb = drizzle(devPool);
const prodDb = drizzle(prodPool);

async function main(): Promise<void> {
  console.log("Fetching services from dev database…");
  const devServices = await devDb.select().from(servicesTable);

  if (devServices.length === 0) {
    console.log("No services in dev database — deleting all services from production.");
    await prodDb.delete(servicesTable);
    console.log("Done. Production services table is now empty.");
    await devPool.end();
    await prodPool.end();
    return;
  }

  // Only sync services that have a slug — null-slug rows have no stable conflict
  // key, so upserting them is not idempotent and can create duplicates in production.
  const sluggedServices = devServices.filter((s): s is typeof s & { slug: string } => s.slug !== null);
  const devSlugs = sluggedServices.map((s) => s.slug);

  const nullSlugCount = devServices.length - sluggedServices.length;
  if (nullSlugCount > 0) {
    console.warn(`WARNING: ${nullSlugCount} service(s) have no slug and will be skipped. Add slugs in the admin panel.`);
  }

  if (sluggedServices.length === 0) {
    console.log("No slug-bearing services to sync.");
    await devPool.end();
    await prodPool.end();
    return;
  }

  // Upsert dev services into production
  console.log(`Upserting ${sluggedServices.length} service(s) into production…`);
  for (const svc of sluggedServices) {
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

  // Delete production services whose slugs are absent from dev
  if (devSlugs.length > 0) {
    const deleted = await prodDb
      .delete(servicesTable)
      .where(notInArray(servicesTable.slug, devSlugs))
      .returning({ slug: servicesTable.slug, name: servicesTable.name });
    if (deleted.length > 0) {
      console.log(`\nRemoved ${deleted.length} stale service(s) from production:`);
      for (const row of deleted) {
        console.log(`  removed: ${row.slug ?? "(no slug)"} — ${row.name}`);
      }
    }
  }

  console.log(`\nDone. Production is now in sync with dev (${devServices.length} service(s)).`);

  await devPool.end();
  await prodPool.end();
}

main().catch((err) => {
  console.error("sync-services failed:", err);
  process.exit(1);
});
