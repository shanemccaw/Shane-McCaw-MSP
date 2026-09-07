/**
 * THE 7-YEAR POST-TERMINATION PURGE, RUN FOR REAL (Git #2859, EPIC #1944 part 7).
 *
 * `../subscription-gate.test.ts` proves the clock arithmetic and proves the registry
 * refuses when empty. `./tenant-scope-coverage.live-db.test.ts` proves nothing
 * tenant-scoped is unaccounted for. Neither proves the thing that actually matters about
 * an irreversible destructive path: that it destroys the right customer's rows, ALL of
 * them, and NOTHING belonging to anyone else.
 *
 * So this creates two real scratch tenants under one scratch MSP, gives both real rows in
 * every id space the purge has to handle, and purges only one:
 *
 *   DUE     lapsed 8 years ago — its whole dataset must be gone and the tenant stamped.
 *   NOT DUE lapsed 1 year ago — every row must still be there, and the tenant unstamped,
 *           because a purge that cannot tell them apart is a purge that destroys a
 *           customer six years early.
 *
 * The NOT-DUE tenant is not a control for tidiness. It is the assertion: the three id
 * spaces (`customerId`, `tenantGuid`, `userId`) all key on values
 * that ANOTHER tenant also has values for, and a wrong predicate — a missing WHERE, a
 * transposed id space, a predicate left on the wrong column — reaches its rows.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row it creates is scratch, tagged with a
 * random suffix, and removed in `afterAll` whether the test passes or fails.
 *
 * Run: pnpm --filter @workspace/api-server vitest run post-termination-purge.live-db
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { eq, sql, type SQL } from "drizzle-orm";
import { db, mspsTable, tenantsTable, usersTable } from "@workspace/db";
import {
  __resetTenantDataPurgersForTest,
  listTenantDataPurgers,
} from "../registry";
import { purgeTerminatedTenant, findTenantsDueForPostTerminationPurge } from "../post-termination";
import { registerAllTenantDataPurgers } from "./index";

const SUFFIX = `vitest-2859-${Math.floor(Math.random() * 1e9)}`;
const YEAR_MS = 365 * 24 * 60 * 60 * 1000;

interface Scratch {
  tenantId: number;
  tenantGuid: string;
  userId: number;
}

/**
 * One representative table per id space, chosen because each is keyed DIFFERENTLY and a
 * transposition between any two of them is silent — and each belongs to a different
 * module, so the per-module accounting is exercised too:
 *
 *   drift_events            config-drift    tenantGuid           (text, the M365 GUID)
 *   portal_ownership_events ownership       customerId           (integer, tenants.id)
 *   tenant_signal_history   engine-scoring  customerId + userId  (both columns #2983 settled)
 */
async function seedTenantRows(scratch: Scratch, mspId: number): Promise<void> {
  await db.execute(sql`
    INSERT INTO drift_events (tenant_id, domain_key, idempotency_key, setting, op)
    VALUES (${scratch.tenantGuid}, ${"identity"}, ${`${SUFFIX}-${scratch.tenantGuid}`}, ${`setting ${SUFFIX}`}, ${"update"})
  `);
  await db.execute(sql`
    INSERT INTO portal_ownership_events (customer_id, object_id, role_key, event_type)
    VALUES (${scratch.tenantId}, ${`obj-${SUFFIX}`}, ${"owner"}, ${"assigned"})
  `);
  // TWO rows, because #2983 left this table with a real column in each id space and the
  // purge has to reach both. `customer_id` is the tenants.id the engine writes today;
  // `client_user_id` is the retained users.id provenance carried by every row written
  // before that migration (and by any environment where it has not run yet). A purge that
  // covers only one of the two silently leaves a terminated customer's signal history
  // behind — which is precisely what happened while the column was ambiguous.
  await db.execute(sql`
    INSERT INTO tenant_signal_history (customer_id, msp_id, signal_key, fired_at)
    VALUES (${scratch.tenantId}, ${mspId}, ${`signal.${SUFFIX}`}, now())
  `);
  await db.execute(sql`
    INSERT INTO tenant_signal_history (client_user_id, msp_id, signal_key, fired_at)
    VALUES (${scratch.userId}, ${mspId}, ${`signal.legacy.${SUFFIX}`}, now())
  `);
  // #2980 — the reinstatement-request row the "commercial" purger now declares. customerId
  // id space, same as portal_ownership_events, but a real dedicated row so the assertion
  // proves THIS target wired correctly rather than only the id-space logic in general.
  await db.execute(sql`
    INSERT INTO retention_reinstatement_requests (tenant_id, msp_id, note, status)
    VALUES (${scratch.tenantId}, ${mspId}, ${`note ${SUFFIX}`}, ${"open"})
  `);
}

async function countTenantRows(scratch: Scratch): Promise<Record<string, number>> {
  const one = async (statement: SQL): Promise<number> => {
    const res = await db.execute<{ n: string }>(statement);
    return Number(res.rows[0]?.n ?? 0);
  };
  return {
    drift_events: await one(sql`SELECT count(*) AS n FROM drift_events WHERE tenant_id = ${scratch.tenantGuid}`),
    portal_ownership_events: await one(
      sql`SELECT count(*) AS n FROM portal_ownership_events WHERE customer_id = ${scratch.tenantId}`,
    ),
    tenant_signal_history: await one(
      sql`SELECT count(*) AS n FROM tenant_signal_history
          WHERE customer_id = ${scratch.tenantId} OR client_user_id = ${scratch.userId}`,
    ),
    retention_reinstatement_requests: await one(
      sql`SELECT count(*) AS n FROM retention_reinstatement_requests WHERE tenant_id = ${scratch.tenantId}`,
    ),
  };
}

describe.skipIf(!process.env.DATABASE_URL)("#2859 — the post-termination purge destroys a due tenant and only a due tenant", () => {
  let mspId = 0;
  let due: Scratch;
  let notDue: Scratch;

  const makeTenant = async (label: string, lapsedAgoMs: number): Promise<Scratch> => {
    const guid = `${SUFFIX}-${label}`;
    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `#2859 ${label} ${SUFFIX}`,
        tenantId: guid,
        // Not one of RETENTION_CLOCK_RUNNING_TENANT_STATUSES ("active" | "onboarding"), and
        // no tenant_subscriptions row, so the billing state the schedule consults reads
        // inactive — the real shape of a terminated customer.
        status: "inactive",
        subscriptionLapsedAt: new Date(Date.now() - lapsedAgoMs),
      })
      .returning({ id: tenantsTable.id });

    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${label}.${SUFFIX}@scratch.invalid`,
        name: `#2859 scratch ${label}`,
        tenantId: tenant!.id,
        mspId,
      })
      .returning({ id: usersTable.id });

    return { tenantId: tenant!.id, tenantGuid: guid, userId: user!.id };
  };

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#2859 purge MSP ${SUFFIX}`, slug: SUFFIX })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    due = await makeTenant("due", 8 * YEAR_MS);
    notDue = await makeTenant("notdue", 1 * YEAR_MS);

    await seedTenantRows(due, mspId);
    await seedTenantRows(notDue, mspId);
  });

  afterAll(async () => {
    // Scratch only, and unconditional: a failed assertion must not leave rows behind.
    for (const scratch of [due, notDue].filter(Boolean)) {
      await db.execute(sql`DELETE FROM drift_events WHERE tenant_id = ${scratch.tenantGuid}`);
      await db.execute(sql`DELETE FROM portal_ownership_events WHERE customer_id = ${scratch.tenantId}`);
      await db.execute(sql`DELETE FROM tenant_signal_history WHERE customer_id = ${scratch.tenantId} OR client_user_id = ${scratch.userId}`);
      await db.execute(sql`DELETE FROM retention_reinstatement_requests WHERE tenant_id = ${scratch.tenantId}`);
      await db.delete(usersTable).where(eq(usersTable.id, scratch.userId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, scratch.tenantId));
    }
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  beforeEach(() => {
    __resetTenantDataPurgersForTest();
  });

  it("refuses, and destroys nothing, while the registry is empty", async () => {
    // The state #2765 shipped. Asserted here against REAL rows rather than a mock: the
    // refusal is only worth anything if it also means nothing was touched.
    expect(listTenantDataPurgers()).toEqual([]);

    const result = await purgeTerminatedTenant(due.tenantId);
    expect(result.outcome).toBe("no_purgers_registered");
    expect(result.totalDestroyed).toBe(0);

    const counts = await countTenantRows(due);
    expect(counts).toEqual({
      drift_events: 1,
      portal_ownership_events: 1,
      tenant_signal_history: 2,
      retention_reinstatement_requests: 1,
    });

    const [row] = await db
      .select({ purgedAt: tenantsTable.postTerminationPurgedAt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, due.tenantId));
    expect(row?.purgedAt, "refusing must not stamp the tenant — a false claim is unrecoverable").toBeNull();
  });

  it("registers every module exactly once, and again is a no-op rather than a throw", () => {
    const first = registerAllTenantDataPurgers();
    expect(first.length).toBeGreaterThan(0);
    expect(new Set(first).size).toBe(first.length);

    const second = registerAllTenantDataPurgers();
    expect(second, "a second arming call is the same registry, not a duplicate-key crash").toEqual([]);
    expect(listTenantDataPurgers().length).toBe(first.length);
  });

  it("refuses a tenant whose window has not expired, with the purgers armed", async () => {
    registerAllTenantDataPurgers();

    const result = await purgeTerminatedTenant(notDue.tenantId);
    expect(result.outcome).toBe("not_due");
    expect(result.totalDestroyed).toBe(0);

    const counts = await countTenantRows(notDue);
    expect(counts).toEqual({
      drift_events: 1,
      portal_ownership_events: 1,
      tenant_signal_history: 2,
      retention_reinstatement_requests: 1,
    });
  });

  it("finds the due tenant, and not the one with six years left", async () => {
    const dueIds = await findTenantsDueForPostTerminationPurge();
    expect(dueIds).toContain(due.tenantId);
    expect(dueIds).not.toContain(notDue.tenantId);
  });

  it("destroys the due tenant's rows across all three id spaces, and stamps it", async () => {
    registerAllTenantDataPurgers();

    const result = await purgeTerminatedTenant(due.tenantId);
    expect(result.outcome).toBe("purged");
    expect(result.totalDestroyed).toBeGreaterThanOrEqual(5);

    // Per-module accounting, not just a total: the audit line records which module
    // destroyed what, and a module reporting zero when it held rows is the failure that
    // would otherwise be invisible.
    expect(result.destroyed["config-drift"]).toBe(1);
    expect(result.destroyed["ownership"]).toBe(1);
    expect(result.destroyed["engine-scoring"]).toBe(2);
    expect(result.destroyed["commercial"]).toBeGreaterThanOrEqual(1);

    expect(await countTenantRows(due)).toEqual({
      drift_events: 0,
      portal_ownership_events: 0,
      tenant_signal_history: 0,
      retention_reinstatement_requests: 0,
    });

    const [row] = await db
      .select({ purgedAt: tenantsTable.postTerminationPurgedAt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, due.tenantId));
    expect(row?.purgedAt).toBeInstanceOf(Date);
  });

  it("leaves the not-due tenant beside it completely untouched", async () => {
    // The assertion the whole file exists for. Runs AFTER the purge above, against the
    // same three tables, in the same three id spaces, for a customer six years from due.
    expect(await countTenantRows(notDue)).toEqual({
      drift_events: 1,
      portal_ownership_events: 1,
      tenant_signal_history: 2,
      retention_reinstatement_requests: 1,
    });

    const [row] = await db
      .select({ purgedAt: tenantsTable.postTerminationPurgedAt })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, notDue.tenantId));
    expect(row?.purgedAt).toBeNull();
  });

  it("reports an already-purged tenant as such rather than purging twice", async () => {
    registerAllTenantDataPurgers();
    const again = await purgeTerminatedTenant(due.tenantId);
    expect(again.outcome).toBe("already_purged");
    expect(again.totalDestroyed).toBe(0);
  });

  it("survives a tenant whose data is already gone, without claiming rows it did not destroy", async () => {
    // A retry after a partial failure hits this: everything is already gone, so the honest
    // count is zero and the outcome is still a completed purge.
    registerAllTenantDataPurgers();
    const purger = listTenantDataPurgers().find((p) => p.key === "config-drift")!;
    const destroyed = await db.transaction(async (tx) => purger.purge(tx, due.tenantId));
    expect(destroyed).toBe(0);
  });
});
