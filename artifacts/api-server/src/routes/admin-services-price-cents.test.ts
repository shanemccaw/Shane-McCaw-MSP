/**
 * admin-services-price-cents.test.ts
 *
 * Regression tests for the two real producers of the platform-wide
 * "price lives only in the legacy decimal column, price_cents NULL" population
 * repaired by lib/db/migrations/manual/2026-07-23-price-cents-backfill.sql:
 *
 *   1. PUT  /api/admin/services/:id      — set price_cents/internal_cost_cents/
 *      annual_price_cents unconditionally from the body, so every save through
 *      the admin catalog editor (whose form schema does not contain them) NULLed
 *      the canonical price. Must now be presence-based.
 *
 *   2. POST /api/admin/catalog/import    — never wrote price_cents at all, so
 *      every imported product landed legacy-priced only. Must now derive it from
 *      the legacy dollars using the canonical `price ?? basePrice` precedence.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const { mockDbUpdate, mockDbExecute, mockSet } = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockDbExecute: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    update: mockDbUpdate,
    execute: mockDbExecute,
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue([]) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([]) }) }),
    query: { services: { findMany: vi.fn().mockResolvedValue([]) } },
  },
  servicesTable: { id: "id", categoryPath: "category_path", updatedAt: "updated_at" },
  clientServicesTable: {},
  contractsTable: {},
  workflowTemplatesTable: {},
  contractTemplatesTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/service-overview-pdf", () => ({
  generateServiceOverviewPdf: vi.fn().mockResolvedValue(null),
}));

vi.mock("../lib/ai-prompts", () => ({ getPromptText: vi.fn().mockResolvedValue("") }));

let app: Express;

/**
 * Every bound parameter value, in order, of the drizzle SQL object passed to
 * db.execute. drizzle's sql`` tag stores literal SQL text as StringChunk objects
 * (whose `value` is a string[]) and interpolated values as the raw value itself.
 */
function executedParams(callIndex = 0): unknown[] {
  const arg = mockDbExecute.mock.calls[callIndex]?.[0] as { queryChunks?: unknown[] } | undefined;
  const isStringChunk = (c: unknown): boolean =>
    typeof c === "object" && c !== null && Array.isArray((c as { value?: unknown }).value);
  return (arg?.queryChunks ?? []).filter((c) => !isStringChunk(c));
}

/**
 * The four consecutive pricing params of the catalog-import INSERT, in the
 * order the VALUES list binds them: price, base_price, max_price, price_cents.
 * Asserting the whole window (rather than just "contains 12900") also fails
 * loudly if a column is ever inserted ahead of them, which is exactly when the
 * derivation needs re-checking.
 */
function importPricingParams(callIndex = 0): unknown[] {
  return executedParams(callIndex).slice(8, 12);
}

beforeEach(async () => {
  vi.clearAllMocks();

  mockSet.mockReturnValue({
    where: vi.fn().mockReturnValue({ returning: vi.fn().mockResolvedValue([{ id: 1, priceCents: 12_900 }]) }),
  });
  mockDbUpdate.mockReturnValue({ set: mockSet });
  mockDbExecute.mockResolvedValue({ rowCount: 1 });

  app = express();
  app.use(express.json());

  const { default: adminServicesRouter } = await import("./admin-services");
  app.use("/api", adminServicesRouter);
});

/** Minimal valid body shaped like the admin catalog editor's real payload. */
const editorBody = {
  name: "MSP Platform — Growth",
  slug: "msp-platform-growth",
  price: "129.00",
  basePrice: null,
  maxPrice: null,
  visibility: "public",
  isPublic: true,
  billingType: "recurring_monthly",
  serviceType: "platform_subscription_tier",
};

describe("PUT /api/admin/services/:id — canonical cents columns", () => {
  it("leaves price_cents untouched when the body omits it (the catalog editor's payload)", async () => {
    const res = await request(app)
      .put("/api/admin/services/1")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send(editorBody);

    expect(res.status).toBe(200);
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>;
    // The whole point: absent key must NOT become a NULL write.
    expect(setArg).not.toHaveProperty("priceCents");
    expect(setArg).not.toHaveProperty("internalCostCents");
    expect(setArg).not.toHaveProperty("annualPriceCents");
    // The fields the editor DOES send still round-trip as before.
    expect(setArg["price"]).toBe("129.00");
    expect(setArg["name"]).toBe("MSP Platform — Growth");
  });

  it("still writes price_cents when the body supplies it", async () => {
    const res = await request(app)
      .put("/api/admin/services/1")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ ...editorBody, priceCents: 12_900, internalCostCents: 9_000, annualPriceCents: 129_000 });

    expect(res.status).toBe(200);
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg["priceCents"]).toBe(12_900);
    expect(setArg["internalCostCents"]).toBe(9_000);
    expect(setArg["annualPriceCents"]).toBe(129_000);
  });

  it("still clears price_cents on an explicit null (deliberate unset)", async () => {
    const res = await request(app)
      .put("/api/admin/services/1")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ ...editorBody, priceCents: null });

    expect(res.status).toBe(200);
    const setArg = mockSet.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(setArg).toHaveProperty("priceCents");
    expect(setArg["priceCents"]).toBeNull();
  });
});

describe("POST /api/admin/catalog/import — derives price_cents", () => {
  it("derives price_cents from a legacy `price` in dollars", async () => {
    const res = await request(app)
      .post("/api/admin/catalog/import")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({
        services: [{
          name: "MSP Platform — Growth", slug: "msp-platform-growth",
          serviceClass: "subscription", deliveryType: "bundle_subscription",
          fulfillmentType: "msp_monthly_subscription", billingType: "recurring_monthly",
          serviceType: "platform_subscription_tier", price: 129,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    // price, base_price, max_price, price_cents
    expect(importPricingParams()).toEqual([129, null, null, 12_900]);
  });

  it("derives price_cents from `basePrice` when `price` is absent (the assessment shape)", async () => {
    const res = await request(app)
      .post("/api/admin/catalog/import")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({
        services: [{
          name: "M365 Security Assessment", slug: "m365-security-assessment",
          deliveryType: "assessment", billingType: "one_time",
          serviceType: "assessment", basePrice: 250,
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(importPricingParams()).toEqual([null, 250, null, 25_000]);
  });

  it("derives NULL (not NaN) when the record carries no usable price", async () => {
    const res = await request(app)
      .post("/api/admin/catalog/import")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({
        services: [{
          name: "Example Monitoring Tier", slug: "example-monitoring-tier",
          serviceClass: "subscription", deliveryType: "bundle_subscription",
          billingType: "recurring_monthly", serviceType: "monitoring_tier",
          typeAttributes: { pricePerUserMonth: "8.00" },
        }],
      });

    expect(res.status).toBe(200);
    expect(res.body.imported).toBe(1);
    expect(importPricingParams()).toEqual([null, null, null, null]);
    expect(executedParams().some((p) => typeof p === "number" && Number.isNaN(p))).toBe(false);
  });
});
