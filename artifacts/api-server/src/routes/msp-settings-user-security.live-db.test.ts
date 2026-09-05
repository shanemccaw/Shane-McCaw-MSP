/**
 * Live-Postgres regression test for the two routes #2723 fixed from no-ops (Git #2906).
 *
 * `msp-settings.ts`'s `PATCH /msp/settings/users/:userId/mfa-enforcement` and
 * `DELETE /msp/settings/users/:userId/sessions` had zero test coverage anywhere in the
 * repo — the only nearby file, `msp-settings-portal-links.test.ts`, only asserts the
 * MFA-reset email link's base URL and never touches either route. A mocked `db` would
 * assert only that `db.update()`/`revokeAllOtherSessions()` were *called*, which is
 * exactly the failure mode #2723 itself documents: a `200 ok` response with no real
 * effect. This file runs the real router against a real local Postgres connection and
 * asserts the actual row state:
 *   - mfa-enforcement really flips `users.mfa_enforced`, scoped to (userId, mspId).
 *   - the sessions DELETE really revokes every `user_sessions` row + its matching
 *     `msp_refresh_tokens` row, `revokedCount` matches the real count, and a
 *     subsequent `/auth/refresh` call with the now-revoked raw token is rejected.
 *
 * Skips cleanly with no `DATABASE_URL`, matching msp-sla-operator-tasks.live-db.test.ts.
 * Every row is synthetic, suffixed, and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-settings-user-security.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import {
  db,
  mspsTable,
  usersTable,
  userSessionsTable,
  mspRefreshTokensTable,
  mspAuditLogsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";

const JWT_SECRET = "test-msp-settings-user-security-live-secret";
process.env.JWT_SECRET = JWT_SECRET;

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

describe.skipIf(!process.env.DATABASE_URL)(
  "msp-settings.ts users/:userId mfa-enforcement + sessions — live Postgres (#2906)",
  () => {
    const suffix = `vitest-2906-${Math.floor(Math.random() * 1e9)}`;
    let mspId: number;
    let adminUserId: number;
    let targetUserId: number;
    let adminToken: string;

    beforeAll(async () => {
      const [msp] = await db
        .insert(mspsTable)
        .values({ name: `User Security Test MSP ${suffix}`, slug: suffix })
        .returning({ id: mspsTable.id });
      mspId = msp.id;

      const [admin] = await db
        .insert(usersTable)
        .values({
          email: `admin-${suffix}@example.com`,
          role: "client",
          mspRole: "MSPAdmin",
          mspId,
        })
        .returning({ id: usersTable.id });
      adminUserId = admin.id;

      const [target] = await db
        .insert(usersTable)
        .values({
          email: `target-${suffix}@example.com`,
          role: "client",
          mspRole: "MSPOperator",
          mspId,
          mfaEnforced: false,
        })
        .returning({ id: usersTable.id });
      targetUserId = target.id;

      adminToken = jwt.sign(
        { id: adminUserId, email: `admin-${suffix}@example.com`, role: "client", mspRole: "MSPAdmin", mspId },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
    });

    afterAll(async () => {
      await db.delete(mspAuditLogsTable).where(eq(mspAuditLogsTable.mspId, mspId));
      await db.delete(mspRefreshTokensTable).where(eq(mspRefreshTokensTable.userId, targetUserId));
      await db.delete(userSessionsTable).where(eq(userSessionsTable.userId, targetUserId));
      await db.delete(usersTable).where(eq(usersTable.id, targetUserId));
      await db.delete(usersTable).where(eq(usersTable.id, adminUserId));
      await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    });

    async function buildApp() {
      const { default: router } = await import("./msp-settings.ts");
      const app = express();
      app.use(express.json());
      app.use("/api", router);
      return app;
    }

    describe("PATCH /msp/settings/users/:userId/mfa-enforcement", () => {
      it("really flips users.mfa_enforced true, scoped to (userId, mspId) — not a no-op", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${targetUserId}/mfa-enforcement`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ enforced: true });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, enforced: true });

        const [row] = await db
          .select({ mfaEnforced: usersTable.mfaEnforced })
          .from(usersTable)
          .where(and(eq(usersTable.id, targetUserId), eq(usersTable.mspId, mspId)));
        expect(row?.mfaEnforced).toBe(true);
      });

      it("really flips it back to false on the next call — proves it isn't stuck true / write-once", async () => {
        const app = await buildApp();

        const res = await request(app)
          .patch(`/api/msp/settings/users/${targetUserId}/mfa-enforcement`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ enforced: false });

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ ok: true, enforced: false });

        const [row] = await db
          .select({ mfaEnforced: usersTable.mfaEnforced })
          .from(usersTable)
          .where(and(eq(usersTable.id, targetUserId), eq(usersTable.mspId, mspId)));
        expect(row?.mfaEnforced).toBe(false);
      });
    });

    describe("DELETE /msp/settings/users/:userId/sessions", () => {
      it("revokes every real session + its refresh token, matches revokedCount, and rejects the old token on refresh", async () => {
        const app = await buildApp();

        // Two real, non-revoked standard sessions for the target user, each backed
        // by a real msp_refresh_tokens row — exactly what a genuine multi-device
        // login leaves behind.
        const rawTokenA = crypto.randomBytes(24).toString("hex");
        const rawTokenB = crypto.randomBytes(24).toString("hex");
        const tokenHashA = hashRefreshToken(rawTokenA);
        const tokenHashB = hashRefreshToken(rawTokenB);
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await db.insert(mspRefreshTokensTable).values([
          { userId: targetUserId, tokenHash: tokenHashA, expiresAt },
          { userId: targetUserId, tokenHash: tokenHashB, expiresAt },
        ]);
        await db.insert(userSessionsTable).values([
          { userId: targetUserId, sessionType: "standard", loginMethod: "password", currentTokenHash: tokenHashA, expiresAt },
          { userId: targetUserId, sessionType: "standard", loginMethod: "password", currentTokenHash: tokenHashB, expiresAt },
        ]);

        const res = await request(app)
          .delete(`/api/msp/settings/users/${targetUserId}/sessions`)
          .set("Authorization", `Bearer ${adminToken}`);

        expect(res.status).toBe(200);
        // The real, pre-fix no-op always returned revokedCount: 0 with nothing
        // actually revoked — assert the genuine count of the two rows seeded above.
        expect(res.body).toMatchObject({ ok: true, revokedCount: 2 });

        const sessionRows = await db
          .select()
          .from(userSessionsTable)
          .where(eq(userSessionsTable.userId, targetUserId));
        expect(sessionRows).toHaveLength(2);
        for (const row of sessionRows) {
          expect(row.revokedAt).not.toBeNull();
        }

        const refreshTokenRows = await db
          .select()
          .from(mspRefreshTokensTable)
          .where(eq(mspRefreshTokensTable.userId, targetUserId));
        expect(refreshTokenRows).toHaveLength(2);
        for (const row of refreshTokenRows) {
          expect(row.revokedAt).not.toBeNull();
        }

        // Prove the effect is real, not just a DB-row formality: a subsequent use
        // of one of the now-revoked raw tokens against the real /auth/refresh route
        // must be rejected, not silently honored.
        const { default: authRouter } = await import("./auth.ts");
        const authApp = express();
        authApp.use(express.json());
        authApp.use("/api", authRouter);

        const refreshRes = await request(authApp)
          .post("/api/auth/refresh")
          .send({ refreshToken: rawTokenA });

        expect(refreshRes.status).toBe(401);
      });

      it("404s for a userId outside the caller's own MSP — never revokes a stranger's sessions", async () => {
        const app = await buildApp();

        const [otherMsp] = await db
          .insert(mspsTable)
          .values({ name: `Other MSP ${suffix}`, slug: `${suffix}-other` })
          .returning({ id: mspsTable.id });
        const [otherUser] = await db
          .insert(usersTable)
          .values({ email: `other-${suffix}@example.com`, role: "client", mspRole: "MSPOperator", mspId: otherMsp.id })
          .returning({ id: usersTable.id });

        try {
          const res = await request(app)
            .delete(`/api/msp/settings/users/${otherUser.id}/sessions`)
            .set("Authorization", `Bearer ${adminToken}`);

          expect(res.status).toBe(404);
        } finally {
          await db.delete(usersTable).where(eq(usersTable.id, otherUser.id));
          await db.delete(mspsTable).where(eq(mspsTable.id, otherMsp.id));
        }
      });
    });
  },
);
