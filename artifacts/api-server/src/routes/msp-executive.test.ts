/**
 * msp-executive.test.ts
 *
 * Unit tests for the MSP Executive Mode endpoints.
 *
 * Covers:
 *   - 401 without auth on every endpoint
 *   - GET /msp/executive requires MSPOperator+ (403 for CustomerUser) and
 *     returns the gathered book, scoped via resolveStaffScopedCustomerIds
 *   - the QBR endpoints require MSPAdmin+ (403 for a plain MSPOperator)
 *   - POST generate: 200 with a ready QBR, 422 for an empty book, 502 on failure
 *
 * The data/generation libs are mocked — their internals are unit-tested
 * separately (msp-executive-data.test.ts / partner-qbr-generator.test.ts).
 *
 * Run: pnpm --filter @workspace/api-server run test -- msp-executive
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "msp-executive-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

function mspToken(mspId: number | null, mspRole: "MSPOperator" | "MSPAdmin" | "CustomerUser" = "MSPOperator"): string {
  return jwt.sign(
    { id: 1, email: "staff@test.com", role: "client", mspRole, mspId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

// resolveStaffScopedCustomerIds reads the scopes table via db.select — return
// no rows (= unrestricted) so the handler proceeds to gatherExecutiveBook.
vi.mock("@workspace/db", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["from", "where", "orderBy", "limit"]) chain[m] = () => chain;
  chain["then"] = (res: (v: unknown) => void) => Promise.resolve([]).then(res);
  return {
    db: { select: vi.fn(() => chain) },
    mspStaffCustomerScopesTable: { customerId: "customerId", staffUserId: "staffUserId", mspId: "mspId" },
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

const { gatherExecutiveBook, getCurrentPartnerQbr, getOrGeneratePartnerQbr } = vi.hoisted(() => ({
  gatherExecutiveBook: vi.fn(),
  getCurrentPartnerQbr: vi.fn(),
  getOrGeneratePartnerQbr: vi.fn(),
}));
vi.mock("../lib/msp-executive-data.ts", () => ({ gatherExecutiveBook }));
vi.mock("../lib/partner-qbr-generator.ts", () => ({
  getCurrentPartnerQbr,
  getOrGeneratePartnerQbr,
  currentQuarterKey: () => "2026-Q3",
}));

import router from "./msp-executive";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(router);
  return app;
}

const MSP_ID = 900;

const sampleBook = {
  mspId: MSP_ID,
  customerCount: 2,
  topRisks: [{ customerId: 1, name: "Acme Corp", healthScore: 70, goodnessPercent: 30, capturedAt: null }],
  topOpportunities: [{ customerId: 2, name: "Beta LLC", openOfferCount: 1, totalValueCents: 100000, topOfferTitle: "SIEM", topScore: 90 }],
  rollup: { avgGoodnessPercent: 58, atRiskCount: 1, totalOpenOpportunityCents: 100000, openOfferCount: 1 },
};

const readyQbr = {
  status: "ready",
  quarterKey: "2026-Q3",
  title: "Acme MSP — Partner QBR — 2026-Q3",
  htmlContent: "<h1>QBR</h1>",
  model: "claude-opus-4-8",
  generatedAt: "2026-07-20T00:00:00.000Z",
  errorMessage: null,
};

beforeEach(() => {
  gatherExecutiveBook.mockReset();
  getCurrentPartnerQbr.mockReset();
  getOrGeneratePartnerQbr.mockReset();
});

describe("GET /msp/executive", () => {
  it("rejects unauthenticated requests", async () => {
    const res = await request(makeApp()).get("/msp/executive");
    expect(res.status).toBe(401);
  });

  it("rejects roles below MSPOperator", async () => {
    const res = await request(makeApp())
      .get("/msp/executive")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "CustomerUser")}`);
    expect(res.status).toBe(403);
  });

  it("returns the gathered book for an MSPOperator", async () => {
    gatherExecutiveBook.mockResolvedValueOnce(sampleBook);
    const res = await request(makeApp())
      .get("/msp/executive")
      .set("Authorization", `Bearer ${mspToken(MSP_ID)}`);

    expect(res.status).toBe(200);
    expect(res.body.topRisks[0].name).toBe("Acme Corp");
    expect(res.body.topOpportunities[0].name).toBe("Beta LLC");
    // Called with the caller's own mspId and a resolved scope (null = unrestricted).
    expect(gatherExecutiveBook).toHaveBeenCalledWith(MSP_ID, null);
  });

  it("403s when the session carries no mspId", async () => {
    const res = await request(makeApp())
      .get("/msp/executive")
      .set("Authorization", `Bearer ${mspToken(null)}`);
    expect(res.status).toBe(403);
  });
});

describe("GET /msp/executive/qbr", () => {
  it("requires MSPAdmin+ (403 for a plain MSPOperator)", async () => {
    const res = await request(makeApp())
      .get("/msp/executive/qbr")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPOperator")}`);
    expect(res.status).toBe(403);
  });

  it("returns the cached QBR for an MSPAdmin without generating", async () => {
    getCurrentPartnerQbr.mockResolvedValueOnce(readyQbr);
    const res = await request(makeApp())
      .get("/msp/executive/qbr")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`);

    expect(res.status).toBe(200);
    expect(res.body.qbr.status).toBe("ready");
    expect(res.body.quarterKey).toBe("2026-Q3");
    expect(getOrGeneratePartnerQbr).not.toHaveBeenCalled();
  });
});

describe("POST /msp/executive/qbr/generate", () => {
  it("requires MSPAdmin+ (403 for a plain MSPOperator)", async () => {
    const res = await request(makeApp())
      .post("/msp/executive/qbr/generate")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPOperator")}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("generates and returns a ready QBR", async () => {
    getOrGeneratePartnerQbr.mockResolvedValueOnce(readyQbr);
    const res = await request(makeApp())
      .post("/msp/executive/qbr/generate")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({ force: true });

    expect(res.status).toBe(200);
    expect(res.body.qbr.htmlContent).toBe("<h1>QBR</h1>");
    expect(getOrGeneratePartnerQbr).toHaveBeenCalledWith(MSP_ID, { force: true });
  });

  it("422s when there are no customers to review", async () => {
    getOrGeneratePartnerQbr.mockResolvedValueOnce(null);
    const res = await request(makeApp())
      .post("/msp/executive/qbr/generate")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it("502s when generation fails", async () => {
    getOrGeneratePartnerQbr.mockResolvedValueOnce({ ...readyQbr, status: "failed", htmlContent: "", errorMessage: "boom" });
    const res = await request(makeApp())
      .post("/msp/executive/qbr/generate")
      .set("Authorization", `Bearer ${mspToken(MSP_ID, "MSPAdmin")}`)
      .send({});
    expect(res.status).toBe(502);
    expect(res.body.error).toBe("boom");
  });
});
