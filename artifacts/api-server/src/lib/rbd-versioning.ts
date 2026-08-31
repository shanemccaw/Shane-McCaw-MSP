/**
 * rbd-versioning.ts — the RBD supersession-chain mechanism (#1508, part of #1487),
 * plus the signature-required-on-scope-expansion derivation (#1510).
 *
 * The RBD is a container, and it is the WHOLE container document — not its
 * individual line items — that is the signed, versioned artifact. Every change
 * produces a new version of the whole document; the previous current version is
 * superseded, never edited or backfilled. This mirrors `drift_baseline_snapshots`'
 * existing supersession chain exactly (see `msp_rbd_versions`'s schema header for
 * the full architecture note).
 *
 * This module is the one place that mechanism lives, so the issues that attach to
 * it — #1509 (line items), #1510 (signature-required-on-expansion, this file's
 * `computeRbdScopeDiff`/`diffNarrativeSnapshot`), #1511 (role-based authority),
 * #1512 (signed document render + capture) — call `createRbdVersion` /
 * `signRbdVersion` rather than each re-implementing the supersede-then-insert
 * transaction.
 *
 * ── #1510: signature required on scope expansion, never on contraction ────────
 *
 * The derivation itself (`computeRbdScopeDiff`, `diffNarrativeSnapshot`) lives
 * in `./rbd-scope-diff.ts` — kept free of any `@workspace/db` dependency so it
 * stays trivially unit-testable. Read that module's header for the full
 * architecture note (why the distinction is derived rather than a flag a
 * caller sets, and why this makes "a new instance is never silently absorbed
 * under an old signature" true by construction). This file is the DB
 * orchestration around it: running the diff inside the supersede-then-insert
 * transaction, and inheriting or requiring a signature accordingly.
 */
import { randomBytes } from "node:crypto";
import {
  db,
  mspRbdVersionsTable,
  mspRbdNarrativeAuditTable,
  type MspAssessor,
  type ClientApprover,
  type MspRbdVersion,
  type MspRbdNarrativeAudit,
  type RbdNarrativeSnapshot,
} from "@workspace/db";
import { and, eq, isNull, desc, gt, or } from "drizzle-orm";
import { computeRbdScopeDiff, diffNarrativeSnapshot } from "./rbd-scope-diff.ts";

export { computeRbdScopeDiff, diffNarrativeSnapshot } from "./rbd-scope-diff.ts";
export type { RbdVersionScopeDiff, RbdNarrativeFieldChange } from "./rbd-scope-diff.ts";

export interface CreateRbdVersionInput {
  mspId: number;
  rbdId: string;
  tenantId: string;
  tenantName: string;
  /** Full, self-contained snapshot of the whole document. Never a pointer for
   * the reader to re-resolve against live rows. */
  content: unknown;
  createdBy: MspAssessor;
  /** #1510 — every `risk_instances.id` this version accepts as in-scope.
   * Callers MUST derive this from the live `risk_instances` table (active
   * instances at capture time), never from client-supplied JSON — see this
   * module's own header for why. */
  scopeInstanceIds: number[];
  /** #1510 — the narrative/score fields at capture time, likewise
   * server-derived from `msp_risk_decisions`, never client-supplied. */
  narrativeSnapshot: RbdNarrativeSnapshot;
}

/**
 * Captures a new version of an RBD document, superseding whatever version was
 * previously current (if any). Runs as one transaction so a reader can never
 * observe two "current" (supersededAt IS NULL) versions of the same container at
 * once, nor a moment with zero current versions between the supersede and the
 * insert.
 *
 * #1510: also runs the scope diff against the version being superseded and
 * either requires a fresh signature (addition present, or first version ever)
 * or inherits the superseded version's own signature (subtraction-only/
 * unchanged scope AND that version was itself signed). Narrative/score drift is
 * diffed independently and, if any changed, recorded as one
 * `msp_rbd_narrative_audit` row in the same transaction — never gates capture,
 * never requires a signature.
 */
export async function createRbdVersion(input: CreateRbdVersionInput): Promise<MspRbdVersion> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(mspRbdVersionsTable)
      .where(
        and(
          eq(mspRbdVersionsTable.mspId, input.mspId),
          eq(mspRbdVersionsTable.rbdId, input.rbdId),
          isNull(mspRbdVersionsTable.supersededAt),
        ),
      )
      .limit(1);

    const now = new Date();
    if (current) {
      await tx
        .update(mspRbdVersionsTable)
        .set({ supersededAt: now })
        .where(eq(mspRbdVersionsTable.id, current.id));
    }

    const scopeDiff = computeRbdScopeDiff(current ? current.scopeInstanceIds : null, input.scopeInstanceIds);
    const inheritSignature = !scopeDiff.requiresSignature && current !== undefined && current.signed;

    const [inserted] = await tx
      .insert(mspRbdVersionsTable)
      .values({
        mspId: input.mspId,
        rbdId: input.rbdId,
        tenantId: input.tenantId,
        tenantName: input.tenantName,
        versionNumber: (current?.versionNumber ?? 0) + 1,
        content: input.content,
        createdBy: input.createdBy,
        scopeInstanceIds: input.scopeInstanceIds,
        scopeAddedInstanceIds: scopeDiff.added,
        scopeRemovedInstanceIds: scopeDiff.removed,
        requiresSignature: scopeDiff.requiresSignature,
        narrativeSnapshot: input.narrativeSnapshot,
        signed: inheritSignature,
        signedBy: inheritSignature ? current!.signedBy : null,
        signedAt: inheritSignature ? current!.signedAt : null,
        signatureData: inheritSignature ? current!.signatureData : null,
        signatureInherited: inheritSignature,
        signatureInheritedFromVersionUid: inheritSignature ? current!.versionUid : null,
        supersededAt: null,
      })
      .returning();

    const narrativeChanges = diffNarrativeSnapshot(
      current ? (current.narrativeSnapshot as RbdNarrativeSnapshot) : null,
      input.narrativeSnapshot,
    );
    if (narrativeChanges.length > 0) {
      await tx.insert(mspRbdNarrativeAuditTable).values({
        mspId: input.mspId,
        rbdId: input.rbdId,
        fromVersionUid: current?.versionUid ?? null,
        toVersionUid: inserted.versionUid,
        changedFields: narrativeChanges,
      });
    }

    return inserted;
  });
}

/** #1510 — the narrative/score audit trail for a container, newest first. */
export async function listRbdNarrativeAudit(mspId: number, rbdId: string): Promise<MspRbdNarrativeAudit[]> {
  return db
    .select()
    .from(mspRbdNarrativeAuditTable)
    .where(and(eq(mspRbdNarrativeAuditTable.mspId, mspId), eq(mspRbdNarrativeAuditTable.rbdId, rbdId)))
    .orderBy(desc(mspRbdNarrativeAuditTable.createdAt));
}

/** The current (`supersededAt IS NULL`) version of a container, or null if none
 * has ever been captured. */
export async function getCurrentRbdVersion(mspId: number, rbdId: string): Promise<MspRbdVersion | null> {
  const [row] = await db
    .select()
    .from(mspRbdVersionsTable)
    .where(
      and(
        eq(mspRbdVersionsTable.mspId, mspId),
        eq(mspRbdVersionsTable.rbdId, rbdId),
        isNull(mspRbdVersionsTable.supersededAt),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** One specific version by its own uid, current or superseded. Renders (#1512)
 * need this — a superseded version must still be renderable, that is the
 * whole point of preserving it. */
export async function getRbdVersionByUid(mspId: number, rbdId: string, versionUid: string): Promise<MspRbdVersion | null> {
  const [row] = await db
    .select()
    .from(mspRbdVersionsTable)
    .where(
      and(
        eq(mspRbdVersionsTable.mspId, mspId),
        eq(mspRbdVersionsTable.rbdId, rbdId),
        eq(mspRbdVersionsTable.versionUid, versionUid),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** Every version of a container, newest first — the full supersession chain. */
export async function listRbdVersions(mspId: number, rbdId: string): Promise<MspRbdVersion[]> {
  return db
    .select()
    .from(mspRbdVersionsTable)
    .where(and(eq(mspRbdVersionsTable.mspId, mspId), eq(mspRbdVersionsTable.rbdId, rbdId)))
    .orderBy(desc(mspRbdVersionsTable.versionNumber));
}

/**
 * Signs a specific version as a whole. Only the CURRENT, unsigned version may be
 * signed — signing a superseded version would sign a document nobody can act on
 * anymore, and re-signing an already-signed version would overwrite a completed
 * signature. Returns null if the version does not exist, is not current, or is
 * already signed (the caller maps that to 404/409 as appropriate).
 */
export async function signRbdVersion(
  mspId: number,
  rbdId: string,
  versionUid: string,
  signedBy: ClientApprover,
  /** #1512 — the actual drawn signature (base64 PNG data-URL), SOW-flow
   * parity. Optional: the MSP-side "record an off-platform signature" caller
   * (`msp-rbd-versions.ts`) may have no image, only the attestation fields. */
  signatureData?: string | null,
): Promise<MspRbdVersion | null> {
  const signedAt = new Date();
  const updated = await db
    .update(mspRbdVersionsTable)
    .set({ signed: true, signedBy, signedAt, signatureData: signatureData ?? null })
    .where(
      and(
        eq(mspRbdVersionsTable.mspId, mspId),
        eq(mspRbdVersionsTable.rbdId, rbdId),
        eq(mspRbdVersionsTable.versionUid, versionUid),
        isNull(mspRbdVersionsTable.supersededAt),
        eq(mspRbdVersionsTable.signed, false),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Generates (or replaces) an unauthenticated review/sign link for the
 * CURRENT, unsigned version of a container — same shape as `msp_sows`'
 * `shareToken`/`shareTokenExpiresAt`. Scoped to the current version only:
 * sharing a superseded version would hand out a link to a document nobody
 * can act on, and an already-signed version has nothing left to sign.
 * 30-day expiry, matching the SOW flow's own convention.
 */
export async function generateRbdShareLink(
  mspId: number,
  rbdId: string,
  versionUid: string,
): Promise<MspRbdVersion | null> {
  const shareToken = randomBytes(24).toString("hex");
  const shareTokenExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  const updated = await db
    .update(mspRbdVersionsTable)
    .set({ shareToken, shareTokenExpiresAt })
    .where(
      and(
        eq(mspRbdVersionsTable.mspId, mspId),
        eq(mspRbdVersionsTable.rbdId, rbdId),
        eq(mspRbdVersionsTable.versionUid, versionUid),
        isNull(mspRbdVersionsTable.supersededAt),
        eq(mspRbdVersionsTable.signed, false),
      ),
    )
    .returning();
  return updated[0] ?? null;
}

/**
 * Resolves a share token to its version, or null if the token does not
 * exist or has expired. Does NOT check `supersededAt`/`signed` — a link
 * generated before signing should still resolve to show the now-signed
 * document (the public read/sign routes decide what that state means).
 */
export async function getRbdVersionByShareToken(shareToken: string): Promise<MspRbdVersion | null> {
  const [row] = await db
    .select()
    .from(mspRbdVersionsTable)
    .where(
      and(
        eq(mspRbdVersionsTable.shareToken, shareToken),
        or(isNull(mspRbdVersionsTable.shareTokenExpiresAt), gt(mspRbdVersionsTable.shareTokenExpiresAt, new Date())),
      ),
    )
    .limit(1);
  return row ?? null;
}
