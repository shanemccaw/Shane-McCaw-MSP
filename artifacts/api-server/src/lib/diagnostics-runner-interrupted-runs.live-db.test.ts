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

/**
 * Live-Postgres acceptance test for #4460 — Shane's decision: a tenant's very
 * first scan ever must not be left interrupted with zero completed history;
 * auto-rescan it immediately. A tenant with prior completed/partial history is
 * left to the existing scheduled-scan cadence, and a restart-loop must not
 * re-trigger the auto-rescan forever.
 *
 * runDiagnostics() is fire-and-forget here exactly as it is in production
 * (maybeAutoRescanFirstScan never awaits it) — the INSERT of the new pending
 * row happens synchronously as its first step, so polling briefly for that row
 * is enough to prove the trigger fired, without waiting for real Graph/
 * PowerShell check execution (which will fail fast against this synthetic
 * tenant's junk credentials and is irrelevant to what this test verifies).
 *
 * Synthetic identities only: `zz-test-4460-<tag>`. afterAll deletes everything
 * created here, including any real run the auto-rescan itself started.
 */
describeLive("#4460 — first-scan auto-rescan after an interrupted run", () => {
  let runner: typeof import("./diagnostics-runner.ts");
  const TAG2 = `zz-test-4460-${randomUUID().slice(0, 8)}`;
  let mspId: number;

  // Tenant A: no prior completed/partial run — its interrupted run is a genuine first scan.
  let firstScanTenantId: number;
  const firstScanInterruptedRunId = randomUUID();

  // Tenant B: has a prior completed run — its interrupted run is a routine rescan.
  let recurringTenantId: number;
  const recurringInterruptedRunId = randomUUID();
  const recurringCompletedRunId = randomUUID();

  // Tenant C: no prior completed/partial run, but already has one recent
  // interrupted auto-rescan attempt — the restart-loop guard must hold.
  let guardedTenantId: number;
  const guardedFirstInterruptedRunId = randomUUID();
  const guardedSecondInterruptedRunId = randomUUID();

  beforeAll(async () => {
    runner = await import("./diagnostics-runner.ts");

    const [msp] = await db.insert(mspsTable).values({ name: `${TAG2} MSP`, slug: TAG2 }).returning({ id: mspsTable.id });
    mspId = msp.id;

    const stale = new Date(Date.now() - runner.DIAGNOSTICS_RUN_STALE_AFTER_MS - MINUTE);
    const recentInterrupted = new Date(Date.now() - MINUTE); // inside the restart-loop guard window

    const [firstScanTenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG2} First-Scan Customer`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    firstScanTenantId = firstScanTenant.id;
    await db.insert(mspDiagnosticRunsTable).values({
      runId: firstScanInterruptedRunId,
      mspId,
      customerId: firstScanTenantId,
      packageKey: "core:premier",
      status: "running",
      startedAt: stale,
      createdAt: stale,
      updatedAt: stale,
    });

    const [recurringTenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG2} Recurring Customer`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    recurringTenantId = recurringTenant.id;
    await db.insert(mspDiagnosticRunsTable).values([
      {
        runId: recurringCompletedRunId,
        mspId,
        customerId: recurringTenantId,
        packageKey: "core:premier",
        status: "completed",
        checksTotal: 198,
        checksOk: 198,
        startedAt: stale,
        completedAt: stale,
        createdAt: stale,
        updatedAt: stale,
      },
      {
        runId: recurringInterruptedRunId,
        mspId,
        customerId: recurringTenantId,
        packageKey: "core:premier",
        status: "running",
        startedAt: stale,
        createdAt: stale,
        updatedAt: stale,
      },
    ]);

    const [guardedTenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${TAG2} Guarded Customer`, tenantId: randomUUID() })
      .returning({ id: tenantsTable.id });
    guardedTenantId = guardedTenant.id;
    await db.insert(mspDiagnosticRunsTable).values([
      // A prior auto-rescan attempt that already got interrupted, recently.
      {
        runId: guardedFirstInterruptedRunId,
        mspId,
        customerId: guardedTenantId,
        packageKey: "core:premier",
        status: "failed",
        errorMessage: runner.INTERRUPTED_RUN_ERROR_MESSAGE,
        startedAt: stale,
        completedAt: recentInterrupted,
        createdAt: stale,
        updatedAt: recentInterrupted,
      },
      // The one this sweep will fail — the guard must stop a second auto-rescan.
      {
        runId: guardedSecondInterruptedRunId,
        mspId,
        customerId: guardedTenantId,
        packageKey: "core:premier",
        status: "running",
        startedAt: stale,
        createdAt: stale,
        updatedAt: stale,
      },
    ]);
  });

  afterAll(async () => {
    for (const tid of [firstScanTenantId, recurringTenantId, guardedTenantId]) {
      if (!tid) continue;
      const stubRuns = await db
        .select({ runId: portalWfRunsTable.runId })
        .from(portalWfRunsTable)
        .where(eq(portalWfRunsTable.customerId, tid));
      if (stubRuns.length > 0) {
        await db.delete(portalWfOperatorTasksTable).where(inArray(portalWfOperatorTasksTable.runId, stubRuns.map((r) => r.runId)));
        await db.delete(portalWfRunsTable).where(eq(portalWfRunsTable.customerId, tid));
      }
      // Best-effort: also removes any real run the auto-rescan itself started,
      // orphaning its fire-and-forget background execution (non-fatal, same as
      // production's tolerance for a customer being deleted mid-scan).
      await db.delete(mspDiagnosticRunsTable).where(eq(mspDiagnosticRunsTable.customerId, tid));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, tid));
    }
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function newestRunFor(customerId: number, excludeRunIds: string[]) {
    const rows = await db
      .select()
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.customerId, customerId));
    return rows
      .filter((r) => !excludeRunIds.includes(r.runId))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  }

  async function pollUntil<T>(fn: () => Promise<T | undefined>, timeoutMs = 5000): Promise<T | undefined> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = await fn();
      if (result) return result;
      if (Date.now() >= deadline) return undefined;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  it("auto-rescans a customer whose interrupted run was genuinely their first scan ever", async () => {
    await runner.failInterruptedDiagnosticRuns();

    const failed = await db
      .select()
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.runId, firstScanInterruptedRunId));
    expect(failed[0]?.status).toBe("failed");

    const newRun = await pollUntil(() => newestRunFor(firstScanTenantId, [firstScanInterruptedRunId]));
    expect(newRun).toBeDefined();
    expect(["pending", "running", "failed", "completed", "partial"]).toContain(newRun!.status);
    expect(newRun!.packageKey).toBe("core:premier");
  }, 10_000);

  it("does not auto-rescan a customer that already has completed/partial history", async () => {
    await runner.failInterruptedDiagnosticRuns();

    const failed = await db
      .select()
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.runId, recurringInterruptedRunId));
    expect(failed[0]?.status).toBe("failed");

    // No new run beyond the two seeded ones should appear for this customer.
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await db
      .select({ runId: mspDiagnosticRunsTable.runId })
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.customerId, recurringTenantId));
    expect(rows.map((r) => r.runId).sort()).toEqual([recurringCompletedRunId, recurringInterruptedRunId].sort());
  });

  it("does not re-trigger a first-scan auto-rescan within the restart-loop guard window", async () => {
    await runner.failInterruptedDiagnosticRuns();

    const failed = await db
      .select()
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.runId, guardedSecondInterruptedRunId));
    expect(failed[0]?.status).toBe("failed");

    // Guarded: only the two seeded rows should exist for this customer — no
    // third row from a second auto-rescan attempt within the guard window.
    await new Promise((r) => setTimeout(r, 1000));
    const rows = await db
      .select({ runId: mspDiagnosticRunsTable.runId })
      .from(mspDiagnosticRunsTable)
      .where(eq(mspDiagnosticRunsTable.customerId, guardedTenantId));
    expect(rows.map((r) => r.runId).sort()).toEqual(
      [guardedFirstInterruptedRunId, guardedSecondInterruptedRunId].sort(),
    );
  });
});
