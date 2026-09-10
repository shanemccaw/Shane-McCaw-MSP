/**
 * msp-sales-offers.test.ts
 *
 * #3386 — PATCH /api/msp/sales-offers/:id/state is a generic state-machine
 * transition with NO knowledge of services.serviceClass and NO fulfillment
 * (no msp_sows row, no Stripe Checkout Session, no Monitoring-Tier gate).
 * Because VALID_TRANSITIONS defines accepted: [], an offer flipped to
 * "accepted" through this route is permanently stuck with zero real
 * fulfillment and no exit path.
 *
 * Covers:
 *   - PATCH .../state with newState="accepted" is rejected (422) and never
 *     reaches transitionOfferState — "accepted" must go through the
 *     purpose-built POST /api/msp/offers/:offerId/accept (msp-sow.ts).
 *   - PATCH .../state with newState="rejected"/"expired" still works — those
 *     need no fulfillment and stay on the generic route.
 *   - PATCH .../state still 404s for an offer outside the caller's mspId.
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import request from "supertest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  salesOffersTable: {
    id: "id",
    customerId: "customer_id",
    mspId: "msp_id",
    state: "state",
    title: "title",
    rationale: "rationale",
    sentAt: "sent_at",
    createdAt: "created_at",
  },
  salesOfferEventsTable: { offerId: "offer_id", createdAt: "created_at" },
  SALES_OFFER_STATES: ["draft", "sent", "accepted", "rejected", "expired"],
}));

vi.mock("drizzle-orm", () => ({
  eq: (_c: unknown, _v: unknown) => ({ eq: [_c, _v] }),
  and: (...args: unknown[]) => ({ and: args }),
  desc: (_c: unknown) => "desc",
  asc: (_c: unknown) => "asc",
  inArray: (_c: unknown, _v: unknown) => ({ inArray: [_c, _v] }),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireCapability: (_capability: string) => (req: Request, _res: Response, next: NextFunction) => {
    req.user = { id: 7, email: "operator@test.com", role: "client", mspRole: "MSPOperator", mspId: MSP_ID } as never;
    next();
  },
  requireMspScope: (_source?: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
  assertCustomerAccess: vi.fn(async () => true),
}));

vi.mock("../middlewares/rbac-ladder.ts", () => ({
  userClearsLadderCapability: vi.fn(),
}));

vi.mock("../lib/msp-entitlement", () => ({
  requirePlanFeature: (_feature: string) => (_req: Request, _res: Response, next: NextFunction) => next(),
}));

vi.mock("../lib/sales-offer-engine", () => ({
  runSalesOfferEngineForTenant: vi.fn(),
  persistSalesOfferCandidates: vi.fn(),
  transitionOfferState: vi.fn(),
  expireStaleSalesOffers: vi.fn(),
}));

vi.mock("../lib/sse-channels", () => ({
  registerMspOfferSSEClient: vi.fn(),
  broadcastMspOfferChange: vi.fn(),
  broadcastCustomerOfferChange: vi.fn(),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const MSP_ID = 10;

vi.mock("../lib/resolve-msp-id.ts", () => ({
  resolveMspIdStrict: vi.fn(() => MSP_ID),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

type MockDb = { select: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn> };

/** Build a drizzle-style fluent chain that resolves to `rows`. */
function buildChain(rows: unknown[]) {
  return {
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn().mockResolvedValue(rows),
    orderBy: vi.fn().mockResolvedValue(rows),
  };
}

import { db } from "@workspace/db";
import { transitionOfferState } from "../lib/sales-offer-engine";

const mockDb = db as unknown as MockDb;

const sentOffer = { id: 1, customerId: 55, mspId: MSP_ID };

beforeEach(() => {
  vi.clearAllMocks();
});

// ── App factory ───────────────────────────────────────────────────────────────

async function makeApp() {
  const { default: mspSalesOffersRouter } = await import("./msp-sales-offers");
  const app = express();
  app.use(express.json());
  app.use("/api", mspSalesOffersRouter);
  return app;
}

// ── Tests: PATCH /api/msp/sales-offers/:id/state ──────────────────────────────

describe("PATCH /api/msp/sales-offers/:id/state", () => {
  it("#3386 — rejects newState=\"accepted\" with 422 and never calls transitionOfferState", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/1/state")
      .send({ newState: "accepted" });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/api\/msp\/offers\/:offerId\/accept/);
    expect(transitionOfferState).not.toHaveBeenCalled();
  });

  it("#3386 — the 422 fires before the offer lookup (guards even a nonexistent offer id)", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([]));
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/999/state")
      .send({ newState: "accepted" });

    expect(res.status).toBe(422);
    expect(transitionOfferState).not.toHaveBeenCalled();
  });

  it("still allows newState=\"rejected\" (no fulfillment needed) through the generic route", async () => {
    const rejectedOffer = { ...sentOffer, state: "rejected" };
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    vi.mocked(transitionOfferState).mockResolvedValue(
      rejectedOffer as unknown as Awaited<ReturnType<typeof transitionOfferState>>,
    );
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/1/state")
      .send({ newState: "rejected", rejectionReason: "Customer declined" });

    expect(res.status).toBe(200);
    expect(transitionOfferState).toHaveBeenCalledWith(1, "rejected", 7, { rejectionReason: "Customer declined" });
  });

  it("still allows newState=\"expired\" through the generic route", async () => {
    const expiredOffer = { ...sentOffer, state: "expired" };
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    vi.mocked(transitionOfferState).mockResolvedValue(
      expiredOffer as unknown as Awaited<ReturnType<typeof transitionOfferState>>,
    );
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/1/state")
      .send({ newState: "expired" });

    expect(res.status).toBe(200);
    expect(transitionOfferState).toHaveBeenCalledWith(1, "expired", 7, {});
  });

  it("returns 404 for an offer outside the caller's mspId (scope enforced before transition)", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([]));
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/1/state")
      .send({ newState: "rejected" });

    expect(res.status).toBe(404);
    expect(transitionOfferState).not.toHaveBeenCalled();
  });

  it("returns 400 for an unrecognized newState value", async () => {
    const app = await makeApp();

    const res = await request(app)
      .patch("/api/msp/sales-offers/1/state")
      .send({ newState: "bogus" });

    expect(res.status).toBe(400);
    expect(transitionOfferState).not.toHaveBeenCalled();
  });
});
