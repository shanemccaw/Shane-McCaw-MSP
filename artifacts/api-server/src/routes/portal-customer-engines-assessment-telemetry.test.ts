/**
 * portal-customer-engines-assessment-telemetry.test.ts
 *
 * GitHub #161 follow-up: assessment-dashboard.tsx (an Assessment-role-accessible
 * page) was calling GET /api/portal/dashboard (requireRole("CustomerUser")) just
 * for telemetryStatus, so Assessment-tier tokens got a silent 403. This covers
 * the new GET /api/portal/assessment/telemetry route: it must be reachable by
 * an Assessment-role token, must apply the same #164 findings/recommendations
 * redaction as /portal/dashboard, and must NEVER include any CustomerUser
 * account-aggregate field (projects, invoices, clientServices, notifications,
 * messages, mspId, customerStatus).
 *
 * The DB is mocked with a FIFO queue mirroring the route's query order:
 *   1. tenantEngineSnapshotsTable  (engine snapshots -> findings/recommendations)
 *   2. assessmentSowAgreementsTable (paid/free_activated check)
 *   3. tenantsTable (customer status -> telemetryStatus)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "portal-customer-engines-telemetry-test-secret";
process.env["JWT_SECRET"] = JWT_SECRET;

let mockResultQueue: any[][] = [];

vi.mock("@workspace/db", () => {
  function makeChain() {
    const chain: any = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (onFulfilled: any, onRejected: any) =>
        Promise.resolve(mockResultQueue.shift() ?? []).then(onFulfilled, onRejected),
    };
    return chain;
  }
  const tbl = (cols: string[]) => Object.fromEntries(cols.map((c) => [c, c]));
  return {
    db: { select: vi.fn(() => makeChain()) },
    tenantEngineSnapshotsTable: tbl(["customerId", "engineKey", "score", "breakdown", "runId", "capturedAt"]),
    tenantsTable: tbl(["id", "status"]),
    clientServicesTable: tbl(["clientUserId", "serviceId", "status", "purchasedAt"]),
    servicesTable: tbl(["id", "typeAttributes", "name", "billingType", "price"]),
    projectsTable: tbl(["clientUserId", "status", "updatedAt"]),
    kanbanTasksTable: tbl(["id", "title", "order", "column", "projectId"]),
    invoicesTable: tbl(["clientUserId", "createdAt"]),
    reportsTable: tbl(["clientUserId", "createdAt"]),
    notificationsTable: tbl(["userId", "read"]),
    messagesTable: tbl(["clientUserId", "readByClient"]),
    mspSalesBundleAssignmentsTable: tbl(["customerId", "mspId", "status"]),
    mspAuditLogsTable: tbl(["id"]),
    assessmentSowAgreementsTable: tbl(["id", "clientUserId", "status"]),
  };
});

vi.mock("drizzle-orm", () => ({
  eq: (c: unknown, v: unknown) => ({ eq: [c, v] }),
  and: (...args: unknown[]) => ({ and: args }),
  or: (...args: unknown[]) => ({ or: args }),
  desc: (c: unknown) => ({ desc: c }),
  asc: (c: unknown) => ({ asc: c }),
  inArray: (c: unknown, v: unknown) => ({ inArray: [c, v] }),
  count: () => ({ count: true }),
}));

vi.mock("../lib/logger", () => {
  const stub = { info: vi.fn(), error: vi.fn(), debug: vi.fn(), warn: vi.fn() };
  return { logger: { ...stub, child: vi.fn(() => stub) } };
});

vi.mock("../lib/audit", () => ({ createAuditLog: vi.fn() }));
vi.mock("../lib/stripe", () => ({ getStripeKey: vi.fn(() => "sk_test") }));
vi.mock("../lib/sla-engine", () => ({ runSlaEngineForTenant: vi.fn() }));
vi.mock("../lib/scope-creep-engine", () => ({ runScopeCreepEngineForTenant: vi.fn() }));
vi.mock("../lib/request-context.ts", () => ({
  getRequestContext: vi.fn(() => ({})),
  enrichRequestContext: vi.fn(),
}));

import router from "./portal-customer-engines";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

function assessmentToken(customerId = 10, id = 1): string {
  return jwt.sign(
    { id, email: "prospect@test.com", role: "client", mspRole: "Assessment", mspId: 1, customerId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const SECRET_FINDING_TEXT = "SECRET_FINDING__admin consent granted to unverified app";
const SECRET_RECOMMENDATION_TEXT = "SECRET_RECOMMENDATION__revoke the unverified app grant";

function queueSnapshot() {
  mockResultQueue.push([
    {
      engineKey: "security",
      score: 42,
      breakdown: [{ finding: SECRET_FINDING_TEXT, recommendation: SECRET_RECOMMENDATION_TEXT }],
      runId: "run-1",
      capturedAt: new Date("2026-07-01T00:00:00Z"),
    },
  ]);
}

beforeEach(() => {
  mockResultQueue = [];
});

describe("GET /api/portal/assessment/telemetry", () => {
  it("is reachable by an Assessment-role token (no 403)", async () => {
    queueSnapshot();
    mockResultQueue.push([]); // assessmentSowAgreementsTable: unpaid
    mockResultQueue.push([{ status: "active" }]); // tenantsTable

    const res = await request(makeApp())
      .get("/api/portal/assessment/telemetry")
      .set("Authorization", `Bearer ${assessmentToken()}`);

    expect(res.status).toBe(200);
  });

  it("redacts findings/recommendations for an unpaid customer, keeps scores", async () => {
    queueSnapshot();
    mockResultQueue.push([]); // unpaid
    mockResultQueue.push([{ status: "active" }]);

    const res = await request(makeApp())
      .get("/api/portal/assessment/telemetry")
      .set("Authorization", `Bearer ${assessmentToken()}`);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SECRET_FINDING_TEXT);
    expect(raw).not.toContain(SECRET_RECOMMENDATION_TEXT);

    expect(res.body.results.pillars.security.findings).toBeUndefined();
    expect(res.body.results.pillars.security.findingsCount).toBe(1);
    expect(res.body.results.pillars.security.score).toBe(42);
    expect(res.body.results.summary.compositeScore).toBe(42);
  });

  it("passes through findings/recommendations for a paid customer", async () => {
    queueSnapshot();
    mockResultQueue.push([{ id: 999 }]); // paid
    mockResultQueue.push([{ status: "active" }]);

    const res = await request(makeApp())
      .get("/api/portal/assessment/telemetry")
      .set("Authorization", `Bearer ${assessmentToken()}`);

    expect(res.body.results.pillars.security.findings).toEqual([SECRET_FINDING_TEXT]);
    expect(res.body.results.pillars.security.recommendations).toEqual([SECRET_RECOMMENDATION_TEXT]);
  });

  it("reports telemetryStatus=in_progress and results.status=running while onboarding", async () => {
    queueSnapshot();
    mockResultQueue.push([]);
    mockResultQueue.push([{ status: "onboarding" }]);

    const res = await request(makeApp())
      .get("/api/portal/assessment/telemetry")
      .set("Authorization", `Bearer ${assessmentToken()}`);

    expect(res.body.telemetryStatus).toBe("in_progress");
    expect(res.body.results.status).toBe("running");
  });

  it("never includes CustomerUser account-aggregate fields", async () => {
    queueSnapshot();
    mockResultQueue.push([]);
    mockResultQueue.push([{ status: "active" }]);

    const res = await request(makeApp())
      .get("/api/portal/assessment/telemetry")
      .set("Authorization", `Bearer ${assessmentToken()}`);

    expect(res.body.projects).toBeUndefined();
    expect(res.body.invoices).toBeUndefined();
    expect(res.body.clientServices).toBeUndefined();
    expect(res.body.reports).toBeUndefined();
    expect(res.body.unreadNotifications).toBeUndefined();
    expect(res.body.unreadMessages).toBeUndefined();
    expect(res.body.customerStatus).toBeUndefined();
    expect(res.body.mspId).toBeUndefined();
    expect(res.body.type_attributes).toBeUndefined();
    expect(res.body.scores).toBeUndefined();
  });
});
