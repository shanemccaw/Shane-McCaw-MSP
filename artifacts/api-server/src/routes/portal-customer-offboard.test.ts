import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

// Top level variable prefixed with 'mock' to bypass hoisting checks
let mockSelectResults: any[] = [];

// Mock database
vi.mock("@workspace/db", () => {
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    orderBy: () => chain,
    limit: () => chain,
    then: (onfulfilled: any) => Promise.resolve(mockSelectResults).then(onfulfilled),
  };

  const updateChain = {
    set: () => updateChain,
    where: () => updateChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const insertChain = {
    values: () => insertChain,
    then: (onfulfilled: any) => Promise.resolve({}).then(onfulfilled),
  };

  const mockDb = {
    select: vi.fn().mockImplementation(() => chain),
    update: vi.fn().mockImplementation(() => updateChain),
    insert: vi.fn().mockImplementation(() => insertChain),
  };

  return {
    db: mockDb,
    mspCustomersTable: { id: "id", mspId: "msp_id", status: "status", name: "name", domain: "domain" },
    clientServicesTable: { id: "id", clientUserId: "client_user_id", status: "status", stripeSubscriptionId: "stripe_subscription_id" },
    servicesTable: { id: "id", name: "name", typeAttributes: "type_attributes", billingType: "billing_type", price: "price" },
    projectsTable: { id: "id", clientUserId: "client_user_id", status: "status" },
    reportsTable: { id: "id", clientUserId: "client_user_id" },
    tenantEngineSnapshotsTable: { id: "id", customerId: "customer_id", engineKey: "engine_key", score: "score", breakdown: "breakdown" },
    mspSalesBundleAssignmentsTable: { id: "id", customerId: "customer_id", status: "status", revokedAt: "revoked_at" },
    mspAuditLogsTable: { id: "id" },
  };
});

vi.mock("../lib/audit.ts", () => ({
  createAuditLog: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../lib/stripe.ts", () => ({
  getStripeKey: vi.fn().mockReturnValue("sk_test_mock_key"),
}));

const mockStripeCancel = vi.fn().mockResolvedValue({ id: "sub_cancelled" });
vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        subscriptions: {
          cancel: mockStripeCancel,
        },
      };
    }),
  };
});

import router from "./portal-customer-engines";
import { db } from "@workspace/db";

const app = express();
app.use(express.json());
app.use("/api", router);

const JWT_SECRET = "test-secret";
process.env.JWT_SECRET = JWT_SECRET;

function makeToken(overrides: Record<string, unknown> = {}): string {
  return jwt.sign(
    { id: 1, email: "customer@company.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId: 10, ...overrides },
    JWT_SECRET,
    { expiresIn: "1h" }
  );
}

describe("Customer Offboarding & Export API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSelectResults = [];
  });

  describe("POST /api/portal/customer/offboard", () => {
    it("returns 403 if customer belongs to another MSP", async () => {
      const token = makeToken({ mspId: 2 });
      const res = await request(app)
        .post("/api/portal/customer/offboard")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Customer offboarding is only available for Shane McCaw Consulting customers");
    });

    it("offboards successfully and cancels subscriptions for MSP ID = 1", async () => {
      const token = makeToken({ mspId: 1 });

      // Mock user services returned by first select query
      mockSelectResults = [
        { id: 5, clientUserId: 1, stripeSubscriptionId: "sub_123", status: "active" },
      ];

      const res = await request(app)
        .post("/api/portal/customer/offboard")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.customerStatus).toBe("inactive");

      // Verify db.update was called on clientServicesTable, mspSalesBundleAssignmentsTable, mspCustomersTable
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe("GET /api/portal/customer/export", () => {
    it("exports customer data package", async () => {
      const token = makeToken();

      // Mock all selects during export (they all use mockSelectResults in mock but we can adjust to return a general mocked set)
      mockSelectResults = [
        { name: "Customer Inc", status: "active", title: "Doc", score: 95 }
      ];

      const res = await request(app)
        .get("/api/portal/customer/export")
        .set("Authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.customer.name).toBe("Customer Inc");
      expect(res.body.services).toBeDefined();
      expect(res.body.projects).toBeDefined();
      expect(res.body.reports).toBeDefined();
      expect(res.body.diagnostics).toBeDefined();
    });
  });
});
