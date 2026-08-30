/**
 * remediation-reveal-gate.test.ts — the CR gate on a customer-executed fix's
 * script (#1541).
 *
 * Two halves:
 *   1. `evaluateRevealAuthorization` / `isChangeRequestApprovedForReveal` — the
 *      PURE rule, exhaustively truth-tabled with no database.
 *   2. `findRevealCandidates` / `recordScriptReveal` — against the REAL local
 *      database, following the same discipline `portal-cab-store.test.ts`
 *      established: rows created under a unique per-run tag, deleted in
 *      `afterAll`.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, mspChangeRequestsTable, crEventsTable } from "@workspace/db";
import {
  evaluateRevealAuthorization,
  isChangeRequestApprovedForReveal,
  findRevealCandidates,
  recordScriptReveal,
  type RemediationRevealCandidate,
} from "./remediation-reveal-gate";

describe("isChangeRequestApprovedForReveal", () => {
  it("false for a rejected CR even if approvedBy is somehow set", () => {
    expect(isChangeRequestApprovedForReveal({ status: "rejected", approvedBy: "Approved by Jane" })).toBe(false);
  });

  it("false when approvedBy is null or blank", () => {
    expect(isChangeRequestApprovedForReveal({ status: "pending_approval", approvedBy: null })).toBe(false);
    expect(isChangeRequestApprovedForReveal({ status: "pending_approval", approvedBy: "   " })).toBe(false);
  });

  it("true once approvedBy is set, regardless of which non-rejected status it's in", () => {
    for (const status of ["pending_approval", "scheduled", "in_progress", "completed", "rolled_back"]) {
      expect(isChangeRequestApprovedForReveal({ status, approvedBy: "Approved by Jane" })).toBe(true);
    }
  });
});

describe("evaluateRevealAuthorization", () => {
  it("fails closed — no CR at all", () => {
    const verdict = evaluateRevealAuthorization([]);
    expect(verdict.authorized).toBe(false);
    if (!verdict.authorized) expect(verdict.reason).toMatch(/no change request/i);
  });

  it("fails closed — a CR exists but is not yet approved", () => {
    const candidates: RemediationRevealCandidate[] = [{ id: 1, status: "pending_approval", approvedBy: null }];
    const verdict = evaluateRevealAuthorization(candidates);
    expect(verdict.authorized).toBe(false);
    if (!verdict.authorized) expect(verdict.reason).toMatch(/approval is not complete/i);
  });

  it("fails closed — the only CR was rejected", () => {
    const candidates: RemediationRevealCandidate[] = [{ id: 1, status: "rejected", approvedBy: null }];
    expect(evaluateRevealAuthorization(candidates).authorized).toBe(false);
  });

  it("authorizes once a CR has cleared approval, naming that CR", () => {
    const candidates: RemediationRevealCandidate[] = [{ id: 7, status: "scheduled", approvedBy: "Approved by Jane" }];
    const verdict = evaluateRevealAuthorization(candidates);
    expect(verdict).toEqual({ authorized: true, changeRequestId: 7 });
  });

  it("stays authorized through execution and even rollback — approval, once granted, is not withdrawn by what happened after", () => {
    for (const status of ["in_progress", "completed", "rolled_back"]) {
      const verdict = evaluateRevealAuthorization([{ id: 3, status, approvedBy: "Approved by Jane" }]);
      expect(verdict).toEqual({ authorized: true, changeRequestId: 3 });
    }
  });

  it("a rejected re-raise does not block a later approved one — picks the most recent qualifying CR", () => {
    const candidates: RemediationRevealCandidate[] = [
      { id: 10, status: "rejected", approvedBy: null },
      { id: 11, status: "scheduled", approvedBy: "Approved by Jane" },
    ];
    expect(evaluateRevealAuthorization(candidates)).toEqual({ authorized: true, changeRequestId: 11 });
  });

  it("among several approved CRs for the same check, the highest id (most recently raised) wins", () => {
    const candidates: RemediationRevealCandidate[] = [
      { id: 5, status: "completed", approvedBy: "Approved by Jane" },
      { id: 9, status: "scheduled", approvedBy: "Approved by Priya" },
    ];
    expect(evaluateRevealAuthorization(candidates)).toEqual({ authorized: true, changeRequestId: 9 });
  });
});

// ── Real-DB half ──────────────────────────────────────────────────────────────

const MSP_ID = 1;
const VERIFY_TAG = `verify-1541-${Date.now()}`;
const TENANT_ID = VERIFY_TAG;
const CHECK_KEY = "identity:global-admin-count";

const createdCrIds: number[] = [];

afterAll(async () => {
  if (createdCrIds.length > 0) {
    await db.delete(crEventsTable).where(inArray(crEventsTable.changeRequestId, createdCrIds));
    await db.delete(mspChangeRequestsTable).where(inArray(mspChangeRequestsTable.id, createdCrIds));
  }
});

type StoredCrStatus = "pending_approval" | "scheduled" | "in_progress" | "completed" | "rolled_back" | "rejected";

async function makeChangeRequest(overrides: { status: StoredCrStatus; approvedBy: string | null; remediationCheckKey: string | null }) {
  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant",
      primaryDomain: "verify.example.test",
      title: "Verification row for #1541",
      description: `Verification row for #1541 (${VERIFY_TAG}).`,
      changeClass: "standard",
      riskLevel: "low",
      category: "Identity",
      targetResource: "/verify/1541",
      psaTicketId: VERIFY_TAG,
      requestedBy: "requester@example.test",
      requestedAt: new Date().toISOString(),
      scheduledFor: "Async / email vote",
      impactedUsersCount: 1,
      status: overrides.status,
      backupVerified: false,
      backupHash: "",
      rollbackScriptSnippet: "",
      approvedBy: overrides.approvedBy,
      remediationCheckKey: overrides.remediationCheckKey,
    })
    .returning({ id: mspChangeRequestsTable.id });
  createdCrIds.push(inserted.id);
  return inserted.id;
}

describe("findRevealCandidates + recordScriptReveal — real DB", () => {
  it("finds only CRs scoped to (mspId, tenantId, checkKey) — a different tenant's CR for the same check is invisible", async () => {
    const mine = await makeChangeRequest({ status: "scheduled", approvedBy: "Approved by Jane", remediationCheckKey: CHECK_KEY });
    const otherTenant = await makeChangeRequest({
      status: "scheduled",
      approvedBy: "Approved by Jane",
      remediationCheckKey: CHECK_KEY,
    });
    // Overwrite the second row's tenant to prove cross-tenant isolation.
    await db.update(mspChangeRequestsTable).set({ tenantId: `${TENANT_ID}-other` }).where(eq(mspChangeRequestsTable.id, otherTenant));

    const candidates = await findRevealCandidates({ mspId: MSP_ID, tenantId: TENANT_ID, checkKey: CHECK_KEY });
    expect(candidates.map((c) => c.id)).toEqual([mine]);
  });

  it("end to end: an approved CR for the check authorizes reveal, and recording it writes a real script_revealed cr_events row", async () => {
    const crId = await makeChangeRequest({ status: "in_progress", approvedBy: "Approved by Jane", remediationCheckKey: CHECK_KEY });

    const candidates = await findRevealCandidates({ mspId: MSP_ID, tenantId: TENANT_ID, checkKey: CHECK_KEY });
    const verdict = evaluateRevealAuthorization(candidates);
    expect(verdict).toEqual({ authorized: true, changeRequestId: crId });

    await recordScriptReveal({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      checkKey: CHECK_KEY,
      actorPersonId: "u999",
      actorName: "verify@example.test",
    });

    const events = await db.select().from(crEventsTable).where(eq(crEventsTable.changeRequestId, crId));
    expect(events).toHaveLength(1);
    expect(events[0].eventType).toBe("script_revealed");
    expect(events[0].toValue).toBe(CHECK_KEY);
    expect(events[0].actorRole).toBe("customer");

    // A second reveal (the customer re-opening the item) writes a SECOND row —
    // each reveal is its own real fact, never coalesced.
    await recordScriptReveal({
      changeRequestId: crId,
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      checkKey: CHECK_KEY,
      actorPersonId: "u999",
      actorName: "verify@example.test",
    });
    const eventsAfterSecondReveal = await db.select().from(crEventsTable).where(eq(crEventsTable.changeRequestId, crId));
    expect(eventsAfterSecondReveal).toHaveLength(2);
  });

  it("an unapproved CR for the check is a real row but does not authorize reveal", async () => {
    const crId = await makeChangeRequest({ status: "pending_approval", approvedBy: null, remediationCheckKey: CHECK_KEY });
    const candidates = await findRevealCandidates({ mspId: MSP_ID, tenantId: TENANT_ID, checkKey: CHECK_KEY });
    expect(candidates.some((c) => c.id === crId)).toBe(true);
    const verdict = evaluateRevealAuthorization(candidates.filter((c) => c.id === crId));
    expect(verdict.authorized).toBe(false);
  });
});
