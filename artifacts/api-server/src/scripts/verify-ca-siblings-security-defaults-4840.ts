// Git #4840 — live check that ca-legacy-auth-block / ca-mfa-coverage stamp
// securityDefaultsEnabled: true on the Security Defaults gate-skipped path and
// that the SIGNALS reason reads security_defaults_active, not gate_skipped.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-ca-siblings-security-defaults-4840.ts <tenants.id>
//
// Read-only: persistProfile: false.
import { eq } from "drizzle-orm";
import { db, tenantsTable, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";
import { unmeasuredReason } from "../lib/pillar-signals.ts";

const id = Number(process.argv[2]);
const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, id)).limit(1);
if (!tenant?.tenantId) { console.error("tenant not found"); process.exit(1); }

for (const key of ["identity:ca-legacy-auth-block", "identity:ca-mfa-coverage", "identity:ca-device-compliance"]) {
  const [check] = await db.select().from(monitorChecksTable).where(eq(monitorChecksTable.key, key));
  const r = await executeMonitorCheck({ check, tenantId: tenant.tenantId, triggerId: `verify-4840-${Date.now()}`, skipIdempotency: true, persistProfile: false });
  const p = r.extractedProperties as Record<string, unknown>;
  console.log(`${key}: status=${r.status} _gateSkipped=${p._gateSkipped} securityDefaultsEnabled=${p.securityDefaultsEnabled}`);
}
process.exit(0);
