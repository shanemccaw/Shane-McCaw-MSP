import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for the dashboard_overrides customer/MSP-facing surface (GET
 * /resolved, PUT/DELETE /overrides). Mocks @workspace/db with a queueable
 * chain, same pattern as dashboard-templates.test.ts — each terminal query
 * shifts the next queued result off mockResultQueue.
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
    dashboardOverridesTable: tbl(["id", "templateId", "scopeType", "scopeId", "overrideLayout", "createdAt", "updatedAt"]),
    mspUsersTable: tbl(["id", "userId", "mspId", "customerId", "mspRole"]),
    DASHBOARD_TEMPLATE_TYPES: ["assessment", "project", "monitoring_package", "msp_overview", "customer_default"],
    DASHBOARD_OVERRIDE_SCOPE_TYPES: ["customer", "msp_user"],
  };
});

import router from "./dashboard-overrides";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function customerToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "c@co.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId: 10, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

function operatorToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 2, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId: 1, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const SAMPLE_LAYOUT = [
  { i: "w1", x: 0, y: 0, w: 2, h: 2, metricKey: "identity.disabledAccountCount", rendererType: "Stat" },
  { i: "w2", x: 2, y: 0, w: 3, h: 3, metricKey: "engine.healthScore", rendererType: "Gauge" },
];

function sampleTemplate(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    mspId: 1,
    templateType: "customer_default",
    targetKey: null,
    canvasLayout: SAMPLE_LAYOUT,
    allowCustomerEdit: true,
    isDefault: true,
    ...overrides,
  };
}

describe("dashboard-overrides API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultQueue = [];
  });

  // ── Auth ──
  it("401s without a token", async () => {
    const res = await request(app).get("/api/dashboard/resolved");
    expect(res.status).toBe(401);
  });

  it("403s a Free role below CustomerUser", async () => {
    const token = jwt.sign({ id: 9, email: "f@f.com", role: "client", mspRole: "Free", mspId: 1 }, JWT_SECRET, { expiresIn: "1h" });
    const res = await request(app).get("/api/dashboard/resolved").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
  });

  // ── GET /resolved ──
  it("resolves cleanly with 'no dashboard configured' when no template exists", async () => {
    mockResultQueue = [[]]; // findDefaultTemplate -> none
    const res = await request(app)
      .get("/api/dashboard/resolved")
      .set("Authorization", `Bearer ${customerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(false);
  });

  it("resolves a CustomerUser's dashboard with no override (template as-is)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [], // findOverride -> none
    ];
    const res = await request(app)
      .get("/api/dashboard/resolved")
      .set("Authorization", `Bearer ${customerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.editable).toBe(true);
    expect(res.body.widgets).toHaveLength(2);
    expect(res.body.hasOverride).toBe(false);
  });

  it("applies override deltas on top of the template (hide + reposition)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [{ id: 5, templateId: 100, scopeType: "customer", scopeId: 10, overrideLayout: { hidden: ["w1"], positions: { w2: { x: 0, y: 0, w: 4, h: 4 } } } }], // findOverride
    ];
    const res = await request(app)
      .get("/api/dashboard/resolved")
      .set("Authorization", `Bearer ${customerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.widgets).toHaveLength(1);
    expect(res.body.widgets[0].i).toBe("w2");
    expect(res.body.widgets[0].w).toBe(4);
    expect(res.body.hasOverride).toBe(true);
  });

  it("flags editable: false when allowCustomerEdit is false, but still resolves", async () => {
    mockResultQueue = [
      [sampleTemplate({ allowCustomerEdit: false })],
      [],
    ];
    const res = await request(app)
      .get("/api/dashboard/resolved")
      .set("Authorization", `Bearer ${customerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.editable).toBe(false);
    expect(res.body.widgets).toHaveLength(2);
  });

  it("resolves an MSPOperator's msp_overview dashboard via msp_users scope lookup", async () => {
    mockResultQueue = [
      [{ id: 42 }], // mspUsersTable lookup by userId -> msp_users.id
      [sampleTemplate({ templateType: "msp_overview" })], // findDefaultTemplate
      [], // findOverride -> none
    ];
    const res = await request(app)
      .get("/api/dashboard/resolved")
      .set("Authorization", `Bearer ${operatorToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.configured).toBe(true);
  });

  // ── PUT /overrides ──
  it("saves valid override deltas (create path)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [], // findOverride -> none
      [{ id: 7, templateId: 100, scopeType: "customer", scopeId: 10, overrideLayout: { hidden: ["w1"], positions: {} } }], // insert returning
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: ["w1"], positions: {} });
    expect(res.status).toBe(201);
    expect(res.body.override.id).toBe(7);
  });

  it("saves valid override deltas (update path)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [{ id: 7, templateId: 100, scopeType: "customer", scopeId: 10, overrideLayout: {} }], // findOverride -> existing
      [{ id: 7, templateId: 100, scopeType: "customer", scopeId: 10, overrideLayout: { hidden: [], positions: { w1: { x: 1, y: 1, w: 2, h: 2 } } } }], // update returning
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: { w1: { x: 1, y: 1, w: 2, h: 2 } } });
    expect(res.status).toBe(200);
    expect(res.body.override.id).toBe(7);
  });

  it("rejects a save naming a widget id not present in the template", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: ["not-a-real-widget"], positions: {} });
    expect(res.status).toBe(400);
    expect(res.body.invalidWidgetIds).toContain("not-a-real-widget");
  });

  it("rejects a save naming an unknown widget id in positions", async () => {
    mockResultQueue = [
      [sampleTemplate()],
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: { "injected-widget": { x: 0, y: 0, w: 1, h: 1 } } });
    expect(res.status).toBe(400);
    expect(res.body.invalidWidgetIds).toContain("injected-widget");
  });

  it("rejects a save naming an unknown widget id in rendererTypes", async () => {
    mockResultQueue = [
      [sampleTemplate()],
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: {}, rendererTypes: { "injected-widget": "Bar" } });
    expect(res.status).toBe(400);
    expect(res.body.invalidWidgetIds).toContain("injected-widget");
  });

  it("saves a valid rendererType swap for an existing widget (Stat -> Gauge, both scalar)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [], // findOverride -> none
      [{ id: 7, templateId: 100, scopeType: "customer", scopeId: 10, overrideLayout: { hidden: [], positions: {}, rendererTypes: { w1: "Gauge" } } }], // insert returning
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: {}, rendererTypes: { w1: "Gauge" } });
    expect(res.status).toBe(201);
    expect(res.body.override.overrideLayout.rendererTypes).toEqual({ w1: "Gauge" });
  });

  it("rejects a rendererType incompatible with the widget's metric shape (Heatmap on a scalar metric)", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
    ];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: {}, rendererTypes: { w1: "Heatmap" } });
    expect(res.status).toBe(400);
    expect(res.body.incompatibleRendererTypes).toEqual([{ widgetId: "w1", rendererType: "Heatmap" }]);
  });

  it("404s a save when no template is configured", async () => {
    mockResultQueue = [[]];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: {} });
    expect(res.status).toBe(404);
  });

  it("403s a save when allowCustomerEdit is false", async () => {
    mockResultQueue = [[sampleTemplate({ allowCustomerEdit: false })]];
    const res = await request(app)
      .put("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`)
      .send({ hidden: [], positions: {} });
    expect(res.status).toBe(403);
  });

  // ── DELETE /overrides (reset) ──
  it("resets (deletes) the caller's override", async () => {
    mockResultQueue = [
      [sampleTemplate()], // findDefaultTemplate
      [], // delete returning (unused by handler but keeps queue consistent)
    ];
    const res = await request(app)
      .delete("/api/dashboard/overrides")
      .set("Authorization", `Bearer ${customerToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});
