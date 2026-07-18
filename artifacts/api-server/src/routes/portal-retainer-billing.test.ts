/**
 * portal-retainer-billing.test.ts
 *
 * Tests for the retainer interval-switch schedule transition handlers
 * (delegated to from portal.ts's processStripeEvent):
 *   1. subscription_schedule.completed — applies pendingBillingInterval,
 *      clears pending state, writes an audit log entry
 *   2. subscription_schedule.canceled — clears stale pending state without
 *      touching the live billingInterval column
 *   3. subscription_schedule.released — finalizes when the target phase already
 *      started, clears stale state when released before the transition
 *   4. subscription_schedule.updated — finalizes only once Stripe has advanced
 *      into the final phase; ignores our own scheduling edits
 *   5. Unknown schedules (no matching client_services row) are ignored
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const selectResults: unknown[][] = [];
const mockUpdateSet = vi.fn();

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
  },
  clientServicesTable: {
    id: "id", clientUserId: "client_user_id", serviceId: "service_id",
    status: "status", billingInterval: "billing_interval",
    stripeScheduleId: "stripe_schedule_id", pendingBillingInterval: "pending_billing_interval",
    stripeSubscriptionId: "stripe_subscription_id",
  },
  servicesTable: {},
}));

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireAuth: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../lib/stripe.ts", () => ({ getStripeKey: () => "sk_test_123" }));
vi.mock("../lib/logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));
const mockCreateAuditLog = vi.fn();
vi.mock("../lib/audit.ts", () => ({ createAuditLog: (e: unknown) => mockCreateAuditLog(e) }));
vi.mock("../lib/sms.ts", () => ({ sendAdminSms: vi.fn() }));

import {
  handleRetainerScheduleUpdated,
  handleRetainerScheduleCompleted,
  handleRetainerScheduleReleased,
  handleRetainerScheduleCanceled,
} from "./portal-retainer-billing.ts";

type StripeSchedule = import("stripe").Stripe.SubscriptionSchedule;

const csRow = {
  id: 9,
  clientUserId: 3,
  serviceId: 4,
  billingInterval: "month",
  pendingBillingInterval: "year",
};

const pastUnix = Math.floor(Date.now() / 1000) - 3600;
const futureUnix = Math.floor(Date.now() / 1000) + 3600;

function schedule(overrides: Partial<Record<string, unknown>> = {}): StripeSchedule {
  return {
    id: "sched_1",
    current_phase: null,
    phases: [
      { start_date: pastUnix - 100, items: [{ price: "price_month" }] },
      { start_date: pastUnix, items: [{ price: "price_year" }] },
    ],
    ...overrides,
  } as unknown as StripeSchedule;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
});

describe("subscription_schedule.completed", () => {
  it("applies the pending interval, clears pending state, writes an audit entry", async () => {
    selectResults.push([csRow]);

    await handleRetainerScheduleCompleted(schedule());

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      billingInterval: "year",
      stripeScheduleId: null,
      pendingBillingInterval: null,
    }));
    // Visible, traceable mechanism: the flip is audit-logged
    expect(mockCreateAuditLog).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "retainer_interval_switched",
      clientId: 3,
      metadata: expect.objectContaining({ fromInterval: "month", toInterval: "year" }),
    }));
  });

  it("is a no-op for schedules with no matching client_services row (idempotent replay)", async () => {
    selectResults.push([]);

    await handleRetainerScheduleCompleted(schedule());

    expect(mockUpdateSet).not.toHaveBeenCalled();
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });
});

describe("subscription_schedule.canceled", () => {
  it("clears stale pending state without touching the live billingInterval", async () => {
    selectResults.push([csRow]);

    await handleRetainerScheduleCanceled(schedule());

    expect(mockUpdateSet).toHaveBeenCalledTimes(1);
    const vals = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals).toEqual(expect.objectContaining({
      stripeScheduleId: null,
      pendingBillingInterval: null,
    }));
    expect(vals).not.toHaveProperty("billingInterval");
    expect(mockCreateAuditLog).not.toHaveBeenCalled();
  });
});

describe("subscription_schedule.released", () => {
  it("finalizes when the target phase already started (released after the transition)", async () => {
    selectResults.push([csRow]);

    await handleRetainerScheduleReleased(schedule());

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      billingInterval: "year",
    }));
  });

  it("clears stale pending state when released before the target phase started", async () => {
    selectResults.push([csRow]);

    await handleRetainerScheduleReleased(schedule({
      phases: [
        { start_date: pastUnix, items: [{ price: "price_month" }] },
        { start_date: futureUnix, items: [{ price: "price_year" }] },
      ],
    }));

    const vals = mockUpdateSet.mock.calls[0]![0] as Record<string, unknown>;
    expect(vals).not.toHaveProperty("billingInterval");
    expect(vals).toEqual(expect.objectContaining({ stripeScheduleId: null, pendingBillingInterval: null }));
  });
});

describe("subscription_schedule.updated", () => {
  it("finalizes when Stripe advances into the final (target) phase", async () => {
    selectResults.push([csRow]);

    await handleRetainerScheduleUpdated(schedule({
      current_phase: { start_date: pastUnix, end_date: futureUnix },
    }));

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      billingInterval: "year",
    }));
  });

  it("ignores updates while phase 1 is still current (our own scheduling edits)", async () => {
    await handleRetainerScheduleUpdated(schedule({
      current_phase: { start_date: pastUnix - 100, end_date: pastUnix },
      phases: [
        { start_date: pastUnix - 100, items: [{ price: "price_month" }] },
        { start_date: futureUnix, items: [{ price: "price_year" }] },
      ],
    }));

    expect(mockUpdateSet).not.toHaveBeenCalled();
  });
});
