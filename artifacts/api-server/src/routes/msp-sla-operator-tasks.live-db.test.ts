/**
 * Live-Postgres regression test for GET /api/msp/operator-tasks (Git #2729).
 *
 * The route's mock-only suite (`msp-sla-scope-creep.test.ts`) stubs `db.execute`
 * directly, so it never noticed the route's `LEFT JOIN msp_customers` — a table
 * the Tenant/User Refactor dropped (`lib/db/migrations/manual/2026-07-28-tenant-
 * user-refactor-phase0-schema-wipe.sql`). Every real call 500ed with
 * `relation "msp_customers" does not exist`, caught silently by the route's own
 * try/catch. This file exercises the real router against a real local Postgres
 * connection — no `@workspace/db` mock — so a future re-regression on this join
 * fails a test instead of only failing in production.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-sla-operator-tasks.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { mspsTable, tenantsTable } from "@workspace/db";

const JWT_SECRET = "test-operator-tasks-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// Skips cleanly when no DATABASE_URL is configured, matching the pattern in
// drift-collector.test.ts. Synthetic msp + tenant, cleaned up afterward.
describe.skipIf(!process.env.DATABASE_URL)("GET /api/msp/operator-tasks — live Postgres (#2729)", () => {
  const suffix = `vitest-2729-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let tenantId: number;
  const breachId = `${suffix}-breach`;
  const violationId = crypto.randomUUID();

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `Operator Tasks Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Operator Tasks Test Customer ${suffix}`, tenantId: suffix })
      .returning({ id: tenantsTable.id });
    tenantId = tenant.id;

    await db.execute(sql`
      INSERT INTO sla_breaches (breach_id, msp_id, customer_id, phase, breach_type, elapsed_minutes, threshold_minutes)
      VALUES (${breachId}, ${mspId}, ${tenantId}, 'response', 'breach', 90, 60)
    `);

    await db.execute(sql`
      INSERT INTO scope_creep_violations (violation_id, msp_id, customer_id, policy_id, severity, composite_score, threshold)
      VALUES (${violationId}::uuid, ${mspId}, ${tenantId}, 999999, 'high', 78, 60)
    `);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM sla_breaches WHERE breach_id = ${breachId}`);
    await db.execute(sql`DELETE FROM scope_creep_violations WHERE violation_id = ${violationId}::uuid`);
    await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("aggregates real SLA breach + scope-creep rows without 500ing, joining tenants for customerName", async () => {
    const { default: router } = await import("./msp-sla.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);

    const token = makeToken({ mspId });
    const res = await request(app)
      .get("/api/msp/operator-tasks")
      .set("Authorization", `Bearer ${token}`);

    // The historical bug: this 500ed ("Failed to load operator tasks") on every
    // real call because msp_customers no longer exists. Assert the real 200 first,
    // so a regression back to the dropped-table join fails loudly here.
    expect(res.status).toBe(200);
    expect(res.body.tasks).toHaveLength(2);

    const slaTask = res.body.tasks.find((t: { type: string }) => t.type === "sla_breach");
    expect(slaTask).toBeTruthy();
    expect(slaTask.customerName).toBe(`Operator Tasks Test Customer ${suffix}`);
    expect(slaTask.customerId).toBe(tenantId);

    const scTask = res.body.tasks.find((t: { type: string }) => t.type === "scope_creep_violation");
    expect(scTask).toBeTruthy();
    expect(scTask.customerName).toBe(`Operator Tasks Test Customer ${suffix}`);
    expect(scTask.customerId).toBe(tenantId);
  });
});
