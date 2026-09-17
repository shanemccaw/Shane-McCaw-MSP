/**
 * Live-Postgres test for Git #4462 — Premier passes every add-on gate, everyone
 * else needs a paid purchase, and a paid purchase provisions it.
 *
 * Live rather than mocked, deliberately: the Premier bypass is only real if the
 * tier comes back through the real join chain (tenants.id -> users -> active
 * client_services -> services.tier), and the provisioning is only idempotent if
 * the real (tenant_id, feature_key) unique constraint makes it so.
 *
 * Uses the real catalog rows (monitoring-premier-micro, monitoring-foundation-micro,
 * change-control-smb) read by slug, and writes only synthetic suffixed msps /
 * tenants / users / client_services / entitlement rows, all removed in afterAll.
 * Skips cleanly with no DATABASE_URL.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run portal-addon-entitlements.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import type Stripe from "stripe";
import {
  db,
  mspsTable,
  tenantsTable,
  usersTable,
  servicesTable,
  clientServicesTable,
  tenantAddOnEntitlementsTable,
  auditLogsTable,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import { requireAddOnEntitlement, resolveAddOnEntitlement } from "./portal-addon-entitlements.ts";
import { ensureAddOnEntitlement, PORTAL_ADD_ON_CHECKOUT_KIND } from "./addon-entitlement-provisioning.ts";

describe.skipIf(!process.env.DATABASE_URL)("#4462 — add-on gate: Premier by tier, others by purchase — live Postgres", () => {
  const suffix = `vitest-4462-${Math.floor(Math.random() * 1e9)}`;
  let mspId: number;
  const tenantIds: number[] = [];
  const userIds: number[] = [];
  let premierTenant: number;
  let foundationTenant: number;
  let noTierTenant: number;
  let changeControlSmbId: number;
  let foundationMicroId: number;

  async function serviceIdBySlug(slug: string): Promise<number> {
    const [row] = await db.select({ id: servicesTable.id }).from(servicesTable).where(eq(servicesTable.slug, slug)).limit(1);
    if (!row) throw new Error(`catalog row ${slug} missing — this test reads the real catalog`);
    return row.id;
  }

  async function makeTenant(label: string, tierSlug: string | null): Promise<number> {
    const [tenant] = await db
      .insert(tenantsTable)
      .values({ mspId, customerName: `${label} ${suffix}`, tenantId: `${label}-${suffix}.onmicrosoft.com` })
      .returning({ id: tenantsTable.id });
    tenantIds.push(tenant.id);
    const [user] = await db
      .insert(usersTable)
      .values({ email: `zz-test-${label}-${suffix}@example.invalid`, tenantId: tenant.id })
      .returning({ id: usersTable.id });
    userIds.push(user.id);
    if (tierSlug) {
      await db.insert(clientServicesTable).values({
        clientUserId: user.id,
        serviceId: await serviceIdBySlug(tierSlug),
        status: "active",
      });
    }
    return tenant.id;
  }

  beforeAll(async () => {
    const [msp] = await db.insert(mspsTable).values({ name: `Add-on Gate Test MSP ${suffix}`, slug: suffix }).returning({ id: mspsTable.id });
    mspId = msp.id;
    changeControlSmbId = await serviceIdBySlug("change-control-smb");
    foundationMicroId = await serviceIdBySlug("monitoring-foundation-micro");
    premierTenant = await makeTenant("premier", "monitoring-premier-micro");
    foundationTenant = await makeTenant("foundation", "monitoring-foundation-micro");
    noTierTenant = await makeTenant("notier", null);
  });

  afterAll(async () => {
    await db.delete(auditLogsTable).where(sql`${auditLogsTable.metadata}->>'stripeCheckoutSessionId' LIKE ${"%" + suffix}`);
    if (tenantIds.length > 0) {
      await db.delete(tenantAddOnEntitlementsTable).where(inArray(tenantAddOnEntitlementsTable.tenantId, tenantIds));
    }
    if (userIds.length > 0) {
      await db.delete(clientServicesTable).where(inArray(clientServicesTable.clientUserId, userIds));
      await db.delete(usersTable).where(inArray(usersTable.id, userIds));
    }
    if (tenantIds.length > 0) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  function appFor(customerId: number, featureKey: string) {
    const app = express();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      (req as unknown as { user: { customerId: number } }).user = { customerId };
      next();
    });
    app.get("/gated", requireAddOnEntitlement(featureKey), (_req, res) => {
      res.json({ ok: true });
    });
    return app;
  }

  async function entitlementRows(tenantId: number) {
    return db.select().from(tenantAddOnEntitlementsTable).where(eq(tenantAddOnEntitlementsTable.tenantId, tenantId));
  }

  it("a Premier tenant with zero entitlement rows passes every add-on gate, not just change_control", async () => {
    expect(await entitlementRows(premierTenant)).toHaveLength(0);
    for (const key of ["change_control", "launch_control_plus", `any_future_add_on_${suffix}`]) {
      const res = await request(appFor(premierTenant, key)).get("/gated");
      expect(res.status).toBe(200);
    }
    expect(await resolveAddOnEntitlement(premierTenant, "change_control")).toEqual({
      entitled: true,
      source: "tier",
      currentTier: "premier",
    });
  });

  it("a Foundation tenant and a tenant with no tier still get 402 ADD_ON_REQUIRED", async () => {
    for (const tenantId of [foundationTenant, noTierTenant]) {
      const res = await request(appFor(tenantId, "change_control")).get("/gated");
      expect(res.status).toBe(402);
      expect(res.body.code).toBe("ADD_ON_REQUIRED");
    }
  });

  it("a paid purchase provisions the entitlement and flips the Foundation tenant to 200; a replay is a no-op", async () => {
    const first = await ensureAddOnEntitlement({
      tenantId: foundationTenant,
      serviceId: changeControlSmbId,
      stripeCheckoutSessionId: `cs_test_${suffix}`,
      stripeSubscriptionId: `sub_test_${suffix}`,
    });
    expect(first).toMatchObject({ provisioned: true, reason: "provisioned", featureKey: "change_control" });

    const res = await request(appFor(foundationTenant, "change_control")).get("/gated");
    expect(res.status).toBe(200);
    expect(await resolveAddOnEntitlement(foundationTenant, "change_control")).toMatchObject({ entitled: true, source: "purchase" });

    // The purchase is change_control only — it unlocks nothing else.
    expect((await request(appFor(foundationTenant, "launch_control_plus")).get("/gated")).status).toBe(402);

    const replay = await ensureAddOnEntitlement({
      tenantId: foundationTenant,
      serviceId: changeControlSmbId,
      stripeCheckoutSessionId: `cs_test_replay_${suffix}`,
      stripeSubscriptionId: null,
    });
    expect(replay).toMatchObject({ provisioned: false, reason: "already_active" });
    const rows = await entitlementRows(foundationTenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", serviceId: changeControlSmbId, stripeCheckoutSessionId: `cs_test_${suffix}` });
  });

  it("a canceled entitlement is reactivated by a new purchase, not duplicated", async () => {
    await db
      .update(tenantAddOnEntitlementsTable)
      .set({ status: "canceled" })
      .where(and(eq(tenantAddOnEntitlementsTable.tenantId, foundationTenant), eq(tenantAddOnEntitlementsTable.featureKey, "change_control")));
    expect((await request(appFor(foundationTenant, "change_control")).get("/gated")).status).toBe(402);

    const again = await ensureAddOnEntitlement({
      tenantId: foundationTenant,
      serviceId: changeControlSmbId,
      stripeCheckoutSessionId: `cs_test_again_${suffix}`,
      stripeSubscriptionId: `sub_test_again_${suffix}`,
    });
    expect(again).toMatchObject({ provisioned: true, reason: "reactivated" });
    const rows = await entitlementRows(foundationTenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "active", stripeCheckoutSessionId: `cs_test_again_${suffix}` });
  });

  it("refuses to provision from a row that is not an add-on", async () => {
    const res = await ensureAddOnEntitlement({
      tenantId: noTierTenant,
      serviceId: foundationMicroId,
      stripeCheckoutSessionId: null,
      stripeSubscriptionId: null,
    });
    expect(res).toEqual({ provisioned: false, reason: "not_add_on" });
    expect(await entitlementRows(noTierTenant)).toHaveLength(0);
  });

  it("provisionPortalAddOnPurchase ignores other checkout kinds and unpaid sessions, provisions a paid one", async () => {
    const { provisionPortalAddOnPurchase } = await import("../routes/portal-add-ons.ts");
    const base = {
      id: `cs_test_webhook_${suffix}`,
      subscription: `sub_test_webhook_${suffix}`,
      amount_total: 14900,
      metadata: {
        checkout_kind: PORTAL_ADD_ON_CHECKOUT_KIND,
        tenantId: String(noTierTenant),
        serviceId: String(changeControlSmbId),
        featureKey: "change_control",
        buyerUserId: String(userIds[userIds.length - 1]),
      },
    };

    const otherKind = await provisionPortalAddOnPurchase({ ...base, payment_status: "paid", metadata: { ...base.metadata, checkout_kind: "direct_marketing" } } as unknown as Stripe.Checkout.Session);
    expect(otherKind).toEqual({ outcome: "not_add_on_checkout" });

    const unpaid = await provisionPortalAddOnPurchase({ ...base, payment_status: "unpaid" } as unknown as Stripe.Checkout.Session);
    expect(unpaid).toEqual({ outcome: "payment_not_complete" });
    expect(await entitlementRows(noTierTenant)).toHaveLength(0);

    const paid = await provisionPortalAddOnPurchase({ ...base, payment_status: "paid" } as unknown as Stripe.Checkout.Session);
    expect(paid).toMatchObject({ outcome: "entitlement", result: { provisioned: true, reason: "provisioned" } });
    const rows = await entitlementRows(noTierTenant);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ stripeSubscriptionId: `sub_test_webhook_${suffix}` });
    expect((await request(appFor(noTierTenant, "change_control")).get("/gated")).status).toBe(200);
  });
});
