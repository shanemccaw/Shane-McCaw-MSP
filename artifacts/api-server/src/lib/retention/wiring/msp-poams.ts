/**
 * msp-poams.ts (retention wiring) — Git #3451.
 *
 * #3451: "no path exists anywhere in the current tree for `record_deletions` to ever
 * gain a row with `acceleration_state = 'pending'`" — the lifecycle mechanism
 * (`../lifecycle.ts`, #1947) is fully built and reachable, but the registries it
 * depends on (`../registry.ts`, `../origin-registry.ts`) both ship empty, and #1944's
 * own body names "POA&M soft delete (#1935) — the trigger" as the expected first real
 * producer. This is that wiring: it registers `msp_poams` so `softDelete()` /
 * `requestAcceleration()` actually have a record type to operate on.
 *
 * Imported for its registration side effect from both `routes/msp-poams.ts` (the
 * MSP-console side) and `routes/portal-poams.ts` (the customer side) — either import
 * alone is sufficient (the registries are process-wide singletons), importing from
 * both just means the wiring is discoverable from whichever file a reader opens first.
 * `registerPoamRetention()` is idempotent (guards on `getRetainedRecordType` /
 * `getOriginResolver` before registering) so calling it more than once never hits the
 * registries' own "already registered" throw.
 */

import { and, eq } from "drizzle-orm";
import { db, mspPoamsTable, tenantsTable } from "@workspace/db";
import { getRetainedRecordType, registerRetainedRecordType, type RetentionTx } from "../registry.ts";
import { getOriginResolver, registerOriginResolver } from "../origin-registry.ts";

const RECORD_TYPE = "msp_poams";

/**
 * `msp_poams` is an MSP-era table — `mspId` + a free-text M365 `tenantId`, not
 * `tenants.id` — the same shape `portal-poams.ts`'s own header documents for this
 * exact table. The retention registry needs `tenants.id`
 * (`RetainedRecordSnapshot.tenantId`), so this resolves the reverse direction: the
 * same `(mspId, tenantId)` pair lookup `msp-changes.ts` / `msp-change-execution-store.ts`
 * already use to find a tenant row from MSP-era columns.
 */
async function resolveTenantsId(mspId: number, tenantIdText: string): Promise<number | null> {
  const [row] = await db
    .select({ id: tenantsTable.id })
    .from(tenantsTable)
    .where(and(eq(tenantsTable.mspId, mspId), eq(tenantsTable.tenantId, tenantIdText)))
    .limit(1);
  return row?.id ?? null;
}

export function registerPoamRetention(): void {
  if (!getRetainedRecordType(RECORD_TYPE)) {
    registerRetainedRecordType({
      recordType: RECORD_TYPE,
      displayName: "POA&M",
      async load(recordId) {
        const id = Number(recordId);
        if (!Number.isFinite(id)) return null;

        const [row] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, id)).limit(1);
        if (!row) return null;

        const tenantsId = await resolveTenantsId(row.mspId, row.tenantId);
        if (tenantsId === null) {
          // Fail closed, same discipline `resolveTenantScope` uses: a POA&M whose
          // (mspId, tenantId) pair does not resolve to a real `tenants` row cannot be
          // scoped by the lifecycle's own per-customer retention policy, so it is
          // reported as not found rather than soft-deleted against a broken reference.
          return null;
        }

        return {
          recordId: String(row.id),
          tenantId: tenantsId,
          mspId: row.mspId,
          label: row.title,
          // No dedicated provenance column on this table. The one real provenance
          // fact it carries is whether it was converted FROM a signed risk
          // acceptance (#3081) rather than authored directly — recorded verbatim,
          // the same FK-derived-string approach `origin-registry.ts` already
          // documents for `msp_risk_decisions`' own nullable-FK provenance.
          rawOrigin: row.spawnedByRiskDecisionId ? "converted_from_risk_decision" : "manual",
          alreadyDeleted: row.deletedAt !== null,
        };
      },
      async markDeleted(tx: RetentionTx, recordId, mark) {
        await tx
          .update(mspPoamsTable)
          .set({
            deletedAt: mark.deletedAt,
            deletedBy: mark.deletedBy,
            deleteReason: mark.deleteReason,
            updatedAt: new Date(),
          })
          .where(eq(mspPoamsTable.id, Number(recordId)));
      },
      async clearDeleted(tx: RetentionTx, recordId) {
        await tx
          .update(mspPoamsTable)
          .set({ deletedAt: null, deletedBy: null, deleteReason: null, updatedAt: new Date() })
          .where(eq(mspPoamsTable.id, Number(recordId)));
      },
      async hardDelete(tx: RetentionTx, recordId) {
        // `msp_poam_milestones.poam_id` is `ON DELETE CASCADE` (schema/msp.ts), so the
        // plan's milestones go with it in the same statement.
        await tx.delete(mspPoamsTable).where(eq(mspPoamsTable.id, Number(recordId)));
      },
    });
  }

  if (!getOriginResolver(RECORD_TYPE)) {
    registerOriginResolver({
      recordType: RECORD_TYPE,
      column: null,
      // Only a hand-authored plan is a mistake-create eligible for the hard-delete
      // bypass; one converted from a signed risk acceptance is evidence of that
      // acceptance and must not be.
      isManual: (raw) => raw === "manual",
    });
  }
}
