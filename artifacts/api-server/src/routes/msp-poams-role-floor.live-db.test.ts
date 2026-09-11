/**
 * Live-Postgres regression test for Git #3452 — the generic
 * `PATCH /api/msp/poams/:poamId` route must not let a plain `MSPOperator`
 * reach `status: "cancelled"`, which this file's own header says is
 * `MSPAdmin`-only ("cancelling a plan is the same weight as revoking an
 * RBD"). Before the fix, the route's only two guards blocked the incoming
 * value being `"active"` and the row's *existing* status already being
 * terminal — neither blocked the incoming value being `"cancelled"`, so an
 * `MSPOperator` could produce the identical DB state as the dedicated,
 * `MSPAdmin`-gated `PATCH /api/msp/poams/:poamId/cancel` route.
 *
 * Live rather than mocked, deliberately: the point is that the row's real
 * status in Postgres does NOT flip to `cancelled` for an `MSPOperator` caller
 * — a mocked `db` would only assert the route didn't call `.update()`, not
 * that the real row was left alone.
 *
 * Skips cleanly with no `DATABASE_URL`, matching the sibling
 * `msp-poam-rbd-conversion.live-db.test.ts`. Every row it writes is
 * synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-poams-role-floor.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { db, mspsTable, tenantsTable, mspPoamsTable, mspAuditLogsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const JWT_SECRET = "test-msp-poams-role-floor-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "operator@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe.skipIf(!process.env.DATABASE_URL)("PATCH /api/msp/poams/:poamId role floor — live Postgres (#3452)", () => {
  const suffix = `vitest-3452-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  const tenantMsId = `${suffix}.onmicrosoft.com`;
  const poamIdsToClean: number[] = [];

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `POAM Role Floor Test MSP ${suffix}`, slug: suffix })
      .returning({ id: mspsTable.id });
    mspId = msp.id;

    await db.insert(tenantsTable).values({ mspId, customerName: `POAM Role Floor Test Customer ${suffix}`, tenantId: tenantMsId });
  });

  afterAll(async () => {
    for (const id of poamIdsToClean) {
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, String(id)));
      await db.delete(mspPoamsTable).where(eq(mspPoamsTable.id, id));
    }
    await db.delete(tenantsTable).where(eq(tenantsTable.tenantId, tenantMsId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  async function mountPoamsApp() {
    const { default: router } = await import("./msp-poams.ts");
    const app = express();
    app.use(express.json());
    app.use("/api", router);
    return app;
  }

  async function makeActivePoam(ref: string) {
    const [poam] = await db
      .insert(mspPoamsTable)
      .values({
        mspId,
        poamId: `POAM-TEST-${ref}`,
        tenantId: tenantMsId,
        tenantName: `POAM Role Floor Test Customer ${suffix}`,
        primaryDomain: "contoso.com",
        title: "Disable legacy auth protocols",
        weaknessDescription: "Legacy authentication remains enabled on Exchange Online.",
        scheduledCompletionDate: "2026-12-01",
        originalScheduledCompletionDate: "2026-12-01",
        interimCompensatingControl: "Conditional Access blocks legacy auth for all but the break-glass account.",
        resourcesRequired: "2 engineer-days",
        status: "active",
      })
      .returning({ id: mspPoamsTable.id, poamId: mspPoamsTable.poamId });
    poamIdsToClean.push(poam.id);
    return poam;
  }

  it("refuses an MSPOperator's generic PATCH with status:'cancelled' (409), and the row is left active", async () => {
    const poam = await makeActivePoam(`CANCEL-BYPASS-${suffix}`);
    const app = await mountPoamsApp();
    const token = makeToken({ mspId });

    const res = await request(app)
      .patch(`/api/msp/poams/${poam.poamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "cancelled" });

    expect(res.status).toBe(409);

    const [unchanged] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poam.id));
    expect(unchanged.status).toBe("active");
  });

  it("still lets an MSPAdmin cancel via the dedicated route the generic PATCH now redirects to", async () => {
    const poam = await makeActivePoam(`CANCEL-VIA-DEDICATED-${suffix}`);
    const app = await mountPoamsApp();
    const adminToken = makeToken({ mspId, mspRole: "MSPAdmin" });

    const res = await request(app)
      .patch(`/api/msp/poams/${poam.poamId}/cancel`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poam.id));
    expect(updated.status).toBe("cancelled");
  });

  it("still allows an MSPOperator's generic PATCH to edit ordinary narrative fields", async () => {
    const poam = await makeActivePoam(`ORDINARY-EDIT-${suffix}`);
    const app = await mountPoamsApp();
    const token = makeToken({ mspId });

    const res = await request(app)
      .patch(`/api/msp/poams/${poam.poamId}`)
      .set("Authorization", `Bearer ${token}`)
      .send({ resourcesRequired: "3 engineer-days" });

    expect(res.status).toBe(200);
    const [updated] = await db.select().from(mspPoamsTable).where(eq(mspPoamsTable.id, poam.id));
    expect(updated.resourcesRequired).toBe("3 engineer-days");
    expect(updated.status).toBe("active");
  });
});
