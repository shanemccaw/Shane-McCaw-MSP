// Git #4512 — live verification of the three Conditional Access checks against a real tenant.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-ca-checks-4512.ts <tenants.id>
//
// Read-only: every Graph call is a GET, and every executeMonitorCheck call passes
// persistProfile: false, so nothing is written to tenant_monitor_profiles (a non-scoring pass
// writing there silently becomes the tenant's score — #543).
//
// Three passes over the LIVE monitor_checks rows:
//   1. as stored            — Security Defaults gate + Entra ID P1 prerequisite in force
//   2. gate removed         — isolates the license prerequisite against the live /subscribedSkus
//   3. pre-#4512 definition — exists/count with no gate or prerequisite, reproducing the defect

import { eq, inArray } from "drizzle-orm";
import { db, tenantsTable, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";
import { graphFetchForTenant } from "../lib/graph.ts";
import { getProvisionedServicePlanNamesForTenant } from "../lib/license-gate.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: verify-ca-checks-4512.ts <tenants.id>");
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

const CA_KEYS = ["identity:ca-mfa-coverage", "identity:ca-legacy-auth-block", "identity:ca-policy-count"];
const checks = await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, CA_KEYS));
if (checks.length !== CA_KEYS.length) {
  console.error(`expected ${CA_KEYS.length} CA checks, found ${checks.length}`);
  process.exit(1);
}

console.log(`tenant ${tenant.id} ${tenant.name} (${tenant.tenantId})\n`);

// Raw live state the checks are judged against.
const sdRes = await graphFetchForTenant(tenant.tenantId, "/policies/identitySecurityDefaultsEnforcementPolicy");
const sd = sdRes.ok ? ((await sdRes.json()) as { isEnabled?: boolean }) : null;
console.log(`live Security Defaults: HTTP ${sdRes.status}, isEnabled = ${JSON.stringify(sd?.isEnabled)}`);
const caRes = await graphFetchForTenant(tenant.tenantId, "/identity/conditionalAccess/policies");
const caBody = caRes.ok ? ((await caRes.json()) as { value?: Array<{ displayName?: string; state?: string }> }) : null;
console.log(
  `live CA policies: HTTP ${caRes.status}, ${caBody?.value?.length ?? "n/a"} policies`
    + (caBody?.value?.length ? ` — ${caBody.value.map((p) => `${p.displayName} [${p.state}]`).join("; ")}` : ""),
);
const plans = await getProvisionedServicePlanNamesForTenant(tenant.tenantId);
console.log(
  `live provisioned service plans: ${plans.error ? `ERROR ${plans.error}` : `${plans.servicePlanNames.size} plans`}; `
    + `AAD_PREMIUM=${plans.servicePlanNames.has("AAD_PREMIUM")} AAD_PREMIUM_P2=${plans.servicePlanNames.has("AAD_PREMIUM_P2")}\n`,
);

const PRE_4512: Record<string, Pick<typeof checks[number], "mapping" | "severityRules" | "properties">> = {
  "identity:ca-mfa-coverage": {
    properties: ["id", "grantControls"],
    mapping: [{ transform: "exists", sourceField: "grantControls", targetField: "caMfaPolicyExists" }],
    severityRules: [{ label: "No Conditional Access policy requires MFA", severity: "critical", expression: "caMfaPolicyExists == false" }],
  },
  "identity:ca-legacy-auth-block": {
    properties: ["id", "conditions"],
    mapping: [{ transform: "exists", sourceField: "conditions", targetField: "caLegacyAuthBlockExists" }],
    severityRules: [{ label: "No Conditional Access policy blocks legacy authentication — MFA can be bypassed entirely", severity: "critical", expression: "caLegacyAuthBlockExists == false" }],
  },
  "identity:ca-policy-count": {
    properties: ["id", "displayName", "state"],
    mapping: [{ transform: "count", sourceField: "id", targetField: "caPolicyCount" }],
    severityRules: [{ label: "No Conditional Access policies exist — zero Zero Trust enforcement on this tenant", severity: "critical", expression: "caPolicyCount == 0" }],
  },
};

const passes: Array<{ name: string; build: (c: typeof checks[number]) => typeof checks[number] }> = [
  { name: "1. as stored (gate + license prerequisite)", build: (c) => c },
  { name: "2. Security Defaults gate removed (license prerequisite only)", build: (c) => ({ ...c, gateEndpoint: null, gateExpression: null }) },
  {
    name: "3. pre-#4512 definition (the defect)",
    build: (c) => ({ ...c, ...PRE_4512[c.key], gateEndpoint: null, gateExpression: null, requiredServicePlans: null }),
  },
];

const extractedSummary = (props: Record<string, unknown>): string =>
  JSON.stringify(Object.fromEntries(Object.entries(props).filter(([k]) =>
    !k.endsWith("_values") && !k.endsWith("_first") && k !== "@odata.context" && k !== "description" && k !== "_evidence")));

for (const pass of passes) {
  console.log(`── ${pass.name}`);
  for (const key of CA_KEYS) {
    const check = pass.build(checks.find((c) => c.key === key)!);
    const r = await executeMonitorCheck({
      check,
      tenantId: tenant.tenantId,
      triggerId: `verify-4512-${Date.now()}`,
      skipIdempotency: true,
      persistProfile: false,
    });
    console.log(
      `   ${key.padEnd(30)} status=${r.status} severity=${r.severityMatched ?? "none"}`
        + (r.severityLabel ? ` "${r.severityLabel}"` : "")
        + (r.errorMessage ? ` error="${r.errorMessage}"` : ""),
    );
    console.log(`   ${"".padEnd(30)} extracted=${extractedSummary(r.extractedProperties)}`);
  }
  console.log("");
}

process.exit(0);
