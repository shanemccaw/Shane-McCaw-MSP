/**
 * evidence-attachments-store.ts — #3503.
 *
 * DB access for `evidence_attachments`, the record `IEvidencePostClient`
 * (MyArchitect #3470's screenshot tool) posts to. One row per posted
 * screenshot/attachment, against either a `remediation_tracker_steps` step or
 * a `cr_executions` change execution — see the schema comment on
 * `evidenceAttachmentsTable` (`lib/db/src/schema/msp.ts`) for the full shape
 * and why the (source, sourceRefId) link is soft (no FK).
 *
 * Ownership is enforced entirely at the DB-id boundary of the two source
 * tables *before* any of these functions run — a `remediation_tracker_steps`
 * row is looked up by (customerId, stepId) with the caller's own
 * `assertCustomerAccess`-checked customerId, and a `cr_executions` row is
 * looked up by (id, mspId) via `getExecution`. Once that lookup has resolved a
 * real sourceRefId + customerId + mspId, these functions just persist/query
 * evidence rows already scoped to values the caller proved it owns.
 */

import { db, evidenceAttachmentsTable, type EvidenceAttachmentSource, type EvidenceAttachment } from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "workflow.change-control" });

export interface RecordEvidenceAttachmentInput {
  readonly mspId: number;
  readonly customerId: number;
  readonly source: EvidenceAttachmentSource;
  readonly sourceRefId: number;
  readonly filePath: string;
  readonly originalFilename?: string | null;
  readonly contentType?: string | null;
  readonly fileSizeBytes?: number | null;
  readonly caption?: string | null;
  readonly width?: number | null;
  readonly height?: number | null;
  readonly capturedAt?: Date;
  readonly uploadedByUserId?: number | null;
  readonly uploadedByPersonId?: string | null;
}

export async function recordEvidenceAttachment(input: RecordEvidenceAttachmentInput): Promise<EvidenceAttachment> {
  const [row] = await db
    .insert(evidenceAttachmentsTable)
    .values({
      mspId: input.mspId,
      customerId: input.customerId,
      source: input.source,
      sourceRefId: input.sourceRefId,
      filePath: input.filePath,
      originalFilename: input.originalFilename ?? null,
      contentType: input.contentType ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      caption: input.caption ?? null,
      width: input.width ?? null,
      height: input.height ?? null,
      capturedAt: input.capturedAt ?? new Date(),
      uploadedByUserId: input.uploadedByUserId ?? null,
      uploadedByPersonId: input.uploadedByPersonId ?? null,
    })
    .returning();

  log.info(
    { mspId: input.mspId, customerId: input.customerId, source: input.source, sourceRefId: input.sourceRefId, id: row.id },
    "evidence attachment recorded",
  );
  return row;
}

/** All evidence attached to one source record, newest first. Scoped by mspId — call only after the caller's own ownership check on the source record. */
export async function listEvidenceAttachments(
  mspId: number,
  source: EvidenceAttachmentSource,
  sourceRefId: number,
): Promise<EvidenceAttachment[]> {
  return db
    .select()
    .from(evidenceAttachmentsTable)
    .where(
      and(
        eq(evidenceAttachmentsTable.mspId, mspId),
        eq(evidenceAttachmentsTable.source, source),
        eq(evidenceAttachmentsTable.sourceRefId, sourceRefId),
      ),
    )
    .orderBy(desc(evidenceAttachmentsTable.capturedAt));
}

/** One evidence row, scoped by mspId. Null when it doesn't exist or belongs to a different MSP. */
export async function getEvidenceAttachment(mspId: number, id: number): Promise<EvidenceAttachment | null> {
  const [row] = await db
    .select()
    .from(evidenceAttachmentsTable)
    .where(and(eq(evidenceAttachmentsTable.id, id), eq(evidenceAttachmentsTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

export interface WireEvidenceAttachment {
  readonly id: number;
  readonly source: EvidenceAttachmentSource;
  readonly sourceRefId: number;
  readonly url: string;
  readonly originalFilename: string | null;
  readonly contentType: string | null;
  readonly fileSizeBytes: number | null;
  readonly caption: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly capturedAt: string;
  readonly uploadedByPersonId: string | null;
  readonly createdAt: string;
}

export function toWireEvidenceAttachment(row: EvidenceAttachment): WireEvidenceAttachment {
  return {
    id: row.id,
    source: row.source,
    sourceRefId: row.sourceRefId,
    url: `/api/msp/evidence-attachments/${row.id}/file`,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSizeBytes: row.fileSizeBytes,
    caption: row.caption,
    width: row.width,
    height: row.height,
    capturedAt: row.capturedAt instanceof Date ? row.capturedAt.toISOString() : String(row.capturedAt),
    uploadedByPersonId: row.uploadedByPersonId,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}
