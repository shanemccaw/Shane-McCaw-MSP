/**
 * Live-Postgres test for the #2847 → #2765 seam: a cancelled per-customer subscription
 * actually freezes that customer's retention clocks and starts their 7-year window.
 *
 * `tenant-billing-state.live-db.test.ts` proves the billing decision is right. This file
 * proves the decision is WIRED — that `syncTenantRetentionState()` and
 * `findTenantsNeedingRetentionSync()` act on it rather than on `tenants.status`, which is
 * the whole point of #2847 and the thing a passing unit test would not catch.
 *
 * The failure it guards against is silent and destructive in both directions:
 *   - a cancelled customer whose clocks keep running purges records during a window
 *     #1944 part 7 says must be frozen;
 *   - a returning customer whose clocks never resume stays frozen forever.
 *
 * Skips cleanly with no `DATABASE_URL`. Scratch MSP + tenant only, removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run subscription-freeze.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, mspsTable, tenantsTable, tenantSubscriptionsTable } from "@workspace/db";
import { recordTenantSubscription } from "../tenant-billing-state.ts";
import {
  findTenantsNeedingRetentionSync,
  readTenantSubscriptionState,
  syncTenantRetentionState,
} from "./subscription-state.ts";

const SUFFIX = `vitest-2847-freeze-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("#2847 — a cancelled subscription freezes the retention clock", () => {
  let mspId = 0;
  let tenantId = 0;
  const stripeSubId = `sub_freeze_${SUFFIX}`;

  beforeAll(async () => {
    const [msp] = await db
      .insert(mspsTable)
      .values({ name: `#2847 freeze MSP ${SUFFIX}`, slug: SUFFIX })
      .returning({ id: mspsTable.id });
    mspId = msp!.id;

    const [tenant] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `#2847 freeze scratch`,
        tenantId: SUFFIX,
        // Deliberately `active` for the whole test. Nothing ever writes `inactive` on
        // non-payment — that is the gap — so the subscription has to be what decides.
        status: "active",
      })
      .returning({ id: tenantsTable.id });
    tenantId = tenant!.id;

    await recordTenantSubscription({
      tenantId,
      mspId,
      billingParty: "msp",
      source: "msp_marketplace",
      status: "active",
      planName: "Freeze Scratch Plan",
      stripeSubscriptionId: stripeSubId,
    });
  });

  afterAll(async () => {
    if (tenantId) await db.delete(tenantsTable).where(eq(tenantsTable.id, tenantId));
    if (mspId) await db.delete(mspsTable).where(eq(mspsTable.id, mspId));
  });

  it("while the subscription is active, nothing is stamped and the sweep ignores the tenant", async () => {
    const synced = await syncTenantRetentionState(tenantId);
    expect(synced.action).toBe("none");
    expect(synced.lapsedAt).toBeNull();
    await expect(findTenantsNeedingRetentionSync()).resolves.not.toContain(tenantId);
  });

  it("cancelling the subscription makes the sweep pick the tenant up — with tenants.status untouched", async () => {
    await db
      .update(tenantSubscriptionsTable)
      .set({ status: "canceled", endedAt: new Date() })
      .where(eq(tenantSubscriptionsTable.stripeSubscriptionId, stripeSubId));

    const [tenantRow] = await db
      .select({ status: tenantsTable.status })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, tenantId));
    expect(tenantRow!.status).toBe("active"); // the gap: nothing writes `inactive`

    // The SQL predicate the daily sweep runs must now see this tenant. Before #2847 it
    // read `tenants.status` and would never have.
    await expect(findTenantsNeedingRetentionSync()).resolves.toContain(tenantId);
  });

  it("reconciling stamps the real lapse instant and starts the 7-year purge window", async () => {
    const synced = await syncTenantRetentionState(tenantId);
    expect(synced.action).toBe("frozen");
    expect(synced.lapsedAt).toBeInstanceOf(Date);

    const state = await readTenantSubscriptionState(tenantId);
    expect(state!.active).toBe(false);
    expect(state!.billingSource).toBe("subscription");
    expect(state!.subscriptionStatus).toBe("canceled");
    expect(state!.planName).toBe("Freeze Scratch Plan");
    expect(state!.lapsedAt).toBeInstanceOf(Date);
    // A real purge date, derived from the real lapse instant — not computed from `now`.
    expect(state!.purgeDueAt).toBeInstanceOf(Date);
    expect(state!.purgeDueAt!.getUTCFullYear()).toBe(state!.lapsedAt!.getUTCFullYear() + 7);
    expect(state!.purgedAt).toBeNull();
  });

  it("reconciling again is a no-op — a double freeze cannot re-stamp the purge date", async () => {
    const before = await readTenantSubscriptionState(tenantId);
    const again = await syncTenantRetentionState(tenantId);
    expect(again.action).toBe("none");
    const after = await readTenantSubscriptionState(tenantId);
    expect(after!.lapsedAt!.getTime()).toBe(before!.lapsedAt!.getTime());
  });

  it("resubscribing resumes: the lapse instant is cleared and the purge date goes away", async () => {
    await db
      .update(tenantSubscriptionsTable)
      .set({ status: "active", endedAt: null })
      .where(eq(tenantSubscriptionsTable.stripeSubscriptionId, stripeSubId));

    await expect(findTenantsNeedingRetentionSync()).resolves.toContain(tenantId);

    const synced = await syncTenantRetentionState(tenantId);
    expect(synced.action).toBe("resumed");

    const state = await readTenantSubscriptionState(tenantId);
    expect(state!.active).toBe(true);
    expect(state!.lapsedAt).toBeNull();
    expect(state!.purgeDueAt).toBeNull();
    await expect(findTenantsNeedingRetentionSync()).resolves.not.toContain(tenantId);
  });
});
