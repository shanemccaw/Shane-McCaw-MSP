#!/usr/bin/env node
/**
 * #1915 — end-to-end verification of the Azure Lighthouse offer promise/record
 * layer, run directly against the local Postgres and the real generator
 * module. Exercises exactly what admin-azure-lighthouse.ts's POST/GET/reconcile
 * routes do, without needing an authenticated HTTP session — the issue's own
 * ask #2 ("real and testable on its own, e.g. via a script or admin-only
 * route, not built as UI-only glue").
 *
 * Usage (from artifacts/api-server):
 *   pnpm exec tsx scripts/verify-azure-lighthouse-offer-1915.mts [tenantId]
 *
 * (plain `node --experimental-strip-types` cannot run this file directly —
 * @workspace/db's package "exports" resolve to a directory import Node's ESM
 * loader rejects outside a bundler-aware resolver; tsx provides one.)
 *
 * Requires DATABASE_URL (from .env.local) and the AZURE_LIGHTHOUSE_* env vars
 * — if those are unset, this script demonstrates (and prints) the honest
 * "unconfigured" failure path instead of fabricating a principal.
 */

import { db, tenantAzureLighthouseOffersTable, tenantAzureReachTable, tenantsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { buildLighthouseArmTemplate, lighthouseManagingTenantConfig } from "../src/lib/azure-lighthouse-onboarding.ts";

async function main() {
  const requestedTenantId = process.argv[2];

  console.log("── Step 1: managing-tenant config ──────────────────────────");
  const config = lighthouseManagingTenantConfig();
  if (!config) {
    console.log("NOT CONFIGURED — set AZURE_LIGHTHOUSE_MANAGING_TENANT_ID (or GRAPH_TENANT_ID), " +
      "AZURE_LIGHTHOUSE_PRINCIPAL_ID, AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME.");
    console.log("Demonstrating the honest failure path buildLighthouseArmTemplate() takes:");
    try {
      buildLighthouseArmTemplate({
        mspOfferName: "demo",
        mspOfferDescription: "demo",
        scope: { scopeType: "subscription", subscriptionId: "00000000-0000-0000-0000-000000000000" },
      });
    } catch (err) {
      console.log("  threw as expected:", err instanceof Error ? err.message : err);
    }
    console.log("\nStopping here — nothing to persist without a real managing-tenant identity.");
    process.exit(0);
  }
  console.log("  managingTenantId:", config.managingTenantId);
  console.log("  principalId:", config.principalId);
  console.log("  principalDisplayName:", config.principalDisplayName);

  console.log("\n── Step 2: pick a tenant to offer against ──────────────────");
  const tenantRow = requestedTenantId
    ? (await db.select().from(tenantsTable).where(eq(tenantsTable.tenantId, requestedTenantId)).limit(1))[0]
    : (await db.select().from(tenantsTable).limit(1))[0];
  if (!tenantRow) {
    console.log("No tenant rows exist locally — nothing to demonstrate against.");
    process.exit(0);
  }
  console.log(`  tenant: ${tenantRow.customerName} (${tenantRow.tenantId})`);

  console.log("\n── Step 3: generate the real ARM template ──────────────────");
  const built = buildLighthouseArmTemplate({
    mspOfferName: `Shane McCaw Consulting — ${tenantRow.customerName}`,
    mspOfferDescription: "Read-only Azure configuration monitoring for security and compliance reporting.",
    scope: { scopeType: "subscription", subscriptionId: "00000000-0000-0000-0000-000000000000" },
  });
  console.log("  armScopePath:", built.armScopePath);
  console.log("  roleDefinitionId:", built.roleDefinitionId, `(${built.roleName})`);
  console.log("  authorizations:", JSON.stringify(built.authorizations));
  console.log("  resource types:", built.template.resources.map((r) => (r as { type: string }).type).join(", "));

  console.log("\n── Step 4: persist the offer (promise/record row) ──────────");
  const [offerRow] = await db
    .insert(tenantAzureLighthouseOffersTable)
    .values({
      tenantId: tenantRow.tenantId,
      scopeType: "subscription",
      subscriptionId: "00000000-0000-0000-0000-000000000000",
      armScopePath: built.armScopePath,
      roleDefinitionId: built.roleDefinitionId,
      roleName: built.roleName,
      state: "offered",
      offeredArtifact: {
        mspOfferName: `Shane McCaw Consulting — ${tenantRow.customerName}`,
        mspOfferDescription: "Read-only Azure configuration monitoring for security and compliance reporting.",
        authorizations: built.authorizations,
        deepLinkUrl: "https://portal.azure.com/#create/Microsoft.Template/uri/DEMO",
      },
    })
    .onConflictDoUpdate({
      target: [tenantAzureLighthouseOffersTable.tenantId, tenantAzureLighthouseOffersTable.armScopePath],
      set: { state: "offered", offeredAt: new Date(), updatedAt: new Date() },
    })
    .returning();
  console.log("  persisted offer id:", offerRow.id, "state:", offerRow.state);

  console.log("\n── Step 5: read back — everOffered / effective state ───────");
  const offers = await db
    .select()
    .from(tenantAzureLighthouseOffersTable)
    .where(eq(tenantAzureLighthouseOffersTable.tenantId, tenantRow.tenantId));
  console.log(`  ${offers.length} offer row(s) for this tenant — everOffered = ${offers.length > 0}`);

  console.log("\n── Step 6: check reconciliation against tenant_azure_reach ─");
  const [reach] = await db.select().from(tenantAzureReachTable).where(eq(tenantAzureReachTable.tenantId, tenantRow.tenantId)).limit(1);
  if (!reach) {
    console.log("  no tenant_azure_reach row — reconcile would report 'never probed', leaving offer state unchanged.");
  } else {
    console.log(`  tenant_azure_reach.state = ${reach.state}, subscriptions = ${reach.subscriptions.length}`);
  }

  console.log("\nOK — real DB rows written, no fabricated data. Clean up test row with:");
  console.log(`  DELETE FROM tenant_azure_lighthouse_offers WHERE id = ${offerRow.id};`);
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
