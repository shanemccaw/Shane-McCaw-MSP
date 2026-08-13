import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

/**
 * Tests for the dashboard_templates CRUD surface — the /api/admin/* routes
 * (PlatformAdmin-only, explicit mspId) and the /api/msp/* routes
 * (MSPAdmin/MSPOperator, always their own mspId). Mocks @workspace/db with a
 * queueable chain, same pattern as dashboard-data.test.ts — each terminal
 * query shifts the next queued result.
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
    servicesTable: tbl(["id", "slug", "name", "serviceClass", "deliveryType", "billingType", "fulfillmentType", "sortOrder", "createdAt"]),
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

function operatorToken(mspId = 1): string {
  return jwt.sign({ id: 2, email: "op@msp.com", role: "client", mspRole: "MSPOperator", mspId }, JWT_SECRET, { expiresIn: "1h" });
}

function mspAdminToken(mspId = 1): string {
  return jwt.sign({ id: 3, email: "admin@msp.com", role: "client", mspRole: "MSPAdmin", mspId }, JWT_SECRET, { expiresIn: "1h" });
}

function customerUserToken(): string {
  return jwt.sign({ id: 4, email: "user@customer.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId: 10 }, JWT_SECRET, { expiresIn: "1h" });
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

describe("dashboard-templates API — /api/msp/* (own-mspId scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultQueue = [];
  });

  it("403s CustomerUser on the msp routes (MSPOperator or above required)", async () => {
    const res = await request(app)
      .get("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${customerUserToken()}`);
    expect(res.status).toBe(403);
  });

  it("MSPOperator lists templates scoped to their own mspId, ignoring no explicit param", async () => {
    mockResultQueue = [[{ id: 1, mspId: 1, templateType: "msp_overview", targetKey: null, canvasLayout: SAMPLE_LAYOUT }]];
    const res = await request(app)
      .get("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
  });

  it("MSPAdmin can also use the msp routes (role hierarchy admits MSPAdmin)", async () => {
    mockResultQueue = [[{ id: 1, mspId: 7, templateType: "msp_overview", targetKey: null, canvasLayout: SAMPLE_LAYOUT }]];
    const res = await request(app)
      .get("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${mspAdminToken(7)}`);
    expect(res.status).toBe(200);
  });

  it("403s an MSPOperator supplying a foreign mspId on list", async () => {
    const res = await request(app)
      .get("/api/msp/dashboard-templates?mspId=999")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(403);
  });

  it("403s an MSPOperator supplying a foreign mspId on save", async () => {
    const res = await request(app)
      .post("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${operatorToken(1)}`)
      .send({ mspId: 999, templateType: "msp_overview", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(403);
  });

  it("MSPOperator saves a template scoped to their own mspId", async () => {
    mockResultQueue = [
      [], // existing lookup -> none
      [{ id: 5, mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT, allowCustomerEdit: true, isDefault: false }],
    ];
    const res = await request(app)
      .post("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${operatorToken(1)}`)
      .send({ mspId: 1, templateType: "monitoring_package", targetKey: "core-security", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(201);
    expect(res.body.template.mspId).toBe(1);
  });

  it("MSPOperator saves without supplying mspId at all (derived from session)", async () => {
    mockResultQueue = [
      [],
      [{ id: 6, mspId: 1, templateType: "msp_overview", targetKey: null, canvasLayout: SAMPLE_LAYOUT, allowCustomerEdit: true, isDefault: false }],
    ];
    const res = await request(app)
      .post("/api/msp/dashboard-templates")
      .set("Authorization", `Bearer ${operatorToken(1)}`)
      .send({ mspId: 1, templateType: "msp_overview", canvasLayout: SAMPLE_LAYOUT });
    expect(res.status).toBe(201);
  });

  it("403s deleting another MSP's template", async () => {
    mockResultQueue = [[{ id: 5, mspId: 999 }]];
    const res = await request(app)
      .delete("/api/msp/dashboard-templates/5")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(403);
  });

  it("deletes own MSP's template", async () => {
    mockResultQueue = [
      [{ id: 5, mspId: 1 }], // ownership lookup
      [{ id: 5 }], // delete returning
    ];
    const res = await request(app)
      .delete("/api/msp/dashboard-templates/5")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("PlatformAdmin's explicit-param /api/admin flow is unaffected by the msp branch", async () => {
    mockResultQueue = [[{ id: 1, mspId: 42, templateType: "msp_overview", targetKey: null, canvasLayout: SAMPLE_LAYOUT }]];
    const res = await request(app)
      .get("/api/admin/dashboard-templates?mspId=42")
      .set("Authorization", `Bearer ${platformAdminToken()}`);
    expect(res.status).toBe(200);
    expect(res.body.templates).toHaveLength(1);
  });
});

describe("dashboard-templates API — GET /api/msp/services", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResultQueue = [];
  });

  it("403s CustomerUser", async () => {
    const res = await request(app)
      .get("/api/msp/services")
      .set("Authorization", `Bearer ${customerUserToken()}`);
    expect(res.status).toBe(403);
  });

  it("lists services filtered by type=assessment", async () => {
    mockResultQueue = [
      [
        { id: 1, slug: "m365-assessment", name: "M365 Assessment", serviceClass: null, deliveryType: "assessment", billingType: "one_time", fulfillmentType: null },
        { id: 2, slug: "migration-project", name: "Migration Project", serviceClass: null, deliveryType: null, billingType: "one_time", fulfillmentType: null },
      ],
    ];
    const res = await request(app)
      .get("/api/msp/services?type=assessment")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(200);
    expect(res.body.services).toHaveLength(1);
    expect(res.body.services[0].slug).toBe("m365-assessment");
  });

  it("400s an invalid type", async () => {
    const res = await request(app)
      .get("/api/msp/services?type=bogus")
      .set("Authorization", `Bearer ${operatorToken(1)}`);
    expect(res.status).toBe(400);
  });
});
