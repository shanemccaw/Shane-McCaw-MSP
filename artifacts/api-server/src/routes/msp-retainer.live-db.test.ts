/**
 * Live-Postgres test for the MSP Console retainer-hours routes (Git #4020).
 *
 * Mounts the real router behind the real requireCapability/requireMspScope
 * against a real local Postgres — no `@workspace/db` mock — with a synthetic
 * MSP + tenant + retainer_settings row, cleaned up afterward. Covers logging,
 * adjusting, deleting, the rollover figures the lib computes, period close
 * (snapshot + lock), reopen (MSP admin only), and cross-MSP isolation.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run msp-retainer.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { eq } from "drizzle-orm";
import {
  db,
  mspsTable,
  tenantsTable,
  retainerSettingsTable,
  retainerWorkLogTable,
  retainerPeriodClosesTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-retainer-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function token(claims: Record<string, unknown>): string {
  return jwt.sign(
    { id: 1, email: "op@msp.test", role: "client", mspRole: LEGACY_ROLE.mspOperator, ...claims },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

describe.skipIf(!process.env.DATABASE_URL)("MSP Console retainer hours — live Postgres (#4020)", () => {
  const suffix = `vitest-4020-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  let otherMspId: number;
  let customerId: number;
  let otherCustomerId: number;
  let app: express.Express;
  let operator: string;
  let admin: string;
  let foreignOperator: string;

  // Anchor day 10 — resolved from retainer_settings.created_at, since the tenant has no subscription row.
  const JUNE = "2026-06-10";
  const MAY = "2026-05-10";

  beforeAll(async () => {
    const [msp] = await db.insert(mspsTable).values({ name: `Retainer MSP ${suffix}`, slug: suffix }).returning({ id: mspsTable.id });
    mspId = msp.id;
    const [other] = await db
      .insert(mspsTable)
      .values({ name: `Retainer Other MSP ${suffix}`, slug: `${suffix}-other` })
      .returning({ id: mspsTable.id });
    otherMspId = other.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Retainer Customer ${suffix}`, tenantId: suffix })
      .returning({ id: tenantsTable.id });
    customerId = tenant.id;
    const [otherTenant] = await db
      .insert(tenantsTable)
      .values({ mspId: otherMspId, customerName: `Retainer Other Customer ${suffix}`, tenantId: `${suffix}-other` })
      .returning({ id: tenantsTable.id });
    otherCustomerId = otherTenant.id;

    await db.insert(retainerSettingsTable).values({
      customerId,
      mspId,
      retainedMinutesPerMonth: 480,
      hourlyRateCents: 30000,
      architectName: "Test Architect",
      active: true,
      createdAt: new Date("2026-01-10T12:00:00Z"),
    });

    operator = token({ mspId });
    admin = token({ mspId, mspRole: LEGACY_ROLE.mspAdmin });
    foreignOperator = token({ mspId: otherMspId });

    const { default: router } = await import("./msp-retainer.ts");
    app = express();
    app.use(express.json());
    app.use("/api", router);
  });

  afterAll(async () => {
    await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.mspId, mspId));
    await db.delete(retainerPeriodClosesTable).where(eq(retainerPeriodClosesTable.customerId, customerId));
    await db.delete(retainerWorkLogTable).where(eq(retainerWorkLogTable.customerId, customerId));
    await db.delete(retainerSettingsTable).where(eq(retainerSettingsTable.customerId, customerId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, otherCustomerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    await db.delete(mspsTable).where(eq(mspsTable.id, otherMspId));
  });

  const base = () => `/api/msp/${mspId}/customers/${customerId}/retainer`;
  let mayEntryId: number;
  let juneEntryId: number;

  it("logs hours into the anniversary period the occurredAt falls in", async () => {
    const may = await request(app)
      .post(`${base()}/entries`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ item: "May workflow build", hours: 6, pillar: "Governance", occurredAt: "2026-05-20T15:00:00Z" });
    expect(may.status).toBe(201);
    expect(may.body.entry.periodMonth).toBe(MAY);
    expect(may.body.entry.hours).toBe(6);
    expect(may.body.entry.source).toBe("unscoped");
    mayEntryId = may.body.entry.id;

    const june = await request(app)
      .post(`${base()}/entries`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ item: "June CA review", hours: 4, occurredAt: "2026-06-15T15:00:00Z" });
    expect(june.status).toBe(201);
    expect(june.body.entry.periodMonth).toBe(JUNE);
    juneEntryId = june.body.entry.id;
  });

  it("adjusts an entry's hours", async () => {
    const res = await request(app)
      .patch(`${base()}/entries/${juneEntryId}`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ hours: 5.5, state: "closed" });
    expect(res.status).toBe(200);
    expect(res.body.entry.hours).toBe(5.5);
    expect(res.body.entry.stateStored).toBe("closed");
  });

  it("rejects an empty or invalid adjustment", async () => {
    const empty = await request(app).patch(`${base()}/entries/${juneEntryId}`).set("Authorization", `Bearer ${operator}`).send({});
    expect(empty.status).toBe(400);
    const bad = await request(app).patch(`${base()}/entries/${juneEntryId}`).set("Authorization", `Bearer ${operator}`).send({ hours: -1 });
    expect(bad.status).toBe(400);
  });

  it("reads the ledger with rollover computed by retainer-hours.ts", async () => {
    const res = await request(app).get(base()).set("Authorization", `Bearer ${operator}`);
    expect(res.status).toBe(200);
    expect(res.body.anchorDay).toBe(10);
    expect(res.body.settings.configured).toBe(true);
    const june = res.body.periods.find((p: { periodKey: string }) => p.periodKey === JUNE);
    // May: 8h retained, 6h used → 2h rolls. June: 8 + 2 − 5.5 = 4.5h remaining.
    expect(june.bucket).toMatchObject({ retainedHours: 8, rolledHours: 2, usedHours: 5.5, remainingHours: 4.5, isOverMonth: false });
    expect(june.hasEnded).toBe(true);
    expect(june.closed).toBe(false);
    expect(res.body.entries).toHaveLength(2);
  });

  it("refuses to close a period key that isn't this customer's boundary, or one that hasn't ended", async () => {
    const wrong = await request(app).post(`${base()}/periods/2026-06-11/close`).set("Authorization", `Bearer ${operator}`).send({});
    expect(wrong.status).toBe(400);
    const future = await request(app).post(`${base()}/periods/2099-01-10/close`).set("Authorization", `Bearer ${operator}`).send({});
    expect(future.status).toBe(409);
  });

  it("closes an ended period with a frozen snapshot, and refuses a second close", async () => {
    const res = await request(app)
      .post(`${base()}/periods/${JUNE}/close`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ note: "June reconciled" });
    expect(res.status).toBe(201);
    expect(res.body.close).toMatchObject({ periodKey: JUNE, anchorDay: 10, entryCount: 1, hourlyRateCents: 30000, note: "June reconciled" });
    expect(res.body.close.bucket).toMatchObject({ retainedHours: 8, rolledHours: 2, usedHours: 5.5, remainingHours: 4.5 });

    const [row] = await db.select().from(retainerPeriodClosesTable).where(eq(retainerPeriodClosesTable.customerId, customerId));
    expect(row.usedMinutes).toBe(330);

    const again = await request(app).post(`${base()}/periods/${JUNE}/close`).set("Authorization", `Bearer ${operator}`).send({});
    expect(again.status).toBe(409);
  });

  it("locks the closed period: log, adjust, move-into and delete all answer 409", async () => {
    const log = await request(app)
      .post(`${base()}/entries`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ item: "late June work", hours: 1, occurredAt: "2026-06-20T10:00:00Z" });
    expect(log.status).toBe(409);

    const adjust = await request(app).patch(`${base()}/entries/${juneEntryId}`).set("Authorization", `Bearer ${operator}`).send({ hours: 9 });
    expect(adjust.status).toBe(409);

    const moveIn = await request(app)
      .patch(`${base()}/entries/${mayEntryId}`)
      .set("Authorization", `Bearer ${operator}`)
      .send({ occurredAt: "2026-06-12T10:00:00Z" });
    expect(moveIn.status).toBe(409);

    const del = await request(app).delete(`${base()}/entries/${juneEntryId}`).set("Authorization", `Bearer ${operator}`);
    expect(del.status).toBe(409);

    const detail = await request(app).get(base()).set("Authorization", `Bearer ${operator}`);
    const june = detail.body.periods.find((p: { periodKey: string }) => p.periodKey === JUNE);
    expect(june.closed).toBe(true);
    expect(detail.body.entries.find((e: { id: number }) => e.id === juneEntryId).periodClosed).toBe(true);
  });

  it("only an MSP admin can reopen; reopening unlocks the period", async () => {
    const byOperator = await request(app).post(`${base()}/periods/${JUNE}/reopen`).set("Authorization", `Bearer ${operator}`);
    expect(byOperator.status).toBe(403);

    const byAdmin = await request(app).post(`${base()}/periods/${JUNE}/reopen`).set("Authorization", `Bearer ${admin}`);
    expect(byAdmin.status).toBe(200);

    const notClosed = await request(app).post(`${base()}/periods/${JUNE}/reopen`).set("Authorization", `Bearer ${admin}`);
    expect(notClosed.status).toBe(404);

    const del = await request(app).delete(`${base()}/entries/${juneEntryId}`).set("Authorization", `Bearer ${operator}`);
    expect(del.status).toBe(200);
  });

  it("writes an msp_audit_logs row for each ledger action", async () => {
    const rows = await db.select({ actionType: mspAuditLogsTable.actionType }).from(mspAuditLogsTable).where(eq(mspAuditLogsTable.mspId, mspId));
    const actions = new Set(rows.map((r) => r.actionType));
    for (const a of ["RETAINER_HOURS_LOGGED", "RETAINER_HOURS_ADJUSTED", "RETAINER_HOURS_DELETED", "RETAINER_PERIOD_CLOSED", "RETAINER_PERIOD_REOPENED"]) {
      expect(actions.has(a)).toBe(true);
    }
  });

  it("lists only this MSP's customers", async () => {
    const res = await request(app).get(`/api/msp/${mspId}/retainer/customers`).set("Authorization", `Bearer ${operator}`);
    expect(res.status).toBe(200);
    expect(res.body.customers.map((c: { customerId: number }) => c.customerId)).toEqual([customerId]);
    expect(res.body.customers[0]).toMatchObject({ configured: true, onRetainer: true, entryCount: 1 });
  });

  it("isolates MSPs: a foreign operator is refused, and another MSP's customer is not found", async () => {
    const foreign = await request(app).get(base()).set("Authorization", `Bearer ${foreignOperator}`);
    expect(foreign.status).toBe(403);

    const crossCustomer = await request(app)
      .get(`/api/msp/${mspId}/customers/${otherCustomerId}/retainer`)
      .set("Authorization", `Bearer ${operator}`);
    expect(crossCustomer.status).toBe(404);

    const crossEntry = await request(app)
      .patch(`/api/msp/${otherMspId}/customers/${otherCustomerId}/retainer/entries/${mayEntryId}`)
      .set("Authorization", `Bearer ${foreignOperator}`)
      .send({ hours: 1 });
    expect(crossEntry.status).toBe(404);
  });

  it("refuses to close a period for a customer with no retainer configured", async () => {
    const otherAdmin = token({ mspId: otherMspId, mspRole: LEGACY_ROLE.mspAdmin });
    const res = await request(app)
      .post(`/api/msp/${otherMspId}/customers/${otherCustomerId}/retainer/periods/2026-06-01/close`)
      .set("Authorization", `Bearer ${otherAdmin}`)
      .send({});
    expect(res.status).toBe(409);
  });

  it("requires authentication", async () => {
    const res = await request(app).get(base());
    expect(res.status).toBe(401);
  });
});
