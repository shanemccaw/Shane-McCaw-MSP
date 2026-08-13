/**
 * backfill-tenant-domain.ts (#238)
 *
 * One-off backfill: tenants.domain was never populated by the consent flow
 * until this fix, so every tenant that granted consent before it landed has
 * domain === null. Connect-IPPSSession-backed checks (DLP/Labels, #212, and
 * anything else built on that mechanism) reject a raw tenant GUID as
 * -Organization and need the real domain, so those tenants hard-fail on any
 * PowerShell-backed check today.
 *
 * For every tenant with domain IS NULL and a currently-granted `graph`
 * consent, calls the same Graph GET /organization lookup the consent
 * callback now uses (getInitialDomainForTenant — client-credentials token
 * for that tenant via the existing multi-tenant App Registration; no stored
 * per-tenant token needed) and backfills tenants.domain.
 *
 * Not a migration — Shane runs this once, manually. Idempotent: re-running
 * only touches rows that are still domain IS NULL.
 *
 * Run:
 *   pnpm --filter @workspace/api-server run build
 *   pnpm --filter @workspace/api-server run backfill-tenant-domain
 *
 * Required env vars: DATABASE_URL, MT_APP_CLIENT_ID, MT_APP_CLIENT_SECRET
 * (same Graph read app the consent flow itself uses).
 */

import { db, tenantsTable, type TenantConsentMap } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getInitialDomainForTenant } from "../lib/graph.ts";

async function main() {
  const candidates = await db
    .select({
      id: tenantsTable.id,
      customerName: tenantsTable.customerName,
      tenantId: tenantsTable.tenantId,
      consent: tenantsTable.consent,
    })
    .from(tenantsTable)
    .where(isNull(tenantsTable.domain));

  const granted = candidates.filter((t) => (t.consent as TenantConsentMap)?.graph?.status === "granted");

  console.log(`[backfill-tenant-domain] ${candidates.length} tenant(s) with domain IS NULL, ${granted.length} with granted graph consent to backfill.`);

  let succeeded = 0;
  let unresolved = 0;
  let failed = 0;

  for (const t of granted) {
    try {
      const domain = await getInitialDomainForTenant(t.tenantId);
      if (!domain) {
        console.warn(`[backfill-tenant-domain] SKIP id=${t.id} "${t.customerName}" (${t.tenantId}) — no verifiedDomains/isInitial in /organization response`);
        unresolved++;
        continue;
      }

      await db
        .update(tenantsTable)
        .set({ domain, updatedAt: new Date() })
        .where(and(eq(tenantsTable.id, t.id), isNull(tenantsTable.domain)));

      console.log(`[backfill-tenant-domain] OK id=${t.id} "${t.customerName}" (${t.tenantId}) -> ${domain}`);
      succeeded++;
    } catch (err) {
      console.error(`[backfill-tenant-domain] FAIL id=${t.id} "${t.customerName}" (${t.tenantId}):`, err);
      failed++;
    }
  }

  console.log(`[backfill-tenant-domain] Done. succeeded=${succeeded} unresolved=${unresolved} failed=${failed} skippedNoConsent=${candidates.length - granted.length}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-tenant-domain] Fatal error:", err);
  process.exit(1);
});
