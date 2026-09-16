/**
 * #4372 — real-database coverage for `users_role_scope_check`
 * (lib/db/migrations/manual/2026-09-16-users-role-scope-check-pending-rungs-4372.sql).
 *
 * This CHECK is an auth invariant (#3950): it is what stops a tenant-scoped rung from
 * existing without a tenant. #4370's per-product Pending/Consented pairs need it widened
 * per rung, not relaxed — so both halves are proven against real inserts: every
 * `*Pending` rung is accepted with `tenant_id IS NULL`, and every `*Consented` rung (plus
 * `Free`/`Customer`) is still refused without one.
 *
 * Same discipline as ../rbac/retainer-no-consent-gating.test.ts: one outer transaction
 * for the file, a nested savepoint per insert, everything rolled back.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import { LEGACY_ROLE } from "../rbac/legacy-ladder.ts";

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

type InsertOutcome = { ok: true } | { ok: false; code: string | undefined; constraint: string | undefined };

/**
 * Inserts one users row inside its own savepoint and reports what Postgres said. The
 * savepoint is always rolled back, so a refused insert never poisons the outer
 * transaction and an accepted one never persists.
 */
async function tryInsert(mspRole: string, withTenant: boolean): Promise<InsertOutcome> {
  let outcome: InsertOutcome = { ok: true };
  const email = `zz-test-4372-${Math.random().toString(36).slice(2)}@example.invalid`;
  await tx
    .transaction(async (nested) => {
      try {
        await nested.execute(sql`
          INSERT INTO users (email, role, msp_role, tenant_id)
          VALUES (${email}, 'client', ${mspRole}, ${withTenant ? sql`(SELECT min(id) FROM tenants)` : sql`NULL`})
        `);
      } catch (err) {
        const pgErr = ((err as { cause?: unknown }).cause ?? err) as { code?: string; constraint?: string };
        outcome = { ok: false, code: pgErr.code, constraint: pgErr.constraint };
      }
      throw new Rollback();
    })
    .catch((err) => {
      if (!(err instanceof Rollback)) throw err;
    });
  return outcome;
}

const REFUSED_BY_SCOPE_CHECK = { ok: false, code: "23514", constraint: "users_role_scope_check" };

const PENDING_RUNGS = [LEGACY_ROLE.retainerPending, LEGACY_ROLE.monitoringPending, LEGACY_ROLE.packPending];
const CONSENTED_RUNGS = [LEGACY_ROLE.retainerConsented, LEGACY_ROLE.monitoringConsented, LEGACY_ROLE.packConsented];

describe("#4372 — users_role_scope_check admits the *Pending rungs tenant-less", () => {
  it("the live database has a tenant to attach the tenant-scoped cases to", async () => {
    const [row] = (await tx.execute(sql`SELECT count(*)::int AS n FROM tenants`)).rows as Array<{ n: number }>;
    expect(row!.n).toBeGreaterThan(0);
  });

  it.each(PENDING_RUNGS)("%s with tenant_id IS NULL is accepted", async (rung) => {
    expect(await tryInsert(rung, false)).toEqual({ ok: true });
  });

  it.each(CONSENTED_RUNGS)("%s with tenant_id IS NULL is refused", async (rung) => {
    expect(await tryInsert(rung, false)).toEqual(REFUSED_BY_SCOPE_CHECK);
  });

  it.each(CONSENTED_RUNGS)("%s with a tenant is accepted", async (rung) => {
    expect(await tryInsert(rung, true)).toEqual({ ok: true });
  });

  it("Free and Customer are still strictly tenant-required", async () => {
    expect(await tryInsert(LEGACY_ROLE.free, false)).toEqual(REFUSED_BY_SCOPE_CHECK);
    expect(await tryInsert(LEGACY_ROLE.customer, false)).toEqual(REFUSED_BY_SCOPE_CHECK);
  });

  it("a value outside the ladder is refused", async () => {
    expect(await tryInsert("NotARung", false)).toEqual(REFUSED_BY_SCOPE_CHECK);
  });
});
