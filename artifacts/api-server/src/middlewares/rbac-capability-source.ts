/**
 * The database reads behind a non-ladder capability decision (#2460, part of #1696).
 *
 * Split out of ./rbac-capability.ts for exactly the reasons ./rbac-ladder-source.ts
 * was split out of ./rbac-ladder.ts by #2458 — read that file's header first; this is
 * the same seam for the same two reasons:
 *
 *  1. **Tests.** Dozens of suites in this package mount a REAL router while mocking
 *     `@workspace/db` down to the handful of tables their own route touches. The
 *     moment a route's gate started reading `customer_roles` / `msp_user_roles` /
 *     `*_feature_role_mapping`, every one of them would fail closed with a 503 on
 *     assertions that have nothing to do with RBAC. `src/test-setup/rbac-capability-rows.ts`
 *     replaces THIS module for the whole vitest run, so the decision logic in
 *     ./rbac-capability.ts needs no test-only export and no weakening.
 *  2. **#1704.** When the permissions engine lands its real caching/loading strategy,
 *     this is the seam it replaces: a small set of named reads with fixed return
 *     shapes, rather than queries braided through the decision path.
 *
 * Everything here is a plain read or a membership write. No decision is made in this
 * file — deny-precedence, the rung/grant split and the fail-closed behaviour all live
 * in ./rbac-capability.ts, so a test that substitutes this module cannot accidentally
 * substitute the rules as well.
 */

import { and, eq, inArray, isNull, or } from "drizzle-orm";
import {
  db,
  usersTable,
  customerFeatureRoleMappingTable,
  customerRolesTable,
  customerUserRolesTable,
  mspFeatureRoleMappingTable,
  mspRolesTable,
  mspUserRolesTable,
} from "@workspace/db";
import type { RbacFeatureMapping } from "@workspace/db/rbac/evaluate";
import type { RbacSystem } from "@workspace/db/rbac/capabilities";
import type { LegacyRole } from "@workspace/db/rbac/legacy-ladder";

/** One role row, as every read below returns it. */
export interface RoleRow {
  readonly id: string;
  readonly key: string;
}

/** Coerce the jsonb payload defensively — a hand-edited row must not throw on an auth path. */
function decodeIds(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
}

/**
 * The id of the platform-scoped role with this key.
 *
 * Platform scope only, deliberately: these are the seven rungs and the `cap.*` grant
 * roles #2457 seeded, and an org-scoped row that happened to reuse one of those keys
 * must not be able to stand in for it.
 */
export async function readPlatformRoleId(system: RbacSystem, key: string): Promise<string | null> {
  if (system === "msp") {
    const [row] = await db
      .select({ id: mspRolesTable.id })
      .from(mspRolesTable)
      .where(and(eq(mspRolesTable.key, key), isNull(mspRolesTable.mspId)))
      .limit(1);
    return row?.id ?? null;
  }
  const [row] = await db
    .select({ id: customerRolesTable.id })
    .from(customerRolesTable)
    .where(and(eq(customerRolesTable.key, key), isNull(customerRolesTable.tenantId)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * Every role this user actually holds — platform-scoped rows plus this org's own.
 *
 * The scope filter is applied to the ROLE row rather than trusted from the join
 * table, the same discipline `loadRbacContext` uses: a mis-scoped membership row
 * still cannot produce a cross-org grant here.
 */
export async function readHeldRoles(
  system: RbacSystem,
  userId: number,
  orgId: number | null,
): Promise<RoleRow[]> {
  if (system === "msp") {
    const scope = orgId === null
      ? isNull(mspRolesTable.mspId)
      : or(isNull(mspRolesTable.mspId), eq(mspRolesTable.mspId, orgId));
    return db
      .select({ id: mspRolesTable.id, key: mspRolesTable.key })
      .from(mspUserRolesTable)
      .innerJoin(mspRolesTable, eq(mspRolesTable.id, mspUserRolesTable.roleId))
      .where(and(eq(mspUserRolesTable.userId, userId), scope));
  }
  const scope = orgId === null
    ? isNull(customerRolesTable.tenantId)
    : or(isNull(customerRolesTable.tenantId), eq(customerRolesTable.tenantId, orgId));
  return db
    .select({ id: customerRolesTable.id, key: customerRolesTable.key })
    .from(customerUserRolesTable)
    .innerJoin(customerRolesTable, eq(customerRolesTable.id, customerUserRolesTable.roleId))
    .where(and(eq(customerUserRolesTable.userId, userId), scope));
}

/** The platform + org feature→role mapping rows for one capability. */
export async function readMappings(
  system: RbacSystem,
  capability: string,
  orgId: number | null,
): Promise<RbacFeatureMapping[]> {
  if (system === "msp") {
    const scope = orgId === null
      ? isNull(mspFeatureRoleMappingTable.mspId)
      : or(isNull(mspFeatureRoleMappingTable.mspId), eq(mspFeatureRoleMappingTable.mspId, orgId));
    const rows = await db
      .select({
        orgId: mspFeatureRoleMappingTable.mspId,
        capabilityKey: mspFeatureRoleMappingTable.capabilityKey,
        roles: mspFeatureRoleMappingTable.roles,
      })
      .from(mspFeatureRoleMappingTable)
      .where(and(eq(mspFeatureRoleMappingTable.capabilityKey, capability), scope));
    return rows.map((row) => ({
      system: "msp" as const,
      capabilityKey: row.capabilityKey,
      orgId: row.orgId,
      allow: decodeIds((row.roles as { allow?: unknown } | null)?.allow),
      deny: decodeIds((row.roles as { deny?: unknown } | null)?.deny),
    }));
  }

  const scope = orgId === null
    ? isNull(customerFeatureRoleMappingTable.tenantId)
    : or(isNull(customerFeatureRoleMappingTable.tenantId), eq(customerFeatureRoleMappingTable.tenantId, orgId));
  const rows = await db
    .select({
      orgId: customerFeatureRoleMappingTable.tenantId,
      capabilityKey: customerFeatureRoleMappingTable.capabilityKey,
      roles: customerFeatureRoleMappingTable.roles,
    })
    .from(customerFeatureRoleMappingTable)
    .where(and(eq(customerFeatureRoleMappingTable.capabilityKey, capability), scope));
  return rows.map((row) => ({
    system: "customer" as const,
    capabilityKey: row.capabilityKey,
    orgId: row.orgId,
    allow: decodeIds((row.roles as { allow?: unknown } | null)?.allow),
    deny: decodeIds((row.roles as { deny?: unknown } | null)?.deny),
  }));
}

/** Look up the keys of a set of role ids, so a caller can tell a rung from a grant. */
export async function readRoleKeys(system: RbacSystem, roleIds: readonly string[]): Promise<RoleRow[]> {
  if (roleIds.length === 0) return [];
  if (system === "msp") {
    return db
      .select({ id: mspRolesTable.id, key: mspRolesTable.key })
      .from(mspRolesTable)
      .where(inArray(mspRolesTable.id, [...roleIds]));
  }
  return db
    .select({ id: customerRolesTable.id, key: customerRolesTable.key })
    .from(customerRolesTable)
    .where(inArray(customerRolesTable.id, [...roleIds]));
}

/** Every user id holding any of these roles. */
export async function readRoleMembers(system: RbacSystem, roleIds: readonly string[]): Promise<number[]> {
  if (roleIds.length === 0) return [];
  const rows = system === "msp"
    ? await db.select({ userId: mspUserRolesTable.userId }).from(mspUserRolesTable)
        .where(inArray(mspUserRolesTable.roleId, [...roleIds]))
    : await db.select({ userId: customerUserRolesTable.userId }).from(customerUserRolesTable)
        .where(inArray(customerUserRolesTable.roleId, [...roleIds]));
  return rows.map((r) => r.userId);
}

/**
 * Every user id whose `users.msp_role` is one of these rungs.
 *
 * Rung membership is read from the COLUMN, not from `*_user_roles`. The column is
 * the rung's source of truth. #3408's `users` triggers keep the rows in step with it,
 * but only where that migration has run. See ./rbac-capability.ts's header.
 */
export async function readUsersWithRung(rungs: readonly LegacyRole[]): Promise<number[]> {
  if (rungs.length === 0) return [];
  const rows = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(inArray(usersTable.mspRole, [...rungs]));
  return rows.map((r) => r.id);
}

/** Which of `userIds` hold `roleId`. */
export async function readMembersAmong(
  system: RbacSystem,
  roleId: string,
  userIds: readonly number[],
): Promise<number[]> {
  if (userIds.length === 0) return [];
  const rows = system === "msp"
    ? await db.select({ userId: mspUserRolesTable.userId }).from(mspUserRolesTable)
        .where(and(eq(mspUserRolesTable.roleId, roleId), inArray(mspUserRolesTable.userId, [...userIds])))
    : await db.select({ userId: customerUserRolesTable.userId }).from(customerUserRolesTable)
        .where(and(eq(customerUserRolesTable.roleId, roleId), inArray(customerUserRolesTable.userId, [...userIds])));
  return rows.map((r) => r.userId);
}

/**
 * Add or remove one membership row. Idempotent in both directions — the boolean
 * column this replaces could be set to the same value twice without complaint.
 */
export async function writeMembership(
  system: RbacSystem,
  userId: number,
  roleId: string,
  granted: boolean,
  grantedByUserId: number | null,
): Promise<void> {
  if (system === "msp") {
    if (granted) {
      await db.insert(mspUserRolesTable).values({ userId, roleId, grantedByUserId }).onConflictDoNothing();
    } else {
      await db.delete(mspUserRolesTable)
        .where(and(eq(mspUserRolesTable.userId, userId), eq(mspUserRolesTable.roleId, roleId)));
    }
    return;
  }
  if (granted) {
    await db.insert(customerUserRolesTable).values({ userId, roleId, grantedByUserId }).onConflictDoNothing();
  } else {
    await db.delete(customerUserRolesTable)
      .where(and(eq(customerUserRolesTable.userId, userId), eq(customerUserRolesTable.roleId, roleId)));
  }
}
