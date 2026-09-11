/**
 * #3408 — real-database coverage for the `users` → RBAC membership triggers
 * (lib/db/migrations/manual/2026-09-10-rbac-user-roles-maintained-3408.sql).
 *
 * The defect was that `msp_user_roles` / `customer_user_roles` were a one-time
 * #2457 snapshot: a user created or re-roled afterwards had no rung row, or the
 * wrong one. These tests make real `users` writes — the same INSERT/UPDATE shapes
 * signup, invite acceptance, provisioning and the AD role reassignment make — and
 * assert the membership rows follow.
 *
 * Same discipline as ./admin.test.ts: one outer transaction for the file, a nested
 * savepoint per test, everything rolled back. Nothing durable is created in the
 * local dev database it runs against.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";

class Rollback extends Error {}

type Tx = Parameters<Parameters<ReturnType<typeof drizzle>["transaction"]>[0]>[0];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const rootDb = drizzle(pool);

let outerReject: (() => void) | null = null;
let outerDone: Promise<void>;
let tx!: Tx;

beforeAll(async () => {
  outerDone = new Promise<void>((_resolve, reject) => {
    outerReject = () => reject(new Rollback());
  });
  const started = new Promise<void>((resolveStarted) => {
    void rootDb
      .transaction(async (t) => {
        tx = t;
        resolveStarted();
        await outerDone;
      })
      .catch((err) => {
        if (!(err instanceof Rollback)) throw err;
      });
  });
  await started;
});

afterAll(async () => {
  outerReject?.();
  await pool.end();
});

async function withSavepoint(fn: (t: Tx) => Promise<void>): Promise<void> {
  await tx
    .transaction(async (nested) => {
      await fn(nested);
      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });
}

/** Insert a user the way the product's writers do — only the columns they set. */
async function insertUser(
  t: Tx,
  fields: { role?: string; mspRole?: string | null; canApproveChanges?: boolean },
): Promise<number> {
  const email = `zz-test-3408-${Math.random().toString(36).slice(2)}@example.invalid`;
  const [row] = (await t.execute(sql`
    INSERT INTO users (email, role, msp_role, can_approve_changes)
    VALUES (${email}, ${fields.role ?? "client"}, ${fields.mspRole ?? "Free"}, ${fields.canApproveChanges ?? false})
    RETURNING id
  `)).rows as Array<{ id: number }>;
  return row!.id;
}

/**
 * Platform-scoped role keys a user holds in one system, sorted in JS — not by SQL
 * ORDER BY, whose collation puts `cap.*` before `MSPAdmin` where `.sort()` does not.
 */
async function heldKeys(t: Tx, system: "msp" | "customer", userId: number): Promise<string[]> {
  const rows = system === "msp"
    ? (await t.execute(sql`
        SELECT r.key FROM msp_user_roles ur JOIN msp_roles r ON r.id = ur.role_id
         WHERE ur.user_id = ${userId} AND r.msp_id IS NULL`)).rows
    : (await t.execute(sql`
        SELECT r.key FROM customer_user_roles ur JOIN customer_roles r ON r.id = ur.role_id
         WHERE ur.user_id = ${userId} AND r.tenant_id IS NULL`)).rows;
  return (rows as Array<{ key: string }>).map((r) => r.key).sort();
}

async function grant(t: Tx, system: "msp" | "customer", userId: number, key: string): Promise<void> {
  if (system === "msp") {
    await t.execute(sql`
      INSERT INTO msp_user_roles (user_id, role_id)
      SELECT ${userId}, id FROM msp_roles WHERE msp_id IS NULL AND key = ${key}`);
  } else {
    await t.execute(sql`
      INSERT INTO customer_user_roles (user_id, role_id)
      SELECT ${userId}, id FROM customer_roles WHERE tenant_id IS NULL AND key = ${key}`);
  }
}

describe("users → RBAC membership sync (#3408)", () => {
  it("the #2457 seed roles this suite depends on are present", async () => {
    const [{ n }] = (await tx.execute(sql`
      SELECT count(*)::int AS n FROM msp_roles
       WHERE msp_id IS NULL AND key IN ('Customer', 'MSPOperator', 'MSPAdmin', 'PlatformAdmin', 'cap.purchases.approve')
    `)).rows as Array<{ n: number }>;
    expect(n).toBe(5);
  });

  it("a newly created user holds their rung in both systems", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Customer" });
      expect(await heldKeys(t, "msp", id)).toEqual(["Customer"]);
      expect(await heldKeys(t, "customer", id)).toEqual(["Customer"]);
    });
  });

  it("the column default (Free) is a rung too — a bare insert is not left roleless", async () => {
    await withSavepoint(async (t) => {
      const [row] = (await t.execute(sql`
        INSERT INTO users (email) VALUES (${`zz-test-3408-bare-${Date.now()}@example.invalid`}) RETURNING id, msp_role
      `)).rows as Array<{ id: number; msp_role: string }>;
      expect(await heldKeys(t, "msp", row!.id)).toEqual([row!.msp_role]);
      expect(await heldKeys(t, "customer", row!.id)).toEqual([row!.msp_role]);
    });
  });

  it("a re-role moves the rung in both systems, leaving exactly one", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Free" });
      await t.execute(sql`UPDATE users SET msp_role = 'MSPOperator' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["MSPOperator"]);
      expect(await heldKeys(t, "customer", id)).toEqual(["MSPOperator"]);
    });
  });

  it("legacy role = 'admin' is promoted to PlatformAdmin, and un-promoted when it goes", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { role: "admin", mspRole: "Free" });
      expect(await heldKeys(t, "msp", id)).toEqual(["PlatformAdmin"]);

      await t.execute(sql`UPDATE users SET role = 'client' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["Free"]);
      expect(await heldKeys(t, "customer", id)).toEqual(["Free"]);
    });
  });

  it("an msp_role that is not one of the rungs holds no rung — and cannot name a capability role", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Customer" });
      await t.execute(sql`UPDATE users SET msp_role = 'NotARole' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual([]);
      expect(await heldKeys(t, "customer", id)).toEqual([]);

      // msp_role is plain text with no CHECK. Naming a cap.* role in it must grant nothing.
      await t.execute(sql`UPDATE users SET msp_role = 'cap.purchases.approve' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual([]);
    });
  });

  it("cap.changes.approve follows users.can_approve_changes both ways", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Customer", canApproveChanges: true });
      expect(await heldKeys(t, "customer", id)).toEqual(["Customer", "cap.changes.approve"].sort());

      await t.execute(sql`UPDATE users SET can_approve_changes = false WHERE id = ${id}`);
      expect(await heldKeys(t, "customer", id)).toEqual(["Customer"]);

      await t.execute(sql`UPDATE users SET can_approve_changes = true WHERE id = ${id}`);
      expect(await heldKeys(t, "customer", id)).toEqual(["Customer", "cap.changes.approve"].sort());
    });
  });

  it("cap.purchases.approve is revoked when the rung falls below MSPOperator", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "MSPOperator" });
      await grant(t, "msp", id, "cap.purchases.approve");
      expect(await heldKeys(t, "msp", id)).toEqual(["MSPOperator", "cap.purchases.approve"].sort());

      // The shape direct-tenant-provisioning makes: `.set({ mspRole: Customer })`.
      await t.execute(sql`UPDATE users SET msp_role = 'Customer' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["Customer"]);
    });
  });

  it("cap.purchases.approve survives a promotion, where it is inert, so a demotion back to MSPOperator keeps it", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "MSPOperator" });
      await grant(t, "msp", id, "cap.purchases.approve");

      await t.execute(sql`UPDATE users SET msp_role = 'MSPAdmin' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["MSPAdmin", "cap.purchases.approve"].sort());

      await t.execute(sql`UPDATE users SET msp_role = 'MSPOperator' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["MSPOperator", "cap.purchases.approve"].sort());
    });
  });

  it("cap.team.manage is the row's own source of truth (#2460) — no re-role touches it", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Customer" });
      await grant(t, "customer", id, "cap.team.manage");

      await t.execute(sql`UPDATE users SET msp_role = 'Free' WHERE id = ${id}`);
      expect(await heldKeys(t, "customer", id)).toEqual(["Free", "cap.team.manage"].sort());
    });
  });

  it("an unrelated column write does not run the sync", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, { mspRole: "Customer" });
      // A second rung, granted by hand. Any sync run would strip it, so its survival
      // proves the UPDATE trigger stayed quiet for a column it does not watch.
      await grant(t, "msp", id, "Free");
      await t.execute(sql`UPDATE users SET last_login_at = now() WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["Customer", "Free"]);

      // ...and a watched column set to its CURRENT value is not a change either.
      await t.execute(sql`UPDATE users SET msp_role = 'Customer' WHERE id = ${id}`);
      expect(await heldKeys(t, "msp", id)).toEqual(["Customer", "Free"]);
    });
  });

  it("an org's own custom role is left alone by a re-role", async () => {
    await withSavepoint(async (t) => {
      const [tenant] = (await t.execute(sql`SELECT id FROM tenants ORDER BY id LIMIT 1`)).rows as Array<{ id: number }>;
      const id = await insertUser(t, { mspRole: "Customer" });
      await t.execute(sql`UPDATE users SET tenant_id = ${tenant!.id} WHERE id = ${id}`);
      const [role] = (await t.execute(sql`
        INSERT INTO customer_roles (tenant_id, key, name) VALUES (${tenant!.id}, 'zz-3408-engineer', 'Engineer') RETURNING id
      `)).rows as Array<{ id: string }>;
      await t.execute(sql`INSERT INTO customer_user_roles (user_id, role_id) VALUES (${id}, ${role!.id}::uuid)`);

      await t.execute(sql`UPDATE users SET msp_role = 'Free' WHERE id = ${id}`);
      const [{ n }] = (await t.execute(sql`
        SELECT count(*)::int AS n FROM customer_user_roles WHERE user_id = ${id} AND role_id = ${role!.id}::uuid
      `)).rows as Array<{ n: number }>;
      expect(n).toBe(1);
      expect(await heldKeys(t, "customer", id)).toEqual(["Free"]);
    });
  });
});
