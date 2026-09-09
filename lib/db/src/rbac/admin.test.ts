/**
 * #2461 — real-database coverage for the RBAC admin CRUD (./admin.ts), the
 * management surface AdminV2's re-pointed AD-style UI calls.
 *
 * Same discipline as ./integrity-check.ts: every write happens inside ONE
 * transaction that is always rolled back (via a thrown sentinel caught outside
 * `db.transaction`), so this test creates nothing durable in the local dev
 * database it runs against. Uses the same real MSP/tenant/user ids
 * integrity-check.ts already establishes as real local-dev rows.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import {
  assignUserRole,
  createRole,
  deleteRole,
  getMapping,
  listMappings,
  listRoles,
  listUserRoles,
  removeUserRole,
  renameRole,
  resolveUserOrgId,
  upsertMapping,
} from "./admin";
import type { RbacDb } from "./load";

// Real local-dev rows (see ./integrity-check.ts for the same ids).
const MSP = 1;
const OTHER_MSP = 1626;
const TENANT = 1;
const MSP_USER = 1; // belongs to MSP
const CUSTOMER_USER = 39; // belongs to TENANT

class Rollback extends Error {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rootDb = drizzle(pool);

// One transaction for the whole file — every test runs inside it via a nested
// savepoint transaction, and the outer transaction is rolled back in
// afterAll(), so nothing here survives the run regardless of pass/fail.
let outerReject: (() => void) | null = null;
let outerDone: Promise<void>;
let tx!: RbacDb;

beforeAll(async () => {
  outerDone = new Promise<void>((_resolve, reject) => {
    outerReject = () => reject(new Rollback());
  });
  const started = new Promise<void>((resolveStarted) => {
    void rootDb
      .transaction(async (t) => {
        tx = t as unknown as RbacDb;
        resolveStarted();
        await outerDone;
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
  });
  await started;
});

afterAll(() => {
  outerReject?.();
});

/** Every test's own writes are further scoped to a nested savepoint, rolled back individually. */
async function withSavepoint<T>(fn: (t: RbacDb) => Promise<T>): Promise<T> {
  let result!: T;
  await (tx as unknown as { transaction: (cb: (t: RbacDb) => Promise<void>) => Promise<void> })
    .transaction(async (nested) => {
      result = await fn(nested);
      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });
  return result;
}

describe("RBAC admin CRUD (#2461)", () => {
  it("creates an org-scoped role, lists it alongside platform roles, then deletes it", async () => {
    await withSavepoint(async (t) => {
      const created = await createRole(t, "msp", { orgId: MSP, key: "zz-2461-engineer", name: "Engineer" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.role.orgId).toBe(MSP);
      expect(created.role.isSystem).toBe(false);

      const roles = await listRoles(t, "msp", MSP);
      expect(roles.some((r) => r.id === created.role.id)).toBe(true);

      // A role scoped to a DIFFERENT msp must not show up when listing this one.
      const otherCreated = await createRole(t, "msp", { orgId: OTHER_MSP, key: "zz-2461-other", name: "Other MSP Role" });
      expect(otherCreated.ok).toBe(true);
      const rolesAfter = await listRoles(t, "msp", MSP);
      expect(rolesAfter.some((r) => otherCreated.ok && r.id === otherCreated.role.id)).toBe(false);

      const deleted = await deleteRole(t, "msp", created.role.id);
      expect(deleted.ok).toBe(true);
      const rolesAfterDelete = await listRoles(t, "msp", MSP);
      expect(rolesAfterDelete.some((r) => r.id === created.role.id)).toBe(false);
    });
  });

  it("refuses to delete a platform-defined baseline (is_system) role", async () => {
    await withSavepoint(async (t) => {
      const created = await createRole(t, "customer", { orgId: null, key: "zz-2461-baseline", name: "Baseline" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      // Flip it to is_system the way a seed migration would (createRole never sets it).
      await t.execute(sql`UPDATE customer_roles SET is_system = true WHERE id = ${created.role.id}`);

      const result = await deleteRole(t, "customer", created.role.id);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/cannot be deleted/);
    });
  });

  it("renames a role and reports its live member count", async () => {
    await withSavepoint(async (t) => {
      const created = await createRole(t, "msp", { orgId: MSP, key: "zz-2461-rename", name: "Before" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      await assignUserRole(t, "msp", MSP_USER, created.role.id, MSP_USER);

      const renamed = await renameRole(t, "msp", created.role.id, { name: "After" });
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.role.name).toBe("After");
      expect(renamed.role.memberCount).toBe(1);
    });
  });

  it("grants and revokes a user's role membership, scoped to their own org", async () => {
    await withSavepoint(async (t) => {
      const created = await createRole(t, "msp", { orgId: MSP, key: "zz-2461-grant", name: "Grantable" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const orgId = await resolveUserOrgId(t, "msp", MSP_USER);
      expect(orgId).toBe(MSP);

      const grant = await assignUserRole(t, "msp", MSP_USER, created.role.id, MSP_USER);
      expect(grant.ok).toBe(true);

      const held = await listUserRoles(t, "msp", MSP_USER);
      expect(held.some((r) => r.id === created.role.id)).toBe(true);

      await removeUserRole(t, "msp", MSP_USER, created.role.id);
      const heldAfter = await listUserRoles(t, "msp", MSP_USER);
      expect(heldAfter.some((r) => r.id === created.role.id)).toBe(false);
    });
  });

  it("refuses a cross-org grant — the scope trigger's refusal surfaces as a normal result, not a throw", async () => {
    await withSavepoint(async (t) => {
      const foreignRole = await createRole(t, "msp", { orgId: OTHER_MSP, key: "zz-2461-foreign", name: "Foreign" });
      expect(foreignRole.ok).toBe(true);
      if (!foreignRole.ok) return;

      // MSP_USER belongs to MSP, not OTHER_MSP — the DB trigger must refuse this.
      const result = await assignUserRole(t, "msp", MSP_USER, foreignRole.role.id, MSP_USER);
      expect(result.ok).toBe(false);
    });
  });

  it("sets and reads back a capability's allow/deny mapping, scoped platform vs org", async () => {
    await withSavepoint(async (t) => {
      const role = await createRole(t, "customer", { orgId: TENANT, key: "zz-2461-billing", name: "Billing Contact" });
      expect(role.ok).toBe(true);
      if (!role.ok) return;

      const set = await upsertMapping(t, "customer", TENANT, "billing.view", { allow: [role.role.id], deny: [] });
      expect(set.ok).toBe(true);

      const read = await getMapping(t, "customer", TENANT, "billing.view");
      expect(read.allow).toEqual([role.role.id]);
      expect(read.deny).toEqual([]);

      // The platform-default row for the SAME capability is independent.
      const platformRead = await getMapping(t, "customer", null, "billing.view");
      expect(platformRead.allow).not.toContain(role.role.id);

      const mappings = await listMappings(t, "customer", TENANT);
      const own = mappings.find((m) => m.orgId === TENANT && m.capabilityKey === "billing.view");
      expect(own?.roles.allow).toEqual([role.role.id]);
    });
  });

  it("refuses an uncatalogued capability key rather than silently storing it", async () => {
    await withSavepoint(async (t) => {
      const result = await upsertMapping(t, "customer", TENANT, "not.a.real.capability", { allow: [], deny: [] });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toMatch(/not a catalogued/);
    });
  });

  // Sanity-anchors this file's own real ids against the schema's cross-tenant
  // reality, mirroring integrity-check.ts's CUSTOMER_USER usage.
  it("resolveUserOrgId reads the customer system off tenantId, not mspId", async () => {
    await withSavepoint(async (t) => {
      const orgId = await resolveUserOrgId(t, "customer", CUSTOMER_USER);
      expect(orgId).toBe(TENANT);
    });
  });
});
