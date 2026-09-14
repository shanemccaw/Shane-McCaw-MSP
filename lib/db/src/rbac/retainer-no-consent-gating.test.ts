/**
 * #3974 — real-database coverage for the RetainerNoConsent gating audit
 * (lib/db/migrations/manual/2026-09-14-rbac-retainer-noconsent-gating-3974.sql).
 *
 * Same discipline as ./customer-admin-billing-roles.test.ts: one outer transaction for
 * the file, a nested savepoint per test, everything rolled back. Proves the real,
 * decided answers for a RetainerNoConsent principal — tenant-scoped capabilities deny,
 * the ladder floor (and therefore any plain-`requireAuth`/`ladder.free` surface —
 * documents/SOW, engagement scope, account settings) allows, marketplace parity with
 * Customer holds, and the billed-party mechanism (#3629) still grants billing
 * independent of msp_role.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { loadRbacEvaluator } from "./load.ts";
import { LEGACY_ROLE, LADDER } from "./legacy-ladder.ts";

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

/**
 * RetainerNoConsent legitimately carries no tenant at all (#3971's
 * users_role_scope_check branch) — the one rung besides PlatformAdmin/MSP-staff that
 * doesn't join an existing tenant.
 */
async function insertRetainerNoConsentUser(t: Tx): Promise<number> {
  const email = `zz-test-3974-${Math.random().toString(36).slice(2)}@example.invalid`;
  const [row] = (await t.execute(sql`
    INSERT INTO users (email, role, msp_role, tenant_id)
    VALUES (${email}, 'client', ${LEGACY_ROLE.retainerNoConsent}, NULL)
    RETURNING id
  `)).rows as Array<{ id: number }>;
  return row!.id;
}

async function insertInvoice(t: Tx, userId: number): Promise<number> {
  const [row] = (await t.execute(sql`
    INSERT INTO invoices (client_user_id, invoice_number, amount)
    VALUES (${userId}, ${`ZZ-3974-${Math.random().toString(36).slice(2)}`}, 100)
    RETURNING id
  `)).rows as Array<{ id: number }>;
  return row!.id;
}

/** The customer-system answer, evaluated with no org (RetainerNoConsent has no tenant). */
async function customerCan(t: Tx, userId: number, capability: string): Promise<boolean> {
  const evaluator = await loadRbacEvaluator(t as never, { system: "customer", userId, orgId: null });
  return evaluator.can(capability);
}

/** The msp-system ladder floor answer — what a plain requireAuth/ladder.free route sees. */
async function mspCan(t: Tx, userId: number, capability: string): Promise<boolean> {
  const evaluator = await loadRbacEvaluator(t as never, { system: "msp", userId, orgId: null });
  return evaluator.can(capability);
}

describe("#3974 — the seeded RetainerNoConsent/RetainerConsented rows", () => {
  it("both rungs exist as platform-scoped roles in both systems", async () => {
    const rows = (await tx.execute(sql`
      SELECT key FROM msp_roles WHERE msp_id IS NULL AND key IN ('RetainerNoConsent', 'RetainerConsented') ORDER BY key
    `)).rows as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).toEqual(["RetainerConsented", "RetainerNoConsent"]);

    const customerRows = (await tx.execute(sql`
      SELECT key FROM customer_roles WHERE tenant_id IS NULL AND key IN ('RetainerNoConsent', 'RetainerConsented') ORDER BY key
    `)).rows as Array<{ key: string }>;
    expect(customerRows.map((r) => r.key)).toEqual(["RetainerConsented", "RetainerNoConsent"]);
  });

  it("ladder.retainer-no-consent and ladder.retainer-consented are real catalogued capabilities", async () => {
    const rows = (await tx.execute(sql`
      SELECT key FROM rbac_capabilities
       WHERE system = 'msp' AND key IN (${LADDER.retainerNoConsent}, ${LADDER.retainerConsented}) AND is_active
       ORDER BY key
    `)).rows as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).toEqual([LADDER.retainerConsented, LADDER.retainerNoConsent].sort());
  });

  it("ladder.free now admits both Retainer rungs — the floor every plain requireAuth surface reads", async () => {
    const rows = (await tx.execute(sql`
      SELECT r.key FROM msp_feature_role_mapping m
      JOIN msp_roles r ON r.id::text IN (SELECT jsonb_array_elements_text(m.roles -> 'allow'))
      WHERE m.msp_id IS NULL AND m.capability_key = ${LADDER.free}
    `)).rows as Array<{ key: string }>;
    const keys = rows.map((r) => r.key);
    expect(keys).toContain("RetainerNoConsent");
    expect(keys).toContain("RetainerConsented");
  });

  it("ladder.customer-user (the Customer floor) does NOT admit RetainerNoConsent", async () => {
    const rows = (await tx.execute(sql`
      SELECT r.key FROM msp_feature_role_mapping m
      JOIN msp_roles r ON r.id::text IN (SELECT jsonb_array_elements_text(m.roles -> 'allow'))
      WHERE m.msp_id IS NULL AND m.capability_key = ${LADDER.customer}
    `)).rows as Array<{ key: string }>;
    expect(rows.map((r) => r.key)).not.toContain("RetainerNoConsent");
  });
});

describe("#3974 — a real RetainerNoConsent principal, no tenant", () => {
  it("clears the Free floor (documents/SOW, engagement scope, account settings sit behind this)", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      expect(await mspCan(t, id, LADDER.free)).toBe(true);
    });
  });

  it("does NOT clear the Customer floor (no tenant-scoped ladder surface)", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      expect(await mspCan(t, id, LADDER.customer)).toBe(false);
    });
  });

  it("is denied team.manage and changes.approve — both explicitly, tenant-scoped", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      expect(await customerCan(t, id, "team.manage")).toBe(false);
      expect(await customerCan(t, id, "changes.approve")).toBe(false);
    });
  });

  it("is allowed marketplace.browse-full — parity with a paying Customer", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      expect(await customerCan(t, id, "marketplace.browse-full")).toBe(true);
    });
  });

  it("holds neither billing capability until actually billed", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      expect(await customerCan(t, id, "billing.view")).toBe(false);
      expect(await customerCan(t, id, "billing.manage")).toBe(false);
    });
  });

  it("the billed-party trigger (#3629) grants billing regardless of msp_role", async () => {
    await withSavepoint(async (t) => {
      const id = await insertRetainerNoConsentUser(t);
      await insertInvoice(t, id);
      expect(await customerCan(t, id, "billing.view")).toBe(true);
      expect(await customerCan(t, id, "billing.manage")).toBe(true);
      // The billed-party grant is scoped to billing only — it must not widen
      // anything tenant-scoped.
      expect(await customerCan(t, id, "team.manage")).toBe(false);
      expect(await customerCan(t, id, "changes.approve")).toBe(false);
    });
  });
});
