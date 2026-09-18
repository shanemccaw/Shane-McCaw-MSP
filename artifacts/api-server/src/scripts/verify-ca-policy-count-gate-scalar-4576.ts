// Git #4576 — live verification that the Security Defaults gate-skipped path
// for identity:ca-policy-count now stamps an explicit caPolicyCount: 0 +
// securityDefaultsEnabled: true, and that the Security pillar tile renders a
// real 0 with the Security Defaults reason instead of "-".
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-ca-policy-count-gate-scalar-4576.ts <tenants.id>
//
// Read-only: persistProfile: false, so nothing is written to
// tenant_monitor_profiles (#543).

import { eq } from "drizzle-orm";
import { db, tenantsTable, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";
import { statFromCheckObservation } from "../lib/pillar-summary-stats.ts";
import type { CheckObservation } from "../lib/pillar-check-observations.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: verify-ca-policy-count-gate-scalar-4576.ts <tenants.id>");
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

const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, "identity:ca-policy-count"));
if (!check) {
  console.error("identity:ca-policy-count not found in monitor_checks");
  process.exit(1);
}

console.log(`tenant ${tenant.id} ${tenant.name} (${tenant.tenantId})\n`);

const result = await executeMonitorCheck({
  check,
  tenantId: tenant.tenantId,
  triggerId: `verify-4576-${Date.now()}`,
  skipIdempotency: true,
  persistProfile: false,
});

console.log(`executeMonitorCheck result: status=${result.status}`);
console.log(`extractedProperties: ${JSON.stringify(result.extractedProperties, null, 2)}`);

const observation: CheckObservation = {
  checkKey: "identity:ca-policy-count",
  status: result.status === "ok" ? "ok" : (result.status as CheckObservation["status"]),
  props: result.extractedProperties,
  collectedAt: new Date().toISOString(),
  licenseFeature: null,
  serviceName: null,
};

const spec = {
  id: "security.caPolicies",
  label: "Conditional Access policies",
  unit: "count" as const,
  source: { kind: "check" as const, checkKey: "identity:ca-policy-count", valueField: "caPolicyCount" },
  replaces: "42 CA policies",
};

const stat = statFromCheckObservation(spec, observation);
console.log(`\npillar tile resolution: ${JSON.stringify(stat, null, 2)}`);

process.exit(0);
