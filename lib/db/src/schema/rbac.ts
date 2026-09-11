/**
 * RBAC foundation tables (#2455, part of #1696 — RBAC Role Model Redesign).
 *
 * Migration step 1 of 5. These tables landed ALONGSIDE the then-existing role enum
 * enum and the three per-user boolean capability columns, and nothing reads them
 * yet — expressing today's roles as data is #2457, moving `requireRole`'s decision
 * source onto them is #2458. This step is purely additive: zero behavior change.
 *
 * ── Why any of this exists ──────────────────────────────────────────────────
 * That enum was not RBAC, it was a privilege ladder — `requireAuth.ts`'s
 * `ROLE_ORDER` is a totally ordered list and every check is "your index >= the
 * required index," so every role is a strict superset of the one below it. A
 * ladder cannot express "an engineer can see remediation but not billing," which
 * is a SIDEWAYS permission. `can_manage_team` / `can_approve_purchases` /
 * `can_approve_changes` are the escape hatches that already had to be bolted on
 * beside the ladder, one column per permission, granted per user with no way to
 * say "engineers get this set." What is needed instead is a lattice: arbitrary
 * permission sets composed by holding several roles at once, which is what the
 * many-to-many `*_user_roles` tables below are for.
 *
 * ── Two systems, one mechanism ──────────────────────────────────────────────
 * #1696's architecture decision (2026-08-29, re-confirmed by Shane 2026-09-09):
 * MSP identity and customer identity are SEPARATE systems — different lifecycles,
 * different admins, different blast radius — that share one mechanism. Hence two
 * parallel sets of three tables with an identical shape, one shared capability
 * catalog, and exactly one evaluation function (../rbac/evaluate.ts) serving both.
 * The tables are separate so a customer-side mistake cannot reach MSP staff; the
 * code is shared so the two cannot drift.
 *
 * ── Scope: platform default + org override ──────────────────────────────────
 * `msp_id` / `tenant_id` NULL means "platform-scoped": a role every org's users
 * may hold, or a mapping that applies to every org. Non-null means that org's own.
 * This is the shape Shane described on 2026-09-09 — a platform default set of
 * customer roles that a customer can then customise (e.g. hiding billing from
 * their engineer role). Precedence between the two is fixed in the evaluator:
 * the sets are merged and DENY WINS, so an org override can grant something the
 * platform left unset but can never un-deny a platform deny.
 *
 * ── Integrity the schema cannot express, and how it is enforced anyway ───────
 * The feature→role mapping is a `jsonb` column, per #1696, and a jsonb column has
 * no foreign key. Three triggers in the migration
 * (lib/db/migrations/manual/2026-09-09-rbac-foundation-2455.sql) supply what the
 * column cannot:
 *
 *   1. Every role id inside `roles` must exist, and must be in a scope the row is
 *      allowed to reference (validated on insert/update).
 *   2. Deleting a role strips its id from every mapping's allow/deny arrays, in
 *      the same transaction — #1696 requirement 2, "a rename/delete must not
 *      orphan a reference." Renaming is free because nothing stores the name.
 *   3. A user may only hold a role from their OWN org's scope or from the
 *      platform scope — never another org's role.
 *
 * Everything else is a real FK, including a composite FK from each mapping table
 * to the capability catalog, so an uncatalogued capability key cannot be stored.
 */

import { pgTable, text, integer, uuid, boolean, timestamp, jsonb, primaryKey, uniqueIndex, index, foreignKey, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { usersTable } from "./index.ts";
import { mspsTable, tenantsTable } from "./msp.ts";
import { RBAC_SYSTEMS } from "../rbac/capabilities.ts";

/**
 * The allow/deny payload of a `*_feature_role_mapping` row.
 *
 * Role UUIDs, never role names (#1696 requirement 2 — the SID lesson: renaming a
 * group must not orphan every ACL that mentions it).
 */
export type RbacRoleMappingPayload = {
  allow: string[];
  deny: string[];
};

export const EMPTY_ROLE_MAPPING: RbacRoleMappingPayload = { allow: [], deny: [] };

// ── The shared capability catalog ─────────────────────────────────────────────

/**
 * Projection of the TypeScript catalog in ../rbac/capabilities.ts, which is the
 * real source of truth (it is what makes the set enumerable at compile time, per
 * #1696 requirement 3 and #1698's mechanical route-coverage pass).
 *
 * This table exists so the two mapping tables can carry a real composite FK onto
 * it — that is the only reason a database copy is kept at all. Keep it in sync
 * with `syncCapabilityCatalog()` (../rbac/sync.ts); rows dropped from the TS
 * catalog are marked `is_active = false` rather than deleted, because deleting a
 * row that a mapping still references would fail the FK, and a capability being
 * retired is not a reason to lose the record of who had it.
 */
export const rbacCapabilitiesTable = pgTable("rbac_capabilities", {
  /** "msp" | "customer" — half of the primary key. The key alone is NOT unique. */
  system: text("system", { enum: RBAC_SYSTEMS }).notNull(),
  /** Stable dotted machine key, e.g. `billing.view`. Immutable once shipped. */
  key: text("key").notNull(),
  category: text("category").notNull(),
  label: text("label").notNull(),
  description: text("description").notNull().default(""),
  /** False = retired from the TS catalog. Retired capabilities always evaluate denied. */
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.system, t.key] }),
  index("rbac_capabilities_system_idx").on(t.system),
]);

export type RbacCapabilityRow = typeof rbacCapabilitiesTable.$inferSelect;
export type InsertRbacCapabilityRow = typeof rbacCapabilitiesTable.$inferInsert;

// ── MSP system ────────────────────────────────────────────────────────────────

/**
 * A named permission set belonging to one MSP — or to the platform when
 * `msp_id` is null, which is how a baseline role every MSP inherits is expressed.
 *
 * `id` is a uuid on purpose. It is the stable reference stored inside the mapping
 * jsonb, so it must never be reused or guessable-by-sequence; `name` is display
 * only and free to change, and `key` is the stable machine handle a seed or a
 * migration can look a system role up by.
 */
export const mspRolesTable = pgTable("msp_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = platform-scoped role, holdable by any MSP's users. */
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  /** Stable machine handle, unique within the scope. Not shown to users. */
  key: text("key").notNull(),
  /** Display name. Renameable at any time — nothing references it. */
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Platform-defined baseline role: an MSP admin may grant it but not delete it. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("msp_roles_msp_id_idx").on(t.mspId),
  // Two partial uniques rather than one composite: Postgres treats NULLs as
  // distinct, so a plain unique(msp_id, key) would let the platform scope hold
  // unlimited duplicates of the same key.
  uniqueIndex("msp_roles_scoped_key_idx").on(t.mspId, t.key).where(sql`msp_id IS NOT NULL`),
  uniqueIndex("msp_roles_platform_key_idx").on(t.key).where(sql`msp_id IS NULL`),
]);

export type MspRoleRow = typeof mspRolesTable.$inferSelect;
export type InsertMspRoleRow = typeof mspRolesTable.$inferInsert;

/**
 * Many-to-many: a user holds several roles, a role has many users. This is the
 * table the ladder could not be — holding two rungs of `ROLE_ORDER` was just the
 * higher rung, whereas holding two rows here genuinely composes two permission sets.
 *
 * Same-org-or-platform scoping is enforced by a trigger, not a constraint: it is a
 * cross-row invariant (users.msp_id vs msp_roles.msp_id) and CHECK cannot see
 * another table.
 *
 * #3408 — the platform-scoped rung rows here and in `customer_user_roles`, plus
 * `cap.changes.approve` and the below-MSPOperator revoke of `cap.purchases.approve`,
 * are maintained by triggers on `users` (`rbac_sync_user_roles`,
 * lib/db/migrations/manual/2026-09-10-rbac-user-roles-maintained-3408.sql). No
 * application code writes a rung row; a users INSERT/UPDATE does.
 */
export const mspUserRolesTable = pgTable("msp_user_roles", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => mspRolesTable.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  /** Who granted it. Kept when that user is deleted — the audit trail outlives the grantor. */
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index("msp_user_roles_role_id_idx").on(t.roleId),
  index("msp_user_roles_granted_by_user_id_idx").on(t.grantedByUserId),
]);

export type MspUserRoleRow = typeof mspUserRolesTable.$inferSelect;
export type InsertMspUserRoleRow = typeof mspUserRolesTable.$inferInsert;

/**
 * One capability's allow/deny role sets, for one MSP (or platform-wide when
 * `msp_id` is null).
 *
 * `system` is pinned to 'msp' by a CHECK purely so the composite FK onto
 * `rbac_capabilities (system, key)` can exist — that FK is what stops a
 * customer-side capability being mapped to an MSP role, and stops an uncatalogued
 * string being stored at all.
 */
export const mspFeatureRoleMappingTable = pgTable("msp_feature_role_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = platform default mapping, applying to every MSP. */
  mspId: integer("msp_id").references(() => mspsTable.id, { onDelete: "cascade" }),
  system: text("system", { enum: RBAC_SYSTEMS }).notNull().default("msp"),
  capabilityKey: text("capability_key").notNull(),
  /** `{ "allow": [role uuid, ...], "deny": [role uuid, ...] }` — ids, never names. */
  roles: jsonb("roles").$type<RbacRoleMappingPayload>().notNull().default(EMPTY_ROLE_MAPPING),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.system, t.capabilityKey],
    foreignColumns: [rbacCapabilitiesTable.system, rbacCapabilitiesTable.key],
    name: "msp_feature_role_mapping_capability_fk",
  }),
  check("msp_feature_role_mapping_system_check", sql`${t.system} = 'msp'`),
  check("msp_feature_role_mapping_shape_check", sql`jsonb_typeof(${t.roles} -> 'allow') = 'array' AND jsonb_typeof(${t.roles} -> 'deny') = 'array'`),
  uniqueIndex("msp_feature_role_mapping_scoped_idx").on(t.mspId, t.capabilityKey).where(sql`msp_id IS NOT NULL`),
  uniqueIndex("msp_feature_role_mapping_platform_idx").on(t.capabilityKey).where(sql`msp_id IS NULL`),
  index("msp_feature_role_mapping_capability_idx").on(t.capabilityKey),
]);

export type MspFeatureRoleMappingRow = typeof mspFeatureRoleMappingTable.$inferSelect;
export type InsertMspFeatureRoleMappingRow = typeof mspFeatureRoleMappingTable.$inferInsert;

// ── Customer system ───────────────────────────────────────────────────────────
// Same three tables, same shape, deliberately separate rows and separate FKs.
// A customer org is a `tenants` row (users.tenant_id -> tenants.id).

/** A named permission set belonging to one customer — or platform-scoped when null. */
export const customerRolesTable = pgTable("customer_roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = platform-scoped role every customer inherits, e.g. the default baseline. */
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  key: text("key").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  /** Platform-defined baseline role: a customer admin may grant it but not delete it. */
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("customer_roles_tenant_id_idx").on(t.tenantId),
  uniqueIndex("customer_roles_scoped_key_idx").on(t.tenantId, t.key).where(sql`tenant_id IS NOT NULL`),
  uniqueIndex("customer_roles_platform_key_idx").on(t.key).where(sql`tenant_id IS NULL`),
]);

export type CustomerRoleRow = typeof customerRolesTable.$inferSelect;
export type InsertCustomerRoleRow = typeof customerRolesTable.$inferInsert;

/** Many-to-many customer user ↔ customer role. Scope enforced by trigger. */
export const customerUserRolesTable = pgTable("customer_user_roles", {
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  roleId: uuid("role_id").notNull().references(() => customerRolesTable.id, { onDelete: "cascade" }),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),
  grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id, { onDelete: "set null" }),
}, (t) => [
  primaryKey({ columns: [t.userId, t.roleId] }),
  index("customer_user_roles_role_id_idx").on(t.roleId),
  index("customer_user_roles_granted_by_user_id_idx").on(t.grantedByUserId),
]);

export type CustomerUserRoleRow = typeof customerUserRolesTable.$inferSelect;
export type InsertCustomerUserRoleRow = typeof customerUserRolesTable.$inferInsert;

/** One capability's allow/deny role sets for one customer (or platform-wide). */
export const customerFeatureRoleMappingTable = pgTable("customer_feature_role_mapping", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** null = platform default mapping, applying to every customer. */
  tenantId: integer("tenant_id").references(() => tenantsTable.id, { onDelete: "cascade" }),
  system: text("system", { enum: RBAC_SYSTEMS }).notNull().default("customer"),
  capabilityKey: text("capability_key").notNull(),
  roles: jsonb("roles").$type<RbacRoleMappingPayload>().notNull().default(EMPTY_ROLE_MAPPING),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.system, t.capabilityKey],
    foreignColumns: [rbacCapabilitiesTable.system, rbacCapabilitiesTable.key],
    name: "customer_feature_role_mapping_capability_fk",
  }),
  check("customer_feature_role_mapping_system_check", sql`${t.system} = 'customer'`),
  check("customer_feature_role_mapping_shape_check", sql`jsonb_typeof(${t.roles} -> 'allow') = 'array' AND jsonb_typeof(${t.roles} -> 'deny') = 'array'`),
  uniqueIndex("customer_feature_role_mapping_scoped_idx").on(t.tenantId, t.capabilityKey).where(sql`tenant_id IS NOT NULL`),
  uniqueIndex("customer_feature_role_mapping_platform_idx").on(t.capabilityKey).where(sql`tenant_id IS NULL`),
  index("customer_feature_role_mapping_capability_idx").on(t.capabilityKey),
]);

export type CustomerFeatureRoleMappingRow = typeof customerFeatureRoleMappingTable.$inferSelect;
export type InsertCustomerFeatureRoleMappingRow = typeof customerFeatureRoleMappingTable.$inferInsert;
