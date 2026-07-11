/**
 * portal-offers.test.ts
 *
 * Unit tests for the customer-facing Sales Offer endpoints.
 *
 * Covers:
 *   - GET /portal/offers — 401 without auth, scoped to customer on valid auth
 *   - GET /portal/offers/:id — 404 for wrong customer, 404 for draft (hidden) state
 *   - POST /portal/offers/:id/accept — state guard (non-sent → 422), ownership check
 *   - POST /portal/offers/:id/reject — state guard, rejection reason passed through
 *
 * Run: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// ── JWT / env setup ───────────────────────────────────────────────────────────

const JWT_SECRET = "portal-offers-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

const CUSTOMER_ID = 42;
const OTHER_CUSTOMER_ID = 99;

const customerToken = jwt.sign(
  { id: 1, email: "c@test.com", role: "client", mspRole: "CustomerUser", customerId: CUSTOMER_ID },
  JWT_SECRET,
  { expiresIn: "1h" },
);
const otherCustomerToken = jwt.sign(
  { id: 2, email: "c2@test.com", role: "client", mspRole: "CustomerUser", customerId: OTHER_CUSTOMER_ID },
  JWT_SECRET,
  { expiresIn: "1h" },
);

// ── Fixture offers ────────────────────────────────────────────────────────────

const sentOffer = {
  id: 1,
  tenantId: CUSTOMER_ID,
  mspId: 10,
  title: "Microsoft 365 Copilot Upgrade",
  rationale: "Your environment is ready for Copilot.",
  firedSignalKeys: ["copilot:ready"],
  bundledOfferIds: [],
  basePriceCents: 100_000,
  adjustedPriceCents: 90_000,
  score: 80,
  state: "sent",
  expiresAt: new Date(Date.now() + 7 * 86_400_000),
  sentAt: new Date(),
  acceptedAt: null,
  closedAt: null,
  rejectionReason: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  engineSnapshot: {},
};

const draftOffer = { ...sentOffer, id: 2, state: "draft", sentAt: null };
const acceptedOffer = { ...sentOffer, id: 3, state: "accepted", acceptedAt: new Date() };

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  salesOffersTable: {
    id: "id",
    tenantId: "tenant_id",
    mspId: "msp_id",
    state: "state",
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
  inArray: (_c: unknown, _v: unknown) => ({ inArray: [_c, _v] }),
}));

vi.mock("../lib/sales-offer-engine", () => ({
  transitionOfferState: vi.fn(),
}));

vi.mock("../lib/sse-broadcast", () => ({
  registerCustomerOfferSSEClient: vi.fn(),
  broadcastMspOfferChange: vi.fn(),
  broadcastCustomerOfferChange: vi.fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() },
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

beforeEach(() => {
  vi.clearAllMocks();
});

// ── App factory ───────────────────────────────────────────────────────────────

async function makeApp() {
  const { default: portalOffersRouter } = await import("./portal-offers");
  const app = express();
  app.use(express.json());
  app.use("/api", portalOffersRouter);
  return app;
}

// ── Tests: GET /api/portal/offers ─────────────────────────────────────────────

describe("GET /api/portal/offers", () => {
  it("returns 401 without Authorization header", async () => {
    const app = await makeApp();
    const res = await request(app).get("/api/portal/offers");
    expect(res.status).toBe(401);
  });

  it("returns list of offers for authenticated customer", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    const app = await makeApp();

    const res = await request(app)
      .get("/api/portal/offers")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("offers");
    expect(Array.isArray(res.body.offers)).toBe(true);
  });

  it("does not expose internal fields (engineSnapshot, score, firedSignalKeys)", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    const app = await makeApp();

    const res = await request(app)
      .get("/api/portal/offers")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    if (res.body.offers.length > 0) {
      const offer = res.body.offers[0] as Record<string, unknown>;
      expect(offer).not.toHaveProperty("engineSnapshot");
      expect(offer).not.toHaveProperty("score");
      expect(offer).not.toHaveProperty("firedSignalKeys");
    }
  });
});

// ── Tests: GET /api/portal/offers/:id ────────────────────────────────────────

describe("GET /api/portal/offers/:id", () => {
  it("returns 404 for an offer belonging to another customer", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([]));
    const app = await makeApp();

    const res = await request(app)
      .get("/api/portal/offers/1")
      .set("Authorization", `Bearer ${otherCustomerToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 404 for a draft offer (not customer-visible)", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([draftOffer]));
    const app = await makeApp();

    const res = await request(app)
      .get("/api/portal/offers/2")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(404);
  });

  it("returns 200 with customer-safe fields for a sent offer", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    const app = await makeApp();

    const res = await request(app)
      .get("/api/portal/offers/1")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offer).toHaveProperty("title");
    expect(res.body.offer).not.toHaveProperty("engineSnapshot");
    expect(res.body.offer).not.toHaveProperty("score");
  });
});

// ── Tests: POST /api/portal/offers/:id/accept ─────────────────────────────────

describe("POST /api/portal/offers/:id/accept", () => {
  it("returns 422 when the offer is not in sent state", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([acceptedOffer]));
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/3/accept")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/accepted/);
  });

  it("returns 404 when the offer belongs to another customer", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([]));
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/1/accept")
      .set("Authorization", `Bearer ${otherCustomerToken}`);

    expect(res.status).toBe(404);
  });

  it("accepts a sent offer and calls transitionOfferState", async () => {
    const updatedOffer = { ...sentOffer, state: "accepted", acceptedAt: new Date() };
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    vi.mocked(transitionOfferState).mockResolvedValue(
      updatedOffer as unknown as Awaited<ReturnType<typeof transitionOfferState>>,
    );
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/1/accept")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offer.state).toBe("accepted");
    expect(transitionOfferState).toHaveBeenCalledWith(1, "accepted", expect.anything(), {});
  });
});

// ── Tests: POST /api/portal/offers/:id/reject ────────────────────────────────

describe("POST /api/portal/offers/:id/reject", () => {
  it("returns 422 when the offer is not in sent state", async () => {
    mockDb.select = vi.fn().mockReturnValue(buildChain([draftOffer]));
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/2/reject")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ rejectionReason: "Not ready" });

    expect(res.status).toBe(422);
  });

  it("rejects a sent offer and passes the rejection reason", async () => {
    const rejectedOffer = { ...sentOffer, state: "rejected", rejectionReason: "Budget constraints" };
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    vi.mocked(transitionOfferState).mockResolvedValue(
      rejectedOffer as unknown as Awaited<ReturnType<typeof transitionOfferState>>,
    );
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/1/reject")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ rejectionReason: "Budget constraints" });

    expect(res.status).toBe(200);
    expect(res.body.offer.state).toBe("rejected");
    expect(transitionOfferState).toHaveBeenCalledWith(
      1,
      "rejected",
      expect.anything(),
      { rejectionReason: "Budget constraints" },
    );
  });

  it("rejects a sent offer without a reason (optional field)", async () => {
    const rejectedOffer = { ...sentOffer, state: "rejected", rejectionReason: null };
    mockDb.select = vi.fn().mockReturnValue(buildChain([sentOffer]));
    vi.mocked(transitionOfferState).mockResolvedValue(
      rejectedOffer as unknown as Awaited<ReturnType<typeof transitionOfferState>>,
    );
    const app = await makeApp();

    const res = await request(app)
      .post("/api/portal/offers/1/reject")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(200);
    expect(res.body.offer.state).toBe("rejected");
  });
});
