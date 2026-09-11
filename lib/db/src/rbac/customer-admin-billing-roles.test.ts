/**
 * #3629 — real-database coverage for the Customer Admin / Billing roles
 * (lib/db/migrations/manual/2026-09-11-rbac-customer-admin-billing-roles-3629.sql).
 *
 * `check-rbac-parity` proves the platform mapping rows implement the decided rule for
 * every principal shape. What it cannot exercise is the trigger half: that a bill
 * issued AFTER the migration grants its addressee Billing, so narrowing
 * customer:billing.* never strands a bill nobody can open. Every portal billing route
 * reads the caller's own rows, so that addressee is the only person who ever could.
 * These tests make real invoices / client_services writes and evaluate the result
 * through the real loader.
 *
 * Same discipline as ./user-role-sync.test.ts: one outer transaction for the file, a
 * nested savepoint per test, everything rolled back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { loadRbacEvaluator } from "./load.ts";
import { CUSTOMER_PLATFORM_ROLE_KEYS, LEGACY_ROLE } from "./legacy-ladder.ts";

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

const { customerAdmin: CUSTOMER_ADMIN, billing: BILLING } = CUSTOMER_PLATFORM_ROLE_KEYS;
const CUSTOMER_CAPABILITIES = ["billing.view", "billing.manage", "team.manage", "changes.approve", "marketplace.browse-full"];

/**
 * Insert a customer-tier user the way the product's writers do. A Customer or Free
 * row must carry a tenant (users_role_scope_check), so it joins an existing tenant —
 * the rows are rolled back with everything else.
 */
async function insertUser(t: Tx, mspRole: string): Promise<number> {
  const email = `zz-test-3629-${Math.random().toString(36).slice(2)}@example.invalid`;
  const [row] = (await t.execute(sql`
    INSERT INTO users (email, role, msp_role, tenant_id)
    VALUES (${email}, 'client', ${mspRole}, (SELECT min(id) FROM tenants))
    RETURNING id
  `)).rows as Array<{ id: number }>;
  return row!.id;
}

async function insertInvoice(t: Tx, userId: number): Promise<number> {
  const [row] = (await t.execute(sql`
    INSERT INTO invoices (client_user_id, invoice_number, amount)
    VALUES (${userId}, ${`ZZ-3629-${Math.random().toString(36).slice(2)}`}, 100)
    RETURNING id
  `)).rows as Array<{ id: number }>;
  return row!.id;
}

/** The platform-role keys one customer mapping row allows. */
async function platformAllowKeys(t: Tx, capability: string): Promise<string[]> {
  const rows = (await t.execute(sql`
    SELECT r.key
      FROM customer_feature_role_mapping m
      JOIN customer_roles r ON r.id::text IN (SELECT jsonb_array_elements_text(m.roles -> 'allow'))
     WHERE m.tenant_id IS NULL AND m.capability_key = ${capability}
  `)).rows as Array<{ key: string }>;
  return rows.map((r) => r.key).sort();
}

async function heldKeys(t: Tx, userId: number): Promise<string[]> {
  const rows = (await t.execute(sql`
    SELECT r.key FROM customer_user_roles ur JOIN customer_roles r ON r.id = ur.role_id
     WHERE ur.user_id = ${userId}
  `)).rows as Array<{ key: string }>;
  return rows.map((r) => r.key).sort();
}

/** The customer-system answer, evaluated inside the user's own tenant as the product does. */
async function can(t: Tx, userId: number, capability: string): Promise<boolean> {
  const [row] = (await t.execute(sql`SELECT tenant_id FROM users WHERE id = ${userId}`)).rows as Array<{ tenant_id: number | null }>;
  const evaluator = await loadRbacEvaluator(t as never, { system: "customer", userId, orgId: row?.tenant_id ?? null });
  return evaluator.can(capability);
}

describe("#3629 — the seeded roles and mapping rows", () => {
  it("seeds Customer Admin and Billing as platform-scoped system roles", async () => {
    const rows = (await tx.execute(sql`
      SELECT key, is_system FROM customer_roles
       WHERE tenant_id IS NULL AND key IN (${CUSTOMER_ADMIN}, ${BILLING}) ORDER BY key
    `)).rows as Array<{ key: string; is_system: boolean }>;
    expect(rows).toEqual([
      { key: BILLING, is_system: true },
      { key: CUSTOMER_ADMIN, is_system: true },
    ]);
  });

  it("narrows billing.view and billing.manage to Customer Admin, Billing and MSP staff", async () => {
    const expected = [
      CUSTOMER_ADMIN, BILLING, LEGACY_ROLE.mspOperator, LEGACY_ROLE.mspAdmin, LEGACY_ROLE.platformAdmin,
    ].sort();
    for (const capability of ["billing.view", "billing.manage"]) {
      expect(await platformAllowKeys(tx, capability), capability).toEqual(expected);
    }
  });

  it("puts Customer Admin on every customer capability, and Billing on the billing pair only", async () => {
    for (const capability of CUSTOMER_CAPABILITIES) {
      const keys = await platformAllowKeys(tx, capability);
      expect(keys, capability).toContain(CUSTOMER_ADMIN);
      expect(keys.includes(BILLING), capability).toBe(capability.startsWith("billing."));
    }
  });
});

describe("#3629 — what a real principal can do", () => {
  it("a plain Customer with no bill of their own holds neither billing capability", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, LEGACY_ROLE.customer);
      expect(await can(t, id, "billing.view")).toBe(false);
      expect(await can(t, id, "billing.manage")).toBe(false);
      // The narrowing touches billing only.
      expect(await can(t, id, "marketplace.browse-full")).toBe(true);
    });
  });

  it("a Customer Admin holds every customer capability, even on the Free rung", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, LEGACY_ROLE.free);
      for (const capability of CUSTOMER_CAPABILITIES) {
        expect(await can(t, id, capability), capability).toBe(false);
      }
      await t.execute(sql`
        INSERT INTO customer_user_roles (user_id, role_id)
        SELECT ${id}, id FROM customer_roles WHERE tenant_id IS NULL AND key = ${CUSTOMER_ADMIN}
      `);
      for (const capability of CUSTOMER_CAPABILITIES) {
        expect(await can(t, id, capability), capability).toBe(true);
      }
    });
  });
});

describe("#3629 — the billed party always holds Billing (invoices / client_services triggers)", () => {
  it("issuing an invoice grants its addressee Billing, and only Billing", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, LEGACY_ROLE.customer);
      expect(await heldKeys(t, id)).not.toContain(BILLING);

      await insertInvoice(t, id);

      const held = await heldKeys(t, id);
      expect(held).toContain(BILLING);
      expect(held).not.toContain(CUSTOMER_ADMIN);
      expect(await can(t, id, "billing.view")).toBe(true);
      expect(await can(t, id, "billing.manage")).toBe(true);
      expect(await can(t, id, "team.manage")).toBe(false);
      expect(await can(t, id, "changes.approve")).toBe(false);
    });
  });

  it("a client_services row does the same", async () => {
    await withSavepoint(async (t) => {
      const id = await insertUser(t, LEGACY_ROLE.free);
      await t.execute(sql`
        INSERT INTO client_services (client_user_id, service_id)
        SELECT ${id}, id FROM services ORDER BY id LIMIT 1
      `);
      expect(await heldKeys(t, id)).toContain(BILLING);
      expect(await can(t, id, "billing.view")).toBe(true);
    });
  });

  it("re-addressing an invoice grants the new addressee, and a second bill is not an error", async () => {
    await withSavepoint(async (t) => {
      const first = await insertUser(t, LEGACY_ROLE.customer);
      const second = await insertUser(t, LEGACY_ROLE.customer);
      const invoiceId = await insertInvoice(t, first);
      await insertInvoice(t, first);

      await t.execute(sql`UPDATE invoices SET client_user_id = ${second} WHERE id = ${invoiceId}`);

      expect(await heldKeys(t, second)).toContain(BILLING);
      expect(await can(t, second, "billing.view")).toBe(true);
    });
  });
});
