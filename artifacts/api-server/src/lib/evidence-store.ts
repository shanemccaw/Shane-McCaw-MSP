/**
 * evidence-store.ts — #4353.
 *
 * DB access for the SHARED Evidence object (`evidence` + `evidence_links`,
 * `lib/db/src/schema/msp.ts`). Distinct from `evidence-attachments-store.ts`
 * (#3503), which is the narrow 1:1 screenshot store pinned to a remediation
 * step or a change execution. Here, one `evidence` row can be linked to MANY
 * real object types through `evidence_links` (milestone|document|finding|gap|
 * risk|kanban_card|poam) — the polymorphic-by-explicit-type design that lets
 * #4345/#4349/#4350 all reuse ONE object.
 *
 * Every function is `mspId`-scoped: an evidence row belongs to the MSP that
 * created it, and no read/mutate crosses that boundary. Callers resolve their
 * own `mspId` (an MSP-operator-scoped route via `resolveMspIdStrict`) before
 * these run.
 */

import {
  db,
  evidenceTable,
  evidenceLinksTable,
  type Evidence,
  type EvidenceLink,
  type EvidenceKind,
  type EvidenceLinkType,
} from "@workspace/db";
import { and, eq, desc } from "drizzle-orm";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "workflow.evidence" });

export interface CreateEvidenceInput {
  readonly mspId: number;
  readonly customerId?: number | null;
  readonly kind: EvidenceKind;
  /** Server-relative path (kind `file`) or external URL (kind `link`). */
  readonly fileRef: string;
  readonly originalFilename?: string | null;
  readonly contentType?: string | null;
  readonly fileSizeBytes?: number | null;
  readonly description?: string | null;
  readonly uploadedByUserId?: number | null;
  readonly uploadedByPersonId?: string | null;
}

export async function createEvidence(input: CreateEvidenceInput): Promise<Evidence> {
  const [row] = await db
    .insert(evidenceTable)
    .values({
      mspId: input.mspId,
      customerId: input.customerId ?? null,
      kind: input.kind,
      fileRef: input.fileRef,
      originalFilename: input.originalFilename ?? null,
      contentType: input.contentType ?? null,
      fileSizeBytes: input.fileSizeBytes ?? null,
      description: input.description ?? null,
      uploadedByUserId: input.uploadedByUserId ?? null,
      uploadedByPersonId: input.uploadedByPersonId ?? null,
    })
    .returning();

  log.info({ mspId: input.mspId, kind: input.kind, id: row.id }, "evidence created");
  return row;
}

/** One evidence row, scoped by mspId. Null when it doesn't exist or belongs to a different MSP. */
export async function getEvidence(mspId: number, id: number): Promise<Evidence | null> {
  const [row] = await db
    .select()
    .from(evidenceTable)
    .where(and(eq(evidenceTable.id, id), eq(evidenceTable.mspId, mspId)))
    .limit(1);
  return row ?? null;
}

/**
 * Attach an existing evidence row to a target object. Idempotent — the unique
 * index (evidence_id, linked_type, linked_id) means re-linking the same target
 * is a no-op that returns the existing link rather than erroring.
 */
export async function linkEvidence(
  evidenceId: number,
  linkedType: EvidenceLinkType,
  linkedId: string,
  linkedByUserId: number | null,
): Promise<EvidenceLink> {
  const [row] = await db
    .insert(evidenceLinksTable)
    .values({ evidenceId, linkedType, linkedId, linkedByUserId })
    .onConflictDoNothing({
      target: [evidenceLinksTable.evidenceId, evidenceLinksTable.linkedType, evidenceLinksTable.linkedId],
    })
    .returning();

  if (row) {
    log.info({ evidenceId, linkedType, linkedId, id: row.id }, "evidence linked");
    return row;
  }

  // Conflict — the link already existed. Return it.
  const [existing] = await db
    .select()
    .from(evidenceLinksTable)
    .where(
      and(
        eq(evidenceLinksTable.evidenceId, evidenceId),
        eq(evidenceLinksTable.linkedType, linkedType),
        eq(evidenceLinksTable.linkedId, linkedId),
      ),
    )
    .limit(1);
  return existing;
}

/** Remove one specific link. Returns true when a link was actually removed. */
export async function unlinkEvidence(
  evidenceId: number,
  linkedType: EvidenceLinkType,
  linkedId: string,
): Promise<boolean> {
  const removed = await db
    .delete(evidenceLinksTable)
    .where(
      and(
        eq(evidenceLinksTable.evidenceId, evidenceId),
        eq(evidenceLinksTable.linkedType, linkedType),
        eq(evidenceLinksTable.linkedId, linkedId),
      ),
    )
    .returning({ id: evidenceLinksTable.id });
  return removed.length > 0;
}

/**
 * All evidence linked to one target object, newest first, scoped by mspId. Joins
 * `evidence_links` → `evidence` and filters the evidence side by mspId so an
 * operator only ever sees their own MSP's evidence even if a link row somehow
 * pointed elsewhere.
 */
export async function listEvidenceForTarget(
  mspId: number,
  linkedType: EvidenceLinkType,
  linkedId: string,
): Promise<Evidence[]> {
  const rows = await db
    .select({ evidence: evidenceTable })
    .from(evidenceLinksTable)
    .innerJoin(evidenceTable, eq(evidenceLinksTable.evidenceId, evidenceTable.id))
    .where(
      and(
        eq(evidenceLinksTable.linkedType, linkedType),
        eq(evidenceLinksTable.linkedId, linkedId),
        eq(evidenceTable.mspId, mspId),
      ),
    )
    .orderBy(desc(evidenceTable.createdAt));
  return rows.map((r) => r.evidence);
}

/** Every link for an evidence row (so a caller can report what it was attached to before/after a delete). */
export async function listLinksForEvidence(evidenceId: number): Promise<EvidenceLink[]> {
  return db
    .select()
    .from(evidenceLinksTable)
    .where(eq(evidenceLinksTable.evidenceId, evidenceId))
    .orderBy(desc(evidenceLinksTable.createdAt));
}

/**
 * Delete an evidence row (and, via the ON DELETE CASCADE FK, all its links),
 * scoped by mspId. Returns the deleted row so the caller can clean up the file
 * on disk. Null when it didn't exist or belonged to another MSP.
 */
export async function deleteEvidence(mspId: number, id: number): Promise<Evidence | null> {
  const [row] = await db
    .delete(evidenceTable)
    .where(and(eq(evidenceTable.id, id), eq(evidenceTable.mspId, mspId)))
    .returning();
  if (row) {
    log.info({ mspId, id }, "evidence deleted");
  }
  return row ?? null;
}

export interface WireEvidenceLink {
  readonly linkedType: EvidenceLinkType;
  readonly linkedId: string;
  readonly createdAt: string;
}

export interface WireEvidence {
  readonly id: number;
  readonly kind: EvidenceKind;
  readonly customerId: number | null;
  /** For a `file`: the scoped file-serving URL. For a `link`: the external URL as-stored. */
  readonly url: string;
  readonly originalFilename: string | null;
  readonly contentType: string | null;
  readonly fileSizeBytes: number | null;
  readonly description: string | null;
  readonly uploadedByPersonId: string | null;
  readonly createdAt: string;
  readonly links?: WireEvidenceLink[];
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

export function toWireEvidence(row: Evidence, links?: EvidenceLink[]): WireEvidence {
  return {
    id: row.id,
    kind: row.kind,
    customerId: row.customerId,
    // A file is served only through the scoped GET; a link is its own URL.
    url: row.kind === "file" ? `/api/msp/evidence/${row.id}/file` : row.fileRef,
    originalFilename: row.originalFilename,
    contentType: row.contentType,
    fileSizeBytes: row.fileSizeBytes,
    description: row.description,
    uploadedByPersonId: row.uploadedByPersonId,
    createdAt: iso(row.createdAt),
    links: links?.map((l) => ({ linkedType: l.linkedType, linkedId: l.linkedId, createdAt: iso(l.createdAt) })),
  };
}
