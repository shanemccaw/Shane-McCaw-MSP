import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for the dashboard_templates CRUD surface (PlatformAdmin-only).
 * Mocks @workspace/db with a queueable chain, same pattern as
 * dashboard-data.test.ts — each terminal query shifts the next queued result.
 */

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      set: () => chain,
      values: () => chain,
      returning: () => Promise.resolve(mockResultQueue.shift() ?? []),
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }

  const mockDb = {
    select: vi.fn(() => makeChain()),
    insert: vi.fn(() => makeChain()),
    update: vi.fn(() => makeChain()),
    delete: vi.fn(() => makeChain()),
  };

  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));

  return {
    db: mockDb,
    dashboardTemplatesTable: tbl(["id", "mspId", "templateType", "targetKey", "canvasLayout", "allowCustomerEdit", "isDefault", "createdAt", "updatedAt"]),
    DASHBOARD_TEMPLATE_TYPES: ["assessment", "project", "monitoring_package", "msp_overview", "customer_default"],
  };
});

import router from "./dashboard-templates";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function platformAdminToken(): string {
  return jwt.sign({ id: 1, email: "admin@platform.com", role: "admin", mspRole: "PlatformAdmin" }, JWT_SECRET, { expiresIn: "1h" });
}

function operatorToken(): string {
  return jwt.sign({ id: 2, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1 }, JWT_SECRET, { expiresIn: "1h" });
}

const SAMPLE_LAYOUT = [
  { i: "w1", x: 0, y: 0, w: 2, h: 2, metricKey: "identity.disabledAccountCount", rendererType: "Stat" },
];

describe("dashboard-templates API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultQueue = [];
  });

  it("401s without a token", async () => {
    const res = await request(app).get("/api/admin/dashboard-templates?mspId=1");
    expect(res.status).toBe(401);
  });

  it("403s a non-PlatformAdmin role (MSPOperator)", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard-templates?mspId=1")
      .set("Authorization", `Bearer ${operatorToken()}`);
    expect(res.status).toBe(403);
  });

  it("400s a list request with no mspId", async () => {
    const res = await request(app)
      .get("/api/admin/dashboard-templates")
      .set("Authorization", `Bearer ${platformAdminToken()}`);
    expect(res.status).toBe(400);
  });

  it("lists templates for an mspId", async () => {
    mockResultQueue = [[{ id: 1, mspId: 1, templateType: "msp_overview", targetKey: null, canvasLayout: SAMPLE_LAYOUT }]];
    const res = await request(app)
      .get("/api/admin/dashboard-templates?mspId=1")
      .set("Authorization", `Bearer ${platformAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
  });

  it("creates a new template (no existing row)", async () => {
    mockResultQueue = [
      [], // existing lookup -> none
      [{ id: 5, mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT, allowCustomerEdit: true, isDefault: false }], // insert returning
    ];
    const res = await request(app)
      .post("/api/admin/dashboard-templates")
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(201);
    expect(res.body.template.id).toBe(5);
  });

  it("updates an existing template (upsert by mspId+templateType+targetKey)", async () => {
    mockResultQueue = [
      [{ id: 5 }], // existing lookup -> found
      [{ id: 5, mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT, allowCustomerEdit: true, isDefault: false }], // update returning
    ];
    const res = await request(app)
      .post("/api/admin/dashboard-templates")
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(200);
    expect(res.body.template.id).toBe(5);
  });

  it("400s when a targetKey-required templateType has no targetKey", async () => {
    const res = await request(app)
      .post("/api/admin/dashboard-templates")
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ mspId: 1, templateType: "assessment", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(400);
  });

  it("400s when msp_overview carries a targetKey", async () => {
    const res = await request(app)
      .post("/api/admin/dashboard-templates")
      .set("Authorization", `Bearer ${platformAdminToken()}`)
      .send({ mspId: 1, templateType: "msp_overview", targetKey: "should-not-be-here", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(400);
  });

  it("deletes a template", async () => {
    mockResultQueue = [[{ id: 5 }]];
    const res = await request(app)
      .delete("/api/admin/dashboard-templates/5")
      .set("Authorization", `Bearer ${platformAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("404s deleting a nonexistent template", async () => {
    mockResultQueue = [[]];
    const res = await request(app)
      .delete("/api/admin/dashboard-templates/999")
      .set("Authorization", `Bearer ${platformAdminToken()}`);
    expect(res.status).toBe(404);
  });
});
