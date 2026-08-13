import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for GET /api/portal/customer/search.
 *
 * DB is mocked with a FIFO queue, same convention as dashboard-data.test.ts:
 * each awaited `.select()...` chain shifts the next queued row array off
 * mockResultQueue, in call order (findings, documents, offers, services).
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: { select: vi.fn(() => makeChain()) },
    mspDiagnosticFindingsTable: tbl(["findingId", "customerId", "title", "description", "severity", "createdAt"]),
    insightsGeneratedDocumentsTable: tbl(["id", "customerId", "title", "docType", "status", "createdAt"]),
    salesOffersTable: tbl(["id", "customerId", "title", "state", "createdAt"]),
    servicesTable: tbl(["id", "slug", "name", "tagline", "visibility", "serviceType", "sortOrder"]),
  };
});

process.env.JWT_SECRET = "test-secret";

async function buildApp() {
  const { default: router } = await import("./portal-customer-search");
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

function tokenFor(user: Record<string, unknown>) {
  return jwt.sign(user, process.env.JWT_SECRET!);
}

beforeEach(() => {
  mockResultQueue = [];
  vi.clearAllMocks();
});

describe("GET /api/portal/customer/search", () => {
  it("400s when the caller has no customerId", async () => {
    const app = await buildApp();
    const token = tokenFor({ id: 1, email: "a@b.com", role: "client", mspRole: "CustomerUser" });
    const res = await request(app)
      .get("/api/portal/customer/search?q=security")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it("returns empty results for a too-short query without hitting the db", async () => {
    const app = await buildApp();
    const token = tokenFor({ id: 1, email: "a@b.com", role: "client", mspRole: "CustomerUser", customerId: 42 });
    const res = await request(app)
      .get("/api/portal/customer/search?q=a")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.results).toEqual([]);
  });

  it("groups matches from multiple sources into one results array", async () => {
    mockResultQueue = [
      [{ findingId: "f-1", title: "Security Baseline Check Failed", description: "MFA not enforced", severity: "critical", createdAt: new Date() }],
      [{ id: 7, title: "Security Assessment Report", docType: "report", status: "delivered", createdAt: new Date() }],
      [],
      [],
    ];
    const app = await buildApp();
    const token = tokenFor({ id: 1, email: "a@b.com", role: "client", mspRole: "CustomerUser", customerId: 42 });
    const res = await request(app)
      .get("/api/portal/customer/search?q=security")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(2);
    const types = res.body.results.map((r: { type: string }) => r.type).sort();
    expect(types).toEqual(["document", "finding"]);
    expect(res.body.results.find((r: { type: string }) => r.type === "finding").title).toBe(
      "Security Baseline Check Failed",
    );
    expect(res.body.results.find((r: { type: string }) => r.type === "document").title).toBe(
      "Security Assessment Report",
    );
  });
});
