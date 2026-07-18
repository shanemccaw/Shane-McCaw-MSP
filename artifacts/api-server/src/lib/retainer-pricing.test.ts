/**
 * retainer-pricing.test.ts
 *
 * Tests for:
 *   1. Unit-amount resolution (monthly dollars → cents, yearly cents, missing-config errors)
 *   2. Schedule phase construction (two phases, no proration, period-end boundary)
 *   3. Schedule creation for a subscription with NO existing schedule
 *   4. Schedule update (replace, not stack) when a schedule ALREADY exists
 *   5. cancel_at_period_end guard (a schedule would silently resurrect billing)
 *   6. Price lookup: reuse existing matching price, create with interval "year" otherwise,
 *      error when annualPriceCents is unset or the service is not recurring
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock @workspace/db ────────────────────────────────────────────────────────

const mockLimit = vi.fn();

vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "innerJoin", "where", "orderBy"]) {
    chain[m] = () => chain;
  }
  chain.limit = (...args: unknown[]) => mockLimit(...args);
  return {
    db: { select: () => chain },
    servicesTable: {
      id: "id", name: "name", slug: "slug", price: "price",
      annualPriceCents: "annual_price_cents", billingType: "billing_type",
    },
  };
});

vi.mock("./stripe.ts", () => ({ getStripeKey: () => "sk_test_123" }));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

// ── Mock the stripe SDK (used by getOrCreateRetainerPrice's own client) ───────

const mockProductsSearch = vi.fn();
const mockProductsCreate = vi.fn();
const mockPricesList = vi.fn();
const mockPricesCreate = vi.fn();

vi.mock("stripe", () => ({
  default: class MockStripe {
    products = { search: mockProductsSearch, create: mockProductsCreate };
    prices = { list: mockPricesList, create: mockPricesCreate };
  },
}));

import {
  resolveRetainerUnitAmountCents,
  monthlyPriceCentsOf,
  buildIntervalSwitchPhases,
  scheduleIntervalSwitchAtPeriodEnd,
  getOrCreateRetainerPrice,
  RetainerPricingError,
} from "./retainer-pricing.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Unit amount resolution ────────────────────────────────────────────────────

describe("resolveRetainerUnitAmountCents", () => {
  it("converts the legacy monthly dollars column to integer cents", () => {
    expect(monthlyPriceCentsOf("250.00")).toBe(25000);
    expect(resolveRetainerUnitAmountCents({ name: "Retainer", price: "49.99", annualPriceCents: null }, "month")).toBe(4999);
  });

  it("uses annualPriceCents verbatim for yearly", () => {
    expect(resolveRetainerUnitAmountCents({ name: "Retainer", price: "49.00", annualPriceCents: 49000 }, "year")).toBe(49000);
  });

  it("throws RetainerPricingError for yearly when annualPriceCents is unset", () => {
    expect(() => resolveRetainerUnitAmountCents({ name: "Retainer", price: "49.00", annualPriceCents: null }, "year"))
      .toThrow(RetainerPricingError);
  });

  it("throws RetainerPricingError for monthly when the price column is missing or invalid", () => {
    expect(() => resolveRetainerUnitAmountCents({ name: "Retainer", price: null, annualPriceCents: null }, "month"))
      .toThrow(RetainerPricingError);
    expect(() => resolveRetainerUnitAmountCents({ name: "Retainer", price: "not-a-number", annualPriceCents: null }, "month"))
      .toThrow(RetainerPricingError);
  });
});

// ── Phase construction ────────────────────────────────────────────────────────

describe("buildIntervalSwitchPhases", () => {
  it("builds exactly two phases: current until period end, target for one iteration, no proration", () => {
    const phases = buildIntervalSwitchPhases({
      currentPriceId: "price_old",
      currentPhaseStartUnix: 1_000,
      periodEndUnix: 2_000,
      targetPriceId: "price_new",
    });

    expect(phases).toHaveLength(2);
    expect(phases[0]).toEqual({
      items: [{ price: "price_old", quantity: 1 }],
      start_date: 1_000,
      end_date: 2_000,
      proration_behavior: "none",
    });
    expect(phases[1]).toEqual({
      items: [{ price: "price_new", quantity: 1 }],
      iterations: 1,
      proration_behavior: "none",
    });
  });
});

// ── Schedule orchestration ────────────────────────────────────────────────────

function fakeStripe(overrides: {
  subscription: Record<string, unknown>;
  retrievedSchedule?: Record<string, unknown>;
  createdSchedule?: Record<string, unknown>;
}) {
  const create = vi.fn().mockResolvedValue(overrides.createdSchedule ?? {});
  const retrieve = vi.fn().mockResolvedValue(overrides.retrievedSchedule ?? {});
  const update = vi.fn().mockResolvedValue({});
  return {
    client: {
      subscriptions: { retrieve: vi.fn().mockResolvedValue(overrides.subscription) },
      subscriptionSchedules: { create, retrieve, update },
    } as unknown as import("stripe").Stripe,
    create,
    retrieve,
    update,
  };
}

describe("scheduleIntervalSwitchAtPeriodEnd", () => {
  const baseSubscription = {
    id: "sub_1",
    cancel_at_period_end: false,
    items: { data: [{ price: { id: "price_old" } }] },
    current_period_start: 1_000,
    current_period_end: 2_000,
    schedule: null,
  };

  it("creates a schedule from the subscription when none exists", async () => {
    const stripe = fakeStripe({
      subscription: baseSubscription,
      createdSchedule: { id: "sched_new", current_phase: { start_date: 1_000 }, phases: [{ start_date: 1_000 }] },
    });

    const result = await scheduleIntervalSwitchAtPeriodEnd(stripe.client, {
      stripeSubscriptionId: "sub_1",
      existingScheduleId: null,
      targetPriceId: "price_new",
    });

    expect(stripe.create).toHaveBeenCalledWith({ from_subscription: "sub_1" });
    expect(stripe.update).toHaveBeenCalledTimes(1);
    const [scheduleId, params] = stripe.update.mock.calls[0] as [string, { phases: unknown[]; end_behavior: string }];
    expect(scheduleId).toBe("sched_new");
    expect(params.end_behavior).toBe("release");
    expect(params.phases).toHaveLength(2);
    expect(result.scheduleId).toBe("sched_new");
    expect(result.effectiveAt).toEqual(new Date(2_000 * 1000));
  });

  it("REPLACES phases on an existing schedule instead of creating/stacking (change of mind)", async () => {
    const stripe = fakeStripe({
      subscription: { ...baseSubscription, schedule: "sched_exist" },
      retrievedSchedule: {
        id: "sched_exist",
        current_phase: { start_date: 1_500 },
        // Simulates a previously scheduled switch: two phases already present
        phases: [{ start_date: 1_500 }, { start_date: 2_000 }],
      },
    });

    const result = await scheduleIntervalSwitchAtPeriodEnd(stripe.client, {
      stripeSubscriptionId: "sub_1",
      existingScheduleId: "sched_exist",
      targetPriceId: "price_newer",
    });

    expect(stripe.create).not.toHaveBeenCalled();
    expect(stripe.update).toHaveBeenCalledTimes(1);
    const [scheduleId, params] = stripe.update.mock.calls[0] as [
      string,
      { phases: { start_date?: number; items: { price: string }[] }[] },
    ];
    expect(scheduleId).toBe("sched_exist");
    // Exactly two phases — the old pending phase is gone, not stacked under a third
    expect(params.phases).toHaveLength(2);
    expect(params.phases[0]!.start_date).toBe(1_500); // preserves in-progress phase start
    expect(params.phases[1]!.items[0]!.price).toBe("price_newer");
    expect(result.scheduleId).toBe("sched_exist");
  });

  it("refuses to schedule on a subscription set to cancel at period end", async () => {
    const stripe = fakeStripe({
      subscription: { ...baseSubscription, cancel_at_period_end: true },
    });

    await expect(scheduleIntervalSwitchAtPeriodEnd(stripe.client, {
      stripeSubscriptionId: "sub_1",
      existingScheduleId: null,
      targetPriceId: "price_new",
    })).rejects.toThrow(RetainerPricingError);
    expect(stripe.create).not.toHaveBeenCalled();
    expect(stripe.update).not.toHaveBeenCalled();
  });

  it("falls back to the item-level current_period_end (newer Stripe API shapes)", async () => {
    const stripe = fakeStripe({
      subscription: {
        ...baseSubscription,
        current_period_end: undefined,
        items: { data: [{ price: { id: "price_old" }, current_period_end: 3_000 }] },
      },
      createdSchedule: { id: "sched_new", current_phase: { start_date: 1_000 }, phases: [{ start_date: 1_000 }] },
    });

    const result = await scheduleIntervalSwitchAtPeriodEnd(stripe.client, {
      stripeSubscriptionId: "sub_1",
      existingScheduleId: null,
      targetPriceId: "price_new",
    });

    expect(result.effectiveAt).toEqual(new Date(3_000 * 1000));
  });
});

// ── Price lookup ──────────────────────────────────────────────────────────────

describe("getOrCreateRetainerPrice", () => {
  const serviceRow = {
    id: 7,
    name: "M365 Care Plan",
    slug: "m365-care",
    price: "250.00",
    annualPriceCents: 250000,
    billingType: "recurring_monthly",
  };

  it("errors for services that are not recurring", async () => {
    mockLimit.mockResolvedValueOnce([{ ...serviceRow, billingType: "one_time" }]);
    await expect(getOrCreateRetainerPrice(7, "year")).rejects.toThrow(RetainerPricingError);
    expect(mockProductsSearch).not.toHaveBeenCalled();
  });

  it("errors when the service has no annualPriceCents set and yearly is requested", async () => {
    mockLimit.mockResolvedValueOnce([{ ...serviceRow, annualPriceCents: null }]);
    await expect(getOrCreateRetainerPrice(7, "year")).rejects.toThrow(RetainerPricingError);
    expect(mockProductsSearch).not.toHaveBeenCalled();
  });

  it("reuses an existing active yearly price with matching amount", async () => {
    mockLimit.mockResolvedValueOnce([serviceRow]);
    mockProductsSearch.mockResolvedValueOnce({ data: [{ id: "prod_7" }] });
    mockPricesList.mockResolvedValueOnce({
      data: [
        { id: "price_month", recurring: { interval: "month" }, unit_amount: 25000, currency: "usd" },
        { id: "price_year", recurring: { interval: "year" }, unit_amount: 250000, currency: "usd" },
      ],
    });

    await expect(getOrCreateRetainerPrice(7, "year")).resolves.toBe("price_year");
    expect(mockPricesCreate).not.toHaveBeenCalled();
  });

  it("creates a yearly price (interval taken as a parameter, not hardcoded month)", async () => {
    mockLimit.mockResolvedValueOnce([serviceRow]);
    mockProductsSearch.mockResolvedValueOnce({ data: [{ id: "prod_7" }] });
    mockPricesList.mockResolvedValueOnce({ data: [] });
    mockPricesCreate.mockResolvedValueOnce({ id: "price_created" });

    await expect(getOrCreateRetainerPrice(7, "year")).resolves.toBe("price_created");
    expect(mockPricesCreate).toHaveBeenCalledTimes(1);
    const params = mockPricesCreate.mock.calls[0]![0] as {
      recurring: { interval: string };
      unit_amount: number;
      metadata: Record<string, string>;
    };
    expect(params.recurring.interval).toBe("year");
    expect(params.unit_amount).toBe(250000);
    expect(params.metadata.serviceId).toBe("7");
  });
});
