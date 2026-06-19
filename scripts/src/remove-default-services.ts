/**
 * remove-default-services.ts
 *
 * One-time cleanup: deletes the 12 hardcoded default services that were
 * previously auto-seeded on every API server startup. Services that have
 * contracts or client-service rows attached to them are left untouched.
 *
 * Safe to re-run — services already deleted produce no error.
 *
 * Run once against the target database (defaults to DATABASE_URL):
 *   pnpm --filter @workspace/scripts run remove-default-services
 *
 * To run against production instead:
 *   PROD_DATABASE_URL=<prod-url> pnpm --filter @workspace/scripts run remove-default-services
 *   (set DATABASE_URL to the target db, or use PROD_DATABASE_URL to override)
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { servicesTable, contractsTable, clientServicesTable } from "@workspace/db/schema";
import { inArray, eq } from "drizzle-orm";

const { Pool } = pg;

const DEFAULT_SLUGS = [
  "m365-health-check",
  "copilot-readiness",
  "sharepoint-blueprint",
  "power-automate",
  "security-audit",
  "copilot-prompts",
  "m365-consulting",
  "copilot-ai-consulting",
  "sharepoint-consulting",
  "power-platform-consulting",
  "governance-consulting",
  "cloud-migration-consulting",
];

const url = process.env["PROD_DATABASE_URL"] ?? process.env["DATABASE_URL_PROD"] ?? process.env["DATABASE_URL"];

if (!url) {
  console.error("ERROR: DATABASE_URL is not set.");
  process.exit(2);
}

const pool = new Pool({ connectionString: url });
const db = drizzle(pool);

async function main(): Promise<void> {
  console.log("Checking for default services to remove…");

  const candidates = await db
    .select({ id: servicesTable.id, slug: servicesTable.slug, name: servicesTable.name })
    .from(servicesTable)
    .where(inArray(servicesTable.slug, DEFAULT_SLUGS));

  if (candidates.length === 0) {
    console.log("No default services found — nothing to do.");
    await pool.end();
    return;
  }

  let skipped = 0;
  let removed = 0;

  for (const svc of candidates) {
    // Skip if any contract references this service
    const [contract] = await db
      .select({ id: contractsTable.id })
      .from(contractsTable)
      .where(eq(contractsTable.serviceId, svc.id))
      .limit(1);

    if (contract) {
      console.log(`  skipped (has contract): ${svc.slug} — ${svc.name}`);
      skipped++;
      continue;
    }

    // Skip if any active client-service row references this service
    const [clientSvc] = await db
      .select({ id: clientServicesTable.id })
      .from(clientServicesTable)
      .where(eq(clientServicesTable.serviceId, svc.id))
      .limit(1);

    if (clientSvc) {
      console.log(`  skipped (has client service): ${svc.slug} — ${svc.name}`);
      skipped++;
      continue;
    }

    await db.delete(servicesTable).where(eq(servicesTable.id, svc.id));
    console.log(`  removed: ${svc.slug} — ${svc.name}`);
    removed++;
  }

  console.log(`\nDone. Removed ${removed} service(s), skipped ${skipped} (still referenced).`);

  await pool.end();
}

main().catch((err) => {
  console.error("remove-default-services failed:", err);
  process.exit(1);
});
