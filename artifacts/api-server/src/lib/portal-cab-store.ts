/**
 * portal-cab-store.ts — the DB side of the Change Advisory Board (Git #1501).
 * The pure rules live in `portal-cab.ts`; this is where they touch
 * `cab_members`, `cab_meetings`, `cab_agenda_items`, and — for the one thing a
 * CAB actually decides — the #1496 approval ledger (`cr_approvals`) via
 * `portal-change-approvals-store.ts` / `portal-change-rejection.ts`. No second
 * approval model is written here; see the header of `portal-cab.ts`.
 */

import {
  db,
  cabAgendaItemsTable,
  cabMembersTable,
  cabMeetingsTable,
  crApprovalsTable,
  mspChangeRequestsTable,
  type CabAgendaItem,
  type CabMeeting,
  type CabMeetingType,
  type CabMember,
  type CabMemberRole,
  type CabMemberSide,
} from "@workspace/db";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";

import { nextPendingStage } from "./portal-change-approvals";
import { recordApproval, type ApproverIdentity, type CrEssentials } from "./portal-change-approvals-store";
import { recordRejection } from "./portal-change-rejection";
import { formatChangeRequestCode } from "./portal-change-control";
import { buildMinutes, isMeetingOpen, isRetroactiveForMeetingType, meetingTypeForChangeClass, type MinutesAgendaLine } from "./portal-cab";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

// ── Membership ────────────────────────────────────────────────────────────────

export interface AddMemberInput {
  readonly personId: string;
  readonly name: string;
  readonly email: string;
  readonly role: CabMemberRole;
  readonly side: CabMemberSide;
  readonly tenantId: string | null;
  readonly isEcab: boolean;
}

/**
 * Add a member, or reactivate/update the caller's existing ACTIVE row for the
 * same person. Idempotent by design: re-adding someone already on the board
 * edits their standing membership rather than erroring on the partial unique
 * index (`cab_members_msp_person_active_unique`).
 */
export async function addOrUpdateMember(mspId: number, input: AddMemberInput): Promise<CabMember> {
  const [existing] = await db
    .select({ id: cabMembersTable.id })
    .from(cabMembersTable)
    .where(and(eq(cabMembersTable.mspId, mspId), eq(cabMembersTable.personId, input.personId), eq(cabMembersTable.active, true)))
    .limit(1);

  const now = new Date();
  if (existing) {
    const [updated] = await db
      .update(cabMembersTable)
      .set({
        name: input.name,
        email: input.email,
        role: input.role,
        side: input.side,
        tenantId: input.tenantId,
        isEcab: input.isEcab,
        updatedAt: now,
      })
      .where(eq(cabMembersTable.id, existing.id))
      .returning();
    return updated;
  }

  const [inserted] = await db
    .insert(cabMembersTable)
    .values({
      mspId,
      personId: input.personId,
      name: input.name,
      email: input.email,
      role: input.role,
      side: input.side,
      tenantId: input.tenantId,
      isEcab: input.isEcab,
    })
    .returning();
  log.info({ mspId, memberId: inserted.id, personId: input.personId }, "cab: member added");
  return inserted;
}

/** Soft-remove: sets active=false so history (past meetings this person chaired/decided at) is never orphaned. */
export async function removeMember(mspId: number, memberId: number): Promise<boolean> {
  const now = new Date();
  const [row] = await db
    .update(cabMembersTable)
    .set({ active: false, removedAt: now, updatedAt: now })
    .where(and(eq(cabMembersTable.id, memberId), eq(cabMembersTable.mspId, mspId), eq(cabMembersTable.active, true)))
    .returning({ id: cabMembersTable.id });
  if (row) log.info({ mspId, memberId }, "cab: member removed");
  return row !== undefined;
}

export async function listMembers(mspId: number, opts: { activeOnly?: boolean; ecabOnly?: boolean } = {}): Promise<CabMember[]> {
  const conditions = [eq(cabMembersTable.mspId, mspId)];
  if (opts.activeOnly) conditions.push(eq(cabMembersTable.active, true));
  if (opts.ecabOnly) conditions.push(eq(cabMembersTable.isEcab, true));
  return db
    .select()
    .from(cabMembersTable)
    .where(and(...conditions))
    .orderBy(asc(cabMembersTable.name));
}

// ── Meetings ─────────────────────────────────────────────────────────────────

export interface ScheduleMeetingInput {
  readonly meetingType: CabMeetingType;
  readonly scheduledFor: Date;
  readonly chairPersonId: string | null;
  readonly chairName: string;
  readonly location: string;
  readonly notes: string;
}

export async function scheduleMeeting(mspId: number, input: ScheduleMeetingInput): Promise<CabMeeting> {
  const [inserted] = await db
    .insert(cabMeetingsTable)
    .values({
      mspId,
      meetingType: input.meetingType,
      scheduledFor: input.scheduledFor,
      chairPersonId: input.chairPersonId,
      chairName: input.chairName,
      location: input.location,
      notes: input.notes,
    })
    .returning();
  log.info({ mspId, meetingId: inserted.id, meetingType: input.meetingType }, "cab: meeting scheduled");
  return inserted;
}

export async function listMeetings(mspId: number): Promise<CabMeeting[]> {
  return db.select().from(cabMeetingsTable).where(eq(cabMeetingsTable.mspId, mspId)).orderBy(desc(cabMeetingsTable.scheduledFor));
}

export async function getMeeting(mspId: number, meetingId: number): Promise<CabMeeting | null> {
  const [row] = await db
    .select()
    .from(cabMeetingsTable)
    .where(and(eq(cabMeetingsTable.id, meetingId), eq(cabMeetingsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

export async function startMeeting(mspId: number, meetingId: number): Promise<CabMeeting | null> {
  const now = new Date();
  const [row] = await db
    .update(cabMeetingsTable)
    .set({ status: "in_progress", heldAt: now, updatedAt: now })
    .where(and(eq(cabMeetingsTable.id, meetingId), eq(cabMeetingsTable.mspId, mspId), eq(cabMeetingsTable.status, "scheduled")))
    .returning();
  return row ?? null;
}

export async function cancelMeeting(mspId: number, meetingId: number): Promise<CabMeeting | null> {
  const now = new Date();
  const [row] = await db
    .update(cabMeetingsTable)
    .set({ status: "cancelled", updatedAt: now })
    .where(
      and(
        eq(cabMeetingsTable.id, meetingId),
        eq(cabMeetingsTable.mspId, mspId),
        ne(cabMeetingsTable.status, "completed"),
        ne(cabMeetingsTable.status, "cancelled"),
      ),
    )
    .returning();
  return row ?? null;
}

export type CloseMeetingOutcome =
  | { readonly ok: true; readonly meeting: CabMeeting }
  | { readonly ok: false; readonly code: 404 | 409; readonly error: string };

/** Closes the meeting and compiles its minutes from the agenda's own recommendations — the "recorded decisions -> minutes" step. */
export async function closeMeeting(mspId: number, meetingId: number): Promise<CloseMeetingOutcome> {
  const meeting = await getMeeting(mspId, meetingId);
  if (!meeting) return { ok: false, code: 404, error: "Meeting not found" };
  if (meeting.status === "completed" || meeting.status === "cancelled") {
    return { ok: false, code: 409, error: "This meeting is already closed" };
  }

  const { items } = await listAgendaWithChanges(mspId, meetingId);
  if (items.some((i) => i.row.recommendation === null)) {
    return { ok: false, code: 409, error: "Every agenda item needs a recommendation (approve, reject, or defer) before the meeting can close" };
  }

  const minutesLines: MinutesAgendaLine[] = items.map((i) => ({
    ordinal: i.row.ordinal,
    change: i.change,
    presenterName: i.row.presenterName,
    discussionNotes: i.row.discussionNotes,
    recommendation: i.row.recommendation,
    isRetroactive: i.row.isRetroactive,
  }));
  const minutes = buildMinutes(meeting, minutesLines);

  const now = new Date();
  const [updated] = await db
    .update(cabMeetingsTable)
    .set({ status: "completed", closedAt: now, minutes, updatedAt: now })
    .where(eq(cabMeetingsTable.id, meetingId))
    .returning();
  log.info({ mspId, meetingId, itemCount: items.length }, "cab: meeting closed, minutes compiled");
  return { ok: true, meeting: updated };
}

// ── Agenda ───────────────────────────────────────────────────────────────────

interface EligibleChange {
  readonly id: number;
  readonly code: string;
  readonly title: string;
  readonly tenantId: string;
  readonly riskLevel: string;
}

/**
 * Candidate changes for a meeting's agenda: this MSP's changes of the class
 * the meeting type takes (normal → cab, emergency → ecab) that still have a
 * PENDING slot in the #1496 ledger — the structural definition that keeps
 * standard changes off every agenda (see `portal-cab.ts`'s header) — and are
 * not already sitting on another still-open meeting's agenda.
 */
export async function eligibleChangesForAgenda(mspId: number, meetingType: CabMeetingType): Promise<EligibleChange[]> {
  const wantedClass = meetingType === "ecab" ? "emergency" : "normal";

  const crs = await db
    .select({
      id: mspChangeRequestsTable.id,
      title: mspChangeRequestsTable.title,
      tenantId: mspChangeRequestsTable.tenantId,
      riskLevel: mspChangeRequestsTable.riskLevel,
      status: mspChangeRequestsTable.status,
    })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.mspId, mspId), eq(mspChangeRequestsTable.changeClass, wantedClass)));
  if (crs.length === 0) return [];

  const crIds = crs.map((c) => c.id);
  const approvalRows = await db
    .select({ changeRequestId: crApprovalsTable.changeRequestId, decision: crApprovalsTable.decision })
    .from(crApprovalsTable)
    .where(inArray(crApprovalsTable.changeRequestId, crIds));
  const pendingIds = new Set(approvalRows.filter((a) => a.decision === "pending").map((a) => a.changeRequestId));

  const openAgendaRows = await db
    .select({ changeRequestId: cabAgendaItemsTable.changeRequestId })
    .from(cabAgendaItemsTable)
    .innerJoin(cabMeetingsTable, eq(cabAgendaItemsTable.meetingId, cabMeetingsTable.id))
    .where(
      and(
        eq(cabMeetingsTable.mspId, mspId),
        inArray(cabMeetingsTable.status, ["scheduled", "in_progress"]),
        inArray(cabAgendaItemsTable.changeRequestId, crIds),
      ),
    );
  const alreadyAgendaed = new Set(openAgendaRows.map((r) => r.changeRequestId));

  return crs
    .filter((c) => c.status !== "rejected" && pendingIds.has(c.id) && !alreadyAgendaed.has(c.id))
    .map((c) => ({ id: c.id, code: formatChangeRequestCode(c.id), title: c.title, tenantId: c.tenantId, riskLevel: c.riskLevel }));
}

export type AddAgendaItemOutcome =
  | { readonly ok: true; readonly item: CabAgendaItem }
  | { readonly ok: false; readonly code: 400 | 404 | 409; readonly error: string };

export async function addAgendaItem(
  mspId: number,
  meetingId: number,
  changeRequestId: number,
  presenterName: string,
): Promise<AddAgendaItemOutcome> {
  const meeting = await getMeeting(mspId, meetingId);
  if (!meeting) return { ok: false, code: 404, error: "Meeting not found" };
  if (!isMeetingOpen(meeting.status)) return { ok: false, code: 409, error: "This meeting is closed and cannot take new agenda items" };

  const [cr] = await db
    .select({
      id: mspChangeRequestsTable.id,
      tenantId: mspChangeRequestsTable.tenantId,
      changeClass: mspChangeRequestsTable.changeClass,
    })
    .from(mspChangeRequestsTable)
    .where(and(eq(mspChangeRequestsTable.id, changeRequestId), eq(mspChangeRequestsTable.mspId, mspId)))
    .limit(1);
  if (!cr) return { ok: false, code: 404, error: "Change request not found" };

  if (cr.changeClass === "standard") {
    return { ok: false, code: 400, error: "Standard changes are pre-approved by the catalog and never go on a CAB agenda" };
  }
  if (meetingTypeForChangeClass(cr.changeClass as "normal" | "emergency") !== meeting.meetingType) {
    return {
      ok: false,
      code: 400,
      error: `A ${cr.changeClass} change belongs on the ${meetingTypeForChangeClass(cr.changeClass as "normal" | "emergency")} agenda, not ${meeting.meetingType}`,
    };
  }

  const pendingRows = await db
    .select({ stage: crApprovalsTable.stage, decision: crApprovalsTable.decision })
    .from(crApprovalsTable)
    .where(eq(crApprovalsTable.changeRequestId, changeRequestId));
  if (nextPendingStage(pendingRows) === null) {
    return { ok: false, code: 409, error: "This change has no pending approval — nothing for the board to decide" };
  }

  const existingOrdinals = await db
    .select({ ordinal: cabAgendaItemsTable.ordinal })
    .from(cabAgendaItemsTable)
    .where(eq(cabAgendaItemsTable.meetingId, meetingId))
    .orderBy(desc(cabAgendaItemsTable.ordinal))
    .limit(1);
  const nextOrdinal = (existingOrdinals[0]?.ordinal ?? 0) + 1;

  try {
    const [inserted] = await db
      .insert(cabAgendaItemsTable)
      .values({
        meetingId,
        changeRequestId,
        mspId,
        tenantId: cr.tenantId,
        ordinal: nextOrdinal,
        presenterName,
        isRetroactive: isRetroactiveForMeetingType(meeting.meetingType),
      })
      .returning();
    log.info({ mspId, meetingId, changeRequestId, agendaItemId: inserted.id }, "cab: agenda item added");
    return { ok: true, item: inserted };
  } catch (err) {
    // Unique (meetingId, changeRequestId) violation — already on this agenda.
    log.warn({ err, mspId, meetingId, changeRequestId }, "cab: agenda item insert failed (likely already on agenda)");
    return { ok: false, code: 409, error: "This change is already on this meeting's agenda" };
  }
}

export async function updateAgendaItemNotes(
  mspId: number,
  agendaItemId: number,
  input: { presenterName?: string; discussionNotes?: string },
): Promise<CabAgendaItem | null> {
  const now = new Date();
  const set: Partial<typeof cabAgendaItemsTable.$inferInsert> = { updatedAt: now };
  if (input.presenterName !== undefined) set.presenterName = input.presenterName;
  if (input.discussionNotes !== undefined) set.discussionNotes = input.discussionNotes;
  const [row] = await db
    .update(cabAgendaItemsTable)
    .set(set)
    .where(and(eq(cabAgendaItemsTable.id, agendaItemId), eq(cabAgendaItemsTable.mspId, mspId)))
    .returning();
  return row ?? null;
}

export interface AgendaItemWithChange {
  readonly row: CabAgendaItem;
  readonly change: { readonly code: string; readonly title: string };
}

export async function listAgendaWithChanges(mspId: number, meetingId: number): Promise<{ items: AgendaItemWithChange[] }> {
  const rows = await db
    .select()
    .from(cabAgendaItemsTable)
    .where(and(eq(cabAgendaItemsTable.meetingId, meetingId), eq(cabAgendaItemsTable.mspId, mspId)))
    .orderBy(asc(cabAgendaItemsTable.ordinal));
  if (rows.length === 0) return { items: [] };

  const crIds = rows.map((r) => r.changeRequestId);
  const crs = await db
    .select({ id: mspChangeRequestsTable.id, title: mspChangeRequestsTable.title })
    .from(mspChangeRequestsTable)
    .where(inArray(mspChangeRequestsTable.id, crIds));
  const byId = new Map(crs.map((c) => [c.id, c.title]));

  return {
    items: rows.map((row) => ({
      row,
      change: { code: formatChangeRequestCode(row.changeRequestId), title: byId.get(row.changeRequestId) ?? "(change not found)" },
    })),
  };
}

export type AgendaDecisionOutcome =
  | { readonly ok: true; readonly item: CabAgendaItem; readonly complete: boolean }
  | { readonly ok: false; readonly code: 400 | 403 | 404 | 409; readonly error: string };

/**
 * Record the board's decision on an agenda item. This is the one place the
 * CAB touches `cr_approvals` — via the SAME `recordApproval` / `recordRejection`
 * the customer register uses, so there is exactly one approval ledger in the
 * system regardless of which surface produced the decision.
 */
export async function recordAgendaDecision(
  mspId: number,
  agendaItemId: number,
  decision: "approve" | "reject",
  approver: ApproverIdentity,
  note: string,
): Promise<AgendaDecisionOutcome> {
  const [item] = await db
    .select()
    .from(cabAgendaItemsTable)
    .where(and(eq(cabAgendaItemsTable.id, agendaItemId), eq(cabAgendaItemsTable.mspId, mspId)))
    .limit(1);
  if (!item) return { ok: false, code: 404, error: "Agenda item not found" };
  if (item.recommendation !== null) return { ok: false, code: 409, error: "This agenda item already has a recorded recommendation" };

  const meeting = await getMeeting(mspId, item.meetingId);
  if (!meeting || !isMeetingOpen(meeting.status)) {
    return { ok: false, code: 409, error: "This meeting is closed — decisions can only be recorded while it is open" };
  }

  const [cr] = await db
    .select({
      id: mspChangeRequestsTable.id,
      mspId: mspChangeRequestsTable.mspId,
      tenantId: mspChangeRequestsTable.tenantId,
      changeClass: mspChangeRequestsTable.changeClass,
      riskLevel: mspChangeRequestsTable.riskLevel,
      status: mspChangeRequestsTable.status,
      approvedBy: mspChangeRequestsTable.approvedBy,
      requestedBy: mspChangeRequestsTable.requestedBy,
      createdAt: mspChangeRequestsTable.createdAt,
      sourceKind: mspChangeRequestsTable.sourceKind,
    })
    .from(mspChangeRequestsTable)
    .where(eq(mspChangeRequestsTable.id, item.changeRequestId))
    .limit(1);
  if (!cr) return { ok: false, code: 404, error: "The change this agenda item refers to no longer exists" };

  const crEssentials: CrEssentials = cr;
  const now = new Date();

  if (decision === "approve") {
    const result = await recordApproval(crEssentials, approver, note || null);
    if (!result.ok) return { ok: false, code: result.code, error: result.error };
    const [approvalRow] = await db
      .select({ id: crApprovalsTable.id })
      .from(crApprovalsTable)
      .where(and(eq(crApprovalsTable.changeRequestId, cr.id), eq(crApprovalsTable.stage, result.stage), eq(crApprovalsTable.decision, "approved")))
      .orderBy(desc(crApprovalsTable.updatedAt))
      .limit(1);
    const [updated] = await db
      .update(cabAgendaItemsTable)
      .set({ recommendation: "approve", decidedAt: now, crApprovalId: approvalRow?.id ?? null, updatedAt: now })
      .where(eq(cabAgendaItemsTable.id, agendaItemId))
      .returning();
    log.info({ mspId, agendaItemId, changeRequestId: cr.id, complete: result.complete }, "cab: agenda item approved");
    return { ok: true, item: updated, complete: result.complete };
  }

  const result = await recordRejection(crEssentials, approver, note || "Rejected by the Change Advisory Board.");
  if (!result.ok) return { ok: false, code: result.code, error: result.error };
  const [approvalRow] = await db
    .select({ id: crApprovalsTable.id })
    .from(crApprovalsTable)
    .where(and(eq(crApprovalsTable.changeRequestId, cr.id), eq(crApprovalsTable.decision, "rejected")))
    .orderBy(desc(crApprovalsTable.updatedAt))
    .limit(1);
  const [updated] = await db
    .update(cabAgendaItemsTable)
    .set({ recommendation: "reject", decidedAt: now, crApprovalId: approvalRow?.id ?? null, updatedAt: now })
    .where(eq(cabAgendaItemsTable.id, agendaItemId))
    .returning();
  log.info({ mspId, agendaItemId, changeRequestId: cr.id, riskDecisionId: result.riskDecisionId }, "cab: agenda item rejected");
  return { ok: true, item: updated, complete: true };
}

export type DeferAgendaItemOutcome =
  | { readonly ok: true; readonly item: CabAgendaItem }
  | { readonly ok: false; readonly code: 404 | 409; readonly error: string };

/**
 * Defer decides nothing about the change — `cr_approvals` is untouched, the
 * change stays pending, and this item is rolled to a future meeting for the
 * board to actually decide.
 */
export async function deferAgendaItem(mspId: number, agendaItemId: number, deferredToMeetingId: number | null): Promise<DeferAgendaItemOutcome> {
  const [item] = await db
    .select()
    .from(cabAgendaItemsTable)
    .where(and(eq(cabAgendaItemsTable.id, agendaItemId), eq(cabAgendaItemsTable.mspId, mspId)))
    .limit(1);
  if (!item) return { ok: false, code: 404, error: "Agenda item not found" };
  if (item.recommendation !== null) return { ok: false, code: 409, error: "This agenda item already has a recorded recommendation" };

  if (deferredToMeetingId !== null) {
    const target = await getMeeting(mspId, deferredToMeetingId);
    if (!target || !isMeetingOpen(target.status)) {
      return { ok: false, code: 409, error: "The meeting to defer to must exist and still be open" };
    }
  }

  const now = new Date();
  const [updated] = await db
    .update(cabAgendaItemsTable)
    .set({ recommendation: "defer", decidedAt: now, deferredToMeetingId, updatedAt: now })
    .where(eq(cabAgendaItemsTable.id, agendaItemId))
    .returning();
  log.info({ mspId, agendaItemId, deferredToMeetingId }, "cab: agenda item deferred");
  return { ok: true, item: updated };
}
