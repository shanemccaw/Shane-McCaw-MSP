/**
 * verify-1847-service-availability.ts — live, READ-ONLY verification for Git #1847.
 *
 * Proves the whole chain against the real tenant rather than asserting it:
 *
 *   1. reads the tenant's actual Intune entitlement out of the /subscribedSkus
 *      collection the platform already stores, and prints the real SKU part
 *      numbers and Intune-family service plans verbatim;
 *   2. makes ONE read-only Graph call to /deviceManagement/managedDevices and shows
 *      what the tenant really answers;
 *   3. shows the resolved tenant-level verdict;
 *   4. records it and reads the row back out of `tenant_service_availability`.
 *
 * Read-only against the tenant. It configures nothing, enables nothing, and writes
 * only the platform's own service-availability row.
 *
 *   node --import tsx src/scripts/verify-1847-service-availability.ts <tenantGuid>
 */

import { graphFetchPaginated } from "../lib/monitor-executor.ts";
import {
  ServiceNotConfiguredError,
  readIntuneEntitlement,
  recordTenantServiceState,
  getTenantServiceStates,
} from "../lib/service-availability.ts";

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("usage: verify-1847-service-availability.ts <tenantGuid>");
  process.exit(1);
}

const line = (s: string) => console.log(s);

async function main() {
  line(`\n=== #1847 live verification — tenant ${tenantId} ===\n`);

  line("[1] Intune entitlement, read from the tenant's own /subscribedSkus collection");
  const entitlement = await readIntuneEntitlement(tenantId);
  line(`    verdict            : ${entitlement.verdict}`);
  line(`    subscribed SKUs    : ${entitlement.skuPartNumbers.join(", ") || "(none on record)"}`);
  line(`    Intune-family plans: ${
    entitlement.plans.map((p) => `${p.servicePlanName} [${p.skuPartNumber}] ${p.provisioningStatus}`).join(" | ") ||
    "(none)"
  }`);
  line(`    source             : ${entitlement.sourceCheckKey ?? "(none)"} @ ${entitlement.collectedAt ?? "-"}`);

  line("\n[2] Live read-only Graph call: GET /deviceManagement/managedDevices?$top=1");
  let err: unknown = null;
  try {
    const res = await graphFetchPaginated(tenantId, "/deviceManagement/managedDevices?$top=1", "GET");
    line(`    ANSWERED: ${res.items.length} item(s), ${res.pageCount} page(s) — Intune is reachable on this tenant.`);
  } catch (e) {
    err = e;
  }

  if (!(err instanceof ServiceNotConfiguredError)) {
    if (err) {
      line(`    Threw a NON-service error, which is itself the honest result: ${String(err)}`);
    }
    line("\n[3] No service state to record from this call.");
    const existing = await getTenantServiceStates(tenantId);
    line(`[4] Rows already on record: ${existing.length}`);
    for (const r of existing) line(`    ${r.serviceKey} = ${r.state} (${r.evidenceBasis})`);
    return;
  }

  line(`    REFUSED: HTTP ${err.httpStatus}, signature ${err.detectionSignature}`);
  line(`    body    : ${err.responseBody.slice(0, 200).replace(/\s+/g, " ")}`);

  line("\n[3] Resolved tenant-level verdict");
  line(`    service       : ${err.serviceKey}`);
  line(`    state         : ${err.state}`);
  line(`    evidence basis: ${err.verdict.evidenceBasis}`);
  line(`    reason        : ${err.reason}`);

  line("\n[4] Recording it once at tenant level, then reading it back");
  await recordTenantServiceState({
    tenantId,
    verdict: err.verdict,
    observedEndpoint: err.endpoint,
    observedHttpStatus: err.httpStatus,
    responseBody: err.responseBody,
    detectedByCheckKey: "verify-1847-service-availability",
  });
  for (const r of await getTenantServiceStates(tenantId)) {
    line(`    ${r.serviceKey} = ${r.state} | ${r.evidenceBasis} | ${r.detectionSignature ?? "-"} | first ${r.firstObservedAt.toISOString()} | last ${r.lastObservedAt.toISOString()}`);
    line(`      ${r.reason}`);
  }
  line("");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
