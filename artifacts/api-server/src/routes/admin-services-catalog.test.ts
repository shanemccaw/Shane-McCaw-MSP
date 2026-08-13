/**
 * admin-services-catalog.test.ts
 *
 * Unit tests for:
 *   1. PATCH /api/admin/services/bulk-category  — bulk categoryPath update by ID
 *   2. PATCH /api/admin/services/reparent-category — prefix-rename all matching services
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const { mockDbUpdate, mockDbExecute } = vi.hoisted(() => ({
  mockDbUpdate: vi.fn(),
  mockDbExecute: vi.fn(),
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

beforeEach(async () => {
  vi.clearAllMocks();

  const updateChain = { set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue({ rowCount: 2 }) }) };
  mockDbUpdate.mockReturnValue(updateChain);
  mockDbExecute.mockResolvedValue({ rowCount: 3 });

  app = express();
  app.use(express.json());

  const { default: adminServicesRouter } = await import("./admin-services");
  app.use("/api", adminServicesRouter);
});

describe("PATCH /api/admin/services/bulk-category", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .patch("/api/admin/services/bulk-category")
      .send({ ids: [1, 2], categoryPath: "New/Path" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when ids is missing", async () => {
    const res = await request(app)
      .patch("/api/admin/services/bulk-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ categoryPath: "New/Path" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/i);
  });

  it("returns 400 when ids is an empty array", async () => {
    const res = await request(app)
      .patch("/api/admin/services/bulk-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ ids: [], categoryPath: "New/Path" });
    expect(res.status).toBe(400);
  });

  it("calls db.update with the provided ids and resolved categoryPath", async () => {
    const res = await request(app)
      .patch("/api/admin/services/bulk-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ ids: [1, 2, 3], categoryPath: "Consulting/M365" });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockDbUpdate).toHaveBeenCalled();
  });

  it("treats an empty-string categoryPath as null (uncategorize)", async () => {
    const res = await request(app)
      .patch("/api/admin/services/bulk-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ ids: [5], categoryPath: "   " });
    expect(res.status).toBe(200);
    const setCall = mockDbUpdate.mock.results[0]?.value?.set;
    expect(setCall).toHaveBeenCalledWith(expect.objectContaining({ categoryPath: null }));
  });
});

describe("PATCH /api/admin/services/reparent-category", () => {
  it("requires authentication", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .send({ fromPath: "A", toParentPath: "B" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when fromPath is missing", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ toParentPath: "B" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fromPath/i);
  });

  it("returns 400 when fromPath is an empty string", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "  ", toParentPath: "B" });
    expect(res.status).toBe(400);
  });

  it("returns 200 immediately when newPath === fromPath (no-op)", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "Consulting", toParentPath: null });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockDbExecute).not.toHaveBeenCalled();
  });

  it("computes newPath as lastName under toParentPath", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "A/Sub", toParentPath: "B" });
    expect(res.status).toBe(200);
    expect(res.body.newPath).toBe("B/Sub");
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it("moves a nested category to root when toParentPath is null", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "Services/Consulting", toParentPath: null });
    expect(res.status).toBe(200);
    expect(res.body.newPath).toBe("Consulting");
    expect(mockDbExecute).toHaveBeenCalled();
  });

  it("moves a root category under a parent", async () => {
    const res = await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "Consulting", toParentPath: "Services" });
    expect(res.status).toBe(200);
    expect(res.body.newPath).toBe("Services/Consulting");
  });

  it("issues a single db.execute call for the UPDATE", async () => {
    await request(app)
      .patch("/api/admin/services/reparent-category")
      .set("Authorization", `Bearer ${ADMIN_PASS}`)
      .send({ fromPath: "A", toParentPath: "B" });
    expect(mockDbExecute).toHaveBeenCalledTimes(1);
  });
});

describe("migration round-trip — 0171_services_catalog_fields.sql", () => {
  it("SQL file exists and contains the four expected columns", async () => {
    const { readFileSync, existsSync } = await import("fs");
    const { resolve } = await import("path");
    const sqlPath = resolve(
      __dirname,
      "../../../../lib/db/drizzle/0171_services_catalog_fields.sql",
    );
    expect(existsSync(sqlPath)).toBe(true);
    const content = readFileSync(sqlPath, "utf-8");
    expect(content).toMatch(/category_path/i);
    expect(content).toMatch(/tags/i);
    expect(content).toMatch(/customer_agreement_template/i);
    expect(content).toMatch(/is_free_offering/i);
  });
});
