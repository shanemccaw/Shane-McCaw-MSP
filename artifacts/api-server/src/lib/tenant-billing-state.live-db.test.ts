/**
 * Live-Postgres test for the per-customer billing state (Git #2847).
 *
 * `tenant-billing-state.test.ts` pins the rule as a pure function; this file proves the
 * two things that APPLY it agree — with each other, and with the database.
 *
 * That agreement is the property that actually matters. `resolveTenantBillingState()`
 * decides one customer at a time (the subscription gate, on request) and
 * `tenantBillingActiveCondition()` decides every customer in one indexed pass (the daily
 * retention sweep). If those two ever disagreed, the sweep would either freeze a paying
 * customer's per-record retention clocks or never start a lapsed customer's 7-year purge
 * window — and neither failure surfaces anywhere until data is already gone.
 *
 * Live rather than mocked, for the same reason `config-change-attribution.live-db.test.ts`
 * is: a mocked `db` would assert that the code calls the functions it calls, and would
 * prove nothing about whether a correlated `NOT EXISTS`/`EXISTS` pair and a JS `.some()`
 * reach the same verdict on the same rows.
 *
 * Skips cleanly with no `DATABASE_URL`. Every row it writes is its own scratch MSP and
 * tenants, suffixed, and removed in `afterAll` — it never reads or mutates a real
 * customer.
 *
 * Run: pnpm --filter @workspace/api-server vitest run tenant-billing-state.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, mspsTable, tenantsTable, tenantSubscriptionsTable } from "@workspace/db";
import {
  decideTenantBillingActive,
  recordTenantSubscription,
  resolveTenantBillingState,
  tenantBillingActiveCondition,
} from "./tenant-billing-state.ts";

const SUFFIX = `vitest-2847-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("#2847 — per-customer billing state, live Postgres", () => {
  let mspId = 0;
  /** Indexed: 0 = no subscription, 1 = active, 2 = cancelled, 3 = inactive tenant status. */
  let tenantIds: number[] = [];

  async function makeTenant(label: string, status: "active" | "inactive"): Promise<number> {
    const [row] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `#2847 scratch ${label}`,
        tenantId: `${SUFFIX}-${label}`,
        status,
      })
      .returning({ id: tenantsTable.id });
    return row!.id;
  }

  /** The sweep's SQL rule, asked about exactly one tenant. */
  async function activeAccordingToSql(tenantId: number): Promise<boolean> {
    const rows = await db
      .select({ id: tenantsTable.id })
      .from(tenantsTable)
      .where(and(eq(tenantsTable.id, tenantId), tenantBillingActiveCondition()));
    return rows.length === 1;
  }

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#2847 scratch MSP ${SUFFIX}`, slug: SUFFIX })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    tenantIds = [
      await makeTenant("no-sub", "active"),
      await makeTenant("active-sub", "active"),
      await makeTenant("cancelled-sub", "active"),
      await makeTenant("inactive-tenant", "inactive"),
    ];

    await recordTenantSubscription({
      tenantId: tenantIds[1]!,
      mspId,
      billingParty: "msp",
      source: "msp_marketplace",
      status: "active",
      planName: "Scratch Plan",
      unitAmountCents: 5000,
      billingInterval: "month",
      stripeSubscriptionId: `sub_active_${SUFFIX}`,
      currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000),
    });

    await recordTenantSubscription({
      tenantId: tenantIds[2]!,
      mspId,
      billingParty: "msp",
      source: "msp_marketplace",
      status: "canceled",
      planName: "Scratch Plan",
      stripeSubscriptionId: `sub_cancelled_${SUFFIX}`,
    });
  });

  afterAll(async () => {
    // tenant_subscriptions is ON DELETE CASCADE from tenants, so this takes both.
    if (tenantIds.length) await db.delete(tenantsTable).where(inArray(tenantsTable.id, tenantIds));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("a tenant with no subscription on record stays OPEN, and reports tenant_status", async () => {
    // The safety property. Every tenant in the database predates this table; if absence
    // meant cancellation, deploying #2847 would gate every existing customer and start
    // their 7-year purge windows from a migration.
    const state = await resolveTenantBillingState(tenantIds[0]!);
    expect(state).not.toBeNull();
    expect(state!.active).toBe(true);
    expect(state!.source).toBe("tenant_status");
    expect(state!.subscriptionCount).toBe(0);
    expect(state!.activeSubscription).toBeNull();
    expect(state!.latestSubscription).toBeNull();
  });

  it("a tenant with an active subscription is OPEN, and names the real plan", async () => {
    const state = await resolveTenantBillingState(tenantIds[1]!);
    expect(state!.active).toBe(true);
    expect(state!.source).toBe("subscription");
    expect(state!.activeSubscription?.status).toBe("active");
    expect(state!.activeSubscription?.planName).toBe("Scratch Plan");
    expect(state!.activeSubscription?.unitAmountCents).toBe(5000);
    expect(state!.activeSubscription?.billingParty).toBe("msp");
  });

  it("a cancelled subscription CLOSES the portal while tenants.status still reads 'active'", async () => {
    // The exact gap #2847 was filed for: nothing ever writes `inactive` onto
    // tenants.status on non-payment, so before this the tenant below stayed fully open
    // and its retention clocks kept running through a window that must be frozen.
    const state = await resolveTenantBillingState(tenantIds[2]!);
    expect(state!.tenantStatus).toBe("active");
    expect(state!.tenantStatusRunning).toBe(true);
    expect(state!.active).toBe(false);
    expect(state!.source).toBe("subscription");
    expect(state!.activeSubscription).toBeNull();
    expect(state!.latestSubscription?.status).toBe("canceled");
  });

  it("an inactive tenant is closed regardless — tenants.status stays a conjunct", async () => {
    const state = await resolveTenantBillingState(tenantIds[3]!);
    expect(state!.active).toBe(false);
    expect(state!.source).toBe("tenant_status");
  });

  it("returns null for a tenant that does not exist", async () => {
    expect(await resolveTenantBillingState(-1)).toBeNull();
  });

  it("THE SWEEP'S SQL AGREES WITH THE RESOLVER, row for row", async () => {
    for (const tenantId of tenantIds) {
      const resolved = await resolveTenantBillingState(tenantId);
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(resolved!.active);
    }
  });

  it("and both agree with the pure rule, closing the loop on all three", async () => {
    for (const tenantId of tenantIds) {
      const resolved = await resolveTenantBillingState(tenantId);
      const statuses = await db
        .select({ status: tenantSubscriptionsTable.status })
        .from(tenantSubscriptionsTable)
        .where(eq(tenantSubscriptionsTable.tenantId, tenantId));
      const pure = decideTenantBillingActive({
        tenantStatus: resolved!.tenantStatus,
        subscriptionStatuses: statuses.map((r) => r.status),
      });
      expect(pure.active).toBe(resolved!.active);
      expect(pure.source).toBe(resolved!.source);
    }
  });

  it("a replayed purchase updates the row rather than opening a second one", async () => {
    // A second row carrying an older "active" status would keep a cancelled customer's
    // portal open forever, because the resolver only needs ONE active row.
    const stripeId = `sub_cancelled_${SUFFIX}`;
    await recordTenantSubscription({
      tenantId: tenantIds[2]!,
      mspId,
      billingParty: "msp",
      source: "msp_marketplace",
      status: "active",
      planName: "Scratch Plan",
      stripeSubscriptionId: stripeId,
    });

    const rows = await db
      .select({ id: tenantSubscriptionsTable.id, status: tenantSubscriptionsTable.status })
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.stripeSubscriptionId, stripeId));

    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe("active");
  });

  it("the partial unique index lets several Stripe-less manual rows coexist", async () => {
    const tenantId = tenantIds[0]!;
    for (const note of ["#2847 scratch manual A", "#2847 scratch manual B"]) {
      await recordTenantSubscription({
        tenantId, mspId, billingParty: "customer", source: "manual", status: "active", notes: note,
      });
    }

    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(tenantSubscriptionsTable)
      .where(eq(tenantSubscriptionsTable.tenantId, tenantId));
    expect(n).toBe(2);
  });
});
