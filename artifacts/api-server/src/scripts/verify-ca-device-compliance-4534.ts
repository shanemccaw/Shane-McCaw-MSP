// Git #4534 — live verification of identity:ca-device-compliance against a real tenant.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-ca-device-compliance-4534.ts <tenants.id>
//
// Read-only: every Graph call is a GET, and the executeMonitorCheck call passes
// persistProfile: false, so nothing is written to tenant_monitor_profiles.
//
// Two passes over the LIVE monitor_checks row:
//   1. as stored            — Entra ID P1 prerequisite in force (#4534's fix)
//   2. pre-#4534 definition — exists over grantControls, no license prerequisite,
//      reproducing the defect

import { eq } from "drizzle-orm";
import { db, tenantsTable, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";
import { graphFetchForTenant } from "../lib/graph.ts";
import { getProvisionedServicePlanNamesForTenant } from "../lib/license-gate.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: verify-ca-device-compliance-4534.ts <tenants.id>");
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

const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, "identity:ca-device-compliance"));
if (!check) {
  console.error("identity:ca-device-compliance not found");
  process.exit(1);
}

console.log(`tenant ${tenant.id} ${tenant.name} (${tenant.tenantId})\n`);

const caRes = await graphFetchForTenant(tenant.tenantId, "/identity/conditionalAccess/policies");
const caBody = caRes.ok ? ((await caRes.json()) as { value?: Array<{ displayName?: string; state?: string; grantControls?: { builtInControls?: string[] } }> }) : null;
console.log(
  `live CA policies: HTTP ${caRes.status}, ${caBody?.value?.length ?? "n/a"} policies`
    + (caBody?.value?.length ? ` — ${caBody.value.map((p) => `${p.displayName} [${p.state}] grants=${JSON.stringify(p.grantControls?.builtInControls)}`).join("; ")}` : ""),
);
const plans = await getProvisionedServicePlanNamesForTenant(tenant.tenantId);
console.log(
  `live provisioned service plans: ${plans.error ? `ERROR ${plans.error}` : `${plans.servicePlanNames.size} plans`}; `
    + `AAD_PREMIUM=${plans.servicePlanNames.has("AAD_PREMIUM")} AAD_PREMIUM_P2=${plans.servicePlanNames.has("AAD_PREMIUM_P2")}\n`,
);

const PRE_4534: Pick<typeof check, "mapping" | "severityRules" | "properties"> = {
  properties: ["id", "grantControls"],
  mapping: [{ transform: "exists", sourceField: "grantControls", targetField: "caDeviceCompliancePolicyExists" }],
  severityRules: [{ label: "No Conditional Access policy requires device compliance", severity: "warning", expression: "caDeviceCompliancePolicyExists == false" }],
};

const passes: Array<{ name: string; build: () => typeof check }> = [
  { name: "1. as stored (license prerequisite in force)", build: () => check },
  { name: "2. pre-#4534 definition (the defect)", build: () => ({ ...check, ...PRE_4534, requiredServicePlans: null }) },
];

const extractedSummary = (props: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(props).filter(([k]) =>
    !k.endsWith("_values") && !k.endsWith("_first") && k !== "@odata.context" && k !== "description" && k !== "_evidence")));

for (const pass of passes) {
  console.log(`── ${pass.name}`);
  const r = await executeMonitorCheck({
    check: pass.build(),
    tenantId: tenant.tenantId,
    triggerId: `verify-4534-${Date.now()}`,
    skipIdempotency: true,
    persistProfile: false,
  });
  console.log(
    `   identity:ca-device-compliance status=${r.status} severity=${r.severityMatched ?? "none"}`
      + (r.severityLabel ? ` "${r.severityLabel}"` : "")
      + (r.errorMessage ? ` error="${r.errorMessage}"` : ""),
  );
  console.log(`   extracted=${extractedSummary(r.extractedProperties)}`);
  console.log("");
}

process.exit(0);
