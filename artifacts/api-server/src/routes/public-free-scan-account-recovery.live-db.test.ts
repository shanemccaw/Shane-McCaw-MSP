/**
 * Live-Postgres route test for Free Scan engagement account recovery (Git #4483).
 *
 * What has to hold, all of it in real rows:
 *
 *   1. Lost password: the emailed code alone sets a new password, revokes every
 *      session, and does NOT sign in — the second factor is still required.
 *   2. Lost authenticator: the emailed code alone can never re-enrol a factor.
 *      It takes the code + the current password to lodge a request, an operator
 *      approval, and then the code + password again before a replacement factor
 *      is swapped in. A password reset cancels a request in flight.
 *   3. Nothing leaks whether an address has an account, codes and tokens are
 *      single-use, the per-account send cap holds, and `users` is never touched.
 *
 * Mail and the admin in-app notification are the only things mocked (they would
 * otherwise go out through Exchange Online and into real admins' feeds). Every
 * row is synthetic and removed in `afterAll`. Skips cleanly with no `DATABASE_URL`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run public-free-scan-account-recovery.live-db
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { generateSync } from "otplib";

process.env.JWT_SECRET ??= "free-scan-account-recovery-test-secret";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "https://anthropic.test";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-anthropic-key";

const sentMail: Array<{ to: string; subject: string; body: string }> = [];
vi.mock("../lib/mailer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mailer.ts")>();
  return {
    ...actual,
    getEmailTemplateOrFallback: async (_slug: string, _vars: Record<string, string>, subject: string, bodyHtml: string) => ({ subject, bodyHtml }),
    sendEmailOrThrow: async (to: string, subject: string, body: string) => {
      sentMail.push({ to, subject, body });
    },
  };
});

const adminNotifications: Array<{ title: string }> = [];
vi.mock("../lib/notification-center.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/notification-center.ts")>();
  return {
    ...actual,
    createNotificationForAllAdmins: async (opts: { title: string }) => {
      adminNotifications.push(opts);
      return 0;
    },
  };
});

import {
  db,
  pool,
  mspsTable,
  tenantsTable,
  usersTable,
  checkoutSessionsTable,
  freeScanEngagementsTable,
  freeScanAccountsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { decideMfaReset } from "../lib/free-scan-account-recovery.ts";

const suffix = `vitest-4483-${Math.floor(Math.random() * 1e9)}`;
const EMAIL = `${suffix}@example.com`;
const PASSWORD = "CorrectHorse42Battery";
const NEW_PASSWORD = "StapleBattery77Horse";
const NEWER_PASSWORD = "PurpleOctopus31Lantern";

const R = "/api/public/free-scan/account/recover";

function codeFrom(body: string): string {
  const match = body.match(/>(\d{6})</);
  if (!match) throw new Error("no code in the captured email");
  return match[1]!;
}

function sessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("fs_acct=") && !c.startsWith("fs_acct=;"));
  if (!cookie) throw new Error("no fs_acct cookie set");
  return cookie.split(";")[0]!;
}

/** send-code answers before it sends; wait for the background mail to land. */
async function waitForMail(count: number, timeoutMs = 8000): Promise<void> {
  const started = Date.now();
  while (sentMail.length < count) {
    if (Date.now() - started > timeoutMs) throw new Error(`expected ${count} mails, have ${sentMail.length}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

async function settle(ms = 600): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe.skipIf(!process.env.DATABASE_URL)("free-scan account recovery — live Postgres (#4483)", () => {
  let app: express.Express;
  let mspId: number;
  let customerId: number;
  let userId: number;
  let sessionId: string;
  let engagementId: number;
  let accountId: number;
  let totpSecret: string;
  let cookie: string;

  /** Request a recovery code and return it. Clears the resend gap and daily cap first (both have their own test). */
  async function recoveryCode(email = EMAIL): Promise<string> {
    await db.update(freeScanAccountsTable).set({ recoveryCodeExpiresAt: null, recoveryCodeSends: 0 }).where(eq(freeScanAccountsTable.id, accountId));
    const before = sentMail.length;
    const res = await request(app).post(`${R}/send-code`).send({ email });
    expect(res.status).toBe(202);
    await waitForMail(before + 1);
    const mail = sentMail[sentMail.length - 1]!;
    expect(mail.to).toBe(EMAIL);
    return codeFrom(mail.body);
  }

  async function recoveryToken(): Promise<request.Response> {
    const code = await recoveryCode();
    const res = await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code });
    expect(res.status).toBe(200);
    return res;
  }

  async function loadAccount() {
    const [row] = await db.select().from(freeScanAccountsTable).where(eq(freeScanAccountsTable.id, accountId));
    return row!;
  }

  beforeAll(async () => {
    const accountRouter = (await import("./public-free-scan-account.ts")).default;
    const recoveryRouter = (await import("./public-free-scan-account-recovery.ts")).default;
    const adminRouter = (await import("./admin-free-scan-account-recovery.ts")).default;
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api", accountRouter);
    app.use("/api", recoveryRouter);
    app.use("/api", adminRouter);

    const [msp] = await db.insert(mspsTable).values({ name: `#4483 recovery MSP ${suffix}`, slug: suffix }).returning({ id: mspsTable.id });
    mspId = msp!.id;
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `Recovery ${suffix}`, tenantId: `${suffix}-tenant`, domain: `${suffix}.example.com`, isTestbed: true, consent: { graph: { status: "granted" } } })
      .returning({ id: tenantsTable.id });
    customerId = tenant!.id;
    const [user] = await db
      .insert(usersTable)
      .values({ email: EMAIL, name: `Prospect ${suffix}`, tenantId: customerId, mspRole: "Free", isActive: true })
      .returning({ id: usersTable.id });
    userId = user!.id;
    const [session] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: "free-scan",
        fullName: `Prospect ${suffix}`,
        email: EMAIL,
        company: `Recovery ${suffix}`,
        status: "consented",
        tenantId: `${suffix}-tenant`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionId = session!.id;
    const [engagement] = await db
      .insert(freeScanEngagementsTable)
      .values({ customerId, checkoutSessionId: sessionId, sowReference: `SOW-${suffix}`, selectedPhaseSlugs: [], status: "paid", paidAt: new Date(), chargedCents: 1_000_000 })
      .returning({ id: freeScanEngagementsTable.id });
    engagementId = engagement!.id;

    // A real, complete account, built through #4329's own routes.
    await request(app).post("/api/public/free-scan/account/send-code").send({ sessionId }).expect(200);
    await request(app).post("/api/public/free-scan/account/verify-code").send({ sessionId, code: codeFrom(sentMail[sentMail.length - 1]!.body) }).expect(200);
    await request(app).post("/api/public/free-scan/account/set-password").send({ sessionId, password: PASSWORD }).expect(200);
    const setup = await request(app).post("/api/public/free-scan/account/mfa/totp/setup").send({ sessionId }).expect(200);
    totpSecret = setup.body.secret;
    const done = await request(app).post("/api/public/free-scan/account/mfa/totp/verify").send({ sessionId, code: generateSync({ secret: totpSecret }) }).expect(200);
    cookie = sessionCookie(done);
    const [account] = await db.select({ id: freeScanAccountsTable.id }).from(freeScanAccountsTable).where(eq(freeScanAccountsTable.engagementId, engagementId));
    accountId = account!.id;
    sentMail.length = 0;
  });

  afterAll(async () => {
    await db.delete(freeScanAccountsTable).where(eq(freeScanAccountsTable.engagementId, engagementId));
    await db.delete(freeScanEngagementsTable).where(eq(freeScanEngagementsTable.customerId, customerId));
    await db.delete(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, sessionId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.delete(tenantsTable).where(eq(tenantsTable.id, customerId));
    await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
    await pool.end();
  });

  it("send-code answers identically for an unknown address and sends nothing", async () => {
    const unknown = await request(app).post(`${R}/send-code`).send({ email: `nobody-${suffix}@example.com` });
    const known = await request(app).post(`${R}/send-code`).send({ email: EMAIL.toUpperCase() });
    expect(unknown.status).toBe(202);
    expect(known.status).toBe(202);
    expect(unknown.body).toEqual(known.body);
    await waitForMail(1);
    await settle();
    expect(sentMail).toHaveLength(1);
    expect(sentMail[0]!.to).toBe(EMAIL);

    const bad = await request(app).post(`${R}/send-code`).send({ email: "not-an-email" });
    expect(bad.status).toBe(400);
  });

  it("holds a one-minute resend gap and a per-account daily cap", async () => {
    // A code was issued in the previous test, seconds ago.
    const before = sentMail.length;
    await request(app).post(`${R}/send-code`).send({ email: EMAIL }).expect(202);
    await settle();
    expect(sentMail.length).toBe(before);

    await db
      .update(freeScanAccountsTable)
      .set({ recoveryCodeExpiresAt: null, recoveryCodeSends: 5, recoveryCodeWindowStartedAt: new Date() })
      .where(eq(freeScanAccountsTable.id, accountId));
    await request(app).post(`${R}/send-code`).send({ email: EMAIL }).expect(202);
    await settle();
    expect(sentMail.length).toBe(before);

    // A day later the window reopens.
    await db
      .update(freeScanAccountsTable)
      .set({ recoveryCodeWindowStartedAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(freeScanAccountsTable.id, accountId));
    await request(app).post(`${R}/send-code`).send({ email: EMAIL }).expect(202);
    await waitForMail(before + 1);
    expect((await loadAccount()).recoveryCodeSends).toBe(1);
  });

  it("verify-code gives one answer for a wrong code and an unknown address, and a code works once", async () => {
    const code = await recoveryCode();
    const wrong = await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code: code === "000000" ? "111111" : "000000" });
    const unknown = await request(app).post(`${R}/verify-code`).send({ email: `nobody-${suffix}@example.com`, code });
    expect(wrong.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(unknown.body).toEqual(wrong.body);

    const right = await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code });
    expect(right.status).toBe(200);
    expect(typeof right.body.recoveryToken).toBe("string");
    expect(right.body.mfaMethod).toBe("totp");
    expect(right.body.mfaReset.state).toBe("none");

    const replay = await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code });
    expect(replay.status).toBe(400);
  });

  it("spends the attempt budget before judging the guess", async () => {
    const code = await recoveryCode();
    const wrongCode = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) {
      await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code: wrongCode }).expect(400);
    }
    const exhausted = await request(app).post(`${R}/verify-code`).send({ email: EMAIL, code });
    expect(exhausted.status).toBe(400);
  });

  it("the emailed code alone can never re-enrol a second factor", async () => {
    const { body } = await recoveryToken();
    const setup = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: body.recoveryToken, password: PASSWORD });
    expect(setup.status).toBe(409);
    expect(setup.body.error).toBe("not_approved");
    const sms = await request(app).post(`${R}/mfa/sms/setup`).send({ recoveryToken: body.recoveryToken, password: PASSWORD, phone: "+15555550100" });
    expect(sms.status).toBe(409);
    const verify = await request(app).post(`${R}/mfa/verify`).send({ recoveryToken: body.recoveryToken, code: "123456" });
    expect(verify.status).toBe(409);
    expect((await loadAccount()).pendingMfaMethod).toBeNull();
  });

  it("lost password: sets a new one, revokes sessions, clears the lockout, and does not sign in", async () => {
    await request(app).get("/api/public/free-scan/account/me").set("Cookie", cookie).expect(200);
    await db.update(freeScanAccountsTable).set({ lockedUntil: new Date(Date.now() + 15 * 60 * 1000) }).where(eq(freeScanAccountsTable.id, accountId));
    const versionBefore = (await loadAccount()).sessionVersion;

    const { body } = await recoveryToken();
    const weak = await request(app).post(`${R}/reset-password`).send({ recoveryToken: body.recoveryToken, password: "short1A" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe("weak_password");

    const reset = await request(app).post(`${R}/reset-password`).send({ recoveryToken: body.recoveryToken, password: NEW_PASSWORD });
    expect(reset.status).toBe(200);
    expect(typeof reset.body.recoveryToken).toBe("string");
    const setCookies = (reset.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
    expect(setCookies.some((c) => c.startsWith("fs_acct=") && !c.startsWith("fs_acct=;"))).toBe(false);

    const after = await loadAccount();
    expect(after.sessionVersion).toBe(versionBefore + 1);
    expect(after.lockedUntil).toBeNull();
    expect(sentMail[sentMail.length - 1]!.subject).toBe("Your password was changed");

    // Single-use: the consumed token is dead.
    const replay = await request(app).post(`${R}/reset-password`).send({ recoveryToken: body.recoveryToken, password: NEWER_PASSWORD });
    expect(replay.status).toBe(401);
    expect(replay.body.error).toBe("recovery_expired");

    // The old session is dead server-side.
    await request(app).get("/api/public/free-scan/account/me").set("Cookie", cookie).expect(401);

    // Old password refused; new password still needs the second factor.
    await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: PASSWORD }).expect(401);
    const login = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: NEW_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.body.method).toBe("totp");
    const ok = await request(app).post("/api/public/free-scan/account/login/verify").send({ challenge: login.body.challenge, code: generateSync({ secret: totpSecret }) });
    expect(ok.status).toBe(200);
    cookie = sessionCookie(ok);
  });

  it("lost authenticator: the request needs the current password, and consumes the token", async () => {
    const { body } = await recoveryToken();
    const wrong = await request(app).post(`${R}/mfa-reset`).send({ recoveryToken: body.recoveryToken, password: "NotThePassword123" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error).toBe("invalid_password");

    const mailBefore = sentMail.length;
    const ok = await request(app).post(`${R}/mfa-reset`).send({ recoveryToken: body.recoveryToken, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.state).toBe("pending");
    expect(adminNotifications.length).toBeGreaterThanOrEqual(1);
    expect(sentMail.slice(mailBefore).some((m) => m.to === EMAIL && m.subject.includes("replace your second factor"))).toBe(true);

    const account = await loadAccount();
    expect(account.mfaResetStatus).toBe("pending");
    expect(account.recoveryNonce).toBeNull();

    const replay = await request(app).post(`${R}/mfa-reset`).send({ recoveryToken: body.recoveryToken, password: NEW_PASSWORD });
    expect(replay.status).toBe(401);

    // Still pending: no re-enrolment yet, even with code + password.
    const next = await recoveryToken();
    expect(next.body.mfaReset.state).toBe("pending");
    const setup = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: next.body.recoveryToken, password: NEW_PASSWORD });
    expect(setup.status).toBe(409);
  });

  it("a password reset cancels a factor reset in flight, so mailbox access cannot ride an approval", async () => {
    // Approve the pending request, then reset the password with the emailed code alone.
    const approved = await decideMfaReset(accountId, "approve", 2_000_000_001, "Called the signer on the number held in CRM");
    expect(approved.ok).toBe(true);

    const { body } = await recoveryToken();
    expect(body.mfaReset.state).toBe("approved");
    const reset = await request(app).post(`${R}/reset-password`).send({ recoveryToken: body.recoveryToken, password: NEWER_PASSWORD });
    expect(reset.status).toBe(200);

    const account = await loadAccount();
    expect(account.mfaResetStatus).toBeNull();
    expect(account.mfaResetApprovalExpiresAt).toBeNull();

    // The fresh token from the reset cannot re-enrol either.
    const setup = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: reset.body.recoveryToken, password: NEWER_PASSWORD });
    expect(setup.status).toBe(409);
    expect(setup.body.error).toBe("not_approved");
  });

  it("operator decisions only apply to a pending request, and the admin routes need a platform admin", async () => {
    const notPending = await decideMfaReset(accountId, "approve", 2_000_000_001, "Called the signer on the number held in CRM");
    expect(notPending).toEqual({ ok: false, reason: "not_pending" });

    const anonymousList = await request(app).get("/api/admin/free-scan/account-recovery");
    expect(anonymousList.status).toBe(401);
    const anonymousApprove = await request(app).post(`/api/admin/free-scan/account-recovery/${accountId}/approve`).send({ note: "no session at all here" });
    expect(anonymousApprove.status).toBe(401);
  });

  it("an expired approval re-enrols nothing", async () => {
    const { body } = await recoveryToken();
    await request(app).post(`${R}/mfa-reset`).send({ recoveryToken: body.recoveryToken, password: NEWER_PASSWORD }).expect(200);
    expect((await decideMfaReset(accountId, "approve", 2_000_000_001, "Called the signer on the number held in CRM")).ok).toBe(true);
    await db
      .update(freeScanAccountsTable)
      .set({ mfaResetApprovalExpiresAt: new Date(Date.now() - 1000) })
      .where(eq(freeScanAccountsTable.id, accountId));

    const next = await recoveryToken();
    expect(next.body.mfaReset.state).toBe("approval_expired");
    const setup = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: next.body.recoveryToken, password: NEWER_PASSWORD });
    expect(setup.status).toBe(409);

    // Asking again starts a fresh pending request.
    const again = await request(app).post(`${R}/mfa-reset`).send({ recoveryToken: next.body.recoveryToken, password: NEWER_PASSWORD });
    expect(again.status).toBe(200);
    expect((await loadAccount()).mfaResetStatus).toBe("pending");
  });

  it("after approval: code + password + the new factor replace the old one, revoke sessions, and sign in", async () => {
    expect((await decideMfaReset(accountId, "approve", 2_000_000_001, "Video call with the signer, matched ID")).ok).toBe(true);
    const versionBefore = (await loadAccount()).sessionVersion;
    await request(app).get("/api/public/free-scan/account/me").set("Cookie", cookie).expect(401); // killed by the earlier reset

    const { body } = await recoveryToken();
    expect(body.mfaReset.state).toBe("approved");

    const wrongPw = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: body.recoveryToken, password: NEW_PASSWORD });
    expect(wrongPw.status).toBe(401);

    const setup = await request(app).post(`${R}/mfa/totp/setup`).send({ recoveryToken: body.recoveryToken, password: NEWER_PASSWORD });
    expect(setup.status).toBe(200);
    const newSecret: string = setup.body.secret;
    expect(newSecret).not.toBe(totpSecret);

    // The live factor is untouched until the replacement is proven.
    const mid = await loadAccount();
    expect(mid.pendingMfaMethod).toBe("totp");
    const midLogin = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: NEWER_PASSWORD });
    expect(midLogin.status).toBe(200);
    await request(app).post("/api/public/free-scan/account/login/verify").send({ challenge: midLogin.body.challenge, code: generateSync({ secret: newSecret }) }).expect(400);

    const oldCode = await request(app).post(`${R}/mfa/verify`).send({ recoveryToken: body.recoveryToken, code: generateSync({ secret: totpSecret }) });
    expect(oldCode.status).toBe(400);

    const done = await request(app).post(`${R}/mfa/verify`).send({ recoveryToken: body.recoveryToken, code: generateSync({ secret: newSecret }) });
    expect(done.status).toBe(200);
    const fresh = sessionCookie(done);
    await request(app).get("/api/public/free-scan/account/me").set("Cookie", fresh).expect(200);

    const after = await loadAccount();
    expect(after.sessionVersion).toBe(versionBefore + 1);
    expect(after.mfaResetStatus).toBeNull();
    expect(after.pendingMfaMethod).toBeNull();
    expect(after.recoveryNonce).toBeNull();
    expect(sentMail[sentMail.length - 1]!.subject).toBe("Your second factor was replaced");

    // The token is spent, and the old authenticator no longer signs in.
    await request(app).post(`${R}/mfa/verify`).send({ recoveryToken: body.recoveryToken, code: generateSync({ secret: newSecret }) }).expect(401);
    const login = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: NEWER_PASSWORD });
    await request(app).post("/api/public/free-scan/account/login/verify").send({ challenge: login.body.challenge, code: generateSync({ secret: totpSecret }) }).expect(400);
    const login2 = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: NEWER_PASSWORD });
    await request(app).post("/api/public/free-scan/account/login/verify").send({ challenge: login2.body.challenge, code: generateSync({ secret: newSecret }) }).expect(200);
  });

  it("never touches users: no Portal password was written by any recovery step", async () => {
    const [user] = await db.select({ passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, userId));
    expect(user!.passwordHash).toBeNull();
  });
});
