/**
 * ONE OPEN ROW PER (CUSTOMER, SIGNAL), PROVED AGAINST THE REAL DATABASE (Git #3078).
 *
 * `recordSignalTransitions` decided what was "newly fired" by reading the customer's
 * open rows and inserting one row per key not in that set. Nothing enforced the
 * invariant that read assumes, and the function is fired-and-forgotten from
 * `computeTenantSignals`, so two overlapping evaluations of the same customer both
 * read zero open rows for a key and both inserted. Live on the local database on
 * 2026-09-07: 45 `(customer_id, signal_key)` pairs held 2-3 open rows apiece, every
 * duplicate pair's `fired_at` values milliseconds apart.
 *
 * The consequence is a customer-facing correctness bug, not bookkeeping noise:
 * `getStabilizedSignals` marks a signal stabilized when ANY open row is older than
 * its window, so the older of a duplicate pair makes the signal read as stabilized
 * before it genuinely is — defeating the flap suppression the window exists for.
 *
 * A unit test with a mocked `db` cannot prove any of this, because the thing under
 * test IS the database constraint. So this runs the real statements against the real
 * table:
 *
 *   - the partial unique index exists, with exactly the predicate the writer's
 *     ON CONFLICT clause names (they must be inferable from one another);
 *   - a second OPEN row for the same pair is rejected outright;
 *   - the writer's own statement, verbatim, degrades to a silent no-op instead;
 *   - two of those statements fired CONCURRENTLY leave exactly one open row —
 *     the actual race, actually run;
 *   - a RESOLVED row does not block a genuine re-fire, which is the whole reason
 *     the index is partial rather than total;
 *   - the index is scoped per customer, so two tenants can hold the same signal
 *     open at once.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row it creates is scratch, tagged with
 * a random suffix, and removed in `afterAll` whether the test passes or fails.
 *
 * Run: pnpm --filter @workspace/api-server vitest run tenant-signals-one-open-per-signal
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import { db, mspsTable, tenantsTable } from "@workspace/db";

const SUFFIX = `vitest-3078-${Math.floor(Math.random() * 1e9)}`;
const SIGNAL_KEY = `signal.test.${SUFFIX}`;
const OTHER_SIGNAL_KEY = `signal.test.other.${SUFFIX}`;

/**
 * The INSERT `recordSignalTransitions` actually issues, character-for-character on
 * the conflict clause. If the index's predicate and this one ever drift apart,
 * Postgres stops inferring the index and this throws instead of no-op'ing — which is
 * precisely the regression this file exists to catch.
 */
async function insertOpenRow(customerId: number, signalKey: string, firedAt?: Date): Promise<number> {
  const result = await db.execute(sql`
    INSERT INTO tenant_signal_history (customer_id, msp_id, signal_key, fired_at)
    VALUES (${customerId}, ${null}, ${signalKey}, ${firedAt ?? new Date()})
    ON CONFLICT (customer_id, signal_key) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id
  `);
  return result.rows.length;
}

async function countRows(customerId: number, signalKey: string): Promise<{ total: number; open: number }> {
  const result = await db.execute(sql`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE resolved_at IS NULL)::int AS open
    FROM tenant_signal_history
    WHERE customer_id = ${customerId} AND signal_key = ${signalKey}
  `);
  return result.rows[0] as { total: number; open: number };
}

describe.skipIf(!process.env.DATABASE_URL)(
  "#3078 — tenant_signal_history holds at most one OPEN row per (customer, signal)",
  () => {
    let mspId = 0;
    let tenantId = 0;
    let otherTenantId = 0;

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `Scratch MSP ${SUFFIX}`, slug: `scratch-${SUFFIX}` })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const tenants = await db
        .insert(tenantsTable)
        .values([
          { mspId, customerName: `Scratch Tenant A ${SUFFIX}`, tenantId: `${SUFFIX}-a` },
          { mspId, customerName: `Scratch Tenant B ${SUFFIX}`, tenantId: `${SUFFIX}-b` },
        ])
        .returning({ id: tenantsTable.id });
      tenantId = tenants[0].id;
      otherTenantId = tenants[1].id;
    });

    afterAll(async () => {
      // Tenant delete cascades tenant_signal_history (#2983 made the FK CASCADE), but
      // the explicit delete keeps this honest if that ever changes.
      if (tenantId || otherTenantId) {
        await db.execute(sql`
          DELETE FROM tenant_signal_history
          WHERE signal_key IN (${SIGNAL_KEY}, ${OTHER_SIGNAL_KEY})
        `);
      }
      if (mspId) {
        await db.execute(sql`DELETE FROM tenants WHERE msp_id = ${mspId}`);
        await db.execute(sql`DELETE FROM msps WHERE id = ${mspId}`);
      }
    });

    beforeEach(async () => {
      await db.execute(sql`
        DELETE FROM tenant_signal_history
        WHERE signal_key IN (${SIGNAL_KEY}, ${OTHER_SIGNAL_KEY})
      `);
    });

    it("the partial unique index exists with exactly the predicate the writer names", async () => {
      const result = await db.execute(sql`
        SELECT indexdef FROM pg_indexes
        WHERE indexname = 'tenant_signal_history_one_open_per_signal'
      `);
      expect(result.rows).toHaveLength(1);
      const { indexdef } = result.rows[0] as { indexdef: string };
      expect(indexdef).toContain("UNIQUE");
      expect(indexdef).toContain("(customer_id, signal_key)");
      expect(indexdef).toContain("WHERE (resolved_at IS NULL)");
    });

    it("rejects a second OPEN row for the same (customer, signal) outright", async () => {
      await db.execute(sql`
        INSERT INTO tenant_signal_history (customer_id, signal_key, fired_at)
        VALUES (${tenantId}, ${SIGNAL_KEY}, NOW())
      `);

      // Asserted on the driver error, not the message: drizzle wraps the pg error in a
      // DrizzleQueryError whose own message is just "Failed query: <sql>", so a message
      // match would pass for ANY failure of this statement. The pg error underneath
      // carries the real 23505 unique_violation and names the offending index.
      const err = await db
        .execute(sql`
          INSERT INTO tenant_signal_history (customer_id, signal_key, fired_at)
          VALUES (${tenantId}, ${SIGNAL_KEY}, NOW())
        `)
        .then(
          () => null,
          (e: unknown) => e as { cause?: { code?: string; constraint?: string } },
        );

      expect(err, "a second open row must not be insertable").not.toBeNull();
      expect(err?.cause?.code).toBe("23505");
      expect(err?.cause?.constraint).toBe("tenant_signal_history_one_open_per_signal");

      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
    });

    it("the writer's ON CONFLICT statement degrades to a silent no-op instead of throwing", async () => {
      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(1);
      // Zero rows returned is how recordSignalTransitions detects it lost the race.
      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(0);
      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
    });

    it("two CONCURRENT writers leave exactly one open row — the real race, actually run", async () => {
      // Not sequential: both statements are in flight at once on separate pooled
      // connections, which is the shape that produced the 45 live duplicate pairs.
      const results = await Promise.all([
        insertOpenRow(tenantId, SIGNAL_KEY),
        insertOpenRow(tenantId, SIGNAL_KEY),
        insertOpenRow(tenantId, SIGNAL_KEY),
      ]);

      expect(results.reduce((a, b) => a + b, 0)).toBe(1);
      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
    });

    it("a RESOLVED row does not block a genuine re-fire (why the index is partial)", async () => {
      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(1);
      await db.execute(sql`
        UPDATE tenant_signal_history SET resolved_at = NOW()
        WHERE customer_id = ${tenantId} AND signal_key = ${SIGNAL_KEY} AND resolved_at IS NULL
      `);

      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(1);
      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 2, open: 1 });

      // And repeatedly — history accumulates, the open set does not.
      await db.execute(sql`
        UPDATE tenant_signal_history SET resolved_at = NOW()
        WHERE customer_id = ${tenantId} AND signal_key = ${SIGNAL_KEY} AND resolved_at IS NULL
      `);
      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(1);
      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 3, open: 1 });
    });

    it("is scoped per customer and per signal, not global", async () => {
      expect(await insertOpenRow(tenantId, SIGNAL_KEY)).toBe(1);
      // A different tenant holding the SAME signal open is normal, not a conflict.
      expect(await insertOpenRow(otherTenantId, SIGNAL_KEY)).toBe(1);
      // As is the same tenant holding a DIFFERENT signal open.
      expect(await insertOpenRow(tenantId, OTHER_SIGNAL_KEY)).toBe(1);

      expect(await countRows(tenantId, SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
      expect(await countRows(otherTenantId, SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
      expect(await countRows(tenantId, OTHER_SIGNAL_KEY)).toEqual({ total: 1, open: 1 });
    });

    it("no duplicate open rows survive anywhere in the table (the #3078 cleanup held)", async () => {
      const result = await db.execute(sql`
        SELECT count(*)::int AS dup_groups FROM (
          SELECT 1 FROM tenant_signal_history
          WHERE resolved_at IS NULL AND customer_id IS NOT NULL
          GROUP BY customer_id, signal_key
          HAVING count(*) > 1
        ) g
      `);
      expect((result.rows[0] as { dup_groups: number }).dup_groups).toBe(0);
    });
  },
);
