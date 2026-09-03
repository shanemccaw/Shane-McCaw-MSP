/**
 * msp-change-pir-store.test.ts — the Post-Implementation Review store (Git
 * #1502) against the REAL local database. Every row is created under a unique
 * per-run marker (`VERIFY_TAG`) and deleted in `afterAll`, following the
 * discipline `msp-change-execution-store.test.ts` established for #1499.
 *
 * This is the end-to-end proof for the build:
 *   • a PIR requires a real `cr_executions` row to attach to (real FK) —
 *     recording against an unknown execution id is rejected;
 *   • a close code + summary is persisted and read back verbatim;
 *   • the drift re-scan is honestly `not_applicable` for a non-Conditional-
 *     Access change (the boundary #1497/#1502 both state, not widened here);
 *   • for a Conditional Access change it actually runs (against the real
 *     testbed tenant, so this is a genuine Graph-backed re-scan, not a mock)
 *     and records a real, non-empty verdict — `ran` or an honest `error`,
 *     never a silently-fabricated clean result;
 *   • a second PIR against an already-reviewed execution is rejected — the
 *     table is append-only, matching `cr_events`;
 *   • the `pir_recorded` `cr_events` row is appended in the same call.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, crExecutionsTable, crEventsTable, crPirsTable, mspChangeRequestsTable, tenantsTable } from "@workspace/db";
import { getPirForExecution, listPirsForChange, recordPir } from "./msp-change-pir-store";

const MSP_ID = 1;
const VERIFY_TAG = `verify-1502-${Date.now()}`;

const createdCrIds: number[] = [];
const createdExecIds: number[] = [];

afterAll(async () => {
  if (createdExecIds.length > 0) {
    await db.delete(crPirsTable).where(inArray(crPirsTable.executionId, createdExecIds));
    await db.delete(crExecutionsTable).where(inArray(crExecutionsTable.id, createdExecIds));
  }
  if (createdCrIds.length > 0) {
    await db.delete(crEventsTable).where(inArray(crEventsTable.changeRequestId, createdCrIds));
    await db.delete(mspChangeRequestsTable).where(inArray(mspChangeRequestsTable.id, createdCrIds));
  }
});

async function makeChangeRequest(opts: { title: string; category: "Identity" | "ConditionalAccess"; tenantId: string }): Promise<number> {
  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: MSP_ID,
      tenantId: opts.tenantId,
      tenantName: "VERIFY Tenant",
      primaryDomain: "verify.example.test",
      title: opts.title,
      description: `Verification row for #1502 (${VERIFY_TAG}).`,
      changeClass: "normal",
      riskLevel: "medium",
      category: opts.category,
      targetResource: "/verify/pir",
      psaTicketId: VERIFY_TAG,
      requestedBy: "requester@example.test",
      requestedAt: new Date().toISOString(),
      scheduledFor: "now",
      impactedUsersCount: 5,
      status: "completed",
      backupVerified: false,
      backupHash: "verify-hash",
      preChangeSnapshot: { state: "before" },
      proposedPayload: { state: "after" },
      rollbackScriptSnippet: "Undo-Verify",
    })
    .returning({ id: mspChangeRequestsTable.id });
  createdCrIds.push(inserted.id);
  return inserted.id;
}

async function makeExecution(changeRequestId: number, tenantId: string): Promise<number> {
  const [exec] = await db
    .insert(crExecutionsTable)
    .values({
      changeRequestId,
      mspId: MSP_ID,
      tenantId,
      executorKind: "human_action",
      implementer: "msp",
      outcome: "succeeded",
      attestedBy: "verify@example.test",
      attestedAt: new Date(),
      executedAt: new Date(),
    })
    .returning({ id: crExecutionsTable.id });
  createdExecIds.push(exec.id);
  return exec.id;
}

describe("cr-pir store — recording a Post-Implementation Review", () => {
  it("rejects a PIR against an execution that does not exist", async () => {
    const result = await recordPir({
      executionId: -999999,
      mspId: MSP_ID,
      closeCode: "successful",
      summary: "n/a",
      reviewedBy: "verify@example.test",
      reviewedByPersonId: null,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("execution_not_found");
  });

  it("records a PIR with drift re-scan honestly not_applicable for a non-Conditional-Access category", async () => {
    const crId = await makeChangeRequest({ title: "Identity PIR", category: "Identity", tenantId: VERIFY_TAG });
    const execId = await makeExecution(crId, VERIFY_TAG);

    const result = await recordPir({
      executionId: execId,
      mspId: MSP_ID,
      closeCode: "successful",
      summary: "Verified the identity change landed as intended.",
      reviewedBy: "verify@example.test",
      reviewedByPersonId: "u1",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pir.closeCode).toBe("successful");
    expect(result.pir.summary).toBe("Verified the identity change landed as intended.");
    expect(result.pir.driftRescanApplicable).toBe(false);
    expect(result.pir.driftRescanStatus).toBe("not_applicable");
    expect(result.pir.driftRescanNote).toContain("Conditional Access");

    // Read back via the accessor.
    const fetched = await getPirForExecution(MSP_ID, execId);
    expect(fetched?.id).toBe(result.pir.id);

    const forChange = await listPirsForChange(MSP_ID, crId);
    expect(forChange.map((p) => p.id)).toContain(result.pir.id);

    // The append-only cr_events row.
    const [event] = await db
      .select()
      .from(crEventsTable)
      .where(eq(crEventsTable.changeRequestId, crId))
      .limit(1);
    expect(event?.eventType).toBe("pir_recorded");
    expect(event?.toValue).toBe("successful");
  });

  it("rejects a second PIR against an already-reviewed execution", async () => {
    const crId = await makeChangeRequest({ title: "Double-review PIR", category: "Identity", tenantId: VERIFY_TAG });
    const execId = await makeExecution(crId, VERIFY_TAG);

    const first = await recordPir({
      executionId: execId,
      mspId: MSP_ID,
      closeCode: "successful",
      summary: "First review.",
      reviewedBy: "verify@example.test",
      reviewedByPersonId: null,
    });
    expect(first.ok).toBe(true);

    const second = await recordPir({
      executionId: execId,
      mspId: MSP_ID,
      closeCode: "failed",
      summary: "A second attempt to review the same execution.",
      reviewedBy: "verify@example.test",
      reviewedByPersonId: null,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_reviewed");
  });

  it("actually runs the drift re-scan for a Conditional Access change against the real testbed tenant", async () => {
    const [testbed] = await db
      .select({ tenantId: tenantsTable.tenantId })
      .from(tenantsTable)
      .where(eq(tenantsTable.isTestbed, true))
      .limit(1);
    // Honest skip, not a fabricated pass, if this environment has no testbed row.
    if (!testbed?.tenantId) {
      expect(testbed).toBeUndefined();
      return;
    }

    const crId = await makeChangeRequest({ title: "CA PIR", category: "ConditionalAccess", tenantId: testbed.tenantId });
    const execId = await makeExecution(crId, testbed.tenantId);

    const result = await recordPir({
      executionId: execId,
      mspId: MSP_ID,
      closeCode: "successful",
      summary: "Verified the Conditional Access change against a fresh re-scan.",
      reviewedBy: "verify@example.test",
      reviewedByPersonId: null,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.pir.driftRescanApplicable).toBe(true);
    expect(result.pir.driftRescanDomainKey).toBe("ca-policy");
    expect(result.pir.driftRescanCheckKey).toBe("identity:ca-policy-count");
    // A real attempt was made — either it ran and recorded counts, or it
    // failed and the real error is in the note. Never silently unattempted.
    expect(["ran", "error"]).toContain(result.pir.driftRescanStatus);
    expect(result.pir.driftRescanNote).toBeTruthy();
    expect(result.pir.driftRescanRanAt).not.toBeNull();
  }, 60_000);
});
