/**
 * msp-plan-pricing.test.ts
 *
 * Tests for:
 *   1. Unit-amount resolution (monthly dollars → cents, yearly cents, missing-config errors)
 *   2. Schedule phase construction (two phases, no proration, period-end boundary)
 *   3. Schedule creation for a subscription with NO existing schedule
 *   4. Schedule update (replace, not stack) when a schedule ALREADY exists
 *   5. Yearly price lookup: reuse existing matching price, create with interval "year" otherwise,
 *      error when annualPriceCents is unset
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
      annualPriceCents: "annual_price_cents", fulfillmentType: "fulfillment_type",
    },
  };
});

vi.mock("./stripe.ts", () => ({ getStripeKey: () => "sk_test_123" }));

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

// ── Mock the stripe SDK (used by getOrCreatePlanPrice's own client) ───────────

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
  resolveUnitAmountCents,
  monthlyPriceCentsOf,
  buildSchedulePhases,
  schedulePlanChangeAtPeriodEnd,
  getOrCreateYearlyPrice,
  PlanPricingError,
} from "./msp-plan-pricing.ts";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── Unit amount resolution ────────────────────────────────────────────────────

describe("resolveUnitAmountCents", () => {
  it("converts the legacy monthly dollars column to integer cents", () => {
    expect(monthlyPriceCentsOf("250.00")).toBe(25000);
    expect(resolveUnitAmountCents({ name: "Pro", price: "49.99", annualPriceCents: null }, "month")).toBe(4999);
  });

  it("uses annualPriceCents verbatim for yearly", () => {
    expect(resolveUnitAmountCents({ name: "Pro", price: "49.00", annualPriceCents: 49000 }, "year")).toBe(49000);
  });

  it("throws PlanPricingError for yearly when annualPriceCents is unset", () => {
    expect(() => resolveUnitAmountCents({ name: "Pro", price: "49.00", annualPriceCents: null }, "year"))
      .toThrow(PlanPricingError);
  });

  it("throws PlanPricingError for monthly when the price column is missing or invalid", () => {
    expect(() => resolveUnitAmountCents({ name: "Pro", price: null, annualPriceCents: null }, "month"))
      .toThrow(PlanPricingError);
    expect(() => resolveUnitAmountCents({ name: "Pro", price: "not-a-number", annualPriceCents: null }, "month"))
      .toThrow(PlanPricingError);
  });
});

// ── Phase construction ────────────────────────────────────────────────────────

describe("buildSchedulePhases", () => {
  it("builds exactly two phases: current until period end, target for one iteration, no proration", () => {
    const phases = buildSchedulePhases({
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

describe("schedulePlanChangeAtPeriodEnd", () => {
  const baseSubscription = {
    id: "sub_1",
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

    const result = await schedulePlanChangeAtPeriodEnd(stripe.client, {
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
        // Simulates a previously scheduled change: two phases already present
        phases: [{ start_date: 1_500 }, { start_date: 2_000 }],
      },
    });

    const result = await schedulePlanChangeAtPeriodEnd(stripe.client, {
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
});

// ── Yearly price lookup ───────────────────────────────────────────────────────

describe("getOrCreateYearlyPrice", () => {
  const tierRow = {
    id: 7,
    name: "Pro",
    slug: "pro",
    price: "49.00",
    annualPriceCents: 49000,
    fulfillmentType: "msp_monthly_subscription",
  };

  it("errors when the tier has no annualPriceCents set", async () => {
    mockLimit.mockResolvedValueOnce([{ ...tierRow, annualPriceCents: null }]);
    await expect(getOrCreateYearlyPrice(7)).rejects.toThrow(PlanPricingError);
    expect(mockProductsSearch).not.toHaveBeenCalled();
  });

  it("reuses an existing active yearly price with matching amount", async () => {
    mockLimit.mockResolvedValueOnce([tierRow]);
    mockProductsSearch.mockResolvedValueOnce({ data: [{ id: "prod_7" }] });
    mockPricesList.mockResolvedValueOnce({
      data: [
        { id: "price_month", recurring: { interval: "month" }, unit_amount: 4900, currency: "usd" },
        { id: "price_year", recurring: { interval: "year" }, unit_amount: 49000, currency: "usd" },
      ],
    });

    await expect(getOrCreateYearlyPrice(7)).resolves.toBe("price_year");
    expect(mockPricesCreate).not.toHaveBeenCalled();
  });

  it("creates a yearly price (interval taken as a parameter, not hardcoded month)", async () => {
    mockLimit.mockResolvedValueOnce([tierRow]);
    mockProductsSearch.mockResolvedValueOnce({ data: [{ id: "prod_7" }] });
    mockPricesList.mockResolvedValueOnce({ data: [] });
    mockPricesCreate.mockResolvedValueOnce({ id: "price_created" });

    await expect(getOrCreateYearlyPrice(7)).resolves.toBe("price_created");
    expect(mockPricesCreate).toHaveBeenCalledTimes(1);
    const params = mockPricesCreate.mock.calls[0]![0] as {
      recurring: { interval: string };
      unit_amount: number;
      metadata: Record<string, string>;
    };
    expect(params.recurring.interval).toBe("year");
    expect(params.unit_amount).toBe(49000);
    expect(params.metadata.serviceId).toBe("7");
  });
});
