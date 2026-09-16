/**
 * Live-Postgres acceptance test for #4375 — the pending-purchase gate, driven through a
 * real Express app with a real signed JWT against the real local database.
 *
 *   1. a `RetainerPending` session is walled (403, `code: "pending_purchase"`) on an
 *      ordinary portal route, and still reaches `/auth/*` and `/public/*`;
 *   2. a token for a PackPending user whose ROW has since been promoted to a Consented rung
 *      is let straight through — the gate confirms the claim against the live row rather
 *      than walling a just-consented user for the rest of their token;
 *   3. a customer session passes untouched.
 *
 * Synthetic principal: one `zz-test-4375-*@example.invalid` login (reserved prefix,
 * CLAUDE.md), tenantless while pending, plus one `zz-test-4375-*` tenant the promotion test
 * attaches the way a real consent does.
 * `afterAll` deletes both and the gate's log lines for its tagged paths.
 *
 * Skips cleanly with no `DATABASE_URL`.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run pendingPurchaseGate.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-pendingPurchaseGate-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4375-${randomUUID().slice(0, 8)}`;

describeLive("#4375 — pending-purchase gate against the real database", () => {
  let dbm: typeof import("@workspace/db");
  let app: express.Express;
  let userId = 0;
  let tenantId = 0;

  const tokenFor = (mspRole: string) =>
    jwt.sign({ id: userId, email: `${TAG}@example.invalid`, role: "client", mspRole }, JWT_SECRET, { expiresIn: "5m" });

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    const { db, usersTable, tenantsTable } = dbm;
    const { pendingPurchaseGate } = await import("./pendingPurchaseGate.ts");

    const [user] = await db
      .insert(usersTable)
      .values({
        email: `${TAG}@example.invalid`,
        role: "client",
        mspRole: LEGACY_ROLE.retainerPending,
        name: `${TAG} synthetic`,
      })
      .returning({ id: usersTable.id });
    userId = user!.id;

    // The tenant a real promote-on-consent swap attaches — users_role_scope_check requires
    // one for the Consented rung the promotion test moves this user to.
    const [anyTenant] = await db.select({ mspId: tenantsTable.mspId }).from(tenantsTable).limit(1);
    expect(anyTenant, "the database must carry at least one tenant, for a real msps.id").toBeTruthy();
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId: anyTenant!.mspId, customerName: `${TAG} synthetic`, tenantId: TAG })
      .returning({ id: tenantsTable.id });
    tenantId = tenant!.id;

    app = express();
    app.use(pendingPurchaseGate);
    app.use((_req, res) => {
      res.json({ reached: true });
    });
  }, 30_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, usersTable, tenantsTable, platformLogStreamTable } = dbm;
    if (userId) await db.delete(usersTable).where(eq(usersTable.id, userId));
    if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    await db.delete(platformLogStreamTable).where(sql`${platformLogStreamTable.meta}->>'path' LIKE ${`%${TAG}%`}`);
  }, 30_000);

  it("walls a RetainerPending session off an ordinary portal route", async () => {
    const res = await request(app).get(`/portal/${TAG}/dashboard`).set("Authorization", `Bearer ${tokenFor(LEGACY_ROLE.retainerPending)}`);
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "pending_purchase", pendingRole: LEGACY_ROLE.retainerPending, resumePath: null });
  });

  it("walls a pre-#4371 RetainerNoConsent token the same way", async () => {
    const res = await request(app).get(`/msp/${TAG}`).set("Authorization", `Bearer ${tokenFor("RetainerNoConsent")}`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("pending_purchase");
  });

  it("still lets the pending session reach session and public checkout routes", async () => {
    const t = tokenFor(LEGACY_ROLE.retainerPending);
    for (const path of ["/auth/logout", "/auth/mfa/totp/setup", "/public/purchase/account-status"]) {
      const res = await request(app).post(path).set("Authorization", `Bearer ${t}`);
      expect(res.status, path).toBe(200);
    }
  });

  it("lets a stale PackPending token through once the live row has been promoted", async () => {
    const { db, usersTable } = dbm;
    const stale = tokenFor(LEGACY_ROLE.packPending);
    // The walled token first, against the still-pending row.
    expect((await request(app).get(`/portal/${TAG}/dashboard`).set("Authorization", `Bearer ${stale}`)).status).toBe(403);

    await db.update(usersTable).set({ mspRole: LEGACY_ROLE.retainerConsented, tenantId }).where(eq(usersTable.id, userId));
    try {
      const res = await request(app).get(`/portal/${TAG}/dashboard`).set("Authorization", `Bearer ${stale}`);
      expect(res.status).toBe(200);
    } finally {
      await db.update(usersTable).set({ mspRole: LEGACY_ROLE.retainerPending, tenantId: null }).where(eq(usersTable.id, userId));
    }
  });

  it("passes a customer session and an anonymous request untouched", async () => {
    expect((await request(app).get(`/portal/${TAG}/dashboard`).set("Authorization", `Bearer ${tokenFor(LEGACY_ROLE.customer)}`)).status).toBe(200);
    expect((await request(app).get(`/portal/${TAG}/dashboard`)).status).toBe(200);
  });
});
