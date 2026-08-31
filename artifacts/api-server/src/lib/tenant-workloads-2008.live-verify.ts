/**
 * tenant-workloads-2008.live-verify.ts — Git #2008
 *
 * One-shot LIVE verification against the real local Postgres: runs
 * syncTenantServicePlans against the testbed tenant's real, already-stored
 * /subscribedSkus page and confirms real rows land in tenant_service_plans and
 * group into real workloads. Not part of the regression sweep — see
 * vitest.live-verify.config.ts.
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/lib/tenant-workloads-2008.live-verify.ts
 */

import { describe, it, expect } from "vitest";
import { db, tenantServicePlansTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { syncTenantServicePlans, groupEnabledServicePlansByWorkload } from "./tenant-workloads.ts";

const TESTBED_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";

describe("syncTenantServicePlans (live)", () => {
  it("syncs the testbed tenant's real enabled service plans and groups them into real workloads", async () => {
    const result = await syncTenantServicePlans(TESTBED_TENANT_ID);
    expect(result.synced).toBe(true);
    expect(result.count).toBeGreaterThan(0);

    const rows = await db
      .select({ servicePlanName: tenantServicePlansTable.servicePlanName, provisioningStatus: tenantServicePlansTable.provisioningStatus })
      .from(tenantServicePlansTable)
      .where(eq(tenantServicePlansTable.tenantId, TESTBED_TENANT_ID));
    expect(rows.length).toBe(result.count);
    expect(rows.every((r) => r.provisioningStatus === "Success")).toBe(true);

    const groups = groupEnabledServicePlansByWorkload(rows);
    // eslint-disable-next-line no-console
    console.log("Git #2008 live verify — synced", result.count, "enabled plans, workloads:", JSON.stringify(groups, null, 2));
    expect(groups.length).toBeGreaterThan(0);
  });
});
