/**
 * Live-Postgres test for #2936: an MSP's own lapsed platform subscription closes its
 * customers' portals and starts their 7-year purge clocks — and the un-cascade returns
 * them, clocks resumed from where they froze.
 *
 * Live rather than mocked, for the same reason `tenant-billing-state.live-db.test.ts` is:
 * the cascade's whole design is that it adds ONE conjunct to a rule expressed twice — in
 * TypeScript for the gate and in correlated SQL for the sweep — and reuses #2765's
 * existing freeze/resume machinery unchanged. A mocked `db` would assert that the code
 * calls the functions it calls. What has to be true is that the SQL `NOT EXISTS` and the
 * JS predicate reach the same verdict on the same rows, and that a real
 * `subscription_lapsed_at` is stamped and later cleared.
 *
 * The failure this guards against is irreversible in one direction: cascading when an MSP
 * has no `msp_subscriptions` row at all would gate every customer of every MSP and start
 * seven-year purge windows for all of them on deploy. `noSubMspTenantId` below is that
 * case, asserted at every step rather than once.
 *
 * Skips cleanly with no `DATABASE_URL`. Scratch MSPs + tenants only, removed in `afterAll`.
 *
 * Run: pnpm --filter @workspace/api-server vitest run msp-cascade.live-db
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  mspsTable,
  mspSubscriptionsTable,
  retentionReinstatementRequestsTable,
  servicesTable,
  tenantsTable,
} from "@workspace/db";
import {
  readMspSubscriptionFacts,
  resolveTenantBillingState,
  tenantBillingActiveCondition,
} from "../tenant-billing-state.ts";
import { cascadeMspSubscriptionToCustomers } from "./msp-cascade.ts";
import {
  invalidateSubscriptionGateCache,
  readTenantSubscriptionState,
} from "./subscription-state.ts";
import {
  readOpenReinstatementRequest,
  submitReinstatementRequest,
} from "./reinstatement.ts";

const SUFFIX = `vitest-2936-${Math.floor(Math.random() * 1e9)}`;

describe.skipIf(!process.env.DATABASE_URL)("#2936 — MSP lapse cascades to its customers", () => {
  /** The MSP that HAS a platform subscription, and whose customers therefore cascade. */
  let subscribedMspId = 0;
  /** The MSP with NO msp_subscriptions row — the safety case. */
  let noSubMspId = 0;
  let customerIds: number[] = [];
  let noSubMspTenantId = 0;

  async function makeTenant(mspId: number, label: string): Promise<number> {
    const [row] = await db
      .insert(tenantsTable)
      .values({
        mspId,
        customerName: `#2936 scratch ${label}`,
        tenantId: `${SUFFIX}-${label}`,
        status: "active",
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

  async function setMspBilling(
    mspId: number,
    values: { status?: "trialing" | "active" | "past_due" | "canceled" | "unpaid"; dunningState?: string | null },
  ): Promise<void> {
    await db
      .update(mspSubscriptionsTable)
      .set({
        ...(values.status !== undefined ? { status: values.status } : {}),
        ...(values.dunningState !== undefined
          ? { dunningState: values.dunningState as "access_revoked" | null }
          : {}),
        updatedAt: new Date(),
      })
      .where(eq(mspSubscriptionsTable.mspId, mspId));
    invalidateSubscriptionGateCache();
  }

  beforeAll(async () => {
    const [subscribed] = await db
      .insert(mspsTable)
      .values({ name: `#2936 subscribed MSP ${SUFFIX}`, slug: `${SUFFIX}-sub` })
      .returning({ id: mspsTable.id });
    subscribedMspId = subscribed!.id;

    const [noSub] = await db
      .insert(mspsTable)
      .values({ name: `#2936 no-subscription MSP ${SUFFIX}`, slug: `${SUFFIX}-nosub` })
      .returning({ id: mspsTable.id });
    noSubMspId = noSub!.id;

    // A real catalog row rather than an invented id. `service_id` carries no FK on this
    // table (confirmed against the live schema), so a fabricated one would have been
    // accepted and would have proved nothing.
    const [service] = await db.select({ id: servicesTable.id }).from(servicesTable).limit(1);

    await db.insert(mspSubscriptionsTable).values({
      mspId: subscribedMspId,
      serviceId: service!.id,
      status: "active",
      stripeSubscriptionId: `sub_msp_${SUFFIX}`,
    });

    customerIds = [
      await makeTenant(subscribedMspId, "customer-a"),
      await makeTenant(subscribedMspId, "customer-b"),
    ];
    noSubMspTenantId = await makeTenant(noSubMspId, "nosub-customer");
  });

  afterAll(async () => {
    const all = [...customerIds, noSubMspTenantId].filter(Boolean);
    if (all.length) {
      await db
        .delete(retentionReinstatementRequestsTable)
        .where(inArray(retentionReinstatementRequestsTable.tenantId, all));
      await db.delete(tenantsTable).where(inArray(tenantsTable.id, all));
    }
    const msps = [subscribedMspId, noSubMspId].filter(Boolean);
    // msp_subscriptions is ON DELETE CASCADE from msps, so this takes it too.
    if (msps.length) await db.delete(mspsTable).where(inArray(mspsTable.id, msps));
  });

  it("a healthy MSP leaves its customers open", async () => {
    for (const tenantId of customerIds) {
      const state = await resolveTenantBillingState(tenantId);
      expect(state!.active).toBe(true);
      expect(state!.mspLapsed).toBe(false);
      expect(state!.mspSubscriptionStatus).toBe("active");
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(true);
    }
  });

  it("AN MSP WITH NO SUBSCRIPTION ROW IS NOT A LAPSE — the deploy-safety property", async () => {
    // Every MSP in the database predates msp_subscriptions. If absence read as "not
    // paying", shipping #2936 would gate their entire book and start seven-year purge
    // windows from a migration.
    expect(await readMspSubscriptionFacts(noSubMspId)).toBeNull();
    const state = await resolveTenantBillingState(noSubMspTenantId);
    expect(state!.active).toBe(true);
    expect(state!.mspLapsed).toBe(false);
    await expect(activeAccordingToSql(noSubMspTenantId)).resolves.toBe(true);
  });

  it("dunning short of access_revoked does NOT cascade", async () => {
    // `suspended` still leaves the MSP itself fully entitled (msp-entitlement.ts revokes
    // only at access_revoked), so closing a customer here would put the customer's wall
    // up before their MSP's own.
    await setMspBilling(subscribedMspId, { status: "past_due", dunningState: "suspended" });
    const cascade = await cascadeMspSubscriptionToCustomers(subscribedMspId);
    expect(cascade.frozen).toBe(0);
    for (const tenantId of customerIds) {
      expect((await resolveTenantBillingState(tenantId))!.active).toBe(true);
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(true);
    }
  });

  it("access_revoked cascades: portals close, lapse instants stamped, 7-year windows start", async () => {
    await setMspBilling(subscribedMspId, { status: "past_due", dunningState: "access_revoked" });

    const cascade = await cascadeMspSubscriptionToCustomers(subscribedMspId);
    expect(cascade.customers).toBe(customerIds.length);
    expect(cascade.frozen).toBe(customerIds.length);
    expect(cascade.failed).toBe(0);

    for (const tenantId of customerIds) {
      const state = await readTenantSubscriptionState(tenantId);
      expect(state!.active).toBe(false);
      expect(state!.mspLapsed).toBe(true);
      expect(state!.mspDunningState).toBe("access_revoked");
      // The customer's own billing was never touched, so the wall must not claim their
      // subscription ended — this is what makes "your MSP hasn't paid" honest.
      expect(state!.billingSource).toBe("msp_subscription");
      // A REAL lapse instant, and a purge date derived from it rather than from `now`.
      expect(state!.lapsedAt).toBeInstanceOf(Date);
      expect(state!.purgeDueAt).toBeInstanceOf(Date);
      expect(state!.purgeDueAt!.getUTCFullYear() - state!.lapsedAt!.getUTCFullYear()).toBe(
        state!.postTerminationYears,
      );
      // The sweep's SQL must agree, or it would leave these customers unreconciled.
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(false);
    }

    // And the other MSP's customer is untouched throughout.
    expect((await resolveTenantBillingState(noSubMspTenantId))!.active).toBe(true);
  });

  it("re-running the cascade is a no-op and cannot re-stamp the lapse instant", async () => {
    // A second stamp would silently push an irreversible purge date years into the future.
    const before = (await readTenantSubscriptionState(customerIds[0]!))!.lapsedAt;
    const again = await cascadeMspSubscriptionToCustomers(subscribedMspId);
    expect(again.frozen).toBe(0);
    expect(again.resumed).toBe(0);
    const after = (await readTenantSubscriptionState(customerIds[0]!))!.lapsedAt;
    expect(after!.getTime()).toBe(before!.getTime());
  });

  it("a gated customer can still record a reinstatement request", async () => {
    const state = await readTenantSubscriptionState(customerIds[0]!);
    const result = await submitReinstatementRequest({
      tenantId: customerIds[0]!,
      requestedByUserId: null,
      note: "Please reopen our portal.",
      lapseSource: state!.billingSource,
      lapseWasMspCascade: state!.mspLapsed,
      lapsedAt: state!.lapsedAt,
    });
    expect(result.outcome).toBe("created");

    // Asking twice returns the same request rather than erroring or opening a second one.
    const second = await submitReinstatementRequest({
      tenantId: customerIds[0]!,
      requestedByUserId: null,
      note: "Following up.",
      lapseSource: state!.billingSource,
      lapseWasMspCascade: state!.mspLapsed,
      lapsedAt: state!.lapsedAt,
    });
    expect(second.outcome).toBe("already_open");

    const open = await readOpenReinstatementRequest(customerIds[0]!);
    expect(open!.lapseWasMspCascade).toBe(true);
    expect(open!.lapseSource).toBe("msp_subscription");
    expect(open!.note).toBe("Please reopen our portal.");

    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(retentionReinstatementRequestsTable)
      .where(eq(retentionReinstatementRequestsTable.tenantId, customerIds[0]!));
    expect(rows[0]!.n).toBe(1);
  });

  it("THE UN-CASCADE: the MSP pays, and its customers reopen through the same mechanism", async () => {
    await setMspBilling(subscribedMspId, { status: "active", dunningState: null });

    const cascade = await cascadeMspSubscriptionToCustomers(subscribedMspId);
    expect(cascade.resumed).toBe(customerIds.length);
    expect(cascade.frozen).toBe(0);

    for (const tenantId of customerIds) {
      const state = await readTenantSubscriptionState(tenantId);
      expect(state!.active).toBe(true);
      expect(state!.mspLapsed).toBe(false);
      // The lapse instant is cleared, so no purge is scheduled any more.
      expect(state!.lapsedAt).toBeNull();
      expect(state!.purgeDueAt).toBeNull();
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(true);
    }

    // The open reinstatement request no longer has a subject and is closed with the real
    // reason — the "self-service resume-if-MSP-resumes check", made concrete.
    expect(await readOpenReinstatementRequest(customerIds[0]!)).toBeNull();
    const [resolved] = await db
      .select({
        status: retentionReinstatementRequestsTable.status,
        resolution: retentionReinstatementRequestsTable.resolution,
      })
      .from(retentionReinstatementRequestsTable)
      .where(eq(retentionReinstatementRequestsTable.tenantId, customerIds[0]!));
    expect(resolved!.status).toBe("resolved");
    expect(resolved!.resolution).toBe("portal_reopened");
  });

  it("a canceled MSP subscription cascades too, with no dunning state involved", async () => {
    // The Stripe-side cancellation path (`handleSubscriptionDeleted`) never walks the
    // dunning ladder, so `status` alone has to be enough.
    await setMspBilling(subscribedMspId, { status: "canceled", dunningState: null });
    const cascade = await cascadeMspSubscriptionToCustomers(subscribedMspId);
    expect(cascade.frozen).toBe(customerIds.length);
    for (const tenantId of customerIds) {
      expect((await readTenantSubscriptionState(tenantId))!.active).toBe(false);
      await expect(activeAccordingToSql(tenantId)).resolves.toBe(false);
    }
    expect((await resolveTenantBillingState(noSubMspTenantId))!.active).toBe(true);
  });
});
