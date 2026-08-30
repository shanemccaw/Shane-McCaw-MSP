/**
 * portal-change-timeline-store.ts — the DB side of the Change Control CR
 * timeline (Git #1503): `cr_events`, `cr_comments`, `cr_attachments`.
 *
 * There was no per-CR event history anywhere in the platform before this.
 * `msp_audit_logs` is platform-wide and carries nothing CR-shaped; "Add a
 * comment" was one of five dead buttons in the retired prototype (proto
 * 1513-1524, no `onClick`).
 *
 * APPEND-ONLY, same discipline as `cr_approvals` (#1496): every write here is
 * an INSERT. There is no update or delete function in this module and there
 * must never be one — a change request is immutable after close, and the
 * timeline that records its history follows the same rule. A correction is a
 * new row, never an edit to an old one.
 *
 * `recordCrEvent` is the single choke point every approval, rejection and
 * execution transition routes through, so "every real transition emits an
 * event" is enforceable by code review at one file rather than re-verified at
 * every call site.
 */

import {
  db,
  crAttachmentsTable,
  crCommentsTable,
  crEventsTable,
  type CrAttachment,
  type CrAttachmentKind,
  type CrComment,
  type CrEvent,
  type CrEventActorRole,
  type CrEventType,
  type CrTimelineAuthorRole,
} from "@workspace/db";
import { asc } from "drizzle-orm";
import { logger } from "./logger";

const log = logger.child({ channel: "workflow.change-control" });

// ── cr_events ─────────────────────────────────────────────────────────────────

export interface RecordCrEventInput {
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  readonly eventType: CrEventType;
  /** The state before this transition. Null for the CR's first-ever event (`raised`). */
  readonly fromValue: string | null;
  readonly toValue: string;
  /** The approval stage this event belongs to, for an approval-ledger event. Omit for a lifecycle event. */
  readonly stage?: number;
  readonly actorRole: CrEventActorRole;
  readonly actorPersonId?: string | null;
  readonly actorName?: string | null;
  readonly reason?: string | null;
  /** When this really happened, if different from "now" (only ever used by the manual backfill migration). */
  readonly occurredAt?: Date;
}

/**
 * Append one immutable row to `cr_events`. Never throws into the caller's write
 * path: an approval/rejection/execution transition that already committed its
 * own state change must not be rolled back or reported as failed just because
 * the timeline write hiccuped — it is logged instead, and the hole this leaves
 * is exactly the "hole in the register" the issue's own rule names, so it is
 * logged loud (error, not warn) rather than swallowed quietly.
 */
export async function recordCrEvent(input: RecordCrEventInput): Promise<CrEvent | null> {
  try {
    const now = new Date();
    const [row] = await db
      .insert(crEventsTable)
      .values({
        changeRequestId: input.changeRequestId,
        mspId: input.mspId,
        tenantId: input.tenantId,
        eventType: input.eventType,
        fromValue: input.fromValue,
        toValue: input.toValue,
        stage: input.stage ?? null,
        actorRole: input.actorRole,
        actorPersonId: input.actorPersonId ?? null,
        actorName: input.actorName ?? null,
        reason: input.reason ?? null,
        occurredAt: input.occurredAt ?? now,
      })
      .returning();
    return row;
  } catch (err) {
    log.error(
      { err, changeRequestId: input.changeRequestId, eventType: input.eventType },
      "cr-events: failed to record a state-transition event — the register now has a hole for this transition",
    );
    return null;
  }
}

/** Every event for a set of CRs, oldest first — the shape the register's timeline reads. */
export async function listEventsForChangeIds(ids: readonly number[]): Promise<CrEvent[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(crEventsTable).orderBy(asc(crEventsTable.occurredAt), asc(crEventsTable.id));
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.changeRequestId));
}

// ── cr_comments ───────────────────────────────────────────────────────────────

export interface AddCommentInput {
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  readonly authorRole: CrTimelineAuthorRole;
  readonly authorPersonId: string;
  readonly authorName: string;
  readonly body: string;
}

/** Append one immutable comment. Real write errors DO propagate — unlike an event, a comment is the caller's whole request, not a side effect of one. */
export async function addComment(input: AddCommentInput): Promise<CrComment> {
  const [row] = await db
    .insert(crCommentsTable)
    .values({
      changeRequestId: input.changeRequestId,
      mspId: input.mspId,
      tenantId: input.tenantId,
      authorRole: input.authorRole,
      authorPersonId: input.authorPersonId,
      authorName: input.authorName,
      body: input.body,
    })
    .returning();
  log.info({ changeRequestId: input.changeRequestId, mspId: input.mspId, authorRole: input.authorRole }, "cr-comments: comment added");
  return row;
}

export async function listCommentsForChangeIds(ids: readonly number[]): Promise<CrComment[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(crCommentsTable).orderBy(asc(crCommentsTable.createdAt), asc(crCommentsTable.id));
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.changeRequestId));
}

// ── cr_attachments ────────────────────────────────────────────────────────────

export interface AddAttachmentInput {
  readonly changeRequestId: number;
  readonly mspId: number;
  readonly tenantId: string;
  readonly kind: CrAttachmentKind;
  readonly label: string;
  readonly externalUrl?: string | null;
  readonly mimeType?: string | null;
  readonly sizeBytes?: number | null;
  readonly uploadedByRole: CrTimelineAuthorRole;
  readonly uploadedByPersonId: string;
  readonly uploadedByName: string;
}

export async function addAttachment(input: AddAttachmentInput): Promise<CrAttachment> {
  const [row] = await db
    .insert(crAttachmentsTable)
    .values({
      changeRequestId: input.changeRequestId,
      mspId: input.mspId,
      tenantId: input.tenantId,
      kind: input.kind,
      label: input.label,
      externalUrl: input.externalUrl ?? null,
      mimeType: input.mimeType ?? null,
      sizeBytes: input.sizeBytes ?? null,
      uploadedByRole: input.uploadedByRole,
      uploadedByPersonId: input.uploadedByPersonId,
      uploadedByName: input.uploadedByName,
    })
    .returning();
  log.info({ changeRequestId: input.changeRequestId, mspId: input.mspId, kind: input.kind }, "cr-attachments: attachment recorded");
  return row;
}

export async function listAttachmentsForChangeIds(ids: readonly number[]): Promise<CrAttachment[]> {
  if (ids.length === 0) return [];
  const rows = await db.select().from(crAttachmentsTable).orderBy(asc(crAttachmentsTable.createdAt), asc(crAttachmentsTable.id));
  const wanted = new Set(ids);
  return rows.filter((r) => wanted.has(r.changeRequestId));
}
