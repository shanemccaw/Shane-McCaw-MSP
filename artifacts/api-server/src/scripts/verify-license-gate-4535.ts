// Git #4535 — live verification that the Launch Control / Config Pack license gate reads
// Entra ID P1/P2 from provisioned SERVICE PLANS, so a tenant holding P1 only inside a bundle
// (Microsoft 365 E3/E5, Business Premium, EMS) is recognised as licensed.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-license-gate-4535.ts <tenants.id>
//
// Read-only: every Graph call is a GET and nothing is written to the database. The config-pack
// pass uses buildConfigPackDryRun, which reads live tenant state and never fires a workflow.
//
// Three passes:
//   1. raw /subscribedSkus  — which SKUs carry an AAD_PREMIUM / AAD_PREMIUM_P2 service plan, and
//                             whether any standalone AAD_PREMIUM / AAD_PREMIUM_P2 SKU exists
//   2. catalog gate         — every live write_action_catalog row with required_license_skus, judged
//                             by the pre-#4535 skuPartNumber test and by the shipped service-plan gate
//   3. config pack          — buildConfigPackDryRun("quickstart-v1"), whose license precondition now
//                             reads the same service-plan set

import { eq, sql } from "drizzle-orm";
import { db, tenantsTable, writeActionCatalogTable } from "@workspace/db";
import { graphFetchForTenant } from "../lib/graph.ts";
import { getProvisionedServicePlanNamesForTenant, tenantHasRequiredLicense } from "../lib/license-gate.ts";
import { buildConfigPackDryRun } from "../lib/config-pack-dry-run.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: verify-license-gate-4535.ts <tenants.id>");
  process.exit(1);
}

const [tenant] = await db
  .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
  .from(tenantsTable)
  .where(eq(tenantsTable.id, tenantRowId))
  .limit(1);
if (!tenant?.tenantId) {
  console.error(`tenants.id=${tenantRowId} not found or has no M365 tenant id`);
  process.exit(1);
}
console.log(`tenant ${tenant.id} ${tenant.name} (${tenant.tenantId})\n`);

const P1_PLANS = ["AAD_PREMIUM", "AAD_PREMIUM_P2"];

// ── 1. raw /subscribedSkus ──
const skuRes = await graphFetchForTenant(tenant.tenantId, "/subscribedSkus?$select=skuPartNumber,capabilityStatus,servicePlans");
if (!skuRes.ok) {
  console.error(`/subscribedSkus HTTP ${skuRes.status}: ${(await skuRes.text()).slice(0, 400)}`);
  process.exit(1);
}
const skuBody = (await skuRes.json()) as {
  value?: Array<{ skuPartNumber?: string; capabilityStatus?: string; servicePlans?: Array<{ servicePlanName?: string; provisioningStatus?: string }> }>;
};
const enabledSkuPartNumbers = new Set<string>();
console.log("live /subscribedSkus:");
for (const sku of skuBody.value ?? []) {
  if (sku.capabilityStatus === "Enabled" && sku.skuPartNumber) enabledSkuPartNumbers.add(sku.skuPartNumber);
  const p1 = (sku.servicePlans ?? []).filter((p) => P1_PLANS.includes(p.servicePlanName ?? ""));
  console.log(
    `  ${sku.skuPartNumber} [${sku.capabilityStatus}] ${sku.servicePlans?.length ?? 0} plans`
      + (p1.length ? ` — ${p1.map((p) => `${p.servicePlanName}:${p.provisioningStatus}`).join(", ")}` : " — no P1/P2 plan"),
  );
}
const standaloneP1Sku = P1_PLANS.filter((s) => enabledSkuPartNumbers.has(s));
console.log(`standalone P1/P2 SKU present: ${standaloneP1Sku.length ? standaloneP1Sku.join(", ") : "NONE"}\n`);

const plans = await getProvisionedServicePlanNamesForTenant(tenant.tenantId);
if (plans.error) {
  console.error(`getProvisionedServicePlanNamesForTenant error: ${plans.error}`);
  process.exit(1);
}
console.log(
  `provisioned service plans: ${plans.servicePlanNames.size}; `
    + P1_PLANS.map((p) => `${p}=${plans.servicePlanNames.has(p)}`).join(" ") + "\n",
);

// ── 2. every live gated catalog row ──
const rows = await db
  .select({ id: writeActionCatalogTable.id, templateId: writeActionCatalogTable.templateId, skus: writeActionCatalogTable.requiredLicenseSkus })
  .from(writeActionCatalogTable)
  .where(sql`jsonb_array_length(coalesce(${writeActionCatalogTable.requiredLicenseSkus}, '[]'::jsonb)) > 0`)
  .orderBy(writeActionCatalogTable.id);
console.log(`catalog rows with required_license_skus: ${rows.length}`);
let flipped = 0;
for (const row of rows) {
  const required = (row.skus ?? []) as string[];
  const before = tenantHasRequiredLicense(required, enabledSkuPartNumbers);
  const after = tenantHasRequiredLicense(required, plans.servicePlanNames);
  if (before !== after) flipped++;
  console.log(`  ${row.id} ${row.templateId ?? "(no template)"} ${JSON.stringify(required)} — pre-#4535 skuPartNumber: ${before ? "licensed" : "BLOCKED"}; service plans: ${after ? "licensed" : "BLOCKED"}`);
}
console.log(`rows whose verdict changed: ${flipped}\n`);

// ── 3. config pack precondition ──
const dry = await buildConfigPackDryRun("quickstart-v1", tenant.id);
console.log(
  `quickstart-v1 dry run: executable=${dry.executable} refusal=${dry.refusal?.code ?? "none"}`
    + (dry.refusal ? ` — ${dry.refusal.message}` : ""),
);

process.exit(0);
