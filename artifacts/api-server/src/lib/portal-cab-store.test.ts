/**
 * portal-cab-store.test.ts — the CAB store (Git #1501) against the REAL local
 * database. All rows are created under a unique per-run marker (`VERIFY_TAG`)
 * and deleted in `afterAll`, following the same discipline
 * `purchase-account-flow.test.ts` established for DB-touching tests in this
 * package.
 *
 * This is the end-to-end proof for the build: membership, a normal change on
 * a CAB agenda, an emergency change on an ECAB agenda (retroactive), a
 * recorded decision that lands in the REAL `cr_approvals` ledger (#1496, not
 * a second model), and a closed meeting with compiled minutes.
 */

import { describe, it, expect, afterAll } from "vitest";
import { eq, inArray } from "drizzle-orm";

import { db, mspChangeRequestsTable, cabAgendaItemsTable, cabMembersTable, cabMeetingsTable, crApprovalsTable } from "@workspace/db";
import { materializeApprovalsForChange } from "./portal-change-approvals-store";
import {
  addAgendaItem,
  addOrUpdateMember,
  closeMeeting,
  eligibleChangesForAgenda,
  recordAgendaDecision,
  removeMember,
  scheduleMeeting,
  startMeeting,
  type ApproverIdentity,
} from "./portal-cab-store";

const MSP_ID = 1;
const VERIFY_TAG = `verify-1501-${Date.now()}`;
const TENANT_ID = VERIFY_TAG;

const createdCrIds: number[] = [];
const createdMeetingIds: number[] = [];
const createdMemberIds: number[] = [];

afterAll(async () => {
  for (const meetingId of createdMeetingIds) {
    await db.delete(cabAgendaItemsTable).where(eq(cabAgendaItemsTable.meetingId, meetingId));
    await db.delete(cabMeetingsTable).where(eq(cabMeetingsTable.id, meetingId));
  }
  if (createdCrIds.length > 0) {
    await db.delete(crApprovalsTable).where(inArray(crApprovalsTable.changeRequestId, createdCrIds));
    await db.delete(mspChangeRequestsTable).where(inArray(mspChangeRequestsTable.id, createdCrIds));
  }
  for (const memberId of createdMemberIds) {
    await db.delete(cabMembersTable).where(eq(cabMembersTable.id, memberId));
  }
});

async function makeChangeRequest(overrides: {
  title: string;
  changeClass: "standard" | "normal" | "emergency";
  riskLevel: "critical" | "high" | "medium" | "low";
  status: "pending_approval" | "in_progress";
}) {
  const [inserted] = await db
    .insert(mspChangeRequestsTable)
    .values({
      mspId: MSP_ID,
      tenantId: TENANT_ID,
      tenantName: "VERIFY Tenant",
      primaryDomain: "verify.example.test",
      title: overrides.title,
      description: `Verification row for #1501 (${VERIFY_TAG}).`,
      changeClass: overrides.changeClass,
      riskLevel: overrides.riskLevel,
      category: "Identity",
      targetResource: `/verify/${overrides.changeClass}`,
      psaTicketId: VERIFY_TAG,
      requestedBy: "requester@example.test",
      requestedAt: new Date().toISOString(),
      scheduledFor: "Async / email vote",
      impactedUsersCount: overrides.riskLevel === "high" ? 500 : 10,
      status: overrides.status,
      backupVerified: false,
      backupHash: "",
    })
    .returning({ id: mspChangeRequestsTable.id, createdAt: mspChangeRequestsTable.createdAt });
  createdCrIds.push(inserted.id);
  await materializeApprovalsForChange({
    id: inserted.id,
    mspId: MSP_ID,
    tenantId: TENANT_ID,
    changeClass: overrides.changeClass,
    riskLevel: overrides.riskLevel,
    status: overrides.status,
    approvedBy: null,
    requestedBy: "requester@example.test",
    createdAt: inserted.createdAt,
  });
  return inserted.id;
}

describe("portal-cab-store — membership", () => {
  it("adds a member, and re-adding the same person updates rather than duplicates", async () => {
    const first = await addOrUpdateMember(MSP_ID, {
      personId: `u-${VERIFY_TAG}-chair`,
      name: "VERIFY Chair",
      email: "verify-chair@example.test",
      role: "chair",
      side: "msp",
      tenantId: null,
      isEcab: true,
    });
    createdMemberIds.push(first.id);

    const second = await addOrUpdateMember(MSP_ID, {
      personId: `u-${VERIFY_TAG}-chair`,
      name: "VERIFY Chair (renamed)",
      email: "verify-chair@example.test",
      role: "chair",
      side: "msp",
      tenantId: null,
      isEcab: true,
    });
    expect(second.id).toBe(first.id);
    expect(second.name).toBe("VERIFY Chair (renamed)");
  });

  it("soft-removes a member (active=false), leaving the row for history", async () => {
    const member = await addOrUpdateMember(MSP_ID, {
      personId: `u-${VERIFY_TAG}-custrep`,
      name: "VERIFY Customer Rep",
      email: "verify-customer@example.test",
      role: "advisory",
      side: "customer",
      tenantId: TENANT_ID,
      isEcab: false,
    });
    createdMemberIds.push(member.id);
    const removed = await removeMember(MSP_ID, member.id);
    expect(removed).toBe(true);
    // Removing again fails — it's no longer an active member to remove.
    expect(await removeMember(MSP_ID, member.id)).toBe(false);
  });
});

describe("portal-cab-store — agenda eligibility structurally excludes standard changes", () => {
  it("a normal change is CAB-eligible, a standard change never is, an emergency change is ECAB-eligible", async () => {
    const normalId = await makeChangeRequest({ title: `VERIFY normal ${VERIFY_TAG}`, changeClass: "normal", riskLevel: "medium", status: "pending_approval" });
    const standardId = await makeChangeRequest({ title: `VERIFY standard ${VERIFY_TAG}`, changeClass: "standard", riskLevel: "low", status: "pending_approval" });
    const emergencyId = await makeChangeRequest({ title: `VERIFY emergency ${VERIFY_TAG}`, changeClass: "emergency", riskLevel: "high", status: "in_progress" });

    const cabEligible = await eligibleChangesForAgenda(MSP_ID, "cab");
    const ecabEligible = await eligibleChangesForAgenda(MSP_ID, "ecab");

    expect(cabEligible.some((c) => c.id === normalId)).toBe(true);
    expect(cabEligible.some((c) => c.id === standardId)).toBe(false);
    expect(ecabEligible.some((c) => c.id === emergencyId)).toBe(true);
  });
});

describe("portal-cab-store — meeting -> agenda -> recorded decision -> minutes, and ECAB retroactive", () => {
  const approver: ApproverIdentity = {
    personId: `u-${VERIFY_TAG}-operator`,
    name: "VERIFY Operator",
    email: "verify-operator@example.test",
    customerId: 0,
    role: "msp",
  };

  it("a standard change cannot be added to a CAB agenda even if attempted directly", async () => {
    const standardId = await makeChangeRequest({ title: `VERIFY standard guard ${VERIFY_TAG}`, changeClass: "standard", riskLevel: "low", status: "pending_approval" });
    const meeting = await scheduleMeeting(MSP_ID, {
      meetingType: "cab",
      scheduledFor: new Date(),
      chairPersonId: null,
      chairName: "VERIFY Chair",
      location: "Teams call",
      notes: VERIFY_TAG,
    });
    createdMeetingIds.push(meeting.id);

    const attempt = await addAgendaItem(MSP_ID, meeting.id, standardId, "should be refused");
    expect(attempt.ok).toBe(false);
    if (!attempt.ok) expect(attempt.error).toMatch(/pre-approved|catalog/i);
  });

  it("records a CAB decision through the real #1496 ledger and compiles minutes on close", async () => {
    const normalId = await makeChangeRequest({ title: `VERIFY decide ${VERIFY_TAG}`, changeClass: "normal", riskLevel: "medium", status: "pending_approval" });
    const meeting = await scheduleMeeting(MSP_ID, {
      meetingType: "cab",
      scheduledFor: new Date(),
      chairPersonId: null,
      chairName: "VERIFY Chair",
      location: "Teams call",
      notes: VERIFY_TAG,
    });
    createdMeetingIds.push(meeting.id);
    await startMeeting(MSP_ID, meeting.id);

    const added = await addAgendaItem(MSP_ID, meeting.id, normalId, "VERIFY presenter");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.item.isRetroactive).toBe(false);

    const decided = await recordAgendaDecision(MSP_ID, added.item.id, "approve", approver, "Looks good.");
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;
    expect(decided.item.crApprovalId).not.toBeNull();

    // The decision really landed in cr_approvals — one ledger, not a second model.
    const [ledgerRow] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, decided.item.crApprovalId!)).limit(1);
    expect(ledgerRow?.decision).toBe("approved");
    expect(ledgerRow?.approverRole).toBe("msp");
    expect(ledgerRow?.approverName).toBe("VERIFY Operator");

    const closed = await closeMeeting(MSP_ID, meeting.id);
    expect(closed.ok).toBe(true);
    if (!closed.ok) return;
    expect(closed.meeting.status).toBe("completed");
    expect(closed.meeting.minutes).toContain("Change Advisory Board (CAB)");
    expect(closed.meeting.minutes).toContain("APPROVE");
  });

  it("an ECAB agenda item is retroactive, and its approval still lands in cr_approvals", async () => {
    const emergencyId = await makeChangeRequest({ title: `VERIFY ecab ${VERIFY_TAG}`, changeClass: "emergency", riskLevel: "high", status: "in_progress" });
    const meeting = await scheduleMeeting(MSP_ID, {
      meetingType: "ecab",
      scheduledFor: new Date(),
      chairPersonId: null,
      chairName: "VERIFY Chair",
      location: "Async / email vote",
      notes: VERIFY_TAG,
    });
    createdMeetingIds.push(meeting.id);
    await startMeeting(MSP_ID, meeting.id);

    const added = await addAgendaItem(MSP_ID, meeting.id, emergencyId, "VERIFY presenter");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(added.item.isRetroactive).toBe(true);

    const decided = await recordAgendaDecision(MSP_ID, added.item.id, "approve", approver, "Retroactively approved.");
    expect(decided.ok).toBe(true);
    if (!decided.ok) return;

    const [ledgerRow] = await db.select().from(crApprovalsTable).where(eq(crApprovalsTable.id, decided.item.crApprovalId!)).limit(1);
    expect(ledgerRow?.decision).toBe("approved");
  });
});
