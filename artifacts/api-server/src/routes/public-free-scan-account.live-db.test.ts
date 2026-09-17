/**
 * Live-Postgres route test for the Free Scan scoped account (Git #4329).
 *
 * Two things have to hold, and both live in real rows, so this runs against the
 * real local database rather than a mocked `db`:
 *
 *   1. The design's acctScreen flow genuinely works end to end for a PAID
 *      engagement: emailed code → password → authenticator app → signed in, then
 *      sign out, then sign back in with password + second factor.
 *   2. The account it produces is SCOPED, per Shane's correction on #4329: it opens
 *      this one engagement through the free-scan doors, and it does not create a
 *      Portal login — no `users.password_hash`, no `client_services` row (so
 *      #656's `hasRealEntitlement()` gate is untouched), no `mfa_enrollments` row,
 *      and a session token `requireAuth`'s own key cannot verify.
 *
 * Mail is the only thing mocked: the code email would otherwise go out through
 * Exchange Online. The mock captures the real code from the real rendered body.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row is synthetic and removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run public-free-scan-account.live-db
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { generateSync } from "otplib";

process.env.JWT_SECRET ??= "free-scan-account-test-secret";
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "https://anthropic.test";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-anthropic-key";

const sentMail: Array<{ to: string; body: string }> = [];
vi.mock("../lib/mailer.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/mailer.ts")>();
  return {
    ...actual,
    getEmailTemplateOrFallback: async (_slug: string, _vars: Record<string, string>, subject: string, bodyHtml: string) => ({
      subject,
      bodyHtml,
    }),
    sendEmailOrThrow: async (to: string, _subject: string, body: string) => {
      sentMail.push({ to, body });
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
  clientServicesTable,
  mfaEnrollmentsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const suffix = `vitest-4329-${Math.floor(Math.random() * 1e9)}`;
const EMAIL = `${suffix}@example.com`;
const PASSWORD = "CorrectHorse42Battery";

function lastCode(): string {
  const body = sentMail[sentMail.length - 1]?.body ?? "";
  const match = body.match(/>(\d{6})</);
  if (!match) throw new Error("no code in the captured email");
  return match[1]!;
}

function sessionCookie(res: request.Response): string {
  const raw = res.headers["set-cookie"] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith("fs_acct="));
  if (!cookie) throw new Error("no fs_acct cookie set");
  return cookie.split(";")[0]!;
}

describe.skipIf(!process.env.DATABASE_URL)("free-scan scoped account — live Postgres (#4329)", () => {
  let app: express.Express;
  let mspId: number;
  let customerId: number;
  let userId: number;
  let sessionId: string;
  let engagementId: number;
  let totpSecret: string;
  let cookie: string;

  beforeAll(async () => {
    const accountRouter = (await import("./public-free-scan-account.ts")).default;
    const remediateRouter = (await import("./public-free-scan-remediate.ts")).default;
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api", accountRouter);
    app.use("/api", remediateRouter);

    const [msp] = await db.insert(mspsTable).values({ name: `#4329 account MSP ${suffix}`, slug: suffix }).returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `Account Routes ${suffix}`,
        tenantId: `${suffix}-tenant`,
        domain: `${suffix}.example.com`,
        isTestbed: true,
        consent: { graph: { status: "granted" } },
      })
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
        company: `Account Routes ${suffix}`,
        status: "consented",
        tenantId: `${suffix}-tenant`,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionId = session!.id;

    const [engagement] = await db
      .insert(freeScanEngagementsTable)
      .values({ customerId, checkoutSessionId: sessionId, sowReference: `SOW-${suffix}`, selectedPhaseSlugs: [], status: "draft" })
      .returning({ id: freeScanEngagementsTable.id });
    engagementId = engagement!.id;
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

  it("refuses to start an account for an engagement that is not paid", async () => {
    const res = await request(app).post("/api/public/free-scan/account/send-code").send({ sessionId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("payment_required");
    expect(sentMail).toHaveLength(0);

    const status = await request(app).post("/api/public/free-scan/account/status").send({ sessionId });
    expect(status.body.stage).toBe("not_paid");
  });

  it("step 1 — emails a code to the billing address and judges it", async () => {
    await db.update(freeScanEngagementsTable).set({ status: "paid", paidAt: new Date(), chargedCents: 1_000_000 }).where(eq(freeScanEngagementsTable.id, engagementId));

    const sent = await request(app).post("/api/public/free-scan/account/send-code").send({ sessionId });
    expect(sent.status).toBe(200);
    expect(sentMail[sentMail.length - 1]!.to).toBe(EMAIL);
    expect(sent.body.email).not.toBe(EMAIL); // masked

    const wrong = await request(app).post("/api/public/free-scan/account/verify-code").send({ sessionId, code: lastCode() === "000000" ? "111111" : "000000" });
    expect(wrong.status).toBe(400);

    // Cannot skip ahead to the password before the mailbox is proven.
    const early = await request(app).post("/api/public/free-scan/account/set-password").send({ sessionId, password: PASSWORD });
    expect(early.status).toBe(409);
    expect(early.body.error).toBe("email_unverified");

    const right = await request(app).post("/api/public/free-scan/account/verify-code").send({ sessionId, code: lastCode() });
    expect(right.status).toBe(200);
    expect(right.body.stage).toBe("password");
  });

  it("step 2 — enforces the design's password rules", async () => {
    const weak = await request(app).post("/api/public/free-scan/account/set-password").send({ sessionId, password: "short1A" });
    expect(weak.status).toBe(400);
    expect(weak.body.error).toBe("weak_password");

    const ok = await request(app).post("/api/public/free-scan/account/set-password").send({ sessionId, password: PASSWORD });
    expect(ok.status).toBe(200);
    expect(ok.body.stage).toBe("mfa");
  });

  it("step 3 — enrolls an authenticator app and signs the Prospect in", async () => {
    const setup = await request(app).post("/api/public/free-scan/account/mfa/totp/setup").send({ sessionId });
    expect(setup.status).toBe(200);
    totpSecret = setup.body.secret;
    expect(typeof totpSecret).toBe("string");

    // A refresh resumes the same pending key rather than invalidating one already added.
    const again = await request(app).post("/api/public/free-scan/account/mfa/totp/setup").send({ sessionId });
    expect(again.body.secret).toBe(totpSecret);

    const bad = await request(app).post("/api/public/free-scan/account/mfa/totp/verify").send({ sessionId, code: "123456" });
    expect(bad.status).toBe(400);

    const done = await request(app)
      .post("/api/public/free-scan/account/mfa/totp/verify")
      .send({ sessionId, code: generateSync({ secret: totpSecret }) });
    expect(done.status).toBe(200);
    expect(done.body.stage).toBe("complete");
    cookie = sessionCookie(done);

    const status = await request(app).post("/api/public/free-scan/account/status").send({ sessionId }).set("Cookie", cookie);
    expect(status.body.stage).toBe("complete");
    expect(status.body.signedIn).toBe(true);
  });

  it("is SCOPED: no Portal password, no client_services entitlement, no mfa_enrollments, and requireAuth's key rejects the session", async () => {
    const [user] = await db.select({ passwordHash: usersTable.passwordHash }).from(usersTable).where(eq(usersTable.id, userId));
    expect(user!.passwordHash).toBeNull();

    const entitlements = await db.select({ id: clientServicesTable.id }).from(clientServicesTable).where(eq(clientServicesTable.clientUserId, userId));
    expect(entitlements).toHaveLength(0);

    const enrollments = await db.select({ id: mfaEnrollmentsTable.id }).from(mfaEnrollmentsTable).where(eq(mfaEnrollmentsTable.userId, userId));
    expect(enrollments).toHaveLength(0);

    const token = decodeURIComponent(cookie.slice("fs_acct=".length));
    expect(() => jwt.verify(token, process.env.JWT_SECRET!)).toThrow();
  });

  it("opens this engagement through the account door, and refuses without the session", async () => {
    const me = await request(app).get("/api/public/free-scan/account/me").set("Cookie", cookie);
    expect(me.status).toBe(200);
    expect(me.body.engagement.sowReference).toBe(`SOW-${suffix}`);
    expect(me.body.tenant.domain).toBe(`${suffix}.example.com`);

    const read = await request(app).post("/api/public/free-scan/remediate/read").send({ accountSession: true }).set("Cookie", cookie);
    expect(read.status).toBe(200);
    expect(read.body.sowReference).toBe(`SOW-${suffix}`);
    expect(read.body.stage).toBe("write_consent");

    const anonymous = await request(app).post("/api/public/free-scan/remediate/read").send({ accountSession: true });
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.error).toBe("account_signin_required");

    const forged = await request(app)
      .get("/api/public/free-scan/account/me")
      .set("Cookie", `fs_acct=${jwt.sign({ typ: "fsa_session", aid: 1, eid: engagementId, ver: 1 }, process.env.JWT_SECRET!)}`);
    expect(forged.status).toBe(401);
  });

  it("never re-creates a completed account through the flow credential", async () => {
    const res = await request(app).post("/api/public/free-scan/account/send-code").send({ sessionId });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("account_exists");
  });

  it("sign-out kills the session server-side", async () => {
    const out = await request(app).post("/api/public/free-scan/account/logout").set("Cookie", cookie);
    expect(out.status).toBe(200);
    const me = await request(app).get("/api/public/free-scan/account/me").set("Cookie", cookie);
    expect(me.status).toBe(401);
  });

  it("signs back in with password + authenticator code", async () => {
    const wrong = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: "WrongPassword999" });
    expect(wrong.status).toBe(401);
    const unknown = await request(app).post("/api/public/free-scan/account/login").send({ email: `nobody-${suffix}@example.com`, password: PASSWORD });
    expect(unknown.status).toBe(401);
    expect(unknown.body.error).toBe(wrong.body.error);

    const first = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL.toUpperCase(), password: PASSWORD });
    expect(first.status).toBe(200);
    expect(first.body.method).toBe("totp");

    const badCode = await request(app).post("/api/public/free-scan/account/login/verify").send({ challenge: first.body.challenge, code: "000000" });
    expect(badCode.status).toBe(400);

    const ok = await request(app)
      .post("/api/public/free-scan/account/login/verify")
      .send({ challenge: first.body.challenge, code: generateSync({ secret: totpSecret }) });
    expect(ok.status).toBe(200);
    const fresh = sessionCookie(ok);

    const me = await request(app).get("/api/public/free-scan/account/me").set("Cookie", fresh);
    expect(me.status).toBe(200);
  });

  it("locks the account after repeated wrong passwords", async () => {
    let last: request.Response | null = null;
    for (let i = 0; i < 5; i++) {
      last = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: `Wrong${i}Password000` });
    }
    expect(last!.status).toBe(423);
    const locked = await request(app).post("/api/public/free-scan/account/login").send({ email: EMAIL, password: PASSWORD });
    expect(locked.status).toBe(423);
  });
});
