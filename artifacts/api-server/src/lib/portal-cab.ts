/**
 * portal-cab.ts — the pure derivations behind the Change Advisory Board
 * (Git #1501): membership, meetings, agenda, and the ECAB retroactive path.
 *
 * `useChangeControl.ts:22` recorded the gap this closes: no CAB agenda table.
 * Everything here is a total function over stored values — no database — the
 * same split `portal-change-control.ts` and `portal-change-approvals.ts`
 * follow, so the rules that decide what belongs on an agenda and when a
 * meeting may close stay unit-testable without a tenant.
 *
 * ── One approval model, not two ─────────────────────────────────────────────
 * A CAB agenda item does not carry its own "decision" concept. Its
 * `recommendation` field (approve / reject / defer) is the BOARD's own
 * determination for the record; the thing that actually authorizes or blocks
 * the change is a real `cr_approvals` row (#1496), written by the same
 * `recordApproval` / `recordRejection` the customer register uses. This file
 * has no `recordDecision` of its own — see `portal-cab-store.ts` for where the
 * two meet.
 *
 * ── Standard changes structurally cannot reach an agenda ────────────────────
 * `requiredStages("standard", …)` is 0 (#1496): a standard change is
 * pre-approved at creation and never has a pending `cr_approvals` row.
 * Agenda eligibility (`portal-cab-store.ts`'s `eligibleChangesForAgenda`) is
 * defined as "has a pending approval slot", so a standard change has nothing
 * to be eligible with — this is not a class filter that could be forgotten,
 * it falls out of the approval model itself.
 */

import type {
  CabAgendaItem,
  CabAgendaRecommendation,
  CabMeeting,
  CabMeetingStatus,
  CabMeetingType,
  CabMember,
  CabMemberRole,
  CabMemberSide,
} from "@workspace/db";
import { CAB_AGENDA_RECOMMENDATIONS, CAB_MEETING_STATUSES, CAB_MEETING_TYPES, CAB_MEMBER_ROLES, CAB_MEMBER_SIDES } from "@workspace/db";
import type { StoredChangeClass } from "./portal-change-control";

export { CAB_AGENDA_RECOMMENDATIONS, CAB_MEETING_STATUSES, CAB_MEETING_TYPES, CAB_MEMBER_ROLES, CAB_MEMBER_SIDES };
export type { CabAgendaRecommendation, CabMeetingStatus, CabMeetingType, CabMemberRole, CabMemberSide };

/** Which board a change's class belongs on. Emergency → ECAB, everything else that can reach a board → the standing CAB. */
export function meetingTypeForChangeClass(changeClass: StoredChangeClass): CabMeetingType {
  return changeClass === "emergency" ? "ecab" : "cab";
}

/**
 * Every item on an `ecab` meeting is retroactive by definition — the
 * emergency change already executed (or is executing) and the board is
 * reviewing it after the fact, not gating it before. A `cab` meeting's items
 * are never retroactive: a normal change waits for the board before it moves.
 */
export function isRetroactiveForMeetingType(meetingType: CabMeetingType): boolean {
  return meetingType === "ecab";
}

/** A meeting accepts new agenda items and decisions only while it is open. */
export function isMeetingOpen(status: CabMeetingStatus): boolean {
  return status === "scheduled" || status === "in_progress";
}

/** A meeting may close once none of its agenda items are still undecided (recommendation is set — approve, reject, or defer). An empty agenda is closeable trivially. */
export function canCloseMeeting(items: readonly Pick<CabAgendaItem, "recommendation">[]): boolean {
  return items.every((i) => i.recommendation !== null);
}

export interface AgendaSummary {
  readonly total: number;
  readonly approved: number;
  readonly rejected: number;
  readonly deferred: number;
  readonly undecided: number;
  readonly retroactive: number;
}

export function summarizeAgenda(items: readonly Pick<CabAgendaItem, "recommendation" | "isRetroactive">[]): AgendaSummary {
  let approved = 0;
  let rejected = 0;
  let deferred = 0;
  let undecided = 0;
  let retroactive = 0;
  for (const i of items) {
    switch (i.recommendation) {
      case "approve":
        approved += 1;
        break;
      case "reject":
        rejected += 1;
        break;
      case "defer":
        deferred += 1;
        break;
      default:
        undecided += 1;
        break;
    }
    if (i.isRetroactive) retroactive += 1;
  }
  return { total: items.length, approved, rejected, deferred, undecided, retroactive };
}

/** One agenda item's change, as `buildMinutes` needs it — the minimal facts of the CR under discussion. */
export interface MinutesChangeFacts {
  readonly code: string;
  readonly title: string;
}

export interface MinutesAgendaLine {
  readonly ordinal: number;
  readonly change: MinutesChangeFacts;
  readonly presenterName: string;
  readonly discussionNotes: string;
  readonly recommendation: CabAgendaRecommendation | null;
  readonly isRetroactive: boolean;
}

/**
 * Compile the meeting's minutes from its own agenda — the "recorded decisions
 * -> minutes" step the issue asks for. Deterministic and total: given the same
 * meeting and agenda it always produces the same text, so closing a meeting
 * twice (which the store forbids, but this function does not know that) never
 * drifts.
 */
export function buildMinutes(
  meeting: Pick<CabMeeting, "meetingType" | "scheduledFor" | "chairName" | "location">,
  items: readonly MinutesAgendaLine[],
): string {
  const boardName = meeting.meetingType === "ecab" ? "Emergency Change Advisory Board (ECAB)" : "Change Advisory Board (CAB)";
  const when = meeting.scheduledFor.toISOString();
  const lines: string[] = [
    `${boardName} — minutes`,
    `Scheduled for: ${when}`,
    `Chair: ${meeting.chairName || "(unrecorded)"}`,
    `Location: ${meeting.location || "(unrecorded)"}`,
    "",
    "Agenda:",
  ];
  if (items.length === 0) {
    lines.push("  (no items on this agenda)");
  }
  for (const item of [...items].sort((a, b) => a.ordinal - b.ordinal)) {
    const recLabel = item.recommendation ? item.recommendation.toUpperCase() : "UNDECIDED";
    const retro = item.isRetroactive ? " [retroactive]" : "";
    lines.push(`  ${item.ordinal}. ${item.change.code} — ${item.change.title}${retro}`);
    if (item.presenterName) lines.push(`     Presented by: ${item.presenterName}`);
    if (item.discussionNotes) lines.push(`     Discussion: ${item.discussionNotes}`);
    lines.push(`     Recommendation: ${recLabel}`);
  }
  return lines.join("\n");
}

/** One roster row, as the operator surface consumes it. */
export interface WireCabMember {
  readonly id: number;
  readonly personId: string;
  readonly name: string;
  readonly email: string;
  readonly role: CabMemberRole;
  readonly side: CabMemberSide;
  readonly tenantId: string | null;
  readonly isEcab: boolean;
  readonly active: boolean;
  readonly addedAt: string;
  readonly removedAt: string | null;
}

export function toWireCabMember(row: CabMember): WireCabMember {
  return {
    id: row.id,
    personId: row.personId,
    name: row.name,
    email: row.email,
    role: row.role,
    side: row.side,
    tenantId: row.tenantId,
    isEcab: row.isEcab,
    active: row.active,
    addedAt: row.addedAt.toISOString(),
    removedAt: row.removedAt ? row.removedAt.toISOString() : null,
  };
}

/** One agenda item, as the operator surface consumes it. */
export interface WireCabAgendaItem {
  readonly id: number;
  readonly changeRequestId: number;
  readonly changeCode: string;
  readonly changeTitle: string;
  readonly tenantId: string;
  readonly ordinal: number;
  readonly presenterName: string;
  readonly discussionNotes: string;
  readonly recommendation: CabAgendaRecommendation | null;
  readonly decidedAt: string | null;
  readonly crApprovalId: number | null;
  readonly isRetroactive: boolean;
  readonly deferredToMeetingId: number | null;
}

export function toWireCabAgendaItem(row: CabAgendaItem, change: MinutesChangeFacts): WireCabAgendaItem {
  return {
    id: row.id,
    changeRequestId: row.changeRequestId,
    changeCode: change.code,
    changeTitle: change.title,
    tenantId: row.tenantId,
    ordinal: row.ordinal,
    presenterName: row.presenterName,
    discussionNotes: row.discussionNotes,
    recommendation: row.recommendation,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    crApprovalId: row.crApprovalId,
    isRetroactive: row.isRetroactive,
    deferredToMeetingId: row.deferredToMeetingId,
  };
}

/** One meeting, as the operator surface consumes it. */
export interface WireCabMeeting {
  readonly id: number;
  readonly meetingType: CabMeetingType;
  readonly status: CabMeetingStatus;
  readonly scheduledFor: string;
  readonly heldAt: string | null;
  readonly closedAt: string | null;
  readonly chairPersonId: string | null;
  readonly chairName: string;
  readonly location: string;
  readonly notes: string;
  readonly minutes: string;
  readonly agendaSummary: AgendaSummary;
}

export function toWireCabMeeting(row: CabMeeting, agendaSummary: AgendaSummary): WireCabMeeting {
  return {
    id: row.id,
    meetingType: row.meetingType,
    status: row.status,
    scheduledFor: row.scheduledFor.toISOString(),
    heldAt: row.heldAt ? row.heldAt.toISOString() : null,
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    chairPersonId: row.chairPersonId,
    chairName: row.chairName,
    location: row.location,
    notes: row.notes,
    minutes: row.minutes,
    agendaSummary,
  };
}
