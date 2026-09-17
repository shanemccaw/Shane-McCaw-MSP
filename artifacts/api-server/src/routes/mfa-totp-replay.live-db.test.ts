/**
 * Live-Postgres regression test for #4408 — TOTP replay protection (RFC 6238
 * §5.2), driven through the REAL mfa.ts router against the real local database.
 *
 * Before #4408 a valid six-digit code could be used for any number of sign-ins
 * inside its ~30s tolerance window, and the code typed to finish enrollment was
 * accepted again at the sign-in challenge straight afterwards. Now
 * mfa_enrollments.totp_last_accepted_step records the step of the last accepted
 * code and every TOTP check refuses a step <= it:
 *
 *   1. /auth/mfa/totp/verify-setup stores the enrolling code's step as spent; a
 *      replayed verify-setup is refused and cannot rewind the stored step;
 *   2. /auth/mfa/totp/challenge and /auth/mfa/verify each accept a code once,
 *      and a code spent on one is refused by the other;
 *   3. concurrent challenges carrying the same code: exactly one wins;
 *   4. a pre-#4408 enrollment (null step) accepts its first code, then refuses it;
 *   5. the check never throws on a malformed secret or a stored step ahead of
 *      the server clock.
 *
 * The purchase-flow verify-setup (public-purchase-account.ts) goes through the
 * same enrollTotp; account-first-purchase.live-db.test.ts asserts its enrolling
 * code is refused at the challenge.
 *
 * Synthetic identities only: `zz-test-4408-<tag>-*@example.invalid`. afterAll
 * deletes everything carrying the tag. Skips cleanly with no DATABASE_URL.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run mfa-totp-replay.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { generateSecret } from "otplib";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { nextTotpCode, lastIssuedTotpStep } from "../test-setup/totp-codes.ts";

process.env.JWT_SECRET ??= "test-4408-totp-replay-live-secret";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4408-${randomUUID().slice(0, 8)}`;

describeLive("#4408 — TOTP codes are single-use, real database", () => {
  let dbm: typeof import("@workspace/db");
  let mfa: typeof import("./mfa.ts");
  let app: express.Express;

  async function createUser(label: string): Promise<{ id: number; email: string; token: string }> {
    const { db, usersTable } = dbm;
    const email = `${TAG}-${label}@example.invalid`;
    const [row] = await db
      .insert(usersTable)
      .values({ email, name: `${TAG} ${label}`, mspRole: LEGACY_ROLE.monitoringPending, isActive: true })
      .returning({ id: usersTable.id });
    const token = jwt.sign({ id: row.id, email, role: "client" }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    return { id: row.id, email, token };
  }

  async function storedSteps(userId: number): Promise<Array<number | null>> {
    const { db, mfaEnrollmentsTable } = dbm;
    const rows = await db
      .select({ step: mfaEnrollmentsTable.totpLastAcceptedStep })
      .from(mfaEnrollmentsTable)
      .where(and(eq(mfaEnrollmentsTable.userId, userId), eq(mfaEnrollmentsTable.method, "totp")));
    return rows.map((r) => r.step);
  }

  const challenge = (userId: number, code: string) =>
    request(app).post("/auth/mfa/totp/challenge").send({ mfaToken: mfa.signMfaToken(userId, ["totp"]), code });

  const unifiedVerify = (userId: number, code: string) =>
    request(app).post("/auth/mfa/verify").send({ mfaToken: mfa.signMfaToken(userId, ["totp"]), method: "totp", code });

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    mfa = await import("./mfa.ts");
    app = express();
    app.use(express.json());
    app.use(mfa.default);
  }, 120_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, usersTable, auditLogsTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      const idList = sql.join(userIds.map((id) => sql`${id}`), sql`, `);
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
      await db.execute(sql`DELETE FROM msp_refresh_tokens WHERE user_id IN (${idList})`).catch(() => {});
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id IN (${idList})`).catch(() => {});
    }
    // mfa_enrollments cascades with the user.
    await db.delete(usersTable).where(like(usersTable.email, `${TAG}-%`));
  }, 60_000);

  it("verify-setup spends the enrolling code; challenge and /auth/mfa/verify each accept a code exactly once", async () => {
    const user = await createUser("enroll");

    const setup = await request(app).post("/auth/mfa/totp/setup").set("Authorization", `Bearer ${user.token}`);
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    const secret = setup.body.secret as string;

    // 1 — enrollment stores the enrolling code's step as spent.
    const enrollCode = await nextTotpCode(secret);
    const enrolled = await request(app)
      .post("/auth/mfa/totp/verify-setup")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ secret, code: enrollCode });
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);
    const enrollStep = lastIssuedTotpStep(secret)!;
    expect(await storedSteps(user.id)).toEqual([enrollStep]);

    // A replayed verify-setup is refused and leaves the stored step where it was.
    const replayedSetup = await request(app)
      .post("/auth/mfa/totp/verify-setup")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ secret, code: enrollCode });
    expect(replayedSetup.status).toBe(400);
    expect(await storedSteps(user.id)).toEqual([enrollStep]);

    // The exact #4408 repro: the enrolling code, straight back at the challenge.
    const enrollReplay = await challenge(user.id, enrollCode);
    expect(enrollReplay.status, JSON.stringify(enrollReplay.body)).toBe(401);
    expect(enrollReplay.body.accessToken).toBeUndefined();

    // 2 — a fresh code signs in once through the challenge…
    const code1 = await nextTotpCode(secret);
    const first = await challenge(user.id, code1);
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.accessToken).toBeTruthy();
    expect(await storedSteps(user.id)).toEqual([lastIssuedTotpStep(secret)]);

    // …and never again, through either endpoint.
    expect((await challenge(user.id, code1)).status).toBe(401);
    expect((await unifiedVerify(user.id, code1)).status).toBe(401);

    // /auth/mfa/verify: same rule, and a code it spent is refused by the challenge.
    const code2 = await nextTotpCode(secret);
    const second = await unifiedVerify(user.id, code2);
    expect(second.status, JSON.stringify(second.body)).toBe(200);
    expect(second.body.accessToken).toBeTruthy();
    expect((await unifiedVerify(user.id, code2)).status).toBe(401);
    expect((await challenge(user.id, code2)).status).toBe(401);
    expect(await storedSteps(user.id)).toEqual([lastIssuedTotpStep(secret)]);
  }, 180_000);

  it("concurrent challenges carrying the same code: exactly one signs in", async () => {
    const user = await createUser("race");
    const setup = await request(app).post("/auth/mfa/totp/setup").set("Authorization", `Bearer ${user.token}`);
    const secret = setup.body.secret as string;
    await request(app)
      .post("/auth/mfa/totp/verify-setup")
      .set("Authorization", `Bearer ${user.token}`)
      .send({ secret, code: await nextTotpCode(secret) })
      .expect(200);

    const code = await nextTotpCode(secret);
    const results = await Promise.all(Array.from({ length: 4 }, () => challenge(user.id, code)));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses, JSON.stringify(results.map((r) => r.body))).toEqual([200, 401, 401, 401]);
  }, 180_000);

  it("a pre-#4408 enrollment (no stored step) accepts its first code, then refuses it", async () => {
    const { db, mfaEnrollmentsTable } = dbm;
    const user = await createUser("legacy");
    const secret = generateSecret();
    await db.insert(mfaEnrollmentsTable).values({
      userId: user.id,
      method: "totp",
      enabled: true,
      encryptedSecret: mfa.encryptTotp(secret),
    });
    expect(await storedSteps(user.id)).toEqual([null]);

    const code = await nextTotpCode(secret);
    expect((await challenge(user.id, code)).status).toBe(200);
    expect(await storedSteps(user.id)).toEqual([lastIssuedTotpStep(secret)]);
    expect((await challenge(user.id, code)).status).toBe(401);
  }, 180_000);

  it("the check refuses — never throws — on a malformed secret or a stored step ahead of the clock", async () => {
    const secret = generateSecret();
    const code = await nextTotpCode(secret);
    const step = lastIssuedTotpStep(secret)!;

    expect(mfa.checkTotpCode(secret, code, null)).toEqual({ valid: true, timeStep: step });
    expect(mfa.checkTotpCode(secret, code, step)).toEqual({ valid: false });
    expect(mfa.checkTotpCode(secret, code, step - 1)).toEqual({ valid: true, timeStep: step });
    expect(mfa.checkTotpCode("not-a-secret", code, null)).toEqual({ valid: false });
    expect(mfa.checkTotpCode(secret, "12", null)).toEqual({ valid: false });
    expect(mfa.checkTotpCode(secret, code, step + 1_000)).toEqual({ valid: false });
  });
});
