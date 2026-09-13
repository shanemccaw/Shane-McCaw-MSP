/**
 * prospect-free-scan-backstop.test.ts — Git #3946 (Feature #2745, Epic #1352).
 *
 * Integration tests for ensureProspectFreeScanBackstop, run against the REAL
 * local Postgres (the same DATABASE_URL the dev api-server uses), because the
 * only decision this function makes — the idempotency guard — is made from a
 * real msp_diagnostic_runs row. The scan trigger itself is injected so no
 * real, Graph-hitting scan fires from the test — only the DECISION is
 * exercised, same pattern as monitoring-onboarding-scan.test.ts (#1314).
 *
 * All rows are created under a unique per-run marker and deleted in afterAll.
 */

import { describe, it, expect, afterAll, vi } from "vitest";
import { randomBytes, randomUUID } from "crypto";
import { db, tenantsTable, mspsTable, mspDiagnosticRunsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import {
  ensureProspectFreeScanBackstop,
  type ProspectFreeScanTriggerOpts,
} from "./prospect-free-scan-backstop.ts";

const RUN_TAG = randomBytes(4).toString("hex");
const createdTenantIds: number[] = [];

async function anyMspId(): Promise<number> {
  const [msp] = await db.select({ id: mspsTable.id }).from(mspsTable).limit(1);
  if (!msp) throw new Error("no MSP row exists in the local DB to anchor test rows to");
  return msp.id;
}

async function makeTenant(mspId: number): Promise<number> {
  const [row] = await db
    .insert(tenantsTable)
    .values({ mspId, customerName: `Test 3946 Prospect ${RUN_TAG}`, tenantId: randomUUID() })
    .returning({ id: tenantsTable.id });
  createdTenantIds.push(row.id);
  return row.id;
}

afterAll(async () => {
  if (createdTenantIds.length > 0) {
    await db.delete(mspDiagnosticRunsTable).where(inArray(mspDiagnosticRunsTable.customerId, createdTenantIds));
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantIds));
  }
});

describe("ensureProspectFreeScanBackstop (Git #3946)", () => {
  it("skips (idempotent) when a diagnostic run already exists for the customer — the consent-time scan already covered it", async () => {
    const mspId = await anyMspId();
    const tenantId = await makeTenant(mspId);
    const [inserted] = await db
      .insert(mspDiagnosticRunsTable)
      .values({ mspId, customerId: tenantId, status: "running" })
      .returning({ runId: mspDiagnosticRunsTable.runId });
    const trigger = vi.fn(async (_o: ProspectFreeScanTriggerOpts) => undefined);

    const result = await ensureProspectFreeScanBackstop(tenantId, { triggerScan: trigger });

    expect(result).toEqual({
      fired: false,
      reason: "already_kicked_off",
      customerId: tenantId,
      existingRunId: inserted.runId,
    });
    expect(trigger).not.toHaveBeenCalled();
  });

  it("fires exactly one free-scan for a Prospect customerId with no prior run", async () => {
    const mspId = await anyMspId();
    const tenantId = await makeTenant(mspId);
    const trigger = vi.fn(async (_o: ProspectFreeScanTriggerOpts) => undefined);

    const result = await ensureProspectFreeScanBackstop(tenantId, { triggerScan: trigger });

    expect(result).toEqual({ fired: true, reason: "kicked_off", customerId: tenantId });
    expect(trigger).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveBeenCalledWith({
      customerId: tenantId,
      packageKey: "core:free-scan-full",
      isAssessmentTriggered: true,
    });
  });

  it("never throws back to the caller when the trigger rejects", async () => {
    const mspId = await anyMspId();
    const tenantId = await makeTenant(mspId);
    const trigger = vi.fn(async (_o: ProspectFreeScanTriggerOpts) => {
      throw new Error("simulated Graph failure");
    });

    const result = await ensureProspectFreeScanBackstop(tenantId, { triggerScan: trigger });

    expect(result).toEqual({ fired: true, reason: "kicked_off", customerId: tenantId });
    // Let the fire-and-forget rejection's .catch() handler run before the test ends.
    await new Promise((resolve) => setImmediate(resolve));
  });
});
