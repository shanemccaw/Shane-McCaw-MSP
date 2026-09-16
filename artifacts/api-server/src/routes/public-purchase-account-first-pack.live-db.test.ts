/**
 * Live-Postgres acceptance test for #4378 (issue 2 of Feature #4376) — the
 * server half of Packs' account-first order (account -> read consent ->
 * packs/pay), driven through the REAL routers against the real local database:
 *
 *   1. POST /public/purchase/pack-anchor moves a pack session's own pack onto
 *      the buyer's real first pack before payment — pending or consented only,
 *      config_pack -> config_pack only, real public rows only, never once paid;
 *   2. promoteAccountFirstBuyerOnPayment (called by payment-confirmed) lifts
 *      the account THIS session created through #4374's pre-consent door from
 *      PackConsented to Customer once the session is paid — and leaves a legacy
 *      pay-then-account session, an unpaid session, and a mismatched account
 *      alone.
 *
 * Synthetic identities only: `zz-test-4378-<tag>-*@example.invalid`. afterAll
 * deletes users (MFA rows cascade), sessions (codes cascade), tenants, audit
 * rows, staged leads and queued Zoho jobs carrying the tag.
 *
 * Skips cleanly with no DATABASE_URL.
 *
 * Run: DATABASE_URL=... pnpm --filter @workspace/api-server exec vitest run public-purchase-account-first-pack.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, like, ne, sql } from "drizzle-orm";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";

process.env.JWT_SECRET ??= "test-4378-account-first-pack-live-secret";

const hasDb = Boolean(process.env.DATABASE_URL);
const describeLive = hasDb ? describe : describe.skip;

const TAG = `zz-test-4378-${randomUUID().slice(0, 8)}`;
const PASSWORD = "Correct-Horse-4378!";

describeLive("#4378 — account-first Packs: pack-anchor + promote on payment", () => {
  let dbm: typeof import("@workspace/db");
  let flow: typeof import("../lib/purchase-account-flow.ts");
  let provisioning: typeof import("../lib/direct-tenant-provisioning.ts");
  let app: express.Express;
  const sessionIds: string[] = [];
  const tenantGuids: string[] = [];

  const emailFor = (label: string) => `${TAG}-${label}@example.invalid`;

  async function slugsFor(category: string, count: number): Promise<string[]> {
    const { db, servicesTable } = dbm;
    const rows = await db
      .select({ slug: servicesTable.slug })
      .from(servicesTable)
      .where(and(eq(servicesTable.category, category), eq(servicesTable.visibility, "public")))
      .limit(count);
    expect(rows.length, `the catalog must carry ${count} public ${category} products`).toBe(count);
    return rows.map((r) => r.slug!);
  }

  async function createSession(opts: {
    label: string;
    productSlug: string;
    status?: "pending" | "consented" | "paid" | "expired";
    tenantId?: string | null;
  }): Promise<string> {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db
      .insert(checkoutSessionsTable)
      .values({
        productSlug: opts.productSlug,
        fullName: `${TAG} Buyer`,
        email: emailFor(opts.label),
        company: `${TAG} Co`,
        industry: "Manufacturing",
        status: opts.status ?? "pending",
        tenantId: opts.tenantId ?? null,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      })
      .returning({ id: checkoutSessionsTable.id });
    sessionIds.push(row.id);
    return row.id;
  }

  async function sessionRow(id: string) {
    const { db, checkoutSessionsTable } = dbm;
    const [row] = await db
      .select({ productSlug: checkoutSessionsTable.productSlug, status: checkoutSessionsTable.status, accountUserId: checkoutSessionsTable.accountUserId })
      .from(checkoutSessionsTable)
      .where(eq(checkoutSessionsTable.id, id));
    return row;
  }

  async function userByEmail(email: string) {
    const { db, usersTable } = dbm;
    const [u] = await db
      .select({ id: usersTable.id, mspRole: usersTable.mspRole, tenantId: usersTable.tenantId })
      .from(usersTable)
      .where(eq(usersTable.email, email))
      .limit(1);
    return u;
  }

  /** The real account-first sequence up to payment: code -> account -> consent. */
  async function accountFirstPackBuyer(label: string, productSlug: string): Promise<{ sessionId: string; email: string }> {
    const email = emailFor(label);
    const sessionId = await createSession({ label, productSlug });
    const resolved = await flow.resolvePreConsentPurchaseSession(sessionId);
    if (!resolved.ok) throw new Error(`expected a pre-consent session, got ${resolved.error}`);
    const { code } = await flow.issueVerificationCode(resolved.session);
    const verified = await request(app).post("/public/purchase/pre-consent/verify-code").send({ sessionId, code });
    expect(verified.status, JSON.stringify(verified.body)).toBe(200);
    const created = await request(app).post("/public/purchase/pre-consent/create-account").send({ sessionId, password: PASSWORD });
    expect(created.status, JSON.stringify(created.body)).toBe(200);
    expect((await userByEmail(email))!.mspRole).toBe(LEGACY_ROLE.packPending);

    // Consent lands on this session (#4373's swap, as the callback runs it).
    const tenantGuid = randomUUID();
    tenantGuids.push(tenantGuid);
    await provisioning.provisionProspectAccount({
      email,
      fullName: `${TAG} Buyer`,
      company: `${TAG} Co`,
      tenantId: tenantGuid,
      role: provisioning.resolveProspectRole("config_pack", true),
    });
    const { db, checkoutSessionsTable } = dbm;
    await db
      .update(checkoutSessionsTable)
      .set({ status: "consented", tenantId: tenantGuid })
      .where(eq(checkoutSessionsTable.id, sessionId));
    expect((await userByEmail(email))!.mspRole).toBe(LEGACY_ROLE.packConsented);
    return { sessionId, email };
  }

  beforeAll(async () => {
    dbm = await import("@workspace/db");
    flow = await import("../lib/purchase-account-flow.ts");
    provisioning = await import("../lib/direct-tenant-provisioning.ts");
    const { default: purchaseAccountRouter } = await import("./public-purchase-account.ts");
    const { default: purchasePaymentRouter } = await import("./public-purchase-payment.ts");

    app = express();
    app.use(express.json());
    app.use(purchaseAccountRouter);
    app.use(purchasePaymentRouter);
  }, 60_000);

  afterAll(async () => {
    if (!dbm) return;
    const { db, usersTable, checkoutSessionsTable, tenantsTable, auditLogsTable, leadStagingTable, mspJobQueueTable, signupExchangeTokensTable } = dbm;
    const users = await db.select({ id: usersTable.id }).from(usersTable).where(like(usersTable.email, `${TAG}-%`));
    const userIds = users.map((u) => u.id);
    if (sessionIds.length > 0) {
      await db.delete(checkoutSessionsTable).where(inArray(checkoutSessionsTable.id, sessionIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, sessionIds));
    }
    if (userIds.length > 0) {
      await db.delete(signupExchangeTokensTable).where(inArray(signupExchangeTokensTable.userId, userIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.actorUserId, userIds));
      await db.delete(auditLogsTable).where(inArray(auditLogsTable.entityId, userIds.map(String)));
    }
    await db.delete(usersTable).where(like(usersTable.email, `${TAG}-%`));
    if (tenantGuids.length > 0) {
      await db.delete(tenantsTable).where(inArray(tenantsTable.tenantId, tenantGuids));
    }
    await db.delete(leadStagingTable).where(like(leadStagingTable.email, `${TAG}-%`));
    await db.delete(mspJobQueueTable).where(sql`${mspJobQueueTable.payload}::text LIKE ${`%${TAG}%`}`);
  }, 60_000);

  describe("POST /public/purchase/pack-anchor", () => {
    it("moves a pending or consented pack session onto another real pack, and is a no-op for the same pack", async () => {
      const [a, b] = await slugsFor("config_pack", 2);
      for (const status of ["pending", "consented"] as const) {
        const sessionId = await createSession({ label: `anchor-${status}`, productSlug: a, status, tenantId: status === "consented" ? randomUUID() : null });
        const moved = await request(app).post("/public/purchase/pack-anchor").send({ sessionId, productSlug: b });
        expect(moved.status, JSON.stringify(moved.body)).toBe(200);
        expect(moved.body).toEqual({ ok: true, productSlug: b, changed: true });
        expect((await sessionRow(sessionId)).productSlug).toBe(b);

        const same = await request(app).post("/public/purchase/pack-anchor").send({ sessionId, productSlug: b });
        expect(same.body).toEqual({ ok: true, productSlug: b, changed: false });
        expect((await sessionRow(sessionId)).status).toBe(status);
      }
    });

    it("never moves a paid session's pack", async () => {
      const [a, b] = await slugsFor("config_pack", 2);
      const sessionId = await createSession({ label: "anchor-paid", productSlug: a, status: "paid", tenantId: randomUUID() });
      const res = await request(app).post("/public/purchase/pack-anchor").send({ sessionId, productSlug: b });
      expect(res.status).toBe(409);
      expect(res.body.error).toBe("selection_locked");
      expect((await sessionRow(sessionId)).productSlug).toBe(a);
    });

    it("refuses a non-pack session, a non-pack or unknown target, and a malformed or unknown session", async () => {
      const { db, servicesTable } = dbm;
      const [pack] = await slugsFor("config_pack", 1);
      const [monitoring] = await slugsFor("monitoring", 1);

      const monSession = await createSession({ label: "anchor-mon", productSlug: monitoring });
      const notPack = await request(app).post("/public/purchase/pack-anchor").send({ sessionId: monSession, productSlug: pack });
      expect(notPack.status).toBe(409);
      expect(notPack.body.error).toBe("not_a_pack_session");
      expect((await sessionRow(monSession)).productSlug).toBe(monitoring);

      const packSession = await createSession({ label: "anchor-target", productSlug: pack });
      for (const target of [monitoring, `${TAG}-no-such-pack`]) {
        const res = await request(app).post("/public/purchase/pack-anchor").send({ sessionId: packSession, productSlug: target });
        expect(res.status, target).toBe(404);
        expect(res.body.error, target).toBe("pack_not_found");
      }
      const [nonPublic] = await db
        .select({ slug: servicesTable.slug })
        .from(servicesTable)
        .where(and(eq(servicesTable.category, "config_pack"), ne(servicesTable.visibility, "public")))
        .limit(1);
      if (nonPublic?.slug) {
        const res = await request(app).post("/public/purchase/pack-anchor").send({ sessionId: packSession, productSlug: nonPublic.slug });
        expect(res.body.error).toBe("pack_not_found");
      }
      expect((await sessionRow(packSession)).productSlug).toBe(pack);

      const malformed = await request(app).post("/public/purchase/pack-anchor").send({ sessionId: "not-a-uuid", productSlug: pack });
      expect(malformed.status).toBe(400);
      const unknown = await request(app).post("/public/purchase/pack-anchor").send({ sessionId: randomUUID(), productSlug: pack });
      expect(unknown.status).toBe(404);
      expect(unknown.body.error).toBe("session_expired");
    });
  });

  describe("promoteAccountFirstBuyerOnPayment", () => {
    it("account -> consent -> re-anchor -> paid promotes the session's own account to Customer, idempotently", async () => {
      const [a, b] = await slugsFor("config_pack", 2);
      const { sessionId, email } = await accountFirstPackBuyer("promote", a);

      // The buyer settles on a different pack at pay time, after consent.
      const anchored = await request(app).post("/public/purchase/pack-anchor").send({ sessionId, productSlug: b });
      expect(anchored.body.changed).toBe(true);

      // Not paid yet: nothing moves.
      expect(await flow.promoteAccountFirstBuyerOnPayment(sessionId)).toEqual({ outcome: "not_paid" });
      expect((await userByEmail(email))!.mspRole).toBe(LEGACY_ROLE.packConsented);

      const { db, checkoutSessionsTable } = dbm;
      await db.update(checkoutSessionsTable).set({ status: "paid" }).where(eq(checkoutSessionsTable.id, sessionId));
      const user = await userByEmail(email);
      expect(await flow.promoteAccountFirstBuyerOnPayment(sessionId)).toEqual({ outcome: "promoted", userId: user!.id });
      const promoted = await userByEmail(email);
      expect(promoted!.mspRole).toBe(LEGACY_ROLE.customer);
      expect(promoted!.tenantId).toBe(user!.tenantId);

      // A replayed confirm is harmless.
      expect((await flow.promoteAccountFirstBuyerOnPayment(sessionId)).outcome).toBe("promoted");
      expect((await userByEmail(email))!.mspRole).toBe(LEGACY_ROLE.customer);

      // The paid session keeps the pack the buyer chose, and portal handoff
      // honours the account this session created.
      expect((await sessionRow(sessionId)).productSlug).toBe(b);
      const handoff = await request(app).post("/public/purchase/portal-handoff").send({ sessionId });
      expect(handoff.status, JSON.stringify(handoff.body)).toBe(200);
      expect(handoff.body.portalUrl).toContain("signupToken=");
    }, 60_000);

    it("leaves a legacy pay-then-account session alone", async () => {
      const [a] = await slugsFor("config_pack", 1);
      const sessionId = await createSession({ label: "legacy", productSlug: a, status: "paid", tenantId: randomUUID() });
      expect(await flow.promoteAccountFirstBuyerOnPayment(sessionId)).toEqual({ outcome: "not_account_first" });
    });

    it("refuses when the session's account no longer carries its verified address", async () => {
      const [a] = await slugsFor("config_pack", 1);
      const { sessionId, email } = await accountFirstPackBuyer("mismatch", a);
      const { db, checkoutSessionsTable, usersTable } = dbm;
      const user = await userByEmail(email);
      await db.update(usersTable).set({ email: emailFor("mismatch-moved") }).where(eq(usersTable.id, user!.id));
      await db.update(checkoutSessionsTable).set({ status: "paid" }).where(eq(checkoutSessionsTable.id, sessionId));
      expect(await flow.promoteAccountFirstBuyerOnPayment(sessionId)).toEqual({ outcome: "email_mismatch" });
      expect((await userByEmail(emailFor("mismatch-moved")))!.mspRole).toBe(LEGACY_ROLE.packConsented);
    }, 60_000);
  });
});
