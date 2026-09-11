/**
 * Live-Postgres regression test for Group L (Git #3693) — MSP-staff alert
 * preferences, the real, confirmed v1.1 gap Shane flagged: no per-MSP-staff-user
 * notification preference surface existed anywhere before this build.
 *
 * Covers two things a mocked `db` would not catch:
 *   - GET/PATCH `/msp/settings/notification-preferences` really persist per-user
 *     rows in `msp_staff_notification_preferences`, defaulting unset categories
 *     to { inAppEnabled: true, emailEnabled: false }, matching the customer-side
 *     `notification-preferences.ts` pair exactly.
 *   - `createNotification()` (notification-center.ts) really reads this table
 *     before firing an `msp_user` notification — an `inAppEnabled: false`
 *     category is genuinely suppressed (no row inserted), not just filtered at
 *     display time.
 *
 * Skips cleanly with no `DATABASE_URL`, matching the other msp-settings
 * live-db test files. Every row is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-settings-notification-preferences.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  db,
  mspsTable,
  usersTable,
  mspStaffNotificationPreferencesTable,
  notificationsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-settings-notification-preferences-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

describe.skipIf(!process.env.DATABASE_URL)(
  "msp-settings.ts notification-preferences (Group L) — live Postgres (#3693)",
  () => {
    const suffix = `vitest-3693-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let operatorUserId: number;
    let operatorToken: string;

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `Notification Prefs Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const [operator] = await db
        .insert(usersTable)
        .values({
          email: `operator-${suffix}@example.com`,
          role: "client",
          mspRole: LEGACY_ROLE.mspOperator,
          mspId,
        })
        .returning({ id: usersTable.id });
      operatorUserId = operator.id;

      operatorToken = jwt.sign(
        { id: operatorUserId, email: `operator-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.mspOperator, mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
    });

    afterAll(async () => {
      await db.delete(notificationsTable).where(eq(notificationsTable.mspUserId, operatorUserId));
      await db.delete(mspStaffNotificationPreferencesTable).where(eq(mspStaffNotificationPreferencesTable.userId, operatorUserId));
      await db.delete(usersTable).where(eq(usersTable.id, operatorUserId));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    });

    async function buildApp() {
      const { default: router } = await import("./msp-settings.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    describe("GET /msp/settings/notification-preferences", () => {
      it("defaults every category to inAppEnabled:true, emailEnabled:false with no rows yet — MSPOperator can read own prefs", async () => {
        const app = await buildApp();

        const res = await request(app)
          .get("/api/msp/settings/notification-preferences")
          .set("Authorization", `Bearer ${operatorToken}`);

        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.preferences)).toBe(true);
        expect(res.body.preferences.length).toBeGreaterThan(0);
        const security = res.body.preferences.find((p: { category: string }) => p.category === "security");
        expect(security).toMatchObject({ inAppEnabled: true, emailEnabled: false });
      });
    });

    describe("PATCH /msp/settings/notification-preferences", () => {
      it("really upserts a real row, scoped to the caller's own userId", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch("/api/msp/settings/notification-preferences")
          .set("Authorization", `Bearer ${operatorToken}`)
          .send({ preferences: [{ category: "security", inAppEnabled: false, emailEnabled: true }] });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true });

        const [row] = await db
          .select()
          .from(mspStaffNotificationPreferencesTable)
          .where(and(eq(mspStaffNotificationPreferencesTable.userId, operatorUserId), eq(mspStaffNotificationPreferencesTable.category, "security")));
        expect(row).toMatchObject({ inAppEnabled: false, emailEnabled: true });

        const getRes = await request(app)
          .get("/api/msp/settings/notification-preferences")
          .set("Authorization", `Bearer ${operatorToken}`);
        const security = getRes.body.preferences.find((p: { category: string }) => p.category === "security");
        expect(security).toMatchObject({ inAppEnabled: false, emailEnabled: true });
      });
    });

    describe("createNotification() delivery gating (notification-center.ts)", () => {
      it("really suppresses an msp_user notification when inAppEnabled is false — no row inserted", async () => {
        const { createNotification } = await import("../lib/notification-center.ts");

        const notifId = await createNotification({
          title: "Suppressed test notification",
          category: "security",
          recipient: { type: "msp_user", mspUserId: operatorUserId, mspId },
        });

        expect(notifId).toBeNull();

        const rows = await db
          .select()
          .from(notificationsTable)
          .where(and(eq(notificationsTable.mspUserId, operatorUserId), eq(notificationsTable.category, "security")));
        expect(rows).toHaveLength(0);
      });

      it("really inserts the notification for a category with inAppEnabled true (the default)", async () => {
        const { createNotification } = await import("../lib/notification-center.ts");

        const notifId = await createNotification({
          title: "Delivered test notification",
          category: "payment",
          recipient: { type: "msp_user", mspUserId: operatorUserId, mspId },
        });

        expect(notifId).not.toBeNull();

        const rows = await db
          .select()
          .from(notificationsTable)
          .where(and(eq(notificationsTable.mspUserId, operatorUserId), eq(notificationsTable.category, "payment")));
        expect(rows).toHaveLength(1);
      });
    });
  },
);
