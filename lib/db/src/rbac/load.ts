/**
 * Loading an RBAC decision context out of the database (#2455, part of #1696).
 *
 * The evaluator (./evaluate.ts) is deliberately pure; this is the only place that
 * knows the two systems live in different tables. Every caller above this line
 * sees one shape — `RbacContext` — regardless of which system it came from, which
 * is what "two systems, one mechanism" means in practice.
 *
 * Nothing in the running product calls this yet. #2455 is additive only: the
 * tables and this loader land, `requireRole` and `MSP_ROLES` keep working exactly
 * as they do today, and #2458 is what swaps the decision source underneath the
 * existing call signature.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  customerFeatureRoleMappingTable,
  customerRolesTable,
  customerUserRolesTable,
  mspFeatureRoleMappingTable,
  mspRolesTable,
  mspUserRolesTable,
  type RbacRoleMappingPayload,
} from "../schema/rbac";
import type { RbacSystem } from "./capabilities";
import { createRbacEvaluator, type RbacContext, type RbacEvaluator, type RbacFeatureMapping } from "./evaluate";

/**
 * Any Drizzle node-postgres handle. Deliberately not the `db` singleton from
 * ../index.ts: importing that would require DATABASE_URL at module load, which
 * would make this module unimportable from a unit test or a script that only
 * wants the types.
 */
export type RbacDb = NodePgDatabase<Record<string, never>>;

export interface LoadRbacContextInput {
  readonly system: RbacSystem;
  /** users.id — the same principal in both systems; only the role tables differ. */
  readonly userId: number;
  /**
   * The org the decision is being made inside: `msps.id` for the MSP system,
   * `tenants.id` for the customer system. Null is legitimate for a principal
   * with no org (a PlatformAdmin holds only platform-scoped roles).
   */
  readonly orgId: number | null;
}

/** Coerce the jsonb payload defensively — a hand-edited row must not throw here. */
function readMappingPayload(value: RbacRoleMappingPayload | null): { allow: string[]; deny: string[] } {
  const allow = Array.isArray(value?.allow) ? value.allow.filter((id): id is string => typeof id === "string") : [];
  const deny = Array.isArray(value?.deny) ? value.deny.filter((id): id is string => typeof id === "string") : [];
  return { allow, deny };
}

/**
 * Load every role this user holds and every mapping row that can bear on them.
 *
 * Both queries take the same scope shape: platform-scoped rows (`org_id IS NULL`)
 * PLUS this org's own rows, and nothing else. A role belonging to another org is
 * not merely unhelpful, it is a cross-tenant permission leak, so the scope filter
 * is applied on the ROLE row rather than trusted from the join table — a
 * mis-scoped `*_user_roles` row (which the migration's trigger already refuses to
 * create) still cannot produce a grant here.
 */
export async function loadRbacContext(db: RbacDb, input: LoadRbacContextInput): Promise<RbacContext> {
  const { system, userId, orgId } = input;

  if (system === "msp") {
    const roleScope = orgId === null ? isNull(mspRolesTable.mspId) : or(isNull(mspRolesTable.mspId), eq(mspRolesTable.mspId, orgId));
    const roleRows = await db
      .select({ id: mspRolesTable.id })
      .from(mspUserRolesTable)
      .innerJoin(mspRolesTable, eq(mspRolesTable.id, mspUserRolesTable.roleId))
      .where(and(eq(mspUserRolesTable.userId, userId), roleScope));

    const mappingScope = orgId === null
      ? isNull(mspFeatureRoleMappingTable.mspId)
      : or(isNull(mspFeatureRoleMappingTable.mspId), eq(mspFeatureRoleMappingTable.mspId, orgId));
    const mappingRows = await db
      .select({
        orgId: mspFeatureRoleMappingTable.mspId,
        capabilityKey: mspFeatureRoleMappingTable.capabilityKey,
        roles: mspFeatureRoleMappingTable.roles,
      })
      .from(mspFeatureRoleMappingTable)
      .where(mappingScope);

    return {
      system,
      userId,
      orgId,
      roleIds: roleRows.map((r) => r.id),
      mappings: mappingRows.map((row): RbacFeatureMapping => ({
        system: "msp",
        capabilityKey: row.capabilityKey,
        orgId: row.orgId,
        ...readMappingPayload(row.roles),
      })),
    };
  }

  const roleScope = orgId === null
    ? isNull(customerRolesTable.tenantId)
    : or(isNull(customerRolesTable.tenantId), eq(customerRolesTable.tenantId, orgId));
  const roleRows = await db
    .select({ id: customerRolesTable.id })
    .from(customerUserRolesTable)
    .innerJoin(customerRolesTable, eq(customerRolesTable.id, customerUserRolesTable.roleId))
    .where(and(eq(customerUserRolesTable.userId, userId), roleScope));

  const mappingScope = orgId === null
    ? isNull(customerFeatureRoleMappingTable.tenantId)
    : or(isNull(customerFeatureRoleMappingTable.tenantId), eq(customerFeatureRoleMappingTable.tenantId, orgId));
  const mappingRows = await db
    .select({
      orgId: customerFeatureRoleMappingTable.tenantId,
      capabilityKey: customerFeatureRoleMappingTable.capabilityKey,
      roles: customerFeatureRoleMappingTable.roles,
    })
    .from(customerFeatureRoleMappingTable)
    .where(mappingScope);

  return {
    system,
    userId,
    orgId,
    roleIds: roleRows.map((r) => r.id),
    mappings: mappingRows.map((row): RbacFeatureMapping => ({
      system: "customer",
      capabilityKey: row.capabilityKey,
      orgId: row.orgId,
      ...readMappingPayload(row.roles),
    })),
  };
}

/**
 * Load once, then answer many capability questions off that single snapshot.
 *
 * The snapshot boundary is the point: two checks inside one request must not be
 * able to disagree because a grant changed between them.
 */
export async function loadRbacEvaluator(db: RbacDb, input: LoadRbacContextInput): Promise<RbacEvaluator> {
  return createRbacEvaluator(await loadRbacContext(db, input));
}

/**
 * Every user id holding a given role — the "membership visible from both
 * directions" the AD-style panes in AdminV2 already expect (#64, #67).
 */
export async function listRoleMembers(db: RbacDb, system: RbacSystem, roleId: string): Promise<number[]> {
  if (system === "msp") {
    const rows = await db
      .select({ userId: mspUserRolesTable.userId })
      .from(mspUserRolesTable)
      .where(eq(mspUserRolesTable.roleId, sql`${roleId}::uuid`));
    return rows.map((r) => r.userId);
  }
  const rows = await db
    .select({ userId: customerUserRolesTable.userId })
    .from(customerUserRolesTable)
    .where(eq(customerUserRolesTable.roleId, sql`${roleId}::uuid`));
  return rows.map((r) => r.userId);
}
