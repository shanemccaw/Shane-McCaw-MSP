// Git #4471 — run ONE real, full diagnostics scan for a tenant, in its own process.
//
//   node artifacts/api-server/run-script.mjs src/scripts/run-full-scan-4471.ts <tenantRowId>
//
// Why a standalone process rather than POST /api/msp/customers/:id/diagnostics/run:
// runDiagnostics() is fire-and-forget inside whichever process calls it, and nothing resumes
// a run after that process exits (#4453). On a busy night the shared :8080 dev api-server is
// restarted by Build Set merge-backs every few minutes, which is exactly what killed both
// core:premier runs for the testbed tenant on 2026-09-16 (runs 556 and 563, both marked
// "interrupted ... the service restarted mid-scan"). A ~20 minute Premier scan cannot finish
// there. This script calls the SAME runDiagnostics() -> executeMonitoringPackage() path, with
// the package resolved by the SAME query the MSP re-check route uses, so the run is identical
// except for which process hosts it. Its heartbeat keeps the #4453 stale-run sweep off it.
//
// Not an assessment scan (isAssessmentTriggered: false), matching the manual MSP re-check.

import { and, desc, eq, sql } from "drizzle-orm";
import {
  db,
  tenantsTable,
  usersTable,
  clientServicesTable,
  servicesTable,
} from "@workspace/db";
import { runDiagnostics } from "../lib/diagnostics-runner.ts";

const tenantRowId = Number(process.argv[2]);
if (!Number.isInteger(tenantRowId) || tenantRowId <= 0) {
  console.error("usage: run-full-scan-4471.ts <tenants.id>");
  process.exit(1);
}

const [tenant] = await db
  .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId })
  .from(tenantsTable)
  .where(eq(tenantsTable.id, tenantRowId))
  .limit(1);
if (!tenant) {
  console.error(`tenants.id=${tenantRowId} not found`);
  process.exit(1);
}

// Same resolution as routes/msp-diagnostics.ts POST /msp/customers/:customerId/diagnostics/run.
const [pkgRow] = await db
  .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
  .from(usersTable)
  .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
  .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
  .where(
    and(
      eq(usersTable.tenantId, tenantRowId),
      eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
      eq(clientServicesTable.status, "active"),
    ),
  )
  .orderBy(desc(clientServicesTable.id))
  .limit(1);
const packageKey = pkgRow?.packageKey;
if (!packageKey) {
  // Refuse rather than silently falling back to core:security-baseline — the point is a
  // scan of the package the customer actually holds.
  console.error(`tenants.id=${tenantRowId} has no active monitoring_subscription with a packageKey`);
  process.exit(1);
}

console.log(`scan start ${new Date().toISOString()} tenant=${tenant.id} (${tenant.name}, ${tenant.tenantId}) package=${packageKey}`);
const result = await runDiagnostics({ customerId: tenant.id, packageKey, isAssessmentTriggered: false });
console.log(`scan end ${new Date().toISOString()} ${JSON.stringify(result)}`);
process.exit(0);
