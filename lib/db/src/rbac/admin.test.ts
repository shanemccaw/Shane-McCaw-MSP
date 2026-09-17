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
  roleGrantFloor,
  getUserLadderIdentity,
  upsertMapping,
} from "./admin.ts";
import type { RbacDb } from "./load.ts";

class Rollback extends Error {}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rootDb = drizzle(pool);

// Real local-dev rows, resolved live rather than hardcoded — same discipline
// #4413's resolveFixtureIds() already uses in ./integrity-check.ts. A
// hardcoded tenant/msp/user id is invalidated the moment a dev-database
// reset reassigns those serial ids (#4474: TENANT = 1 stopped existing).
async function resolveFixtureIds(): Promise<{
  MSP: number; OTHER_MSP: number; TENANT: number; MSP_USER: number;
} | null> {
  const [mspUserRow] = (await rootDb.execute(sql`
    SELECT id, msp_id FROM users WHERE msp_id IS NOT NULL AND tenant_id IS NULL ORDER BY id LIMIT 1
  `)).rows as Array<{ id: number; msp_id: number }>;
  if (!mspUserRow) return null;

  const [otherMspRow] = (await rootDb.execute(sql`
    SELECT id FROM msps WHERE id != ${mspUserRow.msp_id} ORDER BY id LIMIT 1
  `)).rows as Array<{ id: number }>;
  if (!otherMspRow) return null;

  const [customerUserRow] = (await rootDb.execute(sql`
    SELECT tenant_id FROM users WHERE tenant_id IS NOT NULL AND msp_role = 'Customer' ORDER BY id LIMIT 1
  `)).rows as Array<{ tenant_id: number }>;
  if (!customerUserRow) return null;

  return { MSP: mspUserRow.msp_id, OTHER_MSP: otherMspRow.id, TENANT: customerUserRow.tenant_id, MSP_USER: mspUserRow.id };
}

const resolved = await resolveFixtureIds();
if (!resolved) {
  console.log(
    "SKIP  admin.test.ts (#2461) — no real msp user (with a second msp to use as the " +
    "foreign org) plus a real customer-role user (for TENANT) exists in this database " +
    "right now. Nothing hardcoded to fall back on (see #4413/#4474) — seed a real or " +
    "vitest-fixture tenant/user first, then re-run.",
  );
}
const { MSP, OTHER_MSP, TENANT, MSP_USER } = resolved ?? { MSP: 0, OTHER_MSP: 0, TENANT: 0, MSP_USER: 0 };

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

describe.skipIf(!resolved)("RBAC admin CRUD (#2461)", () => {
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
  // reality, mirroring integrity-check.ts's CUSTOMER_USER usage. Resolved at
  // test time rather than hardcoded, since the seed's real customer user ids
  // shift as the local database is reseeded.
  it("resolveUserOrgId reads the customer system off tenantId, not mspId", async () => {
    await withSavepoint(async (t) => {
      const customerUser = (
        (await t.execute(sql`SELECT id FROM users WHERE tenant_id = ${TENANT} AND msp_role = 'Customer' LIMIT 1`)).rows as Array<{ id: number }>
      )[0];
      expect(customerUser, "a real customer user in TENANT must exist in this database").toBeTruthy();

      const orgId = await resolveUserOrgId(t, "customer", customerUser.id);
      expect(orgId).toBe(TENANT);
    });
  });

  // #3637 — the grant-floor helpers the AdminV2 route reads to close the
  // below-MSPOperator cap.purchases.approve gap on the second writer of the row.
  describe("#3637 — capability-role grant floor", () => {
    it("roleGrantFloor returns MSPOperator for the seeded platform cap.purchases.approve role, and null for a floorless role", async () => {
      await withSavepoint(async (t) => {
        const capRole = (
          (await t.execute(sql`SELECT id FROM msp_roles WHERE key = 'cap.purchases.approve' AND msp_id IS NULL LIMIT 1`)).rows as Array<{ id: string }>
        )[0];
        expect(capRole, "the #2457 seed must have run against this database").toBeTruthy();
        expect(await roleGrantFloor(t, "msp", capRole.id)).toBe("MSPOperator");

        // An org's own custom role carries no floor — grantable at any rung.
        const created = await createRole(t, "msp", { orgId: MSP, key: "zz-3637-nofloor", name: "No Floor" });
        expect(created.ok).toBe(true);
        if (!created.ok) return;
        expect(await roleGrantFloor(t, "msp", created.role.id)).toBeNull();
      });
    });

    it("roleGrantFloor returns null for a roleId that names no role in the system", async () => {
      await withSavepoint(async (t) => {
        expect(await roleGrantFloor(t, "msp", "00000000-0000-0000-0000-000000000000")).toBeNull();
      });
    });

    it("getUserLadderIdentity returns the target's role/msp_role, and null for a missing user", async () => {
      await withSavepoint(async (t) => {
        const identity = await getUserLadderIdentity(t, MSP_USER);
        expect(identity).not.toBeNull();
        expect(identity).toHaveProperty("role");
        expect(identity).toHaveProperty("mspRole");
        expect(await getUserLadderIdentity(t, 0)).toBeNull();
      });
    });
  });
});
