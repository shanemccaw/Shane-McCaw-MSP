/**
 * portal-customer-engines-assessment-redaction.test.ts
 *
 * GitHub #164 (Phase 3 of #161): GET /api/portal/dashboard must gate its
 * per-pillar findings[]/recommendations[] arrays server-side by whether the
 * customer has a paid/free_activated assessment SOW agreement — never a
 * client-side blur. Composite/pillar SCORES must always pass through
 * unredacted regardless of payment status.
 *
 * The DB is mocked with a FIFO queue mirroring the route's exact query order:
 *   1. tenantEngineSnapshotsTable  (engine snapshots -> findings/recommendations)
 *   2. assessmentSowAgreementsTable (paid/free_activated check — the new gate)
 *   3. mspDiagnosticFindingsTable (#2500: latest run id for priorityItems)
 *   4. mspDiagnosticFindingsTable (#2500: critical/warning findings for that run)
 *   5. clientServicesTable/servicesTable join (active services -> type_attributes)
 *   6. tenantsTable (customer status)
 *   7. projectsTable
 *   8. clientServicesTable/servicesTable join (clientServicesResult)
 *   9. invoicesTable
 *   10. reportsTable
 *   11. notificationsTable (unread count)
 *   12. messagesTable (unread count)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";

const JWT_SECRET = "portal-customer-engines-redaction-test-secret";
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
    mspDiagnosticFindingsTable: tbl([
      "runId", "customerId", "checkKey", "severity", "title", "description", "createdAt",
    ]),
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

// #1397: portal-customer-engines.ts now customer-scopes reads via this bridge.
// Stub to the single-login set so no extra DB select is issued and this file's
// mock queue expectations stay valid.
vi.mock("../lib/tenant-signals", () => ({
  resolveCustomerUserIds: async (id: number) => [id],
}));

import router from "./portal-customer-engines";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

function customerToken(customerId = 10, id = 1): string {
  return jwt.sign(
    { id, email: "customer@test.com", role: "client", mspRole: "CustomerUser", mspId: 1, customerId },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const SECRET_FINDING_TEXT = "SECRET_FINDING__admin consent granted to unverified app";
const SECRET_RECOMMENDATION_TEXT = "SECRET_RECOMMENDATION__revoke the unverified app grant";

// #2500: priorityItems' two reads (latest run id, then that run's critical/
// warning findings) — no findings by default, so existing callers that don't
// care about this field stay unaffected.
function queuePriorityItems() {
  // 3. latest finding's runId
  mockResultQueue.push([]);
  // (no 4th push: the route short-circuits to [] when no run is found)
}

function queueCommonTail() {
  // 5. activeServices (empty -> default type_attributes)
  mockResultQueue.push([]);
  // 6. tenantsTable customer status
  mockResultQueue.push([{ status: "active" }]);
  // 7. projectsTable
  mockResultQueue.push([]);
  // 8. clientServicesResult
  mockResultQueue.push([]);
  // 9. invoicesTable
  mockResultQueue.push([]);
  // 10. reportsTable
  mockResultQueue.push([]);
  // 11. notificationsTable unread count
  mockResultQueue.push([{ unread: 0 }]);
  // 12. messagesTable unread count
  mockResultQueue.push([{ unreadMessages: 0 }]);
}

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

describe("GET /api/portal/dashboard — assessment findings/recommendations paywall (#164)", () => {
  it("REDACTS findings/recommendations text for a customer with no paid/free_activated agreement, but still returns the real score", async () => {
    queueSnapshot();
    mockResultQueue.push([]); // assessmentSowAgreementsTable: no paid/free_activated row -> unpaid
    queuePriorityItems();
    queueCommonTail();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);

    // The raw response body/text must not contain the finding/recommendation strings at all.
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(SECRET_FINDING_TEXT);
    expect(raw).not.toContain(SECRET_RECOMMENDATION_TEXT);

    expect(res.body.results.pillars.security.findings).toBeUndefined();
    expect(res.body.results.pillars.security.recommendations).toBeUndefined();
    expect(res.body.results.pillars.security.findingsCount).toBe(1);
    expect(res.body.results.pillars.security.recommendationsCount).toBe(1);

    // Scores are NEVER redacted.
    expect(res.body.results.pillars.security.score).toBe(42);
    expect(res.body.scores.security).toBe(42);
    expect(res.body.results.summary.compositeScore).toBe(42);
  });

  it("PASSES THROUGH findings/recommendations text for a customer with a paid agreement", async () => {
    queueSnapshot();
    mockResultQueue.push([{ id: 999 }]); // assessmentSowAgreementsTable: paid row found
    queuePriorityItems();
    queueCommonTail();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.results.pillars.security.findings).toEqual([SECRET_FINDING_TEXT]);
    expect(res.body.results.pillars.security.recommendations).toEqual([SECRET_RECOMMENDATION_TEXT]);
    expect(res.body.results.pillars.security.findingsCount).toBeUndefined();
    expect(res.body.results.pillars.security.score).toBe(42);
  });
});

describe("GET /api/portal/dashboard — results.summary.priorityItems (#2500)", () => {
  const PRIORITY_FINDING_TITLE = "SECRET_PRIORITY__admin consent granted to unverified app";
  const PRIORITY_FINDING_DESC = "SECRET_PRIORITY_DESC__revoke the unverified app grant";

  function queuePriorityFindings() {
    // 3a. latest run id
    mockResultQueue.push([{ runId: "diag-run-1" }]);
    // 3b. that run's critical/warning findings — deliberately out of severity/
    // recency order, to prove the route re-sorts (critical before warning,
    // newest first within a tier) rather than trusting row order.
    mockResultQueue.push([
      {
        checkKey: "old-warning-check",
        severity: "warning",
        title: "an older warning",
        description: "older warning description",
        createdAt: new Date("2026-08-01T00:00:00Z"),
      },
      {
        checkKey: "the-critical-check",
        severity: "critical",
        title: PRIORITY_FINDING_TITLE,
        description: PRIORITY_FINDING_DESC,
        createdAt: new Date("2026-08-02T00:00:00Z"),
      },
    ]);
  }

  it("REDACTS priority-item title/description text for an unpaid customer, but still reports severity/checkKey", async () => {
    queueSnapshot();
    mockResultQueue.push([]); // assessmentSowAgreementsTable: unpaid
    queuePriorityFindings();
    queueCommonTail();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain(PRIORITY_FINDING_TITLE);
    expect(raw).not.toContain(PRIORITY_FINDING_DESC);

    const items = res.body.results.summary.priorityItems;
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      checkKey: "the-critical-check",
      severity: "critical",
      title: null,
      description: null,
    });
    expect(items[1].checkKey).toBe("old-warning-check");
    expect(items[1].severity).toBe("warning");
  });

  it("PASSES THROUGH priority-item text for a paid customer, worst-severity-first", async () => {
    queueSnapshot();
    mockResultQueue.push([{ id: 999 }]); // assessmentSowAgreementsTable: paid
    queuePriorityFindings();
    queueCommonTail();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);
    const items = res.body.results.summary.priorityItems;
    // Critical (createdAt 08-02) sorts before the older warning (08-01) even
    // though it was pushed to the mock queue second.
    expect(items[0]).toEqual({
      checkKey: "the-critical-check",
      severity: "critical",
      title: PRIORITY_FINDING_TITLE,
      description: PRIORITY_FINDING_DESC,
    });
    expect(items[1].severity).toBe("warning");
  });

  it("is a real, always-present [] (not omitted) when the tenant has no findings at all", async () => {
    queueSnapshot();
    mockResultQueue.push([{ id: 999 }]); // paid
    queuePriorityItems(); // no findings run at all
    queueCommonTail();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${customerToken()}`);

    expect(res.status).toBe(200);
    expect(res.body.results.summary.priorityItems).toEqual([]);
  });
});
