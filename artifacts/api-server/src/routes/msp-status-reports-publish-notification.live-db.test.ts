/**
 * Live-Postgres regression test for Git #4252 — the customer notification
 * fan-out on `POST /msp/status-reports/:id/publish`, permission-filtered
 * through the same real `evaluateAccess()`/`ladderEvaluationInput()` ladder
 * check `filterByStatusReportViewAccess` already applies on the comments
 * route (#3043's real fix), never shipped unfiltered.
 *
 * Covers three real recipients on the same customer, against real Postgres:
 *   - a Customer-tier user with no preference row (default opt-in) — holds
 *     `ladder.customer-user` -> notified
 *   - a Free-tier user — subscribed by default but denied by the ladder ->
 *     NOT notified (the exact #1923/#3043 permission gap, closed here)
 *   - a Customer-tier user who explicitly opted out of the
 *     "status_report_published" category -> NOT notified (createNotification's
 *     own preference gate)
 *
 * Skips cleanly with no DATABASE_URL, matching the other *.live-db.test.ts
 * files. Every row is synthetic, suffixed, and removed in afterAll.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-status-reports-publish-notification.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  db,
  mspsTable,
  tenantsTable,
  usersTable,
  mspStatusReportsTable,
  notificationsTable,
  customerNotificationPreferencesTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

const JWT_SECRET = "test-msp-status-reports-publish-notification-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

describe.skipIf(!process.env.DATABASE_URL)(
  "msp-status-reports.ts POST /publish — customer notification fan-out (#4252) — live Postgres",
  () => {
    const suffix = `vitest-4252-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let customerId: number;
    let operatorUserId: number;
    let operatorToken: string;
    let allowedUserId: number;
    let freeUserId: number;
    let optedOutUserId: number;
    let reportId: number;

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `Status Report Notify Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const [tenant] = await db
        .insert(tenantsTable)
        .values({ mspId, customerName: `Status Report Notify Test Customer ${suffix}`, tenantId: suffix })
        .returning({ id: tenantsTable.id });
      customerId = tenant.id;

      const [operator] = await db
        .insert(usersTable)
        .values({ email: `operator-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.mspOperator, mspId })
        .returning({ id: usersTable.id });
      operatorUserId = operator.id;
      operatorToken = jwt.sign(
        { id: operatorUserId, email: `operator-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.mspOperator, mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );

      const [allowedUser] = await db
        .insert(usersTable)
        .values({ email: `allowed-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.customer, tenantId: customerId })
        .returning({ id: usersTable.id });
      allowedUserId = allowedUser.id;

      const [freeUser] = await db
        .insert(usersTable)
        .values({ email: `free-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.free, tenantId: customerId })
        .returning({ id: usersTable.id });
      freeUserId = freeUser.id;

      const [optedOutUser] = await db
        .insert(usersTable)
        .values({ email: `optedout-${suffix}@example.com`, role: "client", mspRole: LEGACY_ROLE.customer, tenantId: customerId })
        .returning({ id: usersTable.id });
      optedOutUserId = optedOutUser.id;
      await db.insert(customerNotificationPreferencesTable).values({
        userId: optedOutUserId,
        category: "status_report_published",
        inAppEnabled: false,
        emailEnabled: false,
      });

      const [report] = await db
        .insert(mspStatusReportsTable)
        .values({
          mspId,
          customerId,
          periodLabel: `Publish Notify Test ${suffix}`,
          asOfDate: new Date(),
          content: "Live-db test content.",
          state: "draft",
          authoredByUserId: operatorUserId,
        })
        .returning({ id: mspStatusReportsTable.id });
      reportId = report.id;
    });

    afterAll(async () => {
      await db.delete(notificationsTable).where(eq(notificationsTable.category, "status_report_published"));
      await db.delete(customerNotificationPreferencesTable).where(eq(customerNotificationPreferencesTable.userId, optedOutUserId));
      await db.delete(mspStatusReportsTable).where(eq(mspStatusReportsTable.id, reportId));
      await db.delete(usersTable).where(eq(usersTable.id, operatorUserId));
      await db.delete(usersTable).where(eq(usersTable.id, allowedUserId));
      await db.delete(usersTable).where(eq(usersTable.id, freeUserId));
      await db.delete(usersTable).where(eq(usersTable.id, optedOutUserId));
      await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    });

    async function buildApp() {
      const { default: router } = await import("./msp-status-reports.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    it("publishes, then notifies only the permitted+opted-in recipient — Free-tier denied, opted-out skipped", async () => {
      const app = await buildApp();

      const res = await request(app)
        .post(`/api/msp/status-reports/${reportId}/publish`)
        .set("Authorization", `Bearer ${operatorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.report).toMatchObject({ id: reportId, state: "published" });

      // Fan-out is fire-and-forget (void async IIFE) — give it a tick to land.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const notifiedRows = await db
        .select({ userId: notificationsTable.userId })
        .from(notificationsTable)
        .where(eq(notificationsTable.category, "status_report_published"));
      const notifiedUserIds = notifiedRows.map((r) => r.userId);

      expect(notifiedUserIds).toContain(allowedUserId);
      expect(notifiedUserIds).not.toContain(freeUserId);
      expect(notifiedUserIds).not.toContain(optedOutUserId);
    });
  },
);
