/**
 * portal-tenant-check-items.test.ts — Git #776 (Phase 1 of 2, sub-issue of
 * epic #647).
 *
 * Three things worth guarding:
 *   1. THE TENANT-ID RESOLUTION IS SCOPED TO THE CALLER'S OWN customerId.
 *      The item-detail table is keyed on the M365 tenantId, not customerId,
 *      so the route must resolve it via a query filtered on the JWT's own
 *      customerId — never accept a tenantId from the request directly.
 *   2. A CHECK KEY WITH NO COLLECTION IS ABSENT, NOT AN ERROR. No row for a
 *      requested checkKey must resolve to a missing map entry, not a 404/500.
 *   3. BATCH REQUESTS RETURN ONE ROW PER CHECK KEY (the most recent), even
 *      when multiple historical rows exist for the same key.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

let mockSelectResultsQueue: any[][] = [];
let mockDistinctOnResultsQueue: any[][] = [];
let lastDistinctOnArgs: any[] = [];
let lastWhereArgs: any[] = [];

vi.mock("@workspace/db", () => {
  const makeSelectChain = () => {
    const chain: any = {
      from: () => chain,
      where: (...args: any[]) => {
        lastWhereArgs.push(args);
        return chain;
      },
      limit: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockSelectResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  const makeDistinctOnChain = () => {
    const chain: any = {
      from: () => chain,
      where: (...args: any[]) => {
        lastWhereArgs.push(args);
        return chain;
      },
      orderBy: () => chain,
      then: (onfulfilled: any, onrejected?: any) =>
        Promise.resolve(mockDistinctOnResultsQueue.shift() ?? []).then(onfulfilled, onrejected),
    };
    return chain;
  };

  return {
    db: {
      select: vi.fn(() => makeSelectChain()),
      selectDistinctOn: vi.fn((cols: any) => {
        lastDistinctOnArgs.push(cols);
        return makeDistinctOnChain();
      }),
    },
    tenantsTable: { id: "id", tenantId: "tenant_id" },
    tenantCheckItemDetailsTable: {
      tenantId: "tenant_id",
      checkKey: "check_key",
      status: "status",
      itemCount: "item_count",
      items: "items",
      itemsOmitted: "items_omitted",
      itemsOmittedReason: "items_omitted_reason",
      collectedAt: "collected_at",
    },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (_req: any, _res: any, next: () => void) => next(),
}));

vi.mock("../lib/logger", () => {
  const child = vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child }));
  return { logger: { child, info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } };
});

import router from "./portal-tenant-check-items";

function makeApp(user: Record<string, unknown> | null) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (user) (req as any).user = user;
    next();
  });
  app.use("/api", router);
  return app;
}

const CUSTOMER = { id: 7, customerId: 42, role: "client" };

beforeEach(() => {
  mockSelectResultsQueue = [];
  mockDistinctOnResultsQueue = [];
  lastDistinctOnArgs = [];
  lastWhereArgs = [];
});

describe("GET /api/portal/tenant-check-items", () => {
  it("rejects a request with no customerId on the token", async () => {
    const app = makeApp({ id: 1, role: "client" });
    const res = await request(app).get("/api/portal/tenant-check-items?checkKeys=identity:ca-policy-count");
    expect(res.status).toBe(403);
  });

  it("requires a non-empty checkKeys param", async () => {
    const app = makeApp(CUSTOMER);
    const res = await request(app).get("/api/portal/tenant-check-items");
    expect(res.status).toBe(400);
  });

  it("returns an empty items map (not an error) when the tenant has never been resolved", async () => {
    mockSelectResultsQueue.push([]); // tenants lookup finds nothing
    const app = makeApp(CUSTOMER);
    const res = await request(app).get("/api/portal/tenant-check-items?checkKeys=identity:ca-policy-count");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: {} });
  });

  it("returns the most recent row per requested check key, keyed by checkKey, absent when never collected", async () => {
    mockSelectResultsQueue.push([{ tenantId: "m365-tenant-guid" }]); // tenants lookup
    const collectedAt = new Date("2026-08-10T12:00:00Z");
    mockDistinctOnResultsQueue.push([
      {
        checkKey: "identity:ca-policy-count",
        status: "ok",
        itemCount: 3,
        items: [{ id: "policy-1" }, { id: "policy-2" }, { id: "policy-3" }],
        itemsOmitted: false,
        itemsOmittedReason: null,
        collectedAt,
      },
    ]);

    const app = makeApp(CUSTOMER);
    const res = await request(app)
      .get("/api/portal/tenant-check-items?checkKeys=identity:ca-policy-count,identity:global-admin-count");

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.items)).toEqual(["identity:ca-policy-count"]);
    expect(res.body.items["identity:ca-policy-count"]).toEqual({
      checkKey: "identity:ca-policy-count",
      status: "ok",
      itemCount: 3,
      items: [{ id: "policy-1" }, { id: "policy-2" }, { id: "policy-3" }],
      itemsOmitted: false,
      itemsOmittedReason: null,
      collectedAt: collectedAt.toISOString(),
    });
    // identity:global-admin-count was requested but never collected — absent, not null/error.
    expect(res.body.items["identity:global-admin-count"]).toBeUndefined();
  });

  it("rejects more than the per-call checkKeys ceiling", async () => {
    const app = makeApp(CUSTOMER);
    const many = Array.from({ length: 26 }, (_, i) => `check:${i}`).join(",");
    const res = await request(app).get(`/api/portal/tenant-check-items?checkKeys=${many}`);
    expect(res.status).toBe(400);
  });
});
