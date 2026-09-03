/**
 * portal-dashboard-route-collision.test.ts
 *
 * GitHub #327: GET /api/portal/dashboard was registered by TWO route files —
 * portal-customer-engines.ts (requireRole("CustomerUser")) and portal-dashboard.ts
 * (requireAuth). Express matches in registration order and routes/index.ts mounted
 * the customer-engines router first, so portal-dashboard.ts's handler never
 * executed for any request from the day it was added. That is the handler #315
 * wrote its real tenant-name (`customerName`) fetch against, so the War Room
 * prelude silently fell back to a generic label for every visitor.
 *
 * The fix merged the two: portal-dashboard.ts is deleted (its body was already a
 * verbatim copy inside the surviving handler, short only `customerName`), the
 * surviving handler emits `customerName`, and its floor drops to requireAuth so
 * the Assessment-tier surfaces that call it (War Room, assessment dashboard) can
 * actually reach it.
 *
 * These tests cover the four things that can regress:
 *   1. Assessment role reaches the route at all and gets the REAL customerName
 *      (#315 — this was a hard 403 before).
 *   2. CustomerUser still gets the full engine payload (no regression to the
 *      customer-engines route that was winning the collision).
 *   3. The floor drop is scoped to THIS route — the sibling customer-engines
 *      routes still reject Assessment, and a token with no customerId claim is
 *      still refused rather than served untenanted data.
 *   4. Exactly ONE route file registers the path, i.e. the collision itself
 *      cannot come back.
 *
 * The DB is mocked with a FIFO queue mirroring the route's exact query order —
 * same harness as portal-customer-engines-assessment-redaction.test.ts:
 *   1. tenantEngineSnapshotsTable   (engine snapshots)
 *   2. assessmentSowAgreementsTable (#164 paid/free_activated gate)
 *   3. mspDiagnosticFindingsTable   (#2500: latest run id for priorityItems)
 *   4. mspDiagnosticFindingsTable   (#2500: critical/warning findings for that run)
 *   5. clientServicesTable/servicesTable join (activeServices -> type_attributes)
 *   6. tenantsTable                 (status + customerName)
 *   7. projectsTable
 *   8. clientServicesTable/servicesTable join (clientServicesResult)
 *   9. invoicesTable
 *   10. reportsTable
 *   11. notificationsTable  (unread count)
 *   12. messagesTable      (unread count)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import jwt from "jsonwebtoken";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const JWT_SECRET = "portal-dashboard-route-collision-test-secret";
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
    tenantsTable: tbl(["id", "status", "customerName"]),
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
// mockResultQueue expectations stay valid.
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

/** A token for any MSP role. `customerId: null` models an MSP-side token. */
function token(mspRole: string, customerId: number | null = 10, id = 1): string {
  return jwt.sign(
    {
      id,
      email: "customer@test.com",
      role: "client",
      mspRole,
      mspId: 1,
      ...(customerId === null ? {} : { customerId }),
    },
    JWT_SECRET,
    { expiresIn: "1h" },
  );
}

const REAL_TENANT_NAME = "Contoso Manufacturing Pty Ltd";

/** Queue every query the handler runs, in order, for a customer with one snapshot. */
function queueFullDashboard({ paid = false }: { paid?: boolean } = {}) {
  // 1. engine snapshots
  mockResultQueue.push([
    {
      engineKey: "security",
      score: 42,
      breakdown: [{ finding: "f1", recommendation: "r1" }],
      runId: "run-1",
      capturedAt: new Date("2026-07-01T00:00:00Z"),
    },
  ]);
  // 2. assessmentSowAgreementsTable (#164 gate)
  mockResultQueue.push(paid ? [{ id: 999 }] : []);
  // 3. mspDiagnosticFindingsTable — latest run id for priorityItems (#2500; none here)
  mockResultQueue.push([]);
  // 5. activeServices (empty -> default type_attributes)
  mockResultQueue.push([]);
  // 6. tenantsTable — status + the real customerName (#315)
  mockResultQueue.push([{ status: "active", customerName: REAL_TENANT_NAME }]);
  // 7. projectsTable (empty -> no kanbanTasks query is issued)
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

beforeEach(() => {
  mockResultQueue = [];
});

describe("GET /api/portal/dashboard — #327 route collision fix", () => {
  it("#315: an Assessment-role account reaches the route and gets the REAL tenant name", async () => {
    queueFullDashboard();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("Assessment")}`);

    // Before #327 this was a hard 403 from requireRole("CustomerUser") — the
    // War Room's whole reason for calling this endpoint.
    expect(res.status).toBe(200);
    expect(res.body.customerName).toBe(REAL_TENANT_NAME);
  });

  it("#315: the real name is the tenants row's value, not a hardcoded or echoed one", async () => {
    // Guards against the field being wired to something that merely looks right.
    // "Northline Health" was the fictional demo org the prelude used to hardcode.
    queueFullDashboard();

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("Assessment")}`);

    expect(res.body.customerName).not.toBe("Northline Health");
    expect(JSON.stringify(res.body)).not.toContain("Northline Health");
  });

  it("returns customerName as null (not an absent key) when the tenants row is missing", async () => {
    mockResultQueue.push([]); // snapshots
    mockResultQueue.push([]); // sow agreements
    mockResultQueue.push([]); // mspDiagnosticFindingsTable latest run (#2500; none)
    mockResultQueue.push([]); // activeServices
    mockResultQueue.push([]); // tenantsTable -> NO ROW
    mockResultQueue.push([]); // projects
    mockResultQueue.push([]); // clientServicesResult
    mockResultQueue.push([]); // invoices
    mockResultQueue.push([]); // reports
    mockResultQueue.push([{ unread: 0 }]);
    mockResultQueue.push([{ unreadMessages: 0 }]);

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("Assessment")}`);

    expect(res.status).toBe(200);
    // `undefined` would be dropped entirely by JSON.stringify; the deleted
    // portal-dashboard.ts coalesced these to null and the merged route must too.
    expect(res.body).toHaveProperty("customerName", null);
    expect(res.body).toHaveProperty("customerStatus", null);
  });

  it("NO REGRESSION: CustomerUser still gets the full engine payload it got before", async () => {
    queueFullDashboard({ paid: true });

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("CustomerUser")}`);

    expect(res.status).toBe(200);
    // Fields that only ever came from the customer-engines handler.
    expect(res.body.scores.security).toBe(42);
    expect(res.body.telemetryStatus).toBe("completed");
    expect(res.body.type_attributes).toEqual(["priority-health", "security", "copilot", "cost"]);
    expect(res.body.results.summary.compositeScore).toBe(42);
    expect(res.body.results.runId).toBe("run-1");
    expect(res.body.results.pillars.security.findings).toEqual(["f1"]);
    // Fields the deleted portal-dashboard.ts also emitted — all still present.
    expect(res.body).toHaveProperty("projects");
    expect(res.body).toHaveProperty("clientServices");
    expect(res.body).toHaveProperty("invoices");
    expect(res.body).toHaveProperty("reports");
    expect(res.body).toHaveProperty("unreadNotifications", 0);
    expect(res.body).toHaveProperty("unreadMessages", 0);
    expect(res.body).toHaveProperty("customerStatus", "active");
    expect(res.body).toHaveProperty("mspId", 1);
    // ...plus the one field it had that this route was missing.
    expect(res.body.customerName).toBe(REAL_TENANT_NAME);
  });

  it("#164 paywall still keys on the SOW agreement, not the role: unpaid Assessment gets counts, not text", async () => {
    queueFullDashboard({ paid: false });

    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("Assessment")}`);

    expect(res.status).toBe(200);
    expect(res.body.results.pillars.security.findings).toBeUndefined();
    expect(res.body.results.pillars.security.findingsCount).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain("f1");
  });

  it("still refuses a token with no customerId claim — the floor drop is not an untenanted hole", async () => {
    const res = await request(makeApp())
      .get("/api/portal/dashboard")
      .set("Authorization", `Bearer ${token("MSPAdmin", null)}`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/no customer account/i);
  });

  it("still refuses an unauthenticated request", async () => {
    const res = await request(makeApp()).get("/api/portal/dashboard");
    expect(res.status).toBe(401);
  });

  it("the requireAuth floor is scoped to /portal/dashboard — sibling routes still reject Assessment", async () => {
    for (const path of ["/api/portal/customer/sla-status", "/api/portal/customer/scope-status"]) {
      const res = await request(makeApp())
        .get(path)
        .set("Authorization", `Bearer ${token("Assessment")}`);

      expect(res.status, `${path} must still be CustomerUser-gated`).toBe(403);
    }
  });
});

describe("#327 regression guard — the path may only be registered once", () => {
  it("exactly one route file registers GET /portal/dashboard", () => {
    const routesDir = join(import.meta.dirname, ".");
    const registrars = readdirSync(routesDir)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
      .filter((f) =>
        // The exact path only — /portal/dashboard/pdf, /ppt and /share in
        // dashboard-export.ts are distinct paths and do not collide.
        /router\.get\(\s*\n?\s*["'`]\/portal\/dashboard["'`]/.test(
          readFileSync(join(routesDir, f), "utf8"),
        ),
      );

    expect(registrars).toEqual(["portal-customer-engines.ts"]);
  });

  it("routes/index.ts no longer mounts the deleted portal-dashboard router", () => {
    const index = readFileSync(join(import.meta.dirname, "index.ts"), "utf8");
    expect(index).not.toMatch(/^\s*import\s+portalDashboardRouter/m);
    expect(index).not.toMatch(/^\s*router\.use\(portalDashboardRouter\)/m);
  });
});
