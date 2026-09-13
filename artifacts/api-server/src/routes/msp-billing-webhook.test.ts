/**
 * msp-billing-webhook.test.ts
 *
 * Tests for the self-service plan-change schedule transition handlers:
 *   1. subscription_schedule.completed — applies pendingServiceId/pendingBillingInterval,
 *      syncs stripePriceId to the target phase price, clears pending state
 *   2. subscription_schedule.canceled — clears stale pending state without
 *      touching the live tier columns
 *   3. subscription_schedule.released — finalizes when the target phase already
 *      started, clears stale state when released before the transition
 *   4. Unknown schedules (no matching row) are ignored
 *
 * And (#3650) checkout.session.completed for fulfillment_type "msp_offer" —
 * msp-sow.ts's add_on/subscription offer-acceptance checkout, which previously
 * had no consumer at all (see dispatchMspStripeEvent tests below).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const selectResults: unknown[][] = [];
const mockUpdateSet = vi.fn();
const mockInsertValues = vi.fn();

function selectChain() {
  const c: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) c[m] = () => c;
  c.limit = async () => selectResults.shift() ?? [];
  return c;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => selectChain()),
    update: vi.fn(() => ({
      set: (vals: unknown) => {
        mockUpdateSet(vals);
        return { where: async () => {} };
      },
    })),
    insert: vi.fn(() => ({ values: async (v: unknown) => mockInsertValues(v) })),
  },
  mspsTable: {},
  mspSubscriptionsTable: {
    id: "id", mspId: "msp_id", serviceId: "service_id", billingInterval: "billing_interval",
    stripeScheduleId: "stripe_schedule_id", pendingServiceId: "pending_service_id",
    pendingBillingInterval: "pending_billing_interval", stripeSubscriptionId: "stripe_subscription_id",
  },
  usersTable: {},
  mspEventStoreTable: {},
  mspAgreementAcceptancesTable: {},
  platformAgreementsTable: {},
}));

// #2847 — the webhook now also applies customer-subscription events to
// `tenant_subscriptions` and reconciles retention. Both are real modules that open a
// database connection at import; this file's `@workspace/db` mock deliberately exposes
// only what the schedule handlers under test need, so the two are stubbed rather than
// having the mock grown to carry a subsystem these tests do not exercise.
const { mockRecordTenantSubscription, mockResolveFulfillment } = vi.hoisted(() => ({
  mockRecordTenantSubscription: vi.fn(async () => ({ id: 1 })),
  // #3650 — checkout.session.completed's msp_offer branch calls resolveFulfillment
  // directly (the same shared fulfillment resolver every purchase path uses); mocked
  // here for the same reason tenant-billing-state.ts is above — this file exercises
  // the webhook's own dispatch/provisioning logic, not resolve-fulfillment.ts's
  // internals (which has its own test file).
  mockResolveFulfillment: vi.fn(async () => ({ status: "emitted" as const, fulfillmentTypeKey: "x", idempotencyKey: "y" })),
}));
vi.mock("../lib/tenant-billing-state.ts", () => ({
  syncTenantSubscriptionFromStripe: vi.fn(async () => ({ matched: false, tenantId: null, status: null })),
  recordTenantSubscription: mockRecordTenantSubscription,
}));
vi.mock("../lib/retention/subscription-state.ts", () => ({
  syncTenantsAfterStatusWrite: vi.fn(async () => {}),
}));
vi.mock("../lib/resolve-fulfillment.ts", () => ({
  resolveFulfillment: mockResolveFulfillment,
}));

vi.mock("../lib/stripe.ts", () => ({ getStripeKey: () => "sk_test_123" }));
vi.mock("../lib/logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

import {
  handleScheduleCompleted,
  handleScheduleCanceled,
  handleScheduleReleased,
  handleScheduleUpdated,
  dispatchMspStripeEvent,
} from "./msp-billing-webhook.ts";

type StripeSchedule = import("stripe").Stripe.SubscriptionSchedule;

const subRow = {
  id: 5,
  mspId: 42,
  serviceId: 1,
  billingInterval: "month",
  pendingServiceId: 2,
  pendingBillingInterval: "year",
};

const pastUnix = Math.floor(Date.now() / 1000) - 3600;
const futureUnix = Math.floor(Date.now() / 1000) + 3600;

function schedule(overrides: Partial<Record<string, unknown>> = {}): StripeSchedule {
  return {
    id: "sched_1",
    current_phase: null,
    phases: [
      { start_date: pastUnix - 100, items: [{ price: "price_old" }] },
      { start_date: pastUnix, items: [{ price: "price_new" }] },
    ],
    ...overrides,
  } as unknown as StripeSchedule;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
});

describe("subscription_schedule.completed", () => {
  it("applies the pending tier + interval, syncs stripePriceId, clears pending state", async () => {
    selectResults.push([subRow]);

    await handleScheduleCompleted(schedule());

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 2,
      billingInterval: "year",
      stripePriceId: "price_new",
      stripeScheduleId: null,
      pendingServiceId: null,
      pendingBillingInterval: null,
    }));
    // Emits a visible plan_changed event to the MSP event store
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "msp.subscription.plan_changed",
      mspId: 42,
    }));
  });

  it("is a no-op for schedules with no matching subscription row (idempotent replay)", async () => {
    selectResults.push([]);

    await handleScheduleCompleted(schedule());

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("subscription_schedule.canceled", () => {
  it("clears stale pending state without touching the live tier columns", async () => {
    selectResults.push([subRow]);

    await handleScheduleCanceled(schedule());

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const vals = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals).toEqual(expect.objectContaining({
      stripeScheduleId: null,
      pendingServiceId: null,
      pendingBillingInterval: null,
    }));
    expect(vals).not.toHaveProperty("serviceId");
    expect(vals).not.toHaveProperty("billingInterval");
    expect(mockInsertValues).not.toHaveBeenCalled();
  });
});

describe("subscription_schedule.released", () => {
  it("finalizes when the target phase already started (released after the transition)", async () => {
    selectResults.push([subRow]);

    await handleScheduleReleased(schedule());

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 2,
      billingInterval: "year",
    }));
  });

  it("clears stale pending state when released before the target phase started", async () => {
    selectResults.push([subRow]);

    await handleScheduleReleased(schedule({
      phases: [
        { start_date: pastUnix, items: [{ price: "price_old" }] },
        { start_date: futureUnix, items: [{ price: "price_new" }] },
      ],
    }));

    const vals = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals).not.toHaveProperty("serviceId");
    expect(vals).toEqual(expect.objectContaining({ stripeScheduleId: null, pendingServiceId: null }));
  });
});

describe("subscription_schedule.updated", () => {
  it("finalizes when Stripe advances into the final (target) phase", async () => {
    selectResults.push([subRow]);

    await handleScheduleUpdated(schedule({
      current_phase: { start_date: pastUnix, end_date: futureUnix },
    }));

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      serviceId: 2,
      billingInterval: "year",
    }));
  });

  it("ignores updates while phase 1 is still current (our own scheduling edits)", async () => {
    await handleScheduleUpdated(schedule({
      current_phase: { start_date: pastUnix - 100, end_date: pastUnix },
      phases: [
        { start_date: pastUnix - 100, items: [{ price: "price_old" }] },
        { start_date: futureUnix, items: [{ price: "price_new" }] },
      ],
    }));

    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});

// ── checkout.session.completed — fulfillment_type "msp_offer" (#3650) ────────
//
// Before this fix, nothing in this file consumed `fulfillment_type: "msp_offer"`
// at all — a one-time ("payment" mode) checkout was dropped by the
// `session.mode !== "subscription"` gate before metadata was even read, and a
// subscription-mode one was dropped by the platform-subscription fulfillmentType
// check right after. dispatchMspStripeEvent is the one real entry point Stripe
// (and the testbed simulator) both go through, so it is exercised directly here
// rather than the module-private handleCheckoutCompleted.

function fakeStripe(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    subscriptions: {
      retrieve: vi.fn(async () => ({
        id: "sub_test",
        status: "active",
        cancel_at_period_end: false,
        items: { data: [{ price: { id: "price_test" } }] },
        current_period_start: Math.floor(Date.now() / 1000),
        current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      })),
    },
    ...overrides,
  } as unknown as import("stripe").Stripe;
}

function checkoutSessionCompletedEvent(session: Partial<Record<string, unknown>>): import("stripe").Stripe.Event {
  return {
    id: "evt_test",
    type: "checkout.session.completed",
    data: { object: { id: "cs_test", ...session } },
  } as unknown as import("stripe").Stripe.Event;
}

describe('checkout.session.completed — fulfillment_type "msp_offer" (#3650)', () => {
  it("resolves fulfillment for a one-time (payment mode) add_on checkout — previously dropped outright by the subscription-mode gate", async () => {
    const stripe = fakeStripe();
    const event = checkoutSessionCompletedEvent({
      mode: "payment",
      payment_status: "paid",
      amount_total: 1500,
      customer_email: "jane@customer.example",
      metadata: {
        fulfillment_type: "msp_offer",
        offerId: "6", mspId: "42", customerId: "88", serviceId: "25",
        serviceClass: "add_on", fulfillmentTypeKey: "backup_addon",
        amountCents: "1500", serviceName: "Backup Add-On",
      },
    });

    await dispatchMspStripeEvent(stripe, event);

    expect(mockResolveFulfillment).toHaveBeenCalledWith(expect.objectContaining({
      fulfillmentTypeKey: "backup_addon",
      idempotencyKey: "msp_offer_checkout:session:cs_test",
      trigger: "purchase",
      payload: expect.objectContaining({ offerId: 6, mspId: 42, customerId: 88, serviceId: 25, amountCents: 1500 }),
    }));
    // One-time purchase — no recurring subscription to record.
    expect(mockRecordTenantSubscription).not.toHaveBeenCalled();
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({ eventType: "msp.offer.checkout_completed" }));
  });

  it("records a customer-billed tenant_subscriptions row and resolves fulfillment for a subscription-mode checkout", async () => {
    const stripe = fakeStripe();
    const event = checkoutSessionCompletedEvent({
      mode: "subscription",
      payment_status: "paid",
      subscription: "sub_test",
      customer: "cus_test",
      amount_total: 9900,
      metadata: {
        fulfillment_type: "msp_offer",
        offerId: "7", mspId: "42", customerId: "88", serviceId: "30",
        serviceClass: "subscription", fulfillmentTypeKey: "monitoring_subscription",
        amountCents: "9900", serviceName: "Monitoring Tier",
      },
    });

    await dispatchMspStripeEvent(stripe, event);

    expect(mockRecordTenantSubscription).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 88,
      mspId: 42,
      billingParty: "customer",
      source: "checkout",
      status: "active",
      stripeSubscriptionId: "sub_test",
      stripeCustomerId: "cus_test",
      stripePriceId: "price_test",
    }));
    expect(mockResolveFulfillment).toHaveBeenCalledWith(expect.objectContaining({
      fulfillmentTypeKey: "monitoring_subscription",
    }));
  });

  it("does not resolve fulfillment for an unpaid/incomplete checkout", async () => {
    const stripe = fakeStripe();
    const event = checkoutSessionCompletedEvent({
      mode: "payment",
      payment_status: "unpaid",
      metadata: { fulfillment_type: "msp_offer", offerId: "6", mspId: "42" },
    });

    await dispatchMspStripeEvent(stripe, event);

    expect(mockResolveFulfillment).not.toHaveBeenCalled();
    expect(mockRecordTenantSubscription).not.toHaveBeenCalled();
  });

  it("does nothing when required offerId/mspId metadata is missing", async () => {
    const stripe = fakeStripe();
    const event = checkoutSessionCompletedEvent({
      mode: "payment",
      payment_status: "paid",
      metadata: { fulfillment_type: "msp_offer" },
    });

    await dispatchMspStripeEvent(stripe, event);

    expect(mockResolveFulfillment).not.toHaveBeenCalled();
    expect(mockRecordTenantSubscription).not.toHaveBeenCalled();
  });
});
