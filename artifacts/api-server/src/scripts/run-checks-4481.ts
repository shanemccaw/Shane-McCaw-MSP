// Git #4481 — run specific monitor checks against one tenant, live, in their own process.
//
//   node artifacts/api-server/run-script.mjs src/scripts/run-checks-4481.ts <tenant GUID> <checkKey> [<checkKey> ...]
//
// Re-verifies individual checks after a fix without a full ~13 minute package scan
// (run-full-scan-4471.ts). Goes through the same executeMonitorCheck() a scan uses, so
// Graph endpoints, PowerShell dispatch to the dev container, mapping and severity rules
// are all the real ones. persistProfile is false: tenant_monitor_profiles is read as the
// tenant's live per-check signal (#543), and a verification pass must not become the score.

import { inArray } from "drizzle-orm";
import { db, monitorChecksTable } from "@workspace/db";
import { executeMonitorCheck } from "../lib/monitor-executor.ts";

const [tenantId, ...checkKeys] = process.argv.slice(2);
if (!tenantId || checkKeys.length === 0) {
  console.error("usage: run-checks-4481.ts <tenant GUID> <checkKey> [<checkKey> ...]");
  process.exit(1);
}

const checks = await db.select().from(monitorChecksTable).where(inArray(monitorChecksTable.key, checkKeys));
const missing = checkKeys.filter(k => !checks.some(c => c.key === k));
if (missing.length) {
  console.error(`unknown check key(s): ${missing.join(", ")}`);
  process.exit(1);
}

let failures = 0;
for (const check of checks) {
  const started = Date.now();
  const result = await executeMonitorCheck({
    check,
    tenantId,
    triggerId: `verify-4481:${check.key}:${started}`,
    skipIdempotency: true,
    persistProfile: false,
    includeItems: true,
  });
  if (result.status === "error") failures++;
  console.log(JSON.stringify({
    checkKey: result.checkKey,
    status: result.status,
    elapsedMs: Date.now() - started,
    itemCount: result.itemCount,
    pageCount: result.pageCount,
    extractedProperties: Object.fromEntries(
      Object.entries(result.extractedProperties).filter(([k]) => !k.startsWith("_")),
    ),
    severityMatched: result.severityMatched,
    severityLabel: result.severityLabel,
    errorMessage: result.errorMessage ?? null,
    // Field names only (no values): enough to confirm the fields a mapping keys on came back.
    firstItemFields: result.items?.[0] && typeof result.items[0] === "object" ? Object.keys(result.items[0] as object) : [],
  }));
}
process.exit(failures ? 2 : 0);
