/**
 * admin-document-generator.test.ts
 *
 * Regression tests for GET /admin/document-generator/missing-types
 * (Document Generator IDE Phase 4) — services flagged for
 * delivery_type = 'document_generation' with no matching document_types row —
 * and for GET /admin/document-generator/history's cost column (#53, parent
 * #48): the route joins ai_usage_events via generatedArtifactId/Type and must
 * pass a null costCents (no matching usage event) through as null, never a
 * fabricated 0.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

let selectResult: unknown[] = [];

// Chain depth varies by route (missing-types: 1 leftJoin + where + orderBy;
// history: 4 leftJoins + where + orderBy + limit) — a single self-returning,
// thenable chain object supports every route's query shape without a mock
// change per route.
function makeQueryChain(): unknown {
  const chain: Record<string, unknown> = {
    from: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(selectResult).then(resolve, reject),
  };
  return chain;
}

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => makeQueryChain()),
  },
  documentTypesTable: { id: "id", serviceId: "service_id", key: "key", label: "label" },
  insightsGeneratedDocumentsTable: { id: "id", docType: "doc_type" },
  projectsTable: {},
  servicesTable: { id: "id", name: "name", description: "description", slug: "slug", deliveryType: "delivery_type" },
  usersTable: {},
  aiUsageEventsTable: { generatedArtifactId: "generated_artifact_id", generatedArtifactType: "generated_artifact_type", costCents: "cost_cents" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/document-engine.ts", () => ({ generateDocument: vi.fn() }));
vi.mock("../lib/document-engine-sow.ts", () => ({ generateSowDocument: vi.fn() }));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: {},
  withAiAttribution: (_ctx: unknown, fn: () => unknown) => fn(),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  selectResult = [];

  app = express();
  app.use(express.json());
  const { default: router } = await import("./admin-document-generator");
  app.use("/api", router);
});

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

describe("GET /admin/document-generator/missing-types", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/document-generator/missing-types");
    expect(res.status).toBe(401);
  });

  it("returns services with no matching document_types row", async () => {
    selectResult = [
      { id: 12, name: "Email Security Audit", description: "Automated email security report", slug: "email-security-audit" },
      { id: 19, name: "License Waste Report", description: null, slug: null },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(selectResult);
  });

  it("returns an empty list when every document-generation service is covered", async () => {
    selectResult = [];
    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns 500 on a query failure", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await auth(request(app).get("/api/admin/document-generator/missing-types"));
    expect(res.status).toBe(500);
  });
});

describe("GET /admin/document-generator/history", () => {
  it("requires authentication", async () => {
    const res = await request(app).get("/api/admin/document-generator/history");
    expect(res.status).toBe(401);
  });

  it("passes through a recorded cost from the ai_usage_events join", async () => {
    selectResult = [
      { id: 1, docType: "sow", category: "consulting", title: "Acme SOW", status: "approved", errorMessage: null, createdAt: "2026-07-29T00:00:00Z", customerId: 5, customerName: "Jane", customerCompany: "Acme", projectId: 1, projectTitle: "Acme Project", docTypeLabel: "SOW", costCents: 350 },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(selectResult);
    expect(res.body[0].costCents).toBe(350);
  });

  it("passes through a null cost for a document with no matching usage event, not a fabricated 0", async () => {
    selectResult = [
      { id: 2, docType: "assessment_report", category: "report", title: "Old Report", status: "approved", errorMessage: null, createdAt: "2026-01-01T00:00:00Z", customerId: 5, customerName: "Jane", customerCompany: "Acme", projectId: null, projectTitle: null, docTypeLabel: "Assessment Report", costCents: null },
    ];

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(200);
    expect(res.body[0].costCents).toBeNull();
  });

  it("returns 500 on a query failure", async () => {
    const { db } = await import("@workspace/db");
    (db.select as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
      throw new Error("db down");
    });

    const res = await auth(request(app).get("/api/admin/document-generator/history"));
    expect(res.status).toBe(500);
  });
});
