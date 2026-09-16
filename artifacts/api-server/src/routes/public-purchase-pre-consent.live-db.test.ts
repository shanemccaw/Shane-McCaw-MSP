/**
 * Live-Postgres acceptance test for #4374 (issue 4 of Feature #4370) — the
 * pre-consent account door, driven through the REAL routers in a real Express
 * app against the real local database:
 *
 *   1. the ordering gate: only an unexpired, still-`pending`, tenant-less
 *      session for a product with a `*Pending` rung reaches the door;
 *   2. create-account inserts a real bcrypt(12) password-bearing users row at
 *      the product's `*Pending` rung with no tenant, records accountUserId,
 *      and is insert-only (a repeat is a no-op, another account at the address
 *      is never touched);
 *   3. MFA enrollment is the existing #1310 handler, gated to the account THIS
 *      session created;
 *   4. the account is immediately usable: POST /auth/login with the password
 *      answers with an MFA challenge once TOTP is enrolled, and the
 *      pending-purchase gate (#4375) still lets that login through;
 *   5. consent afterwards swaps it to its `*Consented` rung with the password
 *      and MFA intact (#4373's path, untouched here).
 *
 * The code-issuing step is exercised through issueVerificationCode (returns the
 * plaintext once) rather than the send route, so the test never mails anyone.
 *
 * Synthetic identities only: `zz-test-4374-<tag>-*@example.invalid`. afterAll
 * deletes users (MFA rows cascade), sessions (codes cascade), tenants, audit
 * rows, staged leads and queued Zoho jobs carrying the tag.
 *
 * Skips cleanly with no DATABASE_URL.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run public-purchase-pre-consent.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import bcrypt from "bcryptjs";
import { randomUUID } from "node:crypto";
import { generateSync } from "otplib";
import { eq, inArray, like, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

process.env.JWT_SECRET ??= "test-4374-pre-consent-live-secret";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4374-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Correct-Horse-4374!";

describeLive("#4374 — pre-consent account door against the real database", () => {
  let dbm: typeof import("@workspace/db");
  let flow: typeof import("../lib/purchase-account-flow.ts");
  let provisioning: typeof import("../lib/direct-tenant-provisioning.ts");
  let app: express.Express;
  const sessionIds: string[] = [];
  const tenantGuids: string[] = [];

  const emailFor = (label: string) => `${TAG}-${label}@example.invalid`;

  async function slugFor(category: string): Promise<string> {
    const { db, servicesTable } = dbm;
    const [row] = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(eq(servicesTable.category, category))
      .limit(1);
    expect(row, `the catalog must carry a real ${category} product`).toBeTruthy();
    expect(row!.slug, `that ${category} product must carry a slug`).toBeTruthy();
    return row!.slug!;
  }

  async function createSession(opts: {
    label: string;
    productSlug: string;
    status?: "pending" | "consented" | "paid" | "expired";
    tenantId?: string | null;
    expiresAt?: Date;
    email?: string;
  }): Promise<string> {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: opts.productSlug,
        fullName: `${TAG} Buyer`,
        email: opts.email ?? emailFor(opts.label),
        company: `${TAG} Co`,
        industry: "Manufacturing",
        status: opts.status ?? "pending",
        tenantId: opts.tenantId ?? null,
        expiresAt: opts.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(row.id);
    return row.id;
  }

  /** Issue a code (plaintext comes back once — nothing is mailed) and prove it over HTTP. */
  async function verifyMailbox(sessionId: string): Promise<void> {
    const resolved = await flow.resolvePreConsentPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error(`expected a pre-consent session, got ${resolved.error}`);
    const { code } = await flow.issueVerificationCode(resolved.session);
    const res = await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId, code });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
  }

  async function userByEmail(email: string) {
    const { db, usersTable } = dbm;
    const [u] = await db
      .select({
        id: usersTable.id,
        passwordHash: usersTable.passwordHash,
        mspRole: usersTable.mspRole,
        tenantId: usersTable.tenantId,
        mspId: usersTable.mspId,
        name: usersTable.name,
        company: usersTable.company,
      })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return u;
  }

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    flow = await import("../lib/purchase-account-flow.ts");
    provisioning = await import("../lib/direct-tenant-provisioning.ts");
    const { default: purchaseAccountRouter } = await import("./public-purchase-account.ts");
    const { default: authRouter } = await import("./auth.ts");
    const { pendingPurchaseGate } = await import("../middlewares/pendingPurchaseGate.ts");

    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use(pendingPurchaseGate);
    app.use(purchaseAccountRouter);
    app.use(authRouter);
  }, 60_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, usersTable, checkoutSessionsTable, tenantsTable, auditLogsTable, leadStagingTable, mspJobQueueTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const userIds = users.map((u) => u.id);
    if (sessionIds.length > 0) {
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
    }
    if (userIds.length > 0) {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, userIds.map(String)));
    }
    if (sessionIds.length > 0) {
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
    }
    await db.delete(usersTable).where(like(usersTable.email, `${TAG}-%`));
    // tenants after users — users.tenant_id references tenants ON DELETE RESTRICT.
    if (tenantGuids.length > 0) {
      await db.delete(tenantsTable).where(inArray(tenantsTable.tenantId, tenantGuids));
    }
    await db.delete(leadStagingTable).where(like(leadStagingTable.email, `${TAG}-%`));
    await db.delete(mspJobQueueTable).where(sql`${mspJobQueueTable.payload}::text LIKE ${`%${TAG}%`}`);
  }, 60_000);

  describe("resolvePreConsentPurchaseSession — the ordering gate", () => {
    it("resolves a pending, tenant-less session to its product's *Pending rung", async () => {
      for (const [category, rung] of [
        ["monitoring", LEGACY_ROLE.monitoringPending],
        ["config_pack", LEGACY_ROLE.packPending],
        ["retainer", LEGACY_ROLE.retainerPending],
      ] as const) {
        const id = await createSession({ label: `gate-${category}`, productSlug: await slugFor(category) });
        const r = await flow.resolvePreConsentPurchaseSession(id);
        expect(r.ok, category).toBe(true);
        if (r.ok) {
          expect(r.session.productCategory).toBe(category);
          expect(r.session.pendingRole).toBe(rung);
        }
      }
    });

    it("refuses a paid session, a consented one, and a pending one that already carries a tenant", async () => {
      const slug = await slugFor("monitoring");
      const paid = await createSession({ label: "gate-paid", productSlug: slug, status: "paid" });
      const consented = await createSession({ label: "gate-consented", productSlug: slug, status: "consented" });
      const tenanted = await createSession({ label: "gate-tenanted", productSlug: slug, tenantId: randomUUID() });
      expect(await flow.resolvePreConsentPurchaseSession(paid)).toEqual({ ok: false, status: 409, error: "already_paid" });
      expect(await flow.resolvePreConsentPurchaseSession(consented)).toEqual({ ok: false, status: 409, error: "consent_already_granted" });
      expect(await flow.resolvePreConsentPurchaseSession(tenanted)).toEqual({ ok: false, status: 409, error: "consent_already_granted" });
    });

    it("refuses an expired session, a malformed id, and a product with no *Pending rung", async () => {
      const expired = await createSession({
        label: "gate-expired",
        productSlug: await slugFor("monitoring"),
        expiresAt: new Date(Date.now() - 1000),
      });
      const uncatalogued = await createSession({ label: "gate-uncatalogued", productSlug: `${TAG}-no-such-product` });
      expect(await flow.resolvePreConsentPurchaseSession(expired)).toEqual({ ok: false, status: 404, error: "session_expired" });
      expect(await flow.resolvePreConsentPurchaseSession("not-a-uuid")).toEqual({ ok: false, status: 400, error: "session_invalid" });
      expect(await flow.resolvePreConsentPurchaseSession(uncatalogued)).toEqual({ ok: false, status: 409, error: "product_not_eligible" });
    });

    it("the paid door still refuses the same pending session — neither door leaks into the other", async () => {
      const id = await createSession({ label: "gate-paid-door", productSlug: await slugFor("monitoring") });
      const res = await request(app).post("/public/purchase/set-password").send({ sessionId: id, password: PASSWORD });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("payment_required");
    });
  });

  describe("provisionPendingAccount — the provisioning function's own guards", () => {
    it("refuses a plaintext password where the hash belongs", async () => {
      await expect(
        provisioning.provisionPendingAccount({
          email: emailFor("guard-plaintext"),
          passwordHash: PASSWORD,
          role: LEGACY_ROLE.monitoringPending,
        }),
      ).rejects.toThrow(/bcrypt hash/);
      expect(await userByEmail(emailFor("guard-plaintext"))).toBeUndefined();
    });

    it("refuses a role that is not a *Pending rung", async () => {
      await expect(
        provisioning.provisionPendingAccount({
          email: emailFor("guard-role"),
          passwordHash: await bcrypt.hash(PASSWORD, 12),
          // Deliberately wrong at runtime — the type would refuse it at compile time.
          role: LEGACY_ROLE.customer as unknown as typeof LEGACY_ROLE.monitoringPending,
        }),
      ).rejects.toThrow(/not a \*Pending rung/);
      expect(await userByEmail(emailFor("guard-role"))).toBeUndefined();
    });
  });

  describe("create-account + MFA + login — the full door, end to end", () => {
    it("creates a real MonitoringPending account with a password, enrolls TOTP, and logs in with an MFA challenge", async () => {
      const email = emailFor("e2e-monitoring");
      const sessionId = await createSession({ label: "e2e-monitoring", productSlug: await slugFor("monitoring") });

      // Before the mailbox is proven, nothing is created.
      const early = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
      expect(early.status).toBe(409);
      expect(early.body.error).toBe("email_not_verified");
      expect(await userByEmail(email)).toBeUndefined();

      await verifyMailbox(sessionId);

      const created = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
      expect(created.status, JSON.stringify(created.body)).toBe(200);
      expect(created.body).toEqual({ ok: true, alreadyCreated: false });

      const user = await userByEmail(email);
      expect(user).toBeTruthy();
      expect(user!.mspRole).toBe(LEGACY_ROLE.monitoringPending);
      expect(user!.tenantId).toBeNull();
      expect(user!.mspId).toBeNull();
      expect(user!.name).toBe(`${TAG} Buyer`);
      expect(user!.company).toBe(`${TAG} Co`);
      expect(user!.passwordHash).toMatch(/^\$2[aby]\$12\$/);
      expect(user!.passwordHash).not.toContain(PASSWORD);
      expect(await bcrypt.compare(PASSWORD, user!.passwordHash!)).toBe(true);

      const { db, checkoutSessionsTable, mfaEnrollmentsTable } = dbm;
      const [sess] = await db
        .select({ accountUserId: checkoutSessionsTable.accountUserId, status: checkoutSessionsTable.status })
        .from(checkoutSessionsTable)
        .where(eq(checkoutSessionsTable.id, sessionId));
      expect(sess).toEqual({ accountUserId: user!.id, status: "pending" });

      // A double-submit is a no-op: nothing re-written, a different password ignored.
      const again = await request(app)
        .post("/public/purchase/pre-consent/create-account")
        .send({ sessionId, password: "Some-Other-Password-1" });
      expect(again.status).toBe(200);
      expect(again.body).toEqual({ ok: true, alreadyCreated: true });
      expect((await userByEmail(email))!.passwordHash).toBe(user!.passwordHash);

      // Immediately usable: the password logs in before MFA exists.
      const preMfaLogin = await request(app).post("/auth/login").send({ email, password: PASSWORD });
      expect(preMfaLogin.status, JSON.stringify(preMfaLogin.body)).toBe(200);
      expect(preMfaLogin.body.mfaRequired).toBeUndefined();
      expect(preMfaLogin.body.accessToken).toBeTruthy();
      const wrong = await request(app).post("/auth/login").send({ email, password: "not-the-password" });
      expect(wrong.status).toBe(401);

      const statusBefore = await request(app).get("/public/purchase/pre-consent/account-status").query({ sessionId });
      expect(statusBefore.body).toMatchObject({ emailVerified: true, accountCreated: true, mfaEnrolled: false, productCategory: "monitoring" });

      // MFA: the existing #1310 TOTP handlers, behind the pre-consent gate.
      const setup = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
      expect(setup.status, JSON.stringify(setup.body)).toBe(200);
      expect(setup.body.secret).toBeTruthy();
      const bad = await request(app)
        .post("/public/purchase/pre-consent/mfa/totp/verify-setup")
        .send({ sessionId, secret: setup.body.secret, code: generateSync({ secret: setup.body.secret }) === "000000" ? "111111" : "000000" });
      expect(bad.status).toBe(400);
      const enrolled = await request(app)
        .post("/public/purchase/pre-consent/mfa/totp/verify-setup")
        .send({ sessionId, secret: setup.body.secret, code: generateSync({ secret: setup.body.secret }) });
      expect(enrolled.status, JSON.stringify(enrolled.body)).toBe(200);

      const [enrollment] = await db
        .select({ method: mfaEnrollmentsTable.method, enabled: mfaEnrollmentsTable.enabled, encryptedSecret: mfaEnrollmentsTable.encryptedSecret })
        .from(mfaEnrollmentsTable)
        .where(eq(mfaEnrollmentsTable.userId, user!.id));
      expect(enrollment.method).toBe("totp");
      expect(enrollment.enabled).toBe(true);
      expect(enrollment.encryptedSecret).not.toContain(setup.body.secret);

      // MFA is not replaceable through the door once enrolled.
      const replace = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
      expect(replace.status).toBe(409);
      expect(replace.body.error).toBe("mfa_already_enrolled");

      // The real login now challenges for MFA — a real password + MFA account.
      const login = await request(app).post("/auth/login").send({ email, password: PASSWORD });
      expect(login.status, JSON.stringify(login.body)).toBe(200);
      expect(login.body).toMatchObject({ mfaRequired: true, methods: ["totp"] });
      expect(login.body.mfaToken).toBeTruthy();

      const statusAfter = await request(app).get("/public/purchase/pre-consent/account-status").query({ sessionId });
      expect(statusAfter.body).toMatchObject({ accountCreated: true, mfaEnrolled: true });

      // Consent lands later on this session (#4373's path, not touched here):
      // the account becomes MonitoringConsented with the tenant linked, and its
      // password and MFA survive the swap.
      const tenantGuid = randomUUID();
      tenantGuids.push(tenantGuid);
      const consent = await provisioning.provisionProspectAccount({
        email,
        fullName: `${TAG} Buyer`,
        company: `${TAG} Co`,
        tenantId: tenantGuid,
        role: provisioning.resolveProspectRole("monitoring", true),
      });
      expect(consent?.userId).toBe(user!.id);
      const consentedUser = await userByEmail(email);
      expect(consentedUser!.mspRole).toBe(LEGACY_ROLE.monitoringConsented);
      expect(consentedUser!.tenantId).toBe(consent?.customerId);
      expect(consentedUser!.passwordHash).toBe(user!.passwordHash);
      const methodsAfterConsent = await db
        .select({ id: mfaEnrollmentsTable.id })
        .from(mfaEnrollmentsTable)
        .where(eq(mfaEnrollmentsTable.userId, user!.id));
      expect(methodsAfterConsent).toHaveLength(1);
    }, 60_000);

    it("a PackPending account is created the same way", async () => {
      const email = emailFor("e2e-pack");
      const sessionId = await createSession({ label: "e2e-pack", productSlug: await slugFor("config_pack") });
      await verifyMailbox(sessionId);
      const res = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      const user = await userByEmail(email);
      expect(user!.mspRole).toBe(LEGACY_ROLE.packPending);
      expect(user!.tenantId).toBeNull();
      expect(await bcrypt.compare(PASSWORD, user!.passwordHash!)).toBe(true);
    }, 60_000);

    it("never touches an account that already exists at the address — with or without a password", async () => {
      const { db, usersTable, checkoutSessionsTable } = dbm;
      const slug = await slugFor("monitoring");

      for (const [label, existingHash] of [
        ["exists-with-password", await bcrypt.hash("Their-Own-Password-1", 12)],
        ["exists-passwordless", null],
      ] as const) {
        const email = emailFor(label);
        await db.insert(usersTable).values({ email, role: "client", mspRole: LEGACY_ROLE.retainerPending, passwordHash: existingHash });
        const before = await userByEmail(email);

        const sessionId = await createSession({ label, productSlug: slug });
        await verifyMailbox(sessionId);
        const res = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
        expect(res.status, label).toBe(409);
        expect(res.body.error).toBe("already_has_account");
        expect(res.body.userId).toBeUndefined();

        expect(await userByEmail(email), label).toEqual(before);
        const [sess] = await db
          .select({ accountUserId: checkoutSessionsTable.accountUserId })
          .from(checkoutSessionsTable)
          .where(eq(checkoutSessionsTable.id, sessionId));
        expect(sess.accountUserId).toBeNull();

        // ...and that account's MFA is not enrollable through this session either.
        const mfa = await request(app).post("/public/purchase/pre-consent/mfa/totp/setup").send({ sessionId });
        expect(mfa.status).toBe(409);
        expect(mfa.body.error).toBe("account_not_created");
      }
    }, 60_000);

    it("once consent has landed on the session, the pre-consent door is closed", async () => {
      const { db, checkoutSessionsTable } = dbm;
      const sessionId = await createSession({ label: "closed-after-consent", productSlug: await slugFor("monitoring") });
      await verifyMailbox(sessionId);
      await db
        .update(checkoutSessionsTable)
        .set({ status: "consented", tenantId: randomUUID() })
        .where(eq(checkoutSessionsTable.id, sessionId));
      for (const path of ["/public/purchase/pre-consent/create-account", "/public/purchase/pre-consent/mfa/totp/setup"]) {
        const res = await request(app).post(path).send({ sessionId, password: PASSWORD });
        expect(res.status, path).toBe(409);
        expect(res.body.error, path).toBe("consent_already_granted");
      }
      expect(await userByEmail(emailFor("closed-after-consent"))).toBeUndefined();
    }, 60_000);
  });
});
