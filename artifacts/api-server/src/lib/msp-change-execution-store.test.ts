/**
 * msp-change-execution-store.test.ts — the Change Control EXECUTION store
 * (Git #1499) against the REAL local database. Every row is created under a
 * unique per-run marker (`VERIFY_TAG`) and deleted in `afterAll`, following the
 * discipline `portal-cab-store.test.ts` / `purchase-account-flow.test.ts`
 * established for DB-touching tests in this package.
 *
 * This is the end-to-end proof for the build:
 *   • a runbook execution whose crRef is written back once its run completes
 *     (`settleChangeExecutions`),
 *   • planned-vs-actual reconciliation against real `wf_run_node_outputs`,
 *   • a human action confirmed only by an attestation,
 *   • a rollback raised as a real inverse CR with its OWN #1496 approvals, and
 *   • rollback verification flipping the original change to `rolled_back`.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import {
  db,
  crExecutionsTable,
  crApprovalsTable,
  mspChangeRequestsTable,
  wfDefinitionsTable,
  wfVersionsTable,
  wfRunsTable,
  wfRunNodeOutputsTable,
} from "@workspace/db";
import {
  attestHumanAction,
  getExecution,
  listExecutionsForChange,
  raiseRollbackChangeRequest,
  reconcileExecutionPlan,
  recordExecution,
  settleChangeExecutions,
  verifyRollback,
} from "./msp-change-execution-store";

const MSP_ID = 1;
const VERIFY_TAG = `verify-1499-${Date.now()}`;
const TENANT_ID = VERIFY_TAG;

const createdCrIds: number[] = [];
const createdRunIds: number[] = [];
const createdVersionIds: number[] = [];
const createdDefinitionIds: number[] = [];

afterAll(async () => {
  if (createdCrIds.length > 0) {
    await db.delete(crExecutionsTable).where(inArray(crExecutionsTable.changeRequestId, createdCrIds));
    await db.delete(crApprovalsTable).where(inArray(crApprovalsTable.changeRequestId, createdCrIds));
    await db.delete(mspChangeRequestsTable).where(inArray(mspChangeRequestsTable.id, createdCrIds));
  }
  for (const runId of createdRunIds) {
    await db.delete(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId));
    await db.delete(wfRunsTable).where(eq(wfRunsTable.id, runId));
  }
  for (const versionId of createdVersionIds) {
    await db.delete(wfVersionsTable).where(eq(wfVersionsTable.id, versionId));
  }
  for (const definitionId of createdDefinitionIds) {
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId));
  }
});

async function makeChangeRequest(opts: { title: string; status: "completed" | "pending_approval"; snippet?: string }): Promise<number> {
  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant",
      primaryDomain: "verify.example.test",
      title: opts.title,
      description: `Verification row for #1499 (${VERIFY_TAG}).`,
      changeClass: "normal",
      riskLevel: "medium",
      category: "Identity",
      targetResource: "/verify/execution",
      psaTicketId: VERIFY_TAG,
      requestedBy: "requester@example.test",
      requestedAt: new Date().toISOString(),
      scheduledFor: "now",
      impactedUsersCount: 10,
      status: opts.status,
      backupVerified: false,
      backupHash: "verify-hash",
      preChangeSnapshot: { state: "before" },
      proposedPayload: { state: "after" },
      rollbackScriptSnippet: opts.snippet ?? "Undo-Verify",
    })
    .returning({ id: mspChangeRequestsTable.id });
  createdCrIds.push(inserted.id);
  return inserted.id;
}

/** A completed wf_run with the given per-node outcomes, for settle + reconcile. */
async function makeCompletedRun(nodes: { nodeId: string; status: "ok" | "error" | "skipped"; errorMessage?: string }[]): Promise<number> {
  const [def] = await db
    .insert(wfDefinitionsTable)
    .values({ name: `verify-1499-def-${Date.now()}-${Math.random().toString(36).slice(2)}`, description: VERIFY_TAG, metadata: {} })
    .returning({ id: wfDefinitionsTable.id });
  createdDefinitionIds.push(def.id);
  const [ver] = await db
    .insert(wfVersionsTable)
    .values({ definitionId: def.id, versionNumber: 1, label: VERIFY_TAG, status: "published", graph: { nodes: [], edges: [] } })
    .returning({ id: wfVersionsTable.id });
  createdVersionIds.push(ver.id);
  const [run] = await db
    .insert(wfRunsTable)
    .values({ definitionId: def.id, versionId: ver.id, status: "completed", payload: {}, finishedAt: new Date() })
    .returning({ id: wfRunsTable.id });
  createdRunIds.push(run.id);
  for (const n of nodes) {
    await db.insert(wfRunNodeOutputsTable).values({
      runId: run.id,
      nodeId: n.nodeId,
      input: {},
      output: {},
      status: n.status,
      errorMessage: n.errorMessage ?? null,
    });
  }
  return run.id;
}

describe("cr-execution store — runbook execution + crRef writeback", () => {
  it("writes back CR-<id> only once the bound run completes", async () => {
    const crId = await makeChangeRequest({ title: "Runbook change", status: "completed" });
    const runId = await makeCompletedRun([{ nodeId: "tpl-ca-block-legacy", status: "ok" }]);

    const exec = await recordExecution({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "runbook_run",
      wfRunId: runId,
      packKey: "verify-pack",
      plannedPlan: { packKey: "verify-pack", actions: [{ templateId: "ca.block.legacy", checkKey: null, label: "Block legacy", changeKind: "update" }] },
    });
    // Before the sweep: pending, no crRef.
    expect(exec.outcome).toBe("pending");
    expect(exec.crRef).toBeNull();

    const result = await settleChangeExecutions();
    expect(result.writtenBack).toBeGreaterThanOrEqual(1);

    const after = await getExecution(MSP_ID, exec.id);
    expect(after?.outcome).toBe("succeeded");
    expect(after?.crRef).toBe(`CR-2026-${100 + crId}`);
    expect(after?.writtenBackAt).not.toBeNull();
  });

  it("reconciles the captured plan against the run's real node outcomes", async () => {
    const crId = await makeChangeRequest({ title: "Reconcile change", status: "completed" });
    // Plan two template steps; the run only ran one of them (the other errored).
    const runId = await makeCompletedRun([
      { nodeId: "tpl-ca-block-legacy", status: "ok" },
      { nodeId: "tpl-mfa-enforce", status: "error", errorMessage: "403 forbidden" },
    ]);
    const exec = await recordExecution({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "runbook_run",
      wfRunId: runId,
      packKey: "verify-pack",
      plannedPlan: {
        packKey: "verify-pack",
        actions: [
          { templateId: "ca.block.legacy", checkKey: null, label: "Block legacy", changeKind: "update" },
          { templateId: "mfa.enforce", checkKey: null, label: "Enforce MFA", changeKind: "update" },
        ],
      },
    });

    const diff = await reconcileExecutionPlan(MSP_ID, exec.id);
    expect(diff).not.toBeNull();
    expect(diff!.matched).toBe(false);
    const mfa = diff!.steps.find((s) => s.key === "tpl-mfa-enforce");
    expect(mfa?.changed).toBe(true);

    const after = await getExecution(MSP_ID, exec.id);
    expect(after?.planMatched).toBe(false);
    expect(after?.planDiff).not.toBeNull();
    expect(after?.actualOutcome).not.toBeNull();
  });
});

describe("cr-execution store — human action attestation", () => {
  it("confirms a human action recorded WITH an attestation immediately", async () => {
    const crId = await makeChangeRequest({ title: "Human change (attested at record)", status: "completed" });
    const exec = await recordExecution({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "human_action",
      implementer: "customer",
      attestedBy: "admin@customer.test",
      attestedByPersonId: "u42",
      attestationNote: "Toggled the setting in the portal manually.",
    });
    expect(exec.outcome).toBe("succeeded");
    expect(exec.attestedAt).not.toBeNull();
    expect(exec.crRef).toBe(`CR-2026-${100 + crId}`);
  });

  it("leaves an unattested human action pending until attested, then confirms it", async () => {
    const crId = await makeChangeRequest({ title: "Human change (attested later)", status: "completed" });
    const exec = await recordExecution({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "human_action",
      implementer: "customer",
    });
    expect(exec.outcome).toBe("pending");
    expect(exec.attestedAt).toBeNull();
    expect(exec.crRef).toBeNull();

    const attested = await attestHumanAction(MSP_ID, exec.id, {
      attestedBy: "admin@customer.test",
      attestedByPersonId: "u42",
      attestationNote: null,
    });
    expect(attested?.outcome).toBe("succeeded");
    expect(attested?.attestedAt).not.toBeNull();
    expect(attested?.crRef).toBe(`CR-2026-${100 + crId}`);

    // A second attestation is refused — an attestation can never be overwritten.
    const again = await attestHumanAction(MSP_ID, exec.id, {
      attestedBy: "someone.else@customer.test",
      attestedByPersonId: "u99",
      attestationNote: null,
    });
    expect(again).toBeNull();
  });
});

describe("cr-execution store — rollback is an inverse CR", () => {
  it("raises an inverse CR with its own approvals and reverses the snapshot", async () => {
    const origId = await makeChangeRequest({ title: "Forward change to revert", status: "completed" });

    const result = await raiseRollbackChangeRequest(MSP_ID, origId, { email: "operator@msp.test", personId: "u1" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    createdCrIds.push(result.inverse.id);

    expect(result.inverse.rollbackOfChangeRequestId).toBe(origId);
    expect(result.inverse.status).toBe("pending_approval");
    // The inverse restores the original's pre-change state.
    expect(result.inverse.proposedPayload).toEqual({ state: "before" });
    expect(result.approvalsCreated).toBeGreaterThanOrEqual(1);

    const approvals = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.changeRequestId, result.inverse.id));
    expect(approvals.length).toBeGreaterThanOrEqual(1);
  });

  it("refuses to roll back a change that never completed", async () => {
    const pendingId = await makeChangeRequest({ title: "Never executed", status: "pending_approval" });
    const result = await raiseRollbackChangeRequest(MSP_ID, pendingId, { email: "operator@msp.test", personId: "u1" });
    expect(result.ok).toBe(false);
  });

  it("verifying a rollback marks the original change rolled_back", async () => {
    const origId = await makeChangeRequest({ title: "Forward change, will be rolled back", status: "completed" });
    const raised = await raiseRollbackChangeRequest(MSP_ID, origId, { email: "operator@msp.test", personId: "u1" });
    expect(raised.ok).toBe(true);
    if (!raised.ok) return;
    createdCrIds.push(raised.inverse.id);

    // The inverse CR executes (a human action here) and is then verified.
    const inverseExec = await recordExecution({
      changeRequestId: raised.inverse.id,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "human_action",
      implementer: "msp",
      attestedBy: "operator@msp.test",
      attestedByPersonId: "u1",
    });

    const verified = await verifyRollback(MSP_ID, inverseExec.id, "verified");
    expect(verified?.rollbackOutcome).toBe("verified");
    expect(verified?.rollbackVerifiedAt).not.toBeNull();

    const [orig] = await db
      .select({ status: mspChangeRequestsTable.status })
      .from(mspChangeRequestsTable)
      .where(eq(mspChangeRequestsTable.id, origId));
    expect(orig?.status).toBe("rolled_back");

    // A non-rollback execution cannot be "rollback-verified".
    const forwardExec = await recordExecution({
      changeRequestId: origId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "human_action",
      attestedBy: "x@y.test",
      attestedByPersonId: "u2",
    });
    const bad = await verifyRollback(MSP_ID, forwardExec.id, "verified");
    expect(bad).toBeNull();
  });
});

describe("cr-execution store — scoping", () => {
  it("never returns another MSP's executions", async () => {
    const crId = await makeChangeRequest({ title: "Scoped change", status: "completed" });
    const exec = await recordExecution({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      executorKind: "human_action",
      attestedBy: "a@b.test",
      attestedByPersonId: "u3",
    });
    const wrongMsp = await getExecution(MSP_ID + 99_999, exec.id);
    expect(wrongMsp).toBeNull();
    const listed = await listExecutionsForChange(MSP_ID, crId);
    expect(listed.some((e) => e.id === exec.id)).toBe(true);
  });
});
