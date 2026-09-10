/**
 * The ONE database read behind `requireRole`'s decision (#2458, part of #1696).
 *
 * Split out of ./rbac-ladder.ts so that the decision logic and the row source are
 * separately replaceable. Two real reasons, both of which showed up immediately:
 *
 *  1. **Tests.** 33 api-server suites mount real routers behind the real `requireRole`
 *     while mocking `@workspace/db` with only the handful of tables their own route
 *     touches. Before #2458 that worked because `requireRole` read no rows at all;
 *     after it, every one of them got `No "mspRolesTable" export is defined on the
 *     "@workspace/db" mock` → the read threw → fail closed → 503 on ~283 assertions
 *     that are not about RBAC. Those tests are asserting route behaviour, and the
 *     honest fix is to give them the ladder rows they never had to think about rather
 *     than to weaken the gate or to mock `requireRole` away and lose the coverage.
 *     `src/test-setup/rbac-ladder-rows.ts` replaces THIS module for the whole vitest
 *     run; nothing in ./rbac-ladder.ts needs a test-only export to make that work.
 *  2. **#1704.** When the permissions engine lands its real caching/loading strategy,
 *     this is the seam it replaces — one function with one return shape, rather than
 *     queries braided through the decision path.
 *
 * Deliberately platform-scoped (`msp_id IS NULL`) and MSP-system only. See
 * ./rbac-ladder.ts's header for why an MSP-scoped override of a `ladder.*` row must
 * never be honoured.
 */

import { db, mspFeatureRoleMappingTable, mspRolesTable } from "@workspace/db";
import { LADDER_CAPABILITY_KEYS, LEGACY_ROLE_ORDER } from "@workspace/db/rbac/legacy-ladder";
import { and, inArray, isNull } from "drizzle-orm";

/** One platform-scoped `msp_roles` row for a ladder rung. */
export interface LadderRungRow {
  readonly id: string;
  readonly key: string;
}

/** One platform-scoped `msp_feature_role_mapping` row for a `ladder.*` capability, decoded. */
export interface LadderMappingRow {
  readonly capabilityKey: string;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

export interface LadderRows {
  readonly rungs: readonly LadderRungRow[];
  readonly mappings: readonly LadderMappingRow[];
}

/** Every `ladder.*` capability key, in ladder order. */
export const LADDER_CAPABILITY_KEY_LIST: readonly string[] = LEGACY_ROLE_ORDER.map(
  (role) => LADDER_CAPABILITY_KEYS[role],
);

/** Coerce the jsonb payload defensively — a hand-edited row must not throw on an auth path. */
function decodeRoleIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/** Read the seven rung role ids and the seven platform `ladder.*` mapping rows. */
export async function readLadderRows(): Promise<LadderRows> {
  const roleRows = await db
    .select({ id: mspRolesTable.id, key: mspRolesTable.key })
    .from(mspRolesTable)
    .where(and(isNull(mspRolesTable.mspId), inArray(mspRolesTable.key, [...LEGACY_ROLE_ORDER])));

  const mappingRows = await db
    .select({
      capabilityKey: mspFeatureRoleMappingTable.capabilityKey,
      roles: mspFeatureRoleMappingTable.roles,
    })
    .from(mspFeatureRoleMappingTable)
    .where(
      and(
        isNull(mspFeatureRoleMappingTable.mspId),
        inArray(mspFeatureRoleMappingTable.capabilityKey, [...LADDER_CAPABILITY_KEY_LIST]),
      ),
    );

  return {
    rungs: roleRows.filter((row): row is LadderRungRow => typeof row.id === "string" && typeof row.key === "string"),
    mappings: mappingRows.map((row): LadderMappingRow => ({
      capabilityKey: row.capabilityKey,
      allow: decodeRoleIds((row.roles as { allow?: unknown } | null)?.allow),
      deny: decodeRoleIds((row.roles as { deny?: unknown } | null)?.deny),
    })),
  };
}
