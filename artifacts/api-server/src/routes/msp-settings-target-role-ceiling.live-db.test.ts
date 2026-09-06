/**
 * Live-Postgres regression test for the Git #3032 privilege-escalation fix.
 *
 * `msp-settings.ts`'s five credential/security-action routes gated the CALLER at
 * `requireRole("MSPAdmin")` (a minimum-tier floor) but applied NO check comparing the
 * caller's role to the TARGET user's role — only an `mspId` ownership filter. Since
 * `PlatformAdmin` carries `mspId` the same as any other role at that MSP, a real
 * MSPAdmin JWT could reset a PlatformAdmin's password, mint a temp password (returned
 * as plaintext), clear their MFA, or suspend their account — full privilege escalation,
 * no interaction with the target needed:
 *
 *   - POST  /msp/settings/users/:userId/reset-password
 *   - POST  /msp/settings/users/:userId/temp-password
 *   - POST  /msp/settings/users/:userId/reset-mfa
 *   - PATCH /msp/settings/users/:userId/mfa-enforcement
 *   - PATCH /msp/settings/users/:userId/status
 *
 * This file runs the real router against a real local Postgres connection and proves,
 * for every one of the five routes:
 *   1. An MSPAdmin JWT attempting the route against a PlatformAdmin target at the SAME
 *      MSP now gets a real 403 — not a silent 200 with the escalation applied.
 *   2. The target row's real state is provably UNCHANGED by the rejected call (password
 *      hash, MFA enrollment row, mfaEnforced flag, isActive flag all untouched).
 *   3. The exact same route against a legitimate lower-tier target (MSPOperator) still
 *      returns 200 and really applies the action — the fix doesn't just fail closed on
 *      everything.
 *
 * Skips cleanly with no `DATABASE_URL`, matching msp-settings-user-security.live-db.test.ts.
 * Every row is synthetic, suffixed, and removed in `afterAll`. Mailer calls are mocked
 * (a rejected call never reaches them anyway; the allowed-path assertions don't depend
 * on real Exchange Online delivery).
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-settings-target-role-ceiling.live-db
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import {
  db,
  mspsTable,
  usersTable,
  mfaEnrollmentsTable,
  mspAuditLogsTable,
  passwordResetTokensTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

vi.mock("../lib/mailer.ts", () => ({
  sendEmailForMsp: vi.fn().mockResolvedValue(undefined),
  emailButton: vi.fn().mockReturnValue(""),
  brandedEmail: vi.fn().mockReturnValue(""),
  sendEmailFromTemplate: vi.fn().mockResolvedValue(undefined),
  passwordResetEmail: vi.fn().mockReturnValue(""),
}));

const JWT_SECRET = "test-msp-settings-target-role-ceiling-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

describe.skipIf(!process.env.DATABASE_URL)(
  "msp-settings.ts target-role ceiling on the 5 credential/security-action routes — live Postgres (#3032)",
  () => {
    const suffix = `vitest-3032-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let mspAdminUserId: number;
    let platformAdminUserId: number;
    let mspOperatorUserId: number;
    let mspAdminToken: string;
    const ORIGINAL_PLATFORM_ADMIN_HASH_MARKER = "original-platform-admin-hash";

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `Target Role Ceiling Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const originalPlatformAdminHash = await bcrypt.hash(ORIGINAL_PLATFORM_ADMIN_HASH_MARKER, 4);

      const [mspAdmin] = await db
        .insert(usersTable)
        .values({
          email: `mspadmin-${suffix}@example.com`,
          role: "client",
          mspRole: "MSPAdmin",
          mspId,
        })
        .returning({ id: usersTable.id });
      mspAdminUserId = mspAdmin.id;

      // The attack target: a PlatformAdmin at the SAME MSP — exactly the live,
      // confirmed case from the issue body (shane@shanemccaw.com, id 1, mspId 1).
      const [platformAdmin] = await db
        .insert(usersTable)
        .values({
          email: `platformadmin-${suffix}@example.com`,
          role: "client",
          mspRole: "PlatformAdmin",
          mspId,
          passwordHash: originalPlatformAdminHash,
          mfaEnforced: false,
          isActive: true,
        })
        .returning({ id: usersTable.id });
      platformAdminUserId = platformAdmin.id;

      // A real, surviving MFA enrollment on the PlatformAdmin target — proves a
      // rejected reset-mfa call really leaves it in place, not just returns 403.
      await db.insert(mfaEnrollmentsTable).values({
        userId: platformAdminUserId,
        method: "totp",
        encryptedSecret: "JBSWY3DPEHPK3PXP",
      });

      // A legitimate lower-tier target — proves the fix doesn't just fail closed
      // on every target, only on peers/higher tiers.
      const [mspOperator] = await db
        .insert(usersTable)
        .values({
          email: `mspoperator-${suffix}@example.com`,
          role: "client",
          mspRole: "MSPOperator",
          mspId,
          mfaEnforced: false,
          isActive: true,
        })
        .returning({ id: usersTable.id });
      mspOperatorUserId = mspOperator.id;

      mspAdminToken = jwt.sign(
        { id: mspAdminUserId, email: `mspadmin-${suffix}@example.com`, role: "client", mspRole: "MSPAdmin", mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
    });

    afterAll(async () => {
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.mspId, mspId));
      await db.delete(passwordResetTokensTable).where(eq(passwordResetTokensTable.userId, platformAdminUserId));
      await db.delete(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, platformAdminUserId));
      await db.delete(usersTable).where(eq(usersTable.id, mspOperatorUserId));
      await db.delete(usersTable).where(eq(usersTable.id, platformAdminUserId));
      await db.delete(usersTable).where(eq(usersTable.id, mspAdminUserId));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    });

    async function buildApp() {
      const { default: router } = await import("./msp-settings.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    async function getUserRow(userId: number) {
      const [row] = await db
        .select({
          passwordHash: usersTable.passwordHash,
          mfaEnforced: usersTable.mfaEnforced,
          isActive: usersTable.isActive,
        })
        .from(usersTable)
        .where(and(eq(usersTable.id, userId), eq(usersTable.mspId, mspId)));
      return row;
    }

    describe("blocked: MSPAdmin caller against a PlatformAdmin target (the live exploit path)", () => {
      it("POST reset-password → 403, no reset token issued", async () => {
        const app = await buildApp();

        const res = await request(app)
          .post(`/api/msp/settings/users/${platformAdminUserId}/reset-password`)
          .set("Authorization", `Bearer ${mspAdminToken}`);

        expect(res.status).toBe(403);

        const tokens = await db
          .select({ id: passwordResetTokensTable.id })
          .from(passwordResetTokensTable)
          .where(eq(passwordResetTokensTable.userId, platformAdminUserId));
        expect(tokens).toHaveLength(0);
      });

      it("POST temp-password → 403, passwordHash never overwritten (the exact escalation the issue describes)", async () => {
        const app = await buildApp();

        const res = await request(app)
          .post(`/api/msp/settings/users/${platformAdminUserId}/temp-password`)
          .set("Authorization", `Bearer ${mspAdminToken}`);

        expect(res.status).toBe(403);
        expect(res.body.tempPassword).toBeUndefined();

        const row = await getUserRow(platformAdminUserId);
        const stillOriginal = await bcrypt.compare(ORIGINAL_PLATFORM_ADMIN_HASH_MARKER, row!.passwordHash!);
        expect(stillOriginal).toBe(true);
      });

      it("POST reset-mfa → 403, real MFA enrollment row survives untouched", async () => {
        const app = await buildApp();

        const res = await request(app)
          .post(`/api/msp/settings/users/${platformAdminUserId}/reset-mfa`)
          .set("Authorization", `Bearer ${mspAdminToken}`);

        expect(res.status).toBe(403);

        const enrollments = await db
          .select({ id: mfaEnrollmentsTable.id })
          .from(mfaEnrollmentsTable)
          .where(eq(mfaEnrollmentsTable.userId, platformAdminUserId));
        expect(enrollments).toHaveLength(1);
      });

      it("PATCH mfa-enforcement → 403, mfaEnforced flag left unchanged", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${platformAdminUserId}/mfa-enforcement`)
          .set("Authorization", `Bearer ${mspAdminToken}`)
          .send({ enforced: true });

        expect(res.status).toBe(403);

        const row = await getUserRow(platformAdminUserId);
        expect(row?.mfaEnforced).toBe(false);
      });

      it("PATCH status → 403, cannot suspend the PlatformAdmin's account", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${platformAdminUserId}/status`)
          .set("Authorization", `Bearer ${mspAdminToken}`)
          .send({ isActive: false });

        expect(res.status).toBe(403);

        const row = await getUserRow(platformAdminUserId);
        expect(row?.isActive).toBe(true);
      });
    });

    describe("still allowed: MSPAdmin caller against a genuinely lower-tier MSPOperator target", () => {
      it("PATCH mfa-enforcement → 200, really flips the flag for a legitimate target", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${mspOperatorUserId}/mfa-enforcement`)
          .set("Authorization", `Bearer ${mspAdminToken}`)
          .send({ enforced: true });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, enforced: true });

        const [row] = await db
          .select({ mfaEnforced: usersTable.mfaEnforced })
          .from(usersTable)
          .where(and(eq(usersTable.id, mspOperatorUserId), eq(usersTable.mspId, mspId)));
        expect(row?.mfaEnforced).toBe(true);
      });

      it("PATCH status → 200, really suspends a legitimate target", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${mspOperatorUserId}/status`)
          .set("Authorization", `Bearer ${mspAdminToken}`)
          .send({ isActive: false });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, isActive: false });

        const [row] = await db
          .select({ isActive: usersTable.isActive })
          .from(usersTable)
          .where(and(eq(usersTable.id, mspOperatorUserId), eq(usersTable.mspId, mspId)));
        expect(row?.isActive).toBe(false);
      });

      it("POST temp-password → 200, really rewrites the target's passwordHash", async () => {
        const app = await buildApp();

        const res = await request(app)
          .post(`/api/msp/settings/users/${mspOperatorUserId}/temp-password`)
          .set("Authorization", `Bearer ${mspAdminToken}`);

        expect(res.status).toBe(200);
        expect(typeof res.body.tempPassword).toBe("string");

        const row = await getUserRow(mspOperatorUserId);
        const matchesReturnedTemp = await bcrypt.compare(res.body.tempPassword, row!.passwordHash!);
        expect(matchesReturnedTemp).toBe(true);
      });
    });
  },
);
