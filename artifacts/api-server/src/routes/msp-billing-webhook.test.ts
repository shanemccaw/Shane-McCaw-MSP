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
  mspUsersTable: {},
  usersTable: {},
  mspEventStoreTable: {},
  mspAgreementAcceptancesTable: {},
  platformAgreementsTable: {},
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
