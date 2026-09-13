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
 * `getLastFullyExecutedSecurityPlanVersion` is the one addition beyond the RBD shape:
 * #1562 settles that the live view sits alongside its drift from the LAST FULLY
 * EXECUTED version (not merely the current one, which can itself be un-executed) — see
 * `security-plan-drift.ts` for the pure comparison that consumes it.
 *
 * #1689/#3793: signing is DUAL, not single. The customer and the MSP each sign into
 * their own independent slot (`customerSigned*` / `mspSigned*`) — one party signing
 * neither blocks nor satisfies the other's signature, and "fully executed" means both
 * are present. This replaced an original single `signed`/`signedBy`/`signedAt` triple
 * that had room for exactly one signer.
 */
import {
  db,
  mspSecurityPlanVersionsTable,
  type MspAssessor,
  type ClientApprover,
  type MspSecurityPlanVersion,
  type SecurityPlanContent,
} from "@workspace/db";
import { and, eq, isNull, isNotNull, desc } from "drizzle-orm";

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
        customerSignedBy: null,
        customerSignedAt: null,
        mspSignedBy: null,
        mspSignedAt: null,
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

/** True once BOTH the customer and the MSP have independently signed (#1689/#3793's
 * dual-signature decision) — neither party's signature alone counts as executed. */
export function isSecurityPlanVersionFullyExecuted(row: MspSecurityPlanVersion): boolean {
  return row.customerSignedAt !== null && row.mspSignedAt !== null;
}

/** The most recently FULLY EXECUTED version (both parties signed), regardless of
 * whether it is still current — the anchor #1562's drift view compares the live
 * assembled document against. Signing only ever happens on the current version at the
 * time (see `signSecurityPlanVersionAsCustomer`/`signSecurityPlanVersionAsMsp`), but a
 * later un-executed seal can leave the current version not-yet-executed while an older,
 * superseded one remains the last version both parties actually signed. Null if nothing
 * has ever been fully executed. */
export async function getLastFullyExecutedSecurityPlanVersion(
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
        isNotNull(mspSecurityPlanVersionsTable.customerSignedAt),
        isNotNull(mspSecurityPlanVersionsTable.mspSignedAt),
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
 * Signs a specific version as the CUSTOMER's own, independent signature (#1689/#3793:
 * dual signature — this never blocks on, and is never satisfied by, the MSP's own
 * signature below). Only the CURRENT, not-yet-customer-signed version may be signed
 * this way — signing a superseded version would sign a document nobody can act on
 * anymore, and re-signing would overwrite a completed signature. Returns null if the
 * version does not exist, is not current, or the customer has already signed it (the
 * caller maps that to 404/409 as appropriate).
 */
export async function signSecurityPlanVersionAsCustomer(
  mspId: number,
  customerId: number,
  versionUid: string,
  signedBy: ClientApprover,
): Promise<MspSecurityPlanVersion | null> {
  const signedAt = new Date();
  const updated = await db
    .update(mspSecurityPlanVersionsTable)
    .set({ customerSignedBy: signedBy, customerSignedAt: signedAt })
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        eq(mspSecurityPlanVersionsTable.versionUid, versionUid),
        isNull(mspSecurityPlanVersionsTable.supersededAt),
        isNull(mspSecurityPlanVersionsTable.customerSignedAt),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Signs a specific version as the MSP's own, independent signature — the servicing
 * party's own endorsement, distinct from (and never a proxy for) the customer's above.
 * Same current/not-yet-signed guard, scoped to the MSP's own slot. Returns null if the
 * version does not exist, is not current, or the MSP has already signed it.
 */
export async function signSecurityPlanVersionAsMsp(
  mspId: number,
  customerId: number,
  versionUid: string,
  signedBy: MspAssessor,
): Promise<MspSecurityPlanVersion | null> {
  const signedAt = new Date();
  const updated = await db
    .update(mspSecurityPlanVersionsTable)
    .set({ mspSignedBy: signedBy, mspSignedAt: signedAt })
    .where(
      and(
        eq(mspSecurityPlanVersionsTable.mspId, mspId),
        eq(mspSecurityPlanVersionsTable.customerId, customerId),
        eq(mspSecurityPlanVersionsTable.versionUid, versionUid),
        isNull(mspSecurityPlanVersionsTable.supersededAt),
        isNull(mspSecurityPlanVersionsTable.mspSignedAt),
      ),
    )
    .returning();
  return updated[0] ?? null;
}
