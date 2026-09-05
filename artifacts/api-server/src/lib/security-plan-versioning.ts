/**
 * security-plan-versioning.ts — the Security Plan's version/seal chain (#1561,
 * #1562, part of #1495/#1485).
 *
 * #1562 settled this as "the RBD pattern one level up," so this module is a direct
 * sibling of `rbd-versioning.ts`: the same supersede-then-insert transaction, the
 * same guarded sign, the same `supersededAt IS NULL` = current sentinel. It exists so
 * the Security Plan reuses that mechanism rather than inventing a second
 * sealing/signing stack.
 *
 * The one difference from RBD is what is sealed: a Security Plan version snapshots the
 * WHOLE assembled document (`SecurityPlanContent` — every module's contributed rows as
 * they were, plus the applied scope #1563 and the computed filter footprint #1565).
 * `content` is a full, self-contained snapshot: a version that re-reads live child
 * rows to render itself is a query, not a signed document.
 *
 * The container is one Security Plan per customer tenant, so the chain is keyed on
 * `(mspId, customerId)` where `customerId` is a `tenants.id`.
 *
 * `getLastSignedSecurityPlanVersion` is the one addition beyond the RBD shape: #1562
 * settles that the live view sits alongside its drift from the LAST SIGNED version
 * (not merely the current one, which can itself be unsigned) — see
 * `security-plan-drift.ts` for the pure comparison that consumes it.
 */
import {
  db,
  mspSecurityPlanVersionsTable,
  type MspAssessor,
  type ClientApprover,
  type MspSecurityPlanVersion,
  type SecurityPlanContent,
} from "@workspace/db";
import { and, eq, isNull, desc } from "drizzle-orm";

export interface CreateSecurityPlanVersionInput {
  mspId: number;
  customerId: number;
  tenantId: string;
  tenantName: string;
  /** Full, self-contained snapshot of the assembled document, incl. the #1565
   * filter footprint. Never a pointer for the reader to re-resolve against live rows. */
  content: SecurityPlanContent;
  createdBy: MspAssessor;
}

/**
 * Seals a new version of a customer's Security Plan, superseding whatever version was
 * previously current (if any). Runs as one transaction so a reader can never observe
 * two current (supersededAt IS NULL) versions of the same plan at once, nor a moment
 * with zero current versions between the supersede and the insert.
 */
export async function createSecurityPlanVersion(
  input: CreateSecurityPlanVersionInput,
): Promise<MspSecurityPlanVersion> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: mspSecurityPlanVersionsTable.id, versionNumber: mspSecurityPlanVersionsTable.versionNumber })
      .from(mspSecurityPlanVersionsTable)
      .where(
        and(
          eq(mspSecurityPlanVersionsTable.mspId, input.mspId),
          eq(mspSecurityPlanVersionsTable.customerId, input.customerId),
          isNull(mspSecurityPlanVersionsTable.supersededAt),
        ),
      )
      .limit(1);

    const now = new Date();
    if (current) {
      await tx
        .update(mspSecurityPlanVersionsTable)
        .set({ supersededAt: now })
        .where(eq(mspSecurityPlanVersionsTable.id, current.id));
    }

    const [inserted] = await tx
      .insert(mspSecurityPlanVersionsTable)
      .values({
        mspId: input.mspId,
        customerId: input.customerId,
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        versionNumber: (current?.versionNumber ?? 0) + 1,
        content: input.content,
        createdBy: input.createdBy,
        signed: false,
        signedBy: null,
        signedAt: null,
        supersededAt: null,
      })
      .returning();

    return inserted;
  });
}

/** The current (`supersededAt IS NULL`) version, or null if none has been sealed. */
export async function getCurrentSecurityPlanVersion(
  mspId: number,
  customerId: number,
): Promise<MspSecurityPlanVersion | null> {
  const [row] = await db
    .select()
    .from(mspSecurityPlanVersionsTable)
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        isNull(mspSecurityPlanVersionsTable.supersededAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The most recently SIGNED version, regardless of whether it is still current — the
 * anchor #1562's drift view compares the live assembled document against. Signing only
 * ever happens on the current version at the time (see `signSecurityPlanVersion`), but a
 * later unsigned seal can leave the current version unsigned while an older, superseded
 * one remains the last real signature. Null if nothing has ever been signed. */
export async function getLastSignedSecurityPlanVersion(
  mspId: number,
  customerId: number,
): Promise<MspSecurityPlanVersion | null> {
  const [row] = await db
    .select()
    .from(mspSecurityPlanVersionsTable)
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        eq(mspSecurityPlanVersionsTable.signed, true),
      ),
    )
    .orderBy(desc(mspSecurityPlanVersionsTable.versionNumber))
    .limit(1);
  return row ?? null;
}

/** One specific version by its own uid, current or superseded — #2949's customer-facing
 * sign flow needs this the same way `rbd-versioning.ts`'s `getRbdVersionByUid` does: a
 * scoped-read-first lookup so a versionUid belonging to another tenant 404s exactly like
 * one that does not exist, rather than leaking existence via the update's own guard. */
export async function getSecurityPlanVersionByUid(
  mspId: number,
  customerId: number,
  versionUid: string,
): Promise<MspSecurityPlanVersion | null> {
  const [row] = await db
    .select()
    .from(mspSecurityPlanVersionsTable)
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        eq(mspSecurityPlanVersionsTable.versionUid, versionUid),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Every version of a customer's plan, newest first — the full supersession chain. */
export async function listSecurityPlanVersions(
  mspId: number,
  customerId: number,
): Promise<MspSecurityPlanVersion[]> {
  return db
    .select()
    .from(mspSecurityPlanVersionsTable)
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
      ),
    )
    .orderBy(desc(mspSecurityPlanVersionsTable.versionNumber));
}

/**
 * Signs a specific version as a whole. Only the CURRENT, unsigned version may be
 * signed — signing a superseded version would sign a document nobody can act on
 * anymore, and re-signing an already-signed version would overwrite a completed
 * signature. Returns null if the version does not exist, is not current, or is already
 * signed (the caller maps that to 404/409 as appropriate).
 */
export async function signSecurityPlanVersion(
  mspId: number,
  customerId: number,
  versionUid: string,
  signedBy: ClientApprover,
): Promise<MspSecurityPlanVersion | null> {
  const signedAt = new Date();
  const updated = await db
    .update(mspSecurityPlanVersionsTable)
    .set({ signed: true, signedBy, signedAt })
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        eq(mspSecurityPlanVersionsTable.versionUid, versionUid),
        isNull(mspSecurityPlanVersionsTable.supersededAt),
        eq(mspSecurityPlanVersionsTable.signed, false),
      ),
    )
    .returning();
  return updated[0] ?? null;
}
