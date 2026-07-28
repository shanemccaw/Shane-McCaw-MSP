/**
 * admin-document-generator.test.ts
 *
 * Regression tests for GET /admin/document-generator/missing-types
 * (Document Generator IDE Phase 4) — services flagged for
 * delivery_type = 'document_generation' with no matching document_types row.
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

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        leftJoin: vi.fn(() => ({
          where: vi.fn(() => ({
            orderBy: vi.fn(() => Promise.resolve(selectResult)),
          })),
        })),
      })),
    })),
  },
  documentTypesTable: { id: "id", serviceId: "service_id" },
  insightsGeneratedDocumentsTable: {},
  projectsTable: {},
  servicesTable: { id: "id", name: "name", description: "description", slug: "slug", deliveryType: "delivery_type" },
  usersTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/document-engine.ts", () => ({ generateDocument: vi.fn() }));
vi.mock("../lib/document-engine-sow.ts", () => ({ generateSowDocument: vi.fn() }));

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
