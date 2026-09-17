/**
 * Live-Postgres acceptance test for #4377 (issue 1 of Feature #4376) — the
 * account-first Monitoring order and the returning-buyer resume, driven through
 * the REAL routers (pre-consent door, consent URL mint, auth + MFA challenge,
 * resume, selection) behind the real pending-purchase gate, against the real
 * local database. The scenario is the bug this rework exists to fix:
 *
 *   1. a buyer starts a Monitoring purchase — the consent URL is refused until
 *      the account exists (account → consent, enforced server-side);
 *   2. creates the account (verified mailbox, password, TOTP) through #4374's
 *      door — the consent URL is now minted;
 *   3. "crashes": nothing client-side survives. A fresh client signs in with a
 *      real /auth/login + MFA challenge and GET /public/purchase/resume hands
 *      back the SAME session, still pending;
 *   4. consent lands (#4373's swap → MonitoringConsented); resume reports it
 *      connected; tier stays changeable, seats are locked;
 *   5. the session lapses past its 24h expiry — resume renews it for its
 *      signed-in owner instead of stranding the purchase;
 *   6. once paid, resume still returns it (paid, pre-handoff);
 *   7. another account's token resumes nothing of this buyer's.
 *
 * Synthetic identities only: `zz-test-4377-<tag>-*@example.invalid`. afterAll
 * deletes everything carrying the tag. Skips cleanly with no DATABASE_URL.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run account-first-purchase.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { generateSync } from "otplib";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

process.env.JWT_SECRET ??= "test-4377-account-first-live-secret";
process.env.MT_APP_CLIENT_ID ??= "test-4377-mt-client-id";
// consent.ts's import graph loads the Anthropic client module, which refuses to
// load without these. Nothing in this test calls it; the values are unroutable.
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:9";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-4377-unused";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4377-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Correct-Horse-4377!";

describeLive("#4377 — account-first Monitoring order + returning-buyer resume, real database", () => {
  let dbm: typeof import("@workspace/db");
  let flow: typeof import("../lib/purchase-account-flow.ts");
  let provisioning: typeof import("../lib/direct-tenant-provisioning.ts");
  let app: express.Express;
  const sessionIds: string[] = [];
  const tenantGuids: string[] = [];

  const emailFor = (label: string) => `${TAG}-${label}@example.invalid`;

  /** A real public monitoring row for a band, plus a same-band sibling tier. */
  async function monitoringSlugs(tenantTierLabel: string): Promise<{ slug: string; seats: number; sibling: string }> {
    const { db, servicesTable } = dbm;
    const rows = await db
      .select({ slug: servicesTable.slug, typeAttributes: servicesTable.typeAttributes })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, "monitoring"), eq(servicesTable.visibility, "public")));
    const band = rows.filter((r) => (r.typeAttributes as { tenantTierLabel?: string } | null)?.tenantTierLabel === tenantTierLabel);
    expect(band.length, `the catalog must carry two ${tenantTierLabel} monitoring tiers`).toBeGreaterThanOrEqual(2);
    const ta = band[0].typeAttributes as { seatMin?: number | string; seatMax?: number | string };
    const seatMin = Math.max(1, Math.trunc(Number(ta.seatMin ?? 1)));
    return { slug: band[0].slug!, seats: seatMin, sibling: band[1].slug! };
  }

  async function createSession(label: string, productSlug: string, seats: number): Promise<string> {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug,
        fullName: `${TAG} Buyer`,
        email: emailFor(label),
        company: `${TAG} Co`,
        industry: "Not specified",
        seats,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(row.id);
    return row.id;
  }

  async function sessionRow(id: string) {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db.select().from(checkoutSessionsTable).where(eq(checkoutSessionsTable.id, id));
    return row;
  }

  /** Mailbox → password → TOTP through #4374's door. Returns the TOTP secret. */
  async function createAccountThroughDoor(sessionId: string): Promise<string> {
    const resolved = await flow.resolvePreConsentPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error(`expected a pre-consent session, got ${resolved.error}`);
    const { code } = await flow.issueVerificationCode(resolved.session);
    const verified = await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId, code });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const created = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    const setup = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    const enrolled = await request(app)
      .post("/public/purchase/pre-consent/mfa/totp/verify-setup")
      .send({ sessionId, secret: setup.body.secret, code: generateSync({ secret: setup.body.secret }) });
    expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);
    return setup.body.secret as string;
  }

  /** A real sign-in from a fresh client: password, then the TOTP challenge. */
  async function signIn(email: string, totpSecret: string): Promise<string> {
    const login = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    const challenge = await request(app)
      .post("/auth/mfa/totp/challenge")
      .send({ mfaToken: login.body.mfaToken, code: generateSync({ secret: totpSecret }) });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    expect(challenge.body.accessToken).toBeTruthy();
    return challenge.body.accessToken as string;
  }

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    flow = await import("../lib/purchase-account-flow.ts");
    provisioning = await import("../lib/direct-tenant-provisioning.ts");
    const { default: purchaseAccountRouter } = await import("./public-purchase-account.ts");
    const { default: resumeRouter } = await import("./public-purchase-resume.ts");
    const { default: consentRouter } = await import("./consent.ts");
    const { default: authRouter } = await import("./auth.ts");
    const { default: mfaRouter } = await import("./mfa.ts");
    const { pendingPurchaseGate } = await import("../middlewares/pendingPurchaseGate.ts");

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(pendingPurchaseGate);
    app.use(purchaseAccountRouter);
    app.use(resumeRouter);
    app.use(consentRouter);
    app.use(authRouter);
    app.use(mfaRouter);
  }, 120_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, usersTable, checkoutSessionsTable, tenantsTable, auditLogsTable, leadStagingTable, mspJobQueueTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const userIds = users.map((u) => u.id);
    if (sessionIds.length > 0) {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (userIds.length > 0) {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, userIds.map(String)));
      await db.execute(sql`DELETE FROM msp_refresh_tokens WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`).catch(() => {});
      await db.execute(sql`DELETE FROM user_sessions WHERE user_id IN (${sql.join(userIds.map((id) => sql`${id}`), sql`, `)})`).catch(() => {});
    }
    await db.delete(usersTable).where(like(usersTable.email, `${TAG}-%`));
    if (tenantGuids.length > 0) {
      await db.delete(tenantsTable).where(inArray(tenantsTable.tenantId, tenantGuids));
    }
    await db.delete(leadStagingTable).where(like(leadStagingTable.email, `${TAG}-%`));
    await db.delete(mspJobQueueTable).where(sql`${mspJobQueueTable.payload}::text LIKE ${`%${TAG}%`}`);
  }, 60_000);

  it("account → consent is enforced, and a buyer who left mid-purchase signs back in and resumes the same session through payment", async () => {
    const { db, usersTable, checkoutSessionsTable } = dbm;
    const email = emailFor("returning");
    const { slug, seats, sibling } = await monitoringSlugs("SMB");
    const sessionId = await createSession("returning", slug, seats);

    // 1 — no account yet: the consent URL is refused, server-side.
    const early = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(early.status, JSON.stringify(early.body)).toBe(409);
    expect(early.body).toEqual({ error: "account_required", reason: "no_account" });

    // Tier change before consent happens in place — the session (and, later,
    // the account bound to it) survives the click.
    const retier = await request(app).post("/public/purchase/monitoring-selection").send({ sessionId, productSlug: sibling, seats });
    expect(retier.status, JSON.stringify(retier.body)).toBe(200);
    expect((await sessionRow(sessionId)).productSlug).toBe(sibling);

    // 2 — account through #4374's door; still not complete until MFA exists.
    const resolved = await flow.resolvePreConsentPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error(resolved.error);
    const { code } = await flow.issueVerificationCode(resolved.session);
    await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId, code }).expect(200);
    await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD }).expect(200);
    const noMfa = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(noMfa.status).toBe(409);
    expect(noMfa.body.reason).toBe("mfa_not_enrolled");
    const setup = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
    await request(app)
      .post("/public/purchase/pre-consent/mfa/totp/verify-setup")
      .send({ sessionId, secret: setup.body.secret, code: generateSync({ secret: setup.body.secret }) })
      .expect(200);
    const totpSecret = setup.body.secret as string;

    const ready = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    expect(ready.body.url).toContain(`state=${sessionId}`);

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    expect(user.mspRole).toBe(LEGACY_ROLE.monitoringPending);

    // 3 — crash. A fresh client knows only the email and password.
    const token = await signIn(email, totpSecret);
    const resumedPending = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token}`);
    expect(resumedPending.status, JSON.stringify(resumedPending.body)).toBe(200);
    expect(resumedPending.body).toMatchObject({
      mfaEnrolled: true,
      sessionId,
      productSlug: sibling,
      productCategory: "monitoring",
      seats,
      status: "pending",
      tenantConnected: false,
      email,
      renewed: false,
    });
    // The pending token reaches nothing else (#4375) — resume is the one door.
    const walled = await request(app).get("/auth/login-history").set("Authorization", `Bearer ${token}`);
    expect(walled.status).toBe(200); // /auth/* is allowlisted…
    const portal = await request(app).post("/portal/consent/reconsent-link").set("Authorization", `Bearer ${token}`);
    expect(portal.status).toBe(403); // …a portal route is not
    expect(portal.body.code).toBe("pending_purchase");

    // Resume without a token is refused.
    await request(app).get("/public/purchase/resume").expect(401);

    // 4 — consent lands on the resumed session (#4373's swap, as the callback runs it).
    const tenantGuid = randomUUID();
    tenantGuids.push(tenantGuid);
    const consent = await provisioning.provisionProspectAccount({
      email,
      fullName: `${TAG} Buyer`,
      company: `${TAG} Co`,
      tenantId: tenantGuid,
      role: provisioning.resolveProspectRole("monitoring", true),
    });
    expect(consent?.userId).toBe(user.id);
    await db
      .update(checkoutSessionsTable)
      .set({ status: "consented", tenantId: tenantGuid, updatedAt: new Date() })
      .where(eq(checkoutSessionsTable.id, sessionId));
    const [consented] = await db.select().from(usersTable).where(eq(usersTable.id, user.id));
    expect(consented.mspRole).toBe(LEGACY_ROLE.monitoringConsented);

    const token2 = await signIn(email, totpSecret);
    const resumedConsented = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token2}`);
    expect(resumedConsented.body).toMatchObject({ sessionId, status: "consented", tenantConnected: true });

    // Seats lock at connect; tier (same band) is still the buyer's choice until payment.
    const seatChange = await request(app)
      .post("/public/purchase/monitoring-selection")
      .send({ sessionId, productSlug: slug, seats: seats + 1 });
    expect(seatChange.status).toBe(409);
    expect(seatChange.body.error).toBe("seats_locked");
    await request(app).post("/public/purchase/monitoring-selection").send({ sessionId, productSlug: slug, seats }).expect(200);
    expect((await sessionRow(sessionId)).productSlug).toBe(slug);

    // 5 — the session lapses (buyer came back the next day): renewed, not lost.
    await db
      .update(checkoutSessionsTable)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(checkoutSessionsTable.id, sessionId));
    const lapsed = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token2}`);
    expect(lapsed.status, JSON.stringify(lapsed.body)).toBe(200);
    expect(lapsed.body).toMatchObject({ sessionId, status: "consented", renewed: true });
    const renewedRow = await sessionRow(sessionId);
    expect(renewedRow.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    // The renewed session is still consent-ready and still carries its proven mailbox.
    expect(renewedRow.accountUserId).toBe(user.id);
    expect(await flow.getVerifiedEmail({ ...renewedRow, company: renewedRow.company, industry: renewedRow.industry })).toBe(email);

    // 6 — paid: still resumable (the buyer lost the tab before the handoff).
    await db.update(checkoutSessionsTable).set({ status: "paid" }).where(eq(checkoutSessionsTable.id, sessionId));
    const paid = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token2}`);
    expect(paid.body).toMatchObject({ sessionId, status: "paid" });
    const paidSelection = await request(app).post("/public/purchase/monitoring-selection").send({ sessionId, productSlug: sibling, seats });
    expect(paidSelection.status).toBe(409);
    expect(paidSelection.body.error).toBe("already_paid");
  }, 180_000);

  it("another account's token resumes nothing of this buyer's, and a non-monitoring session refuses a monitoring selection", async () => {
    const { db, usersTable } = dbm;
    const { slug, seats } = await monitoringSlugs("SMB");

    // An unrelated account with its own real sign-in, no purchase of its own.
    const otherEmail = emailFor("other");
    const otherSession = await createSession("other", slug, seats);
    const otherSecret = await createAccountThroughDoor(otherSession);
    // Detach that session so the other account owns nothing resumable.
    await db.execute(sql`UPDATE checkout_sessions SET account_user_id = NULL WHERE id = ${otherSession}`);
    const otherToken = await signIn(otherEmail, otherSecret);
    const none = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${otherToken}`);
    expect(none.status).toBe(404);
    expect(none.body.error).toBe("no_purchase_in_progress");
    const [other] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, otherEmail));
    expect(other).toBeTruthy();

    // A buyer who set a password but lost the tab before MFA: under enforcement
    // their login token carries mfaSetupPending, which requireAuth refuses. Resume
    // still hands back their own session, reporting MFA not yet enrolled.
    const halfEmail = emailFor("half");
    const halfSession = await createSession("half", slug, seats);
    const halfResolved = await flow.resolvePreConsentPurchaseSession(halfSession);
    if (!halfResolved.ok) throw new Error(halfResolved.error);
    const { code: halfCode } = await flow.issueVerificationCode(halfResolved.session);
    await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId: halfSession, code: halfCode }).expect(200);
    await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId: halfSession, password: PASSWORD }).expect(200);
    const [half] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, halfEmail));
    const setupPendingToken = jwt.sign(
      { id: half.id, email: halfEmail, role: "client", mspRole: LEGACY_ROLE.monitoringPending, mfaSetupPending: true },
      process.env.JWT_SECRET!,
      { expiresIn: "5m" },
    );
    const halfResume = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${setupPendingToken}`);
    expect(halfResume.status, JSON.stringify(halfResume.body)).toBe(200);
    expect(halfResume.body).toMatchObject({ sessionId: halfSession, status: "pending", mfaEnrolled: false });
    // An admin-preview token never resumes (resume can renew a session).
    const previewToken = jwt.sign({ id: half.id, email: halfEmail, role: "client", impersonatedBy: 1 }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${previewToken}`).expect(403);

    // #4383 — a retainer session is account-first too: its (optional) consent
    // URL is refused until an account exists (the full Retainer order is covered
    // by account-first-retainer.live-db.test.ts), and it cannot be re-pointed at
    // a monitoring tier.
    const { servicesTable } = dbm;
    const [retainer] = await db.select({ slug: servicesTable.slug }).from(servicesTable).where(eq(servicesTable.category, "retainer")).limit(1);
    const retainerSession = await createSession("retainer", retainer.slug!, 1);
    const url = await request(app).get("/public/flow/read-consent-url").query({ sessionId: retainerSession });
    expect(url.status, JSON.stringify(url.body)).toBe(409);
    expect(url.body).toEqual({ error: "account_required", reason: "no_account" });
    const sel = await request(app).post("/public/purchase/monitoring-selection").send({ sessionId: retainerSession, productSlug: slug, seats });
    expect(sel.status).toBe(409);
    expect(sel.body.error).toBe("not_monitoring");

    // An account with a password but a different address than the session is refused.
    const mismatch = await createSession("mismatch", slug, seats);
    await db.insert(usersTable).values({
      email: emailFor("mismatch-account"),
      role: "client",
      mspRole: LEGACY_ROLE.monitoringPending,
      passwordHash: await bcrypt.hash(PASSWORD, 12),
    });
    const [mm] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.email, emailFor("mismatch-account")));
    await db.execute(sql`UPDATE checkout_sessions SET account_user_id = ${mm.id} WHERE id = ${mismatch}`);
    const refused = await request(app).get("/public/flow/read-consent-url").query({ sessionId: mismatch });
    expect(refused.status).toBe(409);
    expect(refused.body.reason).toBe("email_mismatch");
  }, 180_000);
});
