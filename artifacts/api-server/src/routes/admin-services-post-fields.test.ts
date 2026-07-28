/**
 * admin-services-post-fields.test.ts
 *
 * Regression test for the Simulator Assessments Phase 5 (#28) creation-wizard
 * gap: POST /api/admin/services silently dropped `category`, `basePrice`,
 * `maxPrice`, `sortOrder`, `tagline`, and `bestFor` — all real columns on
 * servicesTable — so a wizard-created assessment landed with category = NULL,
 * invisible to every existing category='assessment' query (including the
 * Simulator's own admin-simulator-assessments.ts). `description`,
 * `isFreeOffering`, and `allowFreeCheckout` were found missing from the same
 * handler while fixing this and are covered here too — the wizard's Step 1
 * needs all three to create a correctly-flagged free/paid assessment.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const { mockDbInsert, mockValues, mockReturning } = vi.hoisted(() => ({
  mockDbInsert: vi.fn(),
  mockValues: vi.fn(),
  mockReturning: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    insert: mockDbInsert,
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue({ orderBy: vi.fn().mockResolvedValue([]) }) }),
    update: vi.fn(),
    delete: vi.fn(),
  },
  servicesTable: { id: "id", slug: "slug" },
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

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();

  mockReturning.mockResolvedValue([{ id: 42, priceCents: null, internalCostCents: null }]);
  mockValues.mockReturnValue({ returning: mockReturning });
  mockDbInsert.mockReturnValue({ values: mockValues });

  app = express();
  app.use(express.json());

  const { default: adminServicesRouter } = await import("./admin-services");
  app.use("/api", adminServicesRouter);
});

/** A wizard Step 1 payload for a new paid assessment, mirroring what
 *  AssessmentCreationWizard.tsx sends. */
const wizardBody = {
  name: "New Test Assessment",
  slug: "new-test-assessment",
  description: "A wizard-created assessment.",
  category: "assessment",
  tagline: "Find what's broken before it costs you.",
  bestFor: "Mid-market IT teams",
  basePrice: "500",
  maxPrice: "750",
  sortOrder: 22,
  isFreeOffering: false,
  allowFreeCheckout: false,
  typeAttributes: { packageKey: "assess:new-test" },
};

describe("POST /api/admin/services — six-field catalog gap + free-offering fields", () => {
  it("persists category, basePrice, maxPrice, sortOrder, tagline, and bestFor", async () => {
    const res = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send(wizardBody);

    expect(res.status).toBe(201);
    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues["category"]).toBe("assessment");
    expect(insertedValues["basePrice"]).toBe("500");
    expect(insertedValues["maxPrice"]).toBe("750");
    expect(insertedValues["sortOrder"]).toBe(22);
    expect(insertedValues["tagline"]).toBe(wizardBody.tagline);
    expect(insertedValues["bestFor"]).toBe(wizardBody.bestFor);
  });

  it("persists description, isFreeOffering, and allowFreeCheckout", async () => {
    const res = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send(wizardBody);

    expect(res.status).toBe(201);
    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues["description"]).toBe(wizardBody.description);
    expect(insertedValues["isFreeOffering"]).toBe(false);
    expect(insertedValues["allowFreeCheckout"]).toBe(false);
  });

  it("defaults sortOrder to 0 and category to null when the body omits them (old callers unaffected)", async () => {
    const res = await request(app)
      .post("/api/admin/services")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ name: "Minimal Service", slug: "minimal-service" });

    expect(res.status).toBe(201);
    const insertedValues = mockValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(insertedValues["category"]).toBeNull();
    expect(insertedValues["sortOrder"]).toBe(0);
    expect(insertedValues["tagline"]).toBeNull();
    expect(insertedValues["bestFor"]).toBeNull();
    // allowFreeCheckout is intentionally omitted (not set to false/null) when
    // absent, so the notNull DB default (true) applies rather than a naive
    // Boolean(undefined) write forcing it false on every unrelated caller.
    expect(insertedValues).not.toHaveProperty("allowFreeCheckout");
  });
});
