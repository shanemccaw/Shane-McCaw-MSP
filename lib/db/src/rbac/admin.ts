/**
 * RBAC admin CRUD (#2461, part of #1696) — the management surface for the
 * tables #2455 landed.
 *
 * This is deliberately separate from ./load.ts: load.ts answers "what can this
 * user do right now" (read-only, used by the not-yet-wired evaluator path);
 * this module answers "manage the roles, memberships and mappings themselves" —
 * create/rename/delete a role, assign/remove a user's membership, view/set a
 * feature's allow/deny mapping. It is what AdminV2's re-pointed AD-style UI
 * (#2461) calls, through artifacts/api-server/src/routes/admin-rbac.ts.
 *
 * Nothing here changes what MSP_ROLES/requireRole enforce — #2457 (express
 * today's roles as data) and #2458 (move enforcement onto the evaluator) are
 * still pending, exactly as #2455 left them. This module only manages the
 * NEW tables; the ladder keeps deciding real access until #2458 lands.
 *
 * Every mutating function here can fail because a database trigger refused the
 * write (../../migrations/manual/2026-09-09-rbac-foundation-2455.sql — the scope
 * and integrity checks a jsonb column and a plain FK cannot express on their
 * own). Those failures are caught and turned into a real, honest `{ ok: false }`
 * result rather than an unhandled 500 — the trigger's own RAISE EXCEPTION text is
 * threaded through since it already names the exact row and reason.
 */

import { and, eq, isNull, or, sql } from "drizzle-orm";
import {
  customerFeatureRoleMappingTable,
  customerRolesTable,
  customerUserRolesTable,
  mspFeatureRoleMappingTable,
  mspRolesTable,
  mspUserRolesTable,
  usersTable,
  EMPTY_ROLE_MAPPING,
  type RbacRoleMappingPayload,
} from "../schema";
import { isKnownCapability, type RbacSystem } from "./capabilities";
import type { RbacDb } from "./load";

export interface RbacRoleSummary {
  readonly id: string;
  readonly system: RbacSystem;
  /** null = platform-scoped (every org's users may hold it). */
  readonly orgId: number | null;
  readonly key: string;
  readonly name: string;
  readonly description: string;
  readonly isSystem: boolean;
  readonly memberCount: number;
}

function rolesTable(system: RbacSystem) {
  return system === "msp" ? mspRolesTable : customerRolesTable;
}
function userRolesTable(system: RbacSystem) {
  return system === "msp" ? mspUserRolesTable : customerUserRolesTable;
}
function mappingTable(system: RbacSystem) {
  return system === "msp" ? mspFeatureRoleMappingTable : customerFeatureRoleMappingTable;
}
/** `msp_roles.msp_id` / `customer_roles.tenant_id` — the org-scope column name differs per system. */
function roleOrgColumn(system: RbacSystem) {
  return system === "msp" ? mspRolesTable.mspId : customerRolesTable.tenantId;
}
function mappingOrgColumn(system: RbacSystem) {
  return system === "msp" ? mspFeatureRoleMappingTable.mspId : customerFeatureRoleMappingTable.tenantId;
}

/** Postgres error shape for a driver-level failure (trigger RAISE EXCEPTION, constraint violation, …). */
function pgMessage(err: unknown): string {
  if (err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string") {
    return (err as { message: string }).message;
  }
  return "The database refused this write.";
}

// ── Roles ──────────────────────────────────────────────────────────────────

/** Platform-scoped roles (orgId null) PLUS the given org's own roles, in that order. */
export async function listRoles(db: RbacDb, system: RbacSystem, orgId: number | null): Promise<RbacRoleSummary[]> {
  const roles = rolesTable(system) as typeof mspRolesTable;
  const userRoles = userRolesTable(system) as typeof mspUserRolesTable;
  const orgCol = roleOrgColumn(system) as typeof mspRolesTable.mspId;

  const scope = orgId === null ? isNull(orgCol) : or(isNull(orgCol), eq(orgCol, orgId));

  const rows = await db
    .select({
      id: roles.id,
      orgId: orgCol,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      memberCount: sql<number>`count(${userRoles.userId})`.mapWith(Number),
    })
    .from(roles)
    .leftJoin(userRoles, eq(userRoles.roleId, roles.id))
    .where(scope)
    .groupBy(roles.id, orgCol, roles.key, roles.name, roles.description, roles.isSystem)
    .orderBy(roles.name);

  return rows.map((r) => ({ ...r, system }));
}

export type CreateRoleResult = { ok: true; role: RbacRoleSummary } | { ok: false; error: string };

export async function createRole(
  db: RbacDb,
  system: RbacSystem,
  input: { orgId: number | null; key: string; name: string; description?: string },
): Promise<CreateRoleResult> {
  const key = input.key.trim();
  const name = input.name.trim();
  if (!key) return { ok: false, error: "A role key is required." };
  if (!name) return { ok: false, error: "A role name is required." };

  const description = input.description?.trim() ?? "";

  try {
    // Two branches, not a dynamic `{ [orgColumn]: ... }` key: drizzle's `.values()`
    // is keyed by the schema's JS property name (`mspId` / `tenantId`), which is
    // not recoverable from the column object at runtime the way the DB column
    // name is — and this is an insert on a security-relevant table, not a place
    // to lean on a clever-but-unverified shortcut.
    if (system === "msp") {
      const [created] = await db
        .insert(mspRolesTable)
        .values({ mspId: input.orgId, key, name, description })
        .returning({ id: mspRolesTable.id, orgId: mspRolesTable.mspId, key: mspRolesTable.key, name: mspRolesTable.name, description: mspRolesTable.description, isSystem: mspRolesTable.isSystem });
      return { ok: true, role: { ...created, system, memberCount: 0 } };
    }
    const [created] = await db
      .insert(customerRolesTable)
      .values({ tenantId: input.orgId, key, name, description })
      .returning({ id: customerRolesTable.id, orgId: customerRolesTable.tenantId, key: customerRolesTable.key, name: customerRolesTable.name, description: customerRolesTable.description, isSystem: customerRolesTable.isSystem });
    return { ok: true, role: { ...created, system, memberCount: 0 } };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

export type MutateRoleResult = { ok: true; role: RbacRoleSummary } | { ok: false; error: string };

export async function renameRole(
  db: RbacDb,
  system: RbacSystem,
  roleId: string,
  input: { name?: string; description?: string },
): Promise<MutateRoleResult> {
  const roles = rolesTable(system) as typeof mspRolesTable;
  const orgCol = roleOrgColumn(system) as typeof mspRolesTable.mspId;
  const userRoles = userRolesTable(system) as typeof mspUserRolesTable;

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    const trimmed = input.name.trim();
    if (!trimmed) return { ok: false, error: "Role name cannot be blank." };
    set.name = trimmed;
  }
  if (input.description !== undefined) set.description = input.description.trim();

  try {
    const [updated] = await db.update(roles).set(set).where(eq(roles.id, roleId)).returning({
      id: roles.id,
      orgId: orgCol,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    });
    if (!updated) return { ok: false, error: "Role not found." };

    const [{ memberCount }] = await db
      .select({ memberCount: sql<number>`count(*)`.mapWith(Number) })
      .from(userRoles)
      .where(eq(userRoles.roleId, roleId));

    return { ok: true, role: { ...updated, system, memberCount } };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

export type DeleteRoleResult = { ok: true } | { ok: false; error: string };

/**
 * Refuses to delete a platform-defined baseline role (`is_system`) — #1696's
 * "an MSP/customer admin may grant it but not delete it." Deleting an org's own
 * custom role cascades its `*_user_roles` memberships (FK `onDelete: cascade`)
 * and strips it from every mapping's allow/deny arrays in the same transaction
 * (the `rbac_purge_deleted_*_role` trigger — #1696 requirement 2, a delete must
 * not orphan a jsonb reference).
 */
export async function deleteRole(db: RbacDb, system: RbacSystem, roleId: string): Promise<DeleteRoleResult> {
  const roles = rolesTable(system) as typeof mspRolesTable;

  const [existing] = await db.select({ isSystem: roles.isSystem }).from(roles).where(eq(roles.id, roleId)).limit(1);
  if (!existing) return { ok: false, error: "Role not found." };
  if (existing.isSystem) return { ok: false, error: "This is a platform-defined baseline role and cannot be deleted." };

  try {
    await db.delete(roles).where(eq(roles.id, roleId));
    return { ok: true };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

// ── User ↔ role membership ────────────────────────────────────────────────

/** Every role (with its full summary, incl. member count) a user holds in one system. */
export async function listUserRoles(db: RbacDb, system: RbacSystem, userId: number): Promise<RbacRoleSummary[]> {
  const roles = rolesTable(system) as typeof mspRolesTable;
  const userRoles = userRolesTable(system) as typeof mspUserRolesTable;
  const orgCol = roleOrgColumn(system) as typeof mspRolesTable.mspId;

  const rows = await db
    .select({
      id: roles.id,
      orgId: orgCol,
      key: roles.key,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
    })
    .from(userRoles)
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(eq(userRoles.userId, userId))
    .orderBy(roles.name);

  // Member counts aren't needed per-row here (the caller already knows this
  // user is one member); report 0 rather than a second round-trip per role.
  return rows.map((r) => ({ ...r, system, memberCount: 0 }));
}

export type AssignRoleResult = { ok: true } | { ok: false; error: string };

/**
 * Grant a user a role. The `*_user_roles_scope_check` trigger is the real
 * enforcement of "a user may only hold a role from their own org or the
 * platform scope" (#1696 requirement 2's cross-table invariant, which a plain
 * CHECK constraint cannot see) — this function does not duplicate that logic,
 * it just surfaces the trigger's refusal as a normal result instead of a raw
 * driver exception.
 */
export async function assignUserRole(
  db: RbacDb,
  system: RbacSystem,
  userId: number,
  roleId: string,
  grantedByUserId: number,
): Promise<AssignRoleResult> {
  const userRoles = userRolesTable(system) as typeof mspUserRolesTable;
  try {
    await db.insert(userRoles).values({ userId, roleId, grantedByUserId }).onConflictDoNothing();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

export async function removeUserRole(db: RbacDb, system: RbacSystem, userId: number, roleId: string): Promise<{ ok: true }> {
  const userRoles = userRolesTable(system) as typeof mspUserRolesTable;
  await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.roleId, roleId)));
  return { ok: true };
}

/** The org a user's role assignments in this system should be scoped to — msps.id or tenants.id. */
export async function resolveUserOrgId(db: RbacDb, system: RbacSystem, userId: number): Promise<number | null> {
  const [row] = await db
    .select({ mspId: usersTable.mspId, tenantId: usersTable.tenantId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!row) return null;
  return system === "msp" ? row.mspId : row.tenantId;
}

// ── Feature → role mapping ─────────────────────────────────────────────────

/** One capability's allow/deny row for one org (or the platform default when `orgId` is null). */
export async function getMapping(
  db: RbacDb,
  system: RbacSystem,
  orgId: number | null,
  capabilityKey: string,
): Promise<RbacRoleMappingPayload> {
  const mapping = mappingTable(system) as typeof mspFeatureRoleMappingTable;
  const orgCol = mappingOrgColumn(system) as typeof mspFeatureRoleMappingTable.mspId;

  const [row] = await db
    .select({ roles: mapping.roles })
    .from(mapping)
    .where(and(eq(mapping.capabilityKey, capabilityKey), orgId === null ? isNull(orgCol) : eq(orgCol, orgId)))
    .limit(1);

  return row?.roles ?? EMPTY_ROLE_MAPPING;
}

export type UpsertMappingResult = { ok: true; roles: RbacRoleMappingPayload } | { ok: false; error: string };

/**
 * Set one capability's full allow/deny payload for one org (or the platform
 * default when `orgId` is null). Whole-payload replace, not a merge — the
 * caller (the admin UI) always has the current payload in hand from
 * `getMapping`/`listMappings` before editing it.
 */
export async function upsertMapping(
  db: RbacDb,
  system: RbacSystem,
  orgId: number | null,
  capabilityKey: string,
  payload: RbacRoleMappingPayload,
): Promise<UpsertMappingResult> {
  if (!isKnownCapability(system, capabilityKey)) {
    return { ok: false, error: `'${capabilityKey}' is not a catalogued ${system} capability.` };
  }

  const mapping = mappingTable(system) as typeof mspFeatureRoleMappingTable;
  const orgCol = mappingOrgColumn(system) as typeof mspFeatureRoleMappingTable.mspId;
  const roles: RbacRoleMappingPayload = { allow: [...new Set(payload.allow)], deny: [...new Set(payload.deny)] };

  try {
    const [existing] = await db
      .select({ id: mapping.id })
      .from(mapping)
      .where(and(eq(mapping.capabilityKey, capabilityKey), orgId === null ? isNull(orgCol) : eq(orgCol, orgId)))
      .limit(1);

    if (existing) {
      await db.update(mapping).set({ roles, updatedAt: new Date() }).where(eq(mapping.id, existing.id));
    } else if (system === "msp") {
      await db.insert(mspFeatureRoleMappingTable).values({ mspId: orgId, capabilityKey, roles });
    } else {
      await db.insert(customerFeatureRoleMappingTable).values({ tenantId: orgId, capabilityKey, roles });
    }
    return { ok: true, roles };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

/** Every mapping row (platform-default + this org's own) for one system, capability-catalog order. */
export async function listMappings(
  db: RbacDb,
  system: RbacSystem,
  orgId: number | null,
): Promise<Array<{ capabilityKey: string; orgId: number | null; roles: RbacRoleMappingPayload }>> {
  const mapping = mappingTable(system) as typeof mspFeatureRoleMappingTable;
  const orgCol = mappingOrgColumn(system) as typeof mspFeatureRoleMappingTable.mspId;
  const scope = orgId === null ? isNull(orgCol) : or(isNull(orgCol), eq(orgCol, orgId));

  const rows = await db.select({ capabilityKey: mapping.capabilityKey, orgId: orgCol, roles: mapping.roles }).from(mapping).where(scope);
  return rows;
}
