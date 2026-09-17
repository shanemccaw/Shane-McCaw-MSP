/**
 * Live-Postgres acceptance test for #4453 — a diagnostics run whose api-server
 * process died mid-scan stayed `running` forever, so the portal shell's Tenant
 * Status card (via /portal/scan-status) read "Check 1 of 198" on every login.
 *
 * Real incident this reproduces: run 43cc492d (customer 2080) executed checks
 * 21:22:32 → 21:40:11, the api-server restarted at 21:41:23, and the row sat at
 * status=running, checks_*=0, updated_at=21:22:32 from then on. No new run was
 * ever created — the symptom was a dead row, not a re-executed scan.
 *
 * Drives the real failInterruptedDiagnosticRuns() against the real database.
 * Note it is a global sweep by design: any other genuinely-dead run in the
 * database it runs against is failed too, exactly as the server's own boot and
 * interval sweeps would. Assertions only look at this file's own rows.
 *
 * Synthetic identities only: `zz-test-4453-<tag>`. afterAll deletes everything
 * created here.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run diagnostics-runner-interrupted-runs.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  tenantsTable,
  mspsTable,
  mspDiagnosticRunsTable,
  portalWfRunsTable,
  portalWfOperatorTasksTable,
} from "@workspace/db";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4453-${randomUUID().slice(0, 8)}`;
const MINUTE = 60_000;

describeLive("#4453 — interrupted diagnostics runs are failed instead of reading as live forever", () => {
  let runner: typeof import("./diagnostics-runner.ts");
  let mspId: number;
  let tenantRowId: number;

  const deadRunId = randomUUID();
  const deadPendingRunId = randomUUID();
  const liveRunId = randomUUID();
  const finishedRunId = randomUUID();

  beforeAll(async () => {
    runner = await import("./diagnostics-runner.ts");

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG} MSP`, slug: TAG }).returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG} Customer`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    tenantRowId = tenant.id;

    const stale = new Date(Date.now() - runner.DIAGNOSTICS_RUN_STALE_AFTER_MS - MINUTE);
    const recent = new Date(Date.now() - MINUTE);

    await db.insert(mspDiagnosticRunsTable).values([
      // The incident's exact shape: running, zero counts, heartbeat long silent.
      { runId: deadRunId, mspId, customerId: tenantRowId, packageKey: "core:premier", status: "running", startedAt: stale, createdAt: stale, updatedAt: stale },
      // Trigger endpoint inserted the row, runDiagnostics never got to flip it.
      { runId: deadPendingRunId, mspId, customerId: tenantRowId, packageKey: "core:premier", status: "pending", createdAt: stale, updatedAt: stale },
      // A genuinely live run whose heartbeat is current.
      { runId: liveRunId, mspId, customerId: tenantRowId, packageKey: "core:premier", status: "running", startedAt: stale, createdAt: stale, updatedAt: recent },
      // Already terminal — never touched, however old.
      { runId: finishedRunId, mspId, customerId: tenantRowId, packageKey: "core:premier", status: "completed", checksTotal: 198, checksOk: 150, startedAt: stale, completedAt: stale, createdAt: stale, updatedAt: stale },
    ]);
  });

  afterAll(async () => {
    if (tenantRowId) {
      const stubRuns = await db
        .select({ runId: portalWfRunsTable.runId })
        .from(portalWfRunsTable)
        .where(eq(portalWfRunsTable.customerId, tenantRowId));
      if (stubRuns.length > 0) {
        await db.delete(portalWfOperatorTasksTable).where(inArray(portalWfOperatorTasksTable.runId, stubRuns.map((r) => r.runId)));
        await db.delete(portalWfRunsTable).where(eq(portalWfRunsTable.customerId, tenantRowId));
      }
      await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, tenantRowId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantRowId));
    }
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function row(runId: string) {
    const [r] = await db.select().from(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.runId, runId)).limit(1);
    return r!;
  }

  it("fails a running and a pending run whose heartbeat has gone silent, with the real reason", async () => {
    const count = await runner.failInterruptedDiagnosticRuns();
    expect(count).toBeGreaterThanOrEqual(2);

    for (const runId of [deadRunId, deadPendingRunId]) {
      const r = await row(runId);
      expect(r.status).toBe("failed");
      expect(r.errorMessage).toBe(runner.INTERRUPTED_RUN_ERROR_MESSAGE);
      expect(r.completedAt).not.toBeNull();
    }
  });

  it("leaves a run with a current heartbeat, and an already-terminal run, untouched", async () => {
    const live = await row(liveRunId);
    expect(live.status).toBe("running");
    expect(live.errorMessage).toBeNull();

    const finished = await row(finishedRunId);
    expect(finished.status).toBe("completed");
    expect(finished.checksOk).toBe(150);
  });

  it("raises the same operator task an in-process failure does, once per interrupted run", async () => {
    const stubRuns = await db
      .select({ input: portalWfRunsTable.inputPayload })
      .from(portalWfRunsTable)
      .where(eq(portalWfRunsTable.customerId, tenantRowId));
    const failedRunIds = stubRuns.map((r) => (r.input as { diagnosticRunId?: string }).diagnosticRunId).sort();
    expect(failedRunIds).toEqual([deadRunId, deadPendingRunId].sort());
  });

  it("is idempotent — a second sweep finds nothing of this file's left to fail", async () => {
    await runner.failInterruptedDiagnosticRuns();
    const stubRuns = await db
      .select({ runId: portalWfRunsTable.runId })
      .from(portalWfRunsTable)
      .where(eq(portalWfRunsTable.customerId, tenantRowId));
    expect(stubRuns).toHaveLength(2);
    expect((await row(liveRunId)).status).toBe("running");
  });
});
