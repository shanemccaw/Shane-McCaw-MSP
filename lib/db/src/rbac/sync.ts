/**
 * Keeping the `rbac_capabilities` table equal to the TypeScript catalog (#2455).
 *
 * ../rbac/capabilities.ts is the source of truth — it is what makes the set
 * compile-time enumerable, which is #1696 requirement 3 and the precondition for
 * #1698's mechanical "does every route carry a requirement" pass. The table is a
 * projection of it, kept only so the two `*_feature_role_mapping` tables can carry
 * a real composite foreign key onto a capability key.
 *
 * Adding a capability is therefore: one entry in the TS catalog, then run this.
 * No migration, no column — which is the whole point of the redesign.
 */

import { sql } from "drizzle-orm";
import { rbacCapabilitiesTable } from "../schema/rbac.ts";
import { RBAC_CAPABILITIES, capabilityId } from "./capabilities.ts";
import type { RbacDb } from "./load.ts";

export interface CapabilitySyncResult {
  /** Rows inserted or refreshed from the TS catalog. */
  readonly upserted: number;
  /** Rows still present in the table but no longer in the TS catalog, flagged inactive. */
  readonly deactivated: number;
  /** Rows previously flagged inactive that the TS catalog has re-introduced. */
  readonly reactivated: number;
}

/**
 * Upsert every catalogued capability, then flag anything left over inactive.
 *
 * Retired capabilities are flagged, never deleted: a mapping row may still
 * reference the key (the FK would refuse the delete anyway), and losing the record
 * of who once held a permission is not something an audit trail can afford. An
 * inactive row is still denied by the evaluator, because the evaluator reads the
 * TS catalog rather than this table — the flag is for the admin UI's benefit.
 */
export async function syncCapabilityCatalog(db: RbacDb): Promise<CapabilitySyncResult> {
  const rows = RBAC_CAPABILITIES.map((capability) => ({
    system: capability.system,
    key: capability.key,
    category: capability.category,
    label: capability.label,
    description: capability.description,
    isActive: true,
  }));

  if (rows.length === 0) {
    // Not a real state today, but an empty catalog must not silently wipe the
    // table's active flags on the way to becoming one.
    return { upserted: 0, deactivated: 0, reactivated: 0 };
  }

  const previouslyInactive = await db
    .select({ system: rbacCapabilitiesTable.system, key: rbacCapabilitiesTable.key })
    .from(rbacCapabilitiesTable)
    .where(sql`${rbacCapabilitiesTable.isActive} = false`);

  await db
    .insert(rbacCapabilitiesTable)
    .values(rows)
    .onConflictDoUpdate({
      target: [rbacCapabilitiesTable.system, rbacCapabilitiesTable.key],
      set: {
        category: sql`excluded.category`,
        label: sql`excluded.label`,
        description: sql`excluded.description`,
        isActive: sql`true`,
        updatedAt: sql`now()`,
      },
    });

  const catalogued = RBAC_CAPABILITIES.map((c) => capabilityId(c.system, c.key));
  const deactivated = await db
    .update(rbacCapabilitiesTable)
    .set({ isActive: false, updatedAt: new Date() })
    .where(
      sql`${rbacCapabilitiesTable.isActive} = true AND (${rbacCapabilitiesTable.system} || ':' || ${rbacCapabilitiesTable.key}) NOT IN (${sql.join(catalogued.map((id) => sql`${id}`), sql`, `)})`,
    )
    .returning({ key: rbacCapabilitiesTable.key });

  const reactivated = previouslyInactive.filter((row) =>
    catalogued.includes(capabilityId(row.system, row.key)),
  ).length;

  return { upserted: rows.length, deactivated: deactivated.length, reactivated };
}
