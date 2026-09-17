/**
 * Live-Postgres acceptance test for #4383 (issue 6 of Feature #4376) — Retainer
 * on the account-first order: account → connect (optional, still skippable) →
 * pay, through the REAL routers (#4374's pre-consent door, the consent URL
 * mint, read-consent-skip, auth + MFA challenge, resume, retainer-selection,
 * portal handoff) behind the real pending-purchase gate, against the real local
 * database.
 *
 *   1. The consent URL for a Retainer session is refused until the session's
 *      account has a password and MFA — the "consent before account" exposure
 *      #4380 found is closed for the buyer who chooses to connect.
 *   2. The buyer who never connects: account at RetainerPending, the skip is
 *      still recorded without any consent, the tier moves in place, resume
 *      reports the skip, payment leaves the account at RetainerPending (no
 *      tenant, not promotable), entitlement provisions with no tenant, and the
 *      portal handoff honours the account this session created.
 *   3. The buyer who connects: consent swaps RetainerPending → RetainerConsented
 *      with the password and MFA intact; a skip is refused once connected, and
 *      payment does not merge RetainerConsented into Customer.
 *   4. retainer-selection's refusal matrix.
 *
 * Synthetic identities only: `zz-test-4383-<tag>-*@example.invalid`. afterAll
 * deletes everything carrying the tag. Skips cleanly with no DATABASE_URL.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run account-first-retainer.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { nextTotpCode } from "../test-setup/totp-codes.ts";
import { and, eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

process.env.JWT_SECRET ??= "test-4383-account-first-retainer-live-secret";
process.env.MT_APP_CLIENT_ID ??= "test-4383-mt-client-id";
// consent.ts's import graph loads the Anthropic client module, which refuses to
// load without these. Nothing in this test calls it; the values are unroutable.
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??= "http://127.0.0.1:9";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??= "test-4383-unused";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4383-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Correct-Horse-4383!";

describeLive("#4383 — account-first Retainer: account → optional connect → pay, real database", () => {
  let dbm: typeof import("@workspace/db");
  let flow: typeof import("../lib/purchase-account-flow.ts");
  let provisioning: typeof import("../lib/direct-tenant-provisioning.ts");
  let entitlement: typeof import("../lib/purchase-retainer-entitlement.ts");
  let app: express.Express;
  const sessionIds: string[] = [];
  const tenantGuids: string[] = [];

  const emailFor = (label: string) => `${TAG}-${label}@example.invalid`;

  async function publicSlugs(category: string, count: number): Promise<string[]> {
    const { db, servicesTable } = dbm;
    const rows = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, category), eq(servicesTable.visibility, "public")))
      .limit(count);
    expect(rows.length, `the catalog must carry ${count} public ${category} products`).toBe(count);
    return rows.map((r) => r.slug!);
  }

  async function createSession(label: string, productSlug: string): Promise<string> {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug,
        fullName: `${TAG} Buyer`,
        email: emailFor(label),
        company: `${TAG} Co`,
        industry: "Not specified",
        seats: 1,
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

  async function userByEmail(email: string) {
    const { db, usersTable } = dbm;
    const [u] = await db
      .select({ id: usersTable.id, mspRole: usersTable.mspRole, tenantId: usersTable.tenantId, passwordHash: usersTable.passwordHash })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return u;
  }

  /**
   * Mailbox → password → TOTP through #4374's door, asserting the consent URL
   * stays refused at each step before the account is complete. Returns the
   * TOTP secret.
   */
  async function createAccountThroughDoor(sessionId: string): Promise<string> {
    const noAccount = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(noAccount.status, JSON.stringify(noAccount.body)).toBe(409);
    expect(noAccount.body).toEqual({ error: "account_required", reason: "no_account" });

    const resolved = await flow.resolvePreConsentPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error(`expected a pre-consent session, got ${resolved.error}`);
    expect(resolved.session.pendingRole).toBe(LEGACY_ROLE.retainerPending);
    const { code } = await flow.issueVerificationCode(resolved.session);
    await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId, code }).expect(200);
    const created = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
    expect(created.status, JSON.stringify(created.body)).toBe(200);

    const noMfa = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(noMfa.status).toBe(409);
    expect(noMfa.body.reason).toBe("mfa_not_enrolled");

    const setup = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
    expect(setup.status, JSON.stringify(setup.body)).toBe(200);
    await request(app)
      .post("/public/purchase/pre-consent/mfa/totp/verify-setup")
      .send({ sessionId, secret: setup.body.secret, code: await nextTotpCode(setup.body.secret) })
      .expect(200);
    return setup.body.secret as string;
  }

  async function signIn(email: string, totpSecret: string): Promise<string> {
    const login = await request(app).post("/auth/login").send({ email, password: PASSWORD });
    expect(login.status, JSON.stringify(login.body)).toBe(200);
    expect(login.body.mfaRequired).toBe(true);
    const challenge = await request(app)
      .post("/auth/mfa/totp/challenge")
      .send({ mfaToken: login.body.mfaToken, code: await nextTotpCode(totpSecret) });
    expect(challenge.status, JSON.stringify(challenge.body)).toBe(200);
    return challenge.body.accessToken as string;
  }

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    flow = await import("../lib/purchase-account-flow.ts");
    provisioning = await import("../lib/direct-tenant-provisioning.ts");
    entitlement = await import("../lib/purchase-retainer-entitlement.ts");
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
    const {
      db,
      usersTable,
      checkoutSessionsTable,
      tenantsTable,
      auditLogsTable,
      leadStagingTable,
      mspJobQueueTable,
      signupExchangeTokensTable,
      clientServicesTable,
    } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const userIds = users.map((u) => u.id);
    if (sessionIds.length > 0) {
      const services = await db
        .select({ id: clientServicesTable.id })
        .from(clientServicesTable)
        .where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
      if (services.length > 0) {
        await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, services.map((s) => String(s.id))));
        await db.delete(clientServicesTable).where(inArray(clientServicesTable.checkoutSessionId, sessionIds));
      }
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (userIds.length > 0) {
      await db.delete(signupExchangeTokensTable).where(inArray(signupExchangeTokensTable.userId, userIds));
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

  it("a buyer who never connects: account first, skip still recorded, tier moves in place, pays and stays RetainerPending", async () => {
    const { db, checkoutSessionsTable } = dbm;
    const email = emailFor("skip");
    const [slug, sibling] = await publicSlugs("retainer", 2);
    const sessionId = await createSession("skip", slug);

    const totpSecret = await createAccountThroughDoor(sessionId);
    const account = await userByEmail(email);
    expect(account.mspRole).toBe(LEGACY_ROLE.retainerPending);
    expect(account.tenantId).toBeNull();
    expect(account.passwordHash).toBeTruthy();
    expect((await sessionRow(sessionId)).accountUserId).toBe(account.id);

    // The skip needs no consent and no tenant — unchanged by the reorder.
    const skipped = await request(app).post("/public/flow/read-consent-skip").send({ sessionId });
    expect(skipped.status, JSON.stringify(skipped.body)).toBe(200);
    expect(skipped.body).toMatchObject({ ok: true, requirement: "optional", readConsentSkipped: true });

    // The tier picked after the account step moves the kept session in place.
    const retier = await request(app).post("/public/purchase/retainer-selection").send({ sessionId, productSlug: sibling });
    expect(retier.status, JSON.stringify(retier.body)).toBe(200);
    expect(retier.body).toEqual({ ok: true, productSlug: sibling });
    expect((await sessionRow(sessionId)).productSlug).toBe(sibling);

    // A returning buyer signs in and gets the same session back, skip included.
    const token = await signIn(email, totpSecret);
    const resumed = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token}`);
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(200);
    expect(resumed.body).toMatchObject({
      sessionId,
      productSlug: sibling,
      productCategory: "retainer",
      status: "pending",
      tenantConnected: false,
      readConsentSkipped: true,
      mfaEnrolled: true,
      email,
    });

    // Paid (payment-confirmed's promotion step): RetainerPending is not a
    // promotable rung — no tenant, so it stays exactly where it was.
    await db.update(checkoutSessionsTable).set({ status: "paid" }).where(eq(checkoutSessionsTable.id, sessionId));
    expect(await flow.promoteAccountFirstBuyerOnPayment(sessionId)).toEqual({ outcome: "promoted", userId: account.id });
    const afterPay = await userByEmail(email);
    expect(afterPay.mspRole).toBe(LEGACY_ROLE.retainerPending);
    expect(afterPay.tenantId).toBeNull();

    // The entitlement payment-confirmed provisions for an account-first session:
    // a client_services row for the tier actually paid for, no tenant settings.
    const paidSession = await flow.resolvePaidPurchaseSession(sessionId);
    if (!paidSession.ok) throw new Error(paidSession.error);
    const ent = await entitlement.ensureRetainerEntitlement(paidSession.session);
    expect(ent).toMatchObject({ provisioned: true, clientServiceCreated: true, customerId: null, settings: "no_tenant" });

    // Paid: no more tier changes, and the handoff signs in the account THIS session created.
    const paidSelection = await request(app).post("/public/purchase/retainer-selection").send({ sessionId, productSlug: slug });
    expect(paidSelection.status).toBe(409);
    expect(paidSelection.body.error).toBe("already_paid");
    const handoff = await request(app).post("/public/purchase/portal-handoff").send({ sessionId });
    expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
    expect(handoff.body.portalUrl).toContain("signupToken=");
  }, 180_000);

  it("a buyer who connects does so from a real account: consent swaps to RetainerConsented, credentials intact, never merged into Customer", async () => {
    const { db, checkoutSessionsTable } = dbm;
    const email = emailFor("connect");
    const [slug] = await publicSlugs("retainer", 1);
    const sessionId = await createSession("connect", slug);

    const totpSecret = await createAccountThroughDoor(sessionId);
    const ready = await request(app).get("/public/flow/read-consent-url").query({ sessionId });
    expect(ready.status, JSON.stringify(ready.body)).toBe(200);
    expect(ready.body.url).toContain(`state=${sessionId}`);
    expect(ready.body).toMatchObject({ requirement: "optional", skippable: true });

    // Consent lands on this session (#4373's swap, as the callback runs it).
    const account = await userByEmail(email);
    const tenantGuid = randomUUID();
    tenantGuids.push(tenantGuid);
    const consent = await provisioning.provisionProspectAccount({
      email,
      fullName: `${TAG} Buyer`,
      company: `${TAG} Co`,
      tenantId: tenantGuid,
      role: provisioning.resolveProspectRole("retainer", true),
    });
    expect(consent?.userId).toBe(account.id);
    await db
      .update(checkoutSessionsTable)
      .set({ status: "consented", tenantId: tenantGuid, updatedAt: new Date() })
      .where(eq(checkoutSessionsTable.id, sessionId));

    const consented = await userByEmail(email);
    expect(consented.mspRole).toBe(LEGACY_ROLE.retainerConsented);
    expect(consented.tenantId).not.toBeNull();
    expect(consented.passwordHash).toBe(account.passwordHash);
    // The account created before consent still signs in with its own MFA.
    const token = await signIn(email, totpSecret);
    const resumed = await request(app).get("/public/purchase/resume").set("Authorization", `Bearer ${token}`);
    expect(resumed.body).toMatchObject({ sessionId, status: "consented", tenantConnected: true, readConsentSkipped: false });

    // A landed grant is never un-recorded by a skip.
    const skip = await request(app).post("/public/flow/read-consent-skip").send({ sessionId });
    expect(skip.status).toBe(409);
    expect(skip.body.error).toBe("already_consented");

    // Paid: RetainerConsented is a distinct paid state (#3970), never Customer.
    await db.update(checkoutSessionsTable).set({ status: "paid" }).where(eq(checkoutSessionsTable.id, sessionId));
    expect((await flow.promoteAccountFirstBuyerOnPayment(sessionId)).outcome).toBe("promoted");
    expect((await userByEmail(email)).mspRole).toBe(LEGACY_ROLE.retainerConsented);
  }, 180_000);

  it("retainer-selection refuses anything but an unpaid Retainer session moving onto a real public Retainer row", async () => {
    const [retainer] = await publicSlugs("retainer", 1);
    const [monitoring] = await publicSlugs("monitoring", 1);

    const invalid = await request(app).post("/public/purchase/retainer-selection").send({ sessionId: "not-a-uuid", productSlug: retainer });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toBe("session_invalid");

    const unknown = await request(app).post("/public/purchase/retainer-selection").send({ sessionId: randomUUID(), productSlug: retainer });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error).toBe("session_expired");

    const retainerSession = await createSession("matrix-retainer", retainer);
    const ontoMonitoring = await request(app).post("/public/purchase/retainer-selection").send({ sessionId: retainerSession, productSlug: monitoring });
    expect(ontoMonitoring.status).toBe(404);
    expect(ontoMonitoring.body.error).toBe("product_not_found");
    expect((await sessionRow(retainerSession)).productSlug).toBe(retainer);

    const monitoringSession = await createSession("matrix-monitoring", monitoring);
    const notRetainer = await request(app).post("/public/purchase/retainer-selection").send({ sessionId: monitoringSession, productSlug: retainer });
    expect(notRetainer.status).toBe(409);
    expect(notRetainer.body.error).toBe("not_retainer");
    expect((await sessionRow(monitoringSession)).productSlug).toBe(monitoring);
  }, 60_000);
});
