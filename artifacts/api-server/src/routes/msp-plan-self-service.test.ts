/**
 * msp-plan-self-service.test.ts
 *
 * Tests for:
 *   1. Downgrade guardrail — blocked when active tenant count exceeds the target
 *      tier's allowance + overage headroom (hard cap = allowance × 2)
 *   2. POST /api/msp/plan/change — schedules the change and stores pending state
 *   3. POST /api/msp/plan/cancel-pending-change — releases the schedule and
 *      clears pending fields
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import express from "express";
import request from "supertest";

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
  servicesTable: {
    id: "id", name: "name", slug: "slug", description: "description", price: "price",
    annualPriceCents: "annual_price_cents", typeAttributes: "type_attributes",
    fulfillmentType: "fulfillment_type", isPublic: "is_public",
  },
  mspSubscriptionsTable: {
    mspId: "msp_id", serviceId: "service_id", status: "status", dunningState: "dunning_state",
    billingInterval: "billing_interval", stripeSubscriptionId: "stripe_subscription_id",
    stripeScheduleId: "stripe_schedule_id", pendingServiceId: "pending_service_id",
    pendingBillingInterval: "pending_billing_interval", currentPeriodEnd: "current_period_end",
    tenantCountSnapshot: "tenant_count_snapshot",
  },
  mspAuditLogsTable: { actorUserId: "actor_user_id" },
}));

// ── Mock auth / infra ─────────────────────────────────────────────────────────

vi.mock("../middlewares/requireAuth.ts", () => ({
  requireRole: (_role: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 1, email: "admin@msp.test", role: "client", mspRole: "MSPAdmin", mspId: 42 };
    next();
  },
}));

vi.mock("../lib/resolve-msp-id.ts", () => ({ resolveMspId: async () => 42 }));

const mockCountActiveTenants = vi.fn();
vi.mock("../lib/msp-entitlement.ts", () => ({
  countActiveTenants: (...args: unknown[]) => mockCountActiveTenants(...args),
}));

const mockGetOrCreatePlanPrice = vi.fn();
const mockScheduleChange = vi.fn();
vi.mock("../lib/msp-plan-pricing.ts", () => {
  class PlanPricingError extends Error {}
  return {
    PlanPricingError,
    monthlyPriceCentsOf: (price: string | null) =>
      price == null ? null : Math.round(parseFloat(String(price)) * 100),
    getOrCreatePlanPrice: (...args: unknown[]) => mockGetOrCreatePlanPrice(...args),
    schedulePlanChangeAtPeriodEnd: (...args: unknown[]) => mockScheduleChange(...args),
  };
});

vi.mock("../lib/stripe.ts", () => ({ getStripeKey: () => "sk_test_123" }));
vi.mock("../lib/request-context.ts", () => ({ getRequestContext: () => undefined }));
vi.mock("../lib/logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

const mockScheduleRelease = vi.fn();
vi.mock("stripe", () => ({
  default: class MockStripe {
    subscriptionSchedules = { release: mockScheduleRelease };
  },
}));

import router, { downgradeBlockReason } from "./msp-plan-self-service.ts";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  selectResults.length = 0;
});

// ── Downgrade guardrail (pure) ────────────────────────────────────────────────

describe("downgradeBlockReason", () => {
  it("blocks a downgrade when active tenants reach the target hard cap (allowance × 2)", () => {
    expect(
      downgradeBlockReason({ currentAllowance: 10, targetAllowance: 3, activeTenantCount: 6 }),
    ).toMatch(/exceeds/);
  });

  it("allows a downgrade while under the hard cap (overage headroom)", () => {
    expect(
      downgradeBlockReason({ currentAllowance: 10, targetAllowance: 3, activeTenantCount: 5 }),
    ).toBeNull();
  });

  it("never blocks an upgrade", () => {
    expect(
      downgradeBlockReason({ currentAllowance: 3, targetAllowance: 10, activeTenantCount: 100 }),
    ).toBeNull();
  });

  it("never blocks moving to an unlimited (0/null allowance) tier", () => {
    expect(
      downgradeBlockReason({ currentAllowance: 3, targetAllowance: 0, activeTenantCount: 100 }),
    ).toBeNull();
    expect(
      downgradeBlockReason({ currentAllowance: 3, targetAllowance: null, activeTenantCount: 100 }),
    ).toBeNull();
  });

  it("treats unlimited → finite as a downgrade", () => {
    expect(
      downgradeBlockReason({ currentAllowance: 0, targetAllowance: 3, activeTenantCount: 10 }),
    ).toMatch(/exceeds/);
  });
});

// ── POST /api/msp/plan/change ─────────────────────────────────────────────────

const activeSub = {
  serviceId: 1,
  status: "active",
  dunningState: null,
  billingInterval: "month",
  stripeSubscriptionId: "sub_1",
  stripeScheduleId: null,
  pendingServiceId: null,
  currentTierAttributes: { tenantAllowance: 10 },
};

const targetTier = {
  id: 2,
  name: "Starter",
  isPublic: true,
  typeAttributes: { tenantAllowance: 3 },
};

describe("POST /api/msp/plan/change", () => {
  it("blocks a downgrade when the MSP is over the target tier's allowance headroom", async () => {
    selectResults.push([activeSub], [targetTier]);
    mockCountActiveTenants.mockResolvedValueOnce(8); // >= 3 × 2

    const res = await request(makeApp())
      .post("/api/msp/plan/change")
      .send({ targetServiceId: 2, targetInterval: "month" });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/exceeds/);
    expect(mockScheduleChange).not.toHaveBeenCalled();
    expect(mockUpdateSet).not.toHaveBeenCalled();
  });

  it("schedules the change, stores pending state, and writes an audit log", async () => {
    selectResults.push([activeSub], [targetTier]);
    mockCountActiveTenants.mockResolvedValueOnce(2);
    mockGetOrCreatePlanPrice.mockResolvedValueOnce("price_target");
    const effectiveAt = new Date("2026-08-01T00:00:00Z");
    mockScheduleChange.mockResolvedValueOnce({ scheduleId: "sched_1", effectiveAt });

    const res = await request(makeApp())
      .post("/api/msp/plan/change")
      .send({ targetServiceId: 2, targetInterval: "year" });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.effectiveAt).toBe(effectiveAt.toISOString());

    expect(mockGetOrCreatePlanPrice).toHaveBeenCalledWith(2, "year");
    expect(mockScheduleChange).toHaveBeenCalledWith(expect.anything(), {
      stripeSubscriptionId: "sub_1",
      existingScheduleId: null,
      targetPriceId: "price_target",
    });

    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      stripeScheduleId: "sched_1",
      pendingServiceId: 2,
      pendingBillingInterval: "year",
    }));

    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "plan.self_service_change.scheduled",
    }));
  });

  it("passes the existing schedule id through when a change is already pending (replace, not stack)", async () => {
    selectResults.push([{ ...activeSub, stripeScheduleId: "sched_old", pendingServiceId: 3 }], [targetTier]);
    mockCountActiveTenants.mockResolvedValueOnce(2);
    mockGetOrCreatePlanPrice.mockResolvedValueOnce("price_target");
    mockScheduleChange.mockResolvedValueOnce({ scheduleId: "sched_old", effectiveAt: new Date() });

    const res = await request(makeApp())
      .post("/api/msp/plan/change")
      .send({ targetServiceId: 2, targetInterval: "month" });

    expect(res.status).toBe(200);
    expect(mockScheduleChange).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      existingScheduleId: "sched_old",
    }));
  });

  it("rejects a no-op change to the same tier and interval", async () => {
    selectResults.push([activeSub]);

    const res = await request(makeApp())
      .post("/api/msp/plan/change")
      .send({ targetServiceId: 1, targetInterval: "month" });

    expect(res.status).toBe(400);
    expect(mockScheduleChange).not.toHaveBeenCalled();
  });
});

// ── POST /api/msp/plan/cancel-pending-change ──────────────────────────────────

describe("POST /api/msp/plan/cancel-pending-change", () => {
  it("releases the schedule and clears pending fields", async () => {
    selectResults.push([{
      stripeScheduleId: "sched_1",
      pendingServiceId: 2,
      pendingBillingInterval: "year",
    }]);
    mockScheduleRelease.mockResolvedValueOnce({});

    const res = await request(makeApp()).post("/api/msp/plan/cancel-pending-change").send({});

    expect(res.status).toBe(200);
    expect(mockScheduleRelease).toHaveBeenCalledWith("sched_1");
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({
      stripeScheduleId: null,
      pendingServiceId: null,
      pendingBillingInterval: null,
    }));
    expect(mockInsertValues).toHaveBeenCalledWith(expect.objectContaining({
      actionType: "plan.self_service_change.canceled",
    }));
  });

  it("404s when there is no pending change", async () => {
    selectResults.push([{ stripeScheduleId: null, pendingServiceId: null, pendingBillingInterval: null }]);

    const res = await request(makeApp()).post("/api/msp/plan/cancel-pending-change").send({});

    expect(res.status).toBe(404);
    expect(mockScheduleRelease).not.toHaveBeenCalled();
  });

  it("still clears pending state when Stripe reports the schedule already released", async () => {
    selectResults.push([{
      stripeScheduleId: "sched_1",
      pendingServiceId: 2,
      pendingBillingInterval: "year",
    }]);
    mockScheduleRelease.mockRejectedValueOnce(new Error("already released"));

    const res = await request(makeApp()).post("/api/msp/plan/cancel-pending-change").send({});

    expect(res.status).toBe(200);
    expect(mockUpdateSet).toHaveBeenCalledWith(expect.objectContaining({ stripeScheduleId: null }));
  });
});
