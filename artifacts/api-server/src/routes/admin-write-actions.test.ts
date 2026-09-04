/**
 * admin-write-actions.test.ts
 *
 * Regression tests for the Simulator Studio "Write Actions" surface. The safety
 * requirements are the point of this feature, so the tests are written to FAIL
 * if any of them regress:
 *
 *   - The testbed-only restriction is enforced SERVER-SIDE (a non-isTestbed
 *     customerId is rejected by the route, on BOTH preview and execute) — never
 *     "the UI didn't offer one".
 *   - The one production execution engine (runBaselineTemplateAgainstTenant) is
 *     REUSED, not reimplemented. It is MOCKED here exactly like
 *     admin-monitor-check-runs mocks executeMonitorCheck: the tests assert the
 *     route CALLS it with the right args (including source:"simulator") and never
 *     rebuild request construction.
 *   - Explicit confirmation is server-backed: execute without confirmed:true is
 *     refused server-side.
 *   - dependsOn chain state is correctly surfaced in the preview.
 *   - A write-gate failure (write consent not granted) surfaces as a specific 409.
 *
 * The executor being mocked means preview must NOT call it (proving no write) —
 * that is asserted directly.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";
const ADMIN_PASS = "test-admin-pass";

// ── Fixtures (mutable per-test) ─────────────────────────────────────────────────

interface Row { [k: string]: unknown }
let customers: Row[] = [];
let templates: Row[] = [];
let auditLog: Row[] = [];
let catalog: Row[] = [];

const TESTBED_CUSTOMER = { id: 42, customerName: "Testbed Co", tenantId: "tenant-guid-abc", isTestbed: true, status: "active" };
const LIVE_CUSTOMER = { id: 99, customerName: "Real Paying Customer", tenantId: "tenant-guid-live", isTestbed: false, status: "active" };

const DISABLE_SIGNIN = {
  templateId: "users.disable_enable_signin",
  label: "Disable / Enable User Sign-In",
  description: "Sets accountEnabled",
  category: "Users",
  endpoint: "/users/{{userId}}",
  method: "PATCH",
  bodyTemplate: { accountEnabled: "{{accountEnabled}}" },
  requiredVariables: ["userId", "accountEnabled"],
  successCriteria: { statusCode: 204 },
  dependsOn: [],
  requiresVerificationGate: false,
  reversible: true,
  reverseTemplateId: "users.disable_enable_signin",
  status: "active",
};

// A template that DECLARES a dependency, to exercise dependsOn surfacing.
const DEPENDENT = {
  ...DISABLE_SIGNIN,
  templateId: "teams.add_member",
  label: "Add Team Member",
  category: "Teams",
  endpoint: "/teams/{{teamId}}/members",
  method: "POST",
  bodyTemplate: {},
  requiredVariables: ["teamId", "memberId"],
  successCriteria: { statusCode: 201 },
  dependsOn: ["groups.add_member"],
  reversible: true,
  reverseTemplateId: "teams.remove_member",
};

const GROUPS_ADD = {
  ...DISABLE_SIGNIN,
  templateId: "groups.add_member",
  label: "Add Group Member",
  category: "Groups",
  dependsOn: [],
  reversible: true,
  reverseTemplateId: "groups.remove_member",
};

// ── drizzle-orm condition descriptors ───────────────────────────────────────────

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    and: (...cs: any[]) => ({ __op: "and", cs: cs.filter(Boolean) }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "in", col, vals }),
    desc: (col: any) => ({ __op: "desc", col }),
  };
});

// ── @workspace/db — condition-aware, fixture-backed select ──────────────────────

vi.mock("@workspace/db", () => {
  const col = (tbl: string, name: string) => ({ __col: name, __table: tbl });
  const table = (name: string, cols: string[]) => ({
    __table: name,
    ...Object.fromEntries(cols.map((c) => [c, col(name, c)])),
  });

  const tenantsTable = table("tenants", ["id", "customerName", "tenantId", "isTestbed", "status"]);
  const baselineActionTemplatesTable = table("baseline_action_templates", [
    "templateId", "label", "description", "category", "endpoint", "method", "bodyTemplate",
    "requiredVariables", "successCriteria", "dependsOn", "requiresVerificationGate",
    "reversible", "reverseTemplateId", "status",
  ]);
  const baselineActionTemplateAuditLogTable = table("baseline_action_template_audit_log", [
    "id", "templateId", "action", "afterSnapshot", "requestVariables", "createdAt",
  ]);
  const writeActionCatalogTable = table("write_action_catalog", [
    "templateId", "domain", "surface", "requiredPermission", "safeOrGated",
    "minBundledTier", "snapshotNotes", "status", "blockedReason",
  ]);

  const fixturesFor = (name: string): Row[] =>
    name === "tenants" ? customers
      : name === "baseline_action_templates" ? templates
      : name === "baseline_action_template_audit_log" ? auditLog
      : name === "write_action_catalog" ? catalog
      : [];

  const matches = (row: Row, cond: any): boolean => {
    if (!cond) return true;
    switch (cond.__op) {
      case "and": return cond.cs.every((c: any) => matches(row, c));
      case "eq": return row[cond.col.__col] === cond.val;
      case "in": return cond.vals.includes(row[cond.col.__col]);
      default: return true;
    }
  };

  const resolveCol = (primaryRow: Row, primaryTable: string, colDesc: any): unknown => {
    if (colDesc.__table === primaryTable) return primaryRow[colDesc.__col];
    // Joined (catalog) column — left join on templateId.
    const joined = fixturesFor(colDesc.__table).find(j => j["templateId"] === primaryRow["templateId"]);
    return joined ? joined[colDesc.__col] : null;
  };

  const chainFor = (projection: Record<string, any> | undefined) => {
    let primaryTable = "";
    let cond: any = null;
    let order: any[] = [];
    let lim: number | null = null;

    const exec = () => {
      let rows = fixturesFor(primaryTable).filter(r => matches(r, cond));
      if (order.length > 0) {
        rows = [...rows].sort((a, b) => {
          for (const spec of order) {
            const dir = spec?.__op === "desc" ? -1 : 1;
            const c = spec?.__op === "desc" ? spec.col : spec;
            const av = a[c.__col] as any, bv = b[c.__col] as any;
            const na = av instanceof Date ? av.getTime() : av;
            const nb = bv instanceof Date ? bv.getTime() : bv;
            if (na < nb) return -1 * dir;
            if (na > nb) return 1 * dir;
          }
          return 0;
        });
      }
      if (lim != null) rows = rows.slice(0, lim);
      if (!projection) return rows.map(r => ({ ...r }));
      return rows.map(r =>
        Object.fromEntries(Object.entries(projection).map(([alias, c]) => [alias, resolveCol(r, primaryTable, c)])),
      );
    };

    const chain: any = {
      from: (t: any) => ((primaryTable = t.__table), chain),
      leftJoin: () => chain,
      where: (c: any) => ((cond = c), chain),
      orderBy: (...o: any[]) => ((order = o), chain),
      limit: (n: number) => ((lim = n), chain),
      then: (ok: any, err: any) => Promise.resolve(exec()).then(ok, err),
    };
    return chain;
  };

  return {
    db: { select: vi.fn((projection?: Record<string, any>) => chainFor(projection)) },
    tenantsTable,
    baselineActionTemplatesTable,
    baselineActionTemplateAuditLogTable,
    writeActionCatalogTable,
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
  // Same admin-session check as requireAdmin above (see the real
  // requireAdminOrIngestToken in ../middlewares/requireAuth.ts, which falls
  // back to requireAdmin when no ingest-token env var is set — no test here
  // exercises the ingest-token path, so the mock only needs the fallback).
  requireAdminOrIngestToken:
    (_envVar?: string) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
      res.status(401).json({ error: "Unauthorized" });
    },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The reuse point under test — MOCKED, never reimplemented. resolveBaselineTemplateRequest
// and runBaselineTemplateAgainstTenant are the executor's real request-construction +
// execution; stubbing them is what lets these tests assert the route CALLS them.
const resolveBaselineTemplateRequest = vi.fn();
const runBaselineTemplateAgainstTenant = vi.fn();
vi.mock("../lib/workflow-executor", () => ({
  resolveBaselineTemplateRequest: (...a: unknown[]) => resolveBaselineTemplateRequest(...a),
  runBaselineTemplateAgainstTenant: (...a: unknown[]) => runBaselineTemplateAgainstTenant(...a),
}));

// Graph error classes kept REAL so describeWriteGateError's instanceof checks work.
import { WriteConsentRequiredError } from "../lib/graph";

import router from "./admin-write-actions";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}
const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

beforeEach(() => {
  customers = [{ ...TESTBED_CUSTOMER }, { ...LIVE_CUSTOMER }];
  templates = [{ ...DISABLE_SIGNIN }, { ...DEPENDENT }, { ...GROUPS_ADD }];
  auditLog = [];
  catalog = [];
  resolveBaselineTemplateRequest.mockReset();
  runBaselineTemplateAgainstTenant.mockReset();
});

// ── The load-bearing safety requirement: testbed-only, SERVER-SIDE ──────────────

describe("testbed-only restriction is enforced server-side", () => {
  it("preview REJECTS a non-testbed customer with 403 (not hidden — refused)", async () => {
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/preview")
        .send({ customerId: LIVE_CUSTOMER.id, variables: { userId: "u1", accountEnabled: "false" } }),
    );
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/isTestbed/);
    // Proof it never even resolved the request against a live tenant.
    expect(resolveBaselineTemplateRequest).not.toHaveBeenCalled();
  });

  it("execute REJECTS a non-testbed customer with 403 even with confirmed:true", async () => {
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ customerId: LIVE_CUSTOMER.id, confirmed: true, variables: { userId: "u1", accountEnabled: "false" } }),
    );
    expect(res.status).toBe(403);
    // THE critical assertion: a real write against a live tenant never happened.
    expect(runBaselineTemplateAgainstTenant).not.toHaveBeenCalled();
  });

  it("execute rejects a missing customerId with 400", async () => {
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ confirmed: true, variables: {} }),
    );
    expect(res.status).toBe(400);
    expect(runBaselineTemplateAgainstTenant).not.toHaveBeenCalled();
  });

  it("execute rejects an unknown customer with 404", async () => {
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ customerId: 123456, confirmed: true, variables: {} }),
    );
    expect(res.status).toBe(404);
    expect(runBaselineTemplateAgainstTenant).not.toHaveBeenCalled();
  });
});

// ── Explicit confirmation, server-backed ────────────────────────────────────────

describe("explicit confirmation is required server-side", () => {
  it("execute without confirmed:true is refused (400), no write attempted", async () => {
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ customerId: TESTBED_CUSTOMER.id, variables: { userId: "u1", accountEnabled: "false" } }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/confirmed:true/);
    expect(runBaselineTemplateAgainstTenant).not.toHaveBeenCalled();
  });
});

// ── Reuse of the production execution engine ────────────────────────────────────

describe("execute reuses the production engine (runBaselineTemplateAgainstTenant)", () => {
  it("calls it with the resolved tenant/customer and source:'simulator', and evaluates successCriteria", async () => {
    runBaselineTemplateAgainstTenant.mockResolvedValue({
      success: true, status: 204, data: null, endpoint: "/users/u1", method: "PATCH",
      label: "Disable / Enable User Sign-In", auditLogId: 7,
    });

    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ customerId: TESTBED_CUSTOMER.id, confirmed: true, variables: { userId: "u1", accountEnabled: "false" } }),
    );

    expect(res.status).toBe(200);
    expect(runBaselineTemplateAgainstTenant).toHaveBeenCalledTimes(1);
    const [templateId, tenantId, customerId, payload, source] = runBaselineTemplateAgainstTenant.mock.calls[0]!;
    expect(templateId).toBe("users.disable_enable_signin");
    expect(tenantId).toBe(TESTBED_CUSTOMER.tenantId);
    expect(customerId).toBe(TESTBED_CUSTOMER.id);
    expect(payload).toMatchObject({ userId: "u1", accountEnabled: "false", customerId: TESTBED_CUSTOMER.id });
    expect(source).toBe("simulator");

    // successCriteria (declared 204) evaluated against the returned 204.
    expect(res.body.successCriteria).toMatchObject({ defined: true, expectedStatus: 204, actualStatus: 204, met: true });
    expect(res.body.result.success).toBe(true);
  });

  it("surfaces a write-consent gate failure as a specific 409", async () => {
    runBaselineTemplateAgainstTenant.mockRejectedValue(new WriteConsentRequiredError("tenant-guid-abc"));
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/execute")
        .send({ customerId: TESTBED_CUSTOMER.id, confirmed: true, variables: { userId: "u1", accountEnabled: "false" } }),
    );
    expect(res.status).toBe(409);
    expect(res.body.gate).toBe("write_consent_not_granted");
  });
});

// ── Preview resolves the real request WITHOUT executing, and surfaces dependsOn ──

describe("preview resolves the real request without executing", () => {
  it("returns the resolved endpoint/method/body and never calls the executor's run function", async () => {
    resolveBaselineTemplateRequest.mockResolvedValue({
      templateId: "users.disable_enable_signin", label: "Disable / Enable User Sign-In", category: "Users",
      endpoint: "/users/u1", rawEndpoint: "/users/{{userId}}", method: "PATCH",
      body: { accountEnabled: false }, rawBodyTemplate: { accountEnabled: "{{accountEnabled}}" },
      requiredVariables: ["userId", "accountEnabled"], missingVariables: [],
    });

    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/preview")
        .send({ customerId: TESTBED_CUSTOMER.id, variables: { userId: "u1", accountEnabled: "false" } }),
    );

    expect(res.status).toBe(200);
    expect(res.body.resolvedRequest).toMatchObject({ endpoint: "/users/u1", method: "PATCH", body: { accountEnabled: false } });
    expect(res.body.ready).toBe(true);
    // Reverse (rollback) info surfaced — self-paired template.
    expect(res.body.safety.reversible).toBe(true);
    expect(res.body.safety.reverse.templateId).toBe("users.disable_enable_signin");
    // No dependencies for this template.
    expect(res.body.safety.dependsOn.hasDependencies).toBe(false);
    // The load-bearing assertion: preview is READ-ONLY — no write engine call.
    expect(runBaselineTemplateAgainstTenant).not.toHaveBeenCalled();
  });

  it("reports ready:false when a required variable did not resolve", async () => {
    resolveBaselineTemplateRequest.mockResolvedValue({
      templateId: "users.disable_enable_signin", label: "x", category: "Users",
      endpoint: "/users/", rawEndpoint: "/users/{{userId}}", method: "PATCH",
      body: {}, rawBodyTemplate: {}, requiredVariables: ["userId", "accountEnabled"], missingVariables: ["userId"],
    });
    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/users.disable_enable_signin/preview")
        .send({ customerId: TESTBED_CUSTOMER.id, variables: { accountEnabled: "false" } }),
    );
    expect(res.status).toBe(200);
    expect(res.body.ready).toBe(false);
    expect(res.body.resolvedRequest.missingVariables).toEqual(["userId"]);
  });

  it("surfaces the dependsOn chain and a standalone-run warning for a dependent template", async () => {
    resolveBaselineTemplateRequest.mockResolvedValue({
      templateId: "teams.add_member", label: "Add Team Member", category: "Teams",
      endpoint: "/teams/t1/members", rawEndpoint: "/teams/{{teamId}}/members", method: "POST",
      body: {}, rawBodyTemplate: {}, requiredVariables: ["teamId", "memberId"], missingVariables: [],
    });
    // No prior successful run of the dependency for this customer.
    auditLog = [];

    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/teams.add_member/preview")
        .send({ customerId: TESTBED_CUSTOMER.id, variables: { teamId: "t1", memberId: "m1" } }),
    );

    expect(res.status).toBe(200);
    const dep = res.body.safety.dependsOn;
    expect(dep.hasDependencies).toBe(true);
    expect(dep.possiblyUnsatisfied).toBe(true);
    expect(dep.entries[0]).toMatchObject({ templateId: "groups.add_member", exists: true, hasRecentSuccess: false });
    expect(dep.isolatedRunWarning).toMatch(/groups\.add_member/);
  });

  it("marks a dependency satisfied when the audit log shows a prior success for THIS customer", async () => {
    resolveBaselineTemplateRequest.mockResolvedValue({
      templateId: "teams.add_member", label: "Add Team Member", category: "Teams",
      endpoint: "/teams/t1/members", rawEndpoint: "/teams/{{teamId}}/members", method: "POST",
      body: {}, rawBodyTemplate: {}, requiredVariables: ["teamId", "memberId"], missingVariables: [],
    });
    auditLog = [
      { id: 1, templateId: "groups.add_member", action: "executed", createdAt: new Date(),
        afterSnapshot: { success: true, customerId: TESTBED_CUSTOMER.id, status: 204 }, requestVariables: {} },
      // A success for a DIFFERENT customer must NOT count.
      { id: 2, templateId: "groups.add_member", action: "executed", createdAt: new Date(),
        afterSnapshot: { success: true, customerId: 777, status: 204 }, requestVariables: {} },
    ];

    const res = await auth(
      request(makeApp())
        .post("/api/admin/write-actions/teams.add_member/preview")
        .send({ customerId: TESTBED_CUSTOMER.id, variables: { teamId: "t1", memberId: "m1" } }),
    );

    const dep = res.body.safety.dependsOn;
    expect(dep.entries[0]).toMatchObject({ templateId: "groups.add_member", hasRecentSuccess: true });
    expect(dep.possiblyUnsatisfied).toBe(false);
  });
});

// ── Tree list + history ─────────────────────────────────────────────────────────

describe("list + history", () => {
  it("lists executable templates and flags whether a catalog link exists", async () => {
    catalog = [{
      templateId: "users.disable_enable_signin", domain: "Users", surface: "Graph",
      requiredPermission: "User.ReadWrite.All", safeOrGated: "gated", minBundledTier: "pro",
      snapshotNotes: "captures accountEnabled", status: "promoted", blockedReason: null,
    }];

    const res = await auth(request(makeApp()).get("/api/admin/write-actions"));
    expect(res.status).toBe(200);
    const linked = res.body.templates.find((t: any) => t.templateId === "users.disable_enable_signin");
    expect(linked.catalogLinked).toBe(true);
    expect(linked.catalog.safeOrGated).toBe("gated");
    // Reverse label resolved from the sibling template.
    expect(linked.reverseTemplateLabel).toBe("Disable / Enable User Sign-In");

    const unlinked = res.body.templates.find((t: any) => t.templateId === "teams.add_member");
    expect(unlinked.catalogLinked).toBe(false);
    expect(unlinked.catalog).toBeNull();
  });

  it("returns execution history from the audit log, filtered to a customer, newest first", async () => {
    auditLog = [
      { id: 1, templateId: "users.disable_enable_signin", action: "executed", createdAt: new Date("2026-07-01"),
        afterSnapshot: { success: true, status: 204, customerId: TESTBED_CUSTOMER.id, source: "simulator", endpoint: "/users/u1", method: "PATCH" }, requestVariables: { userId: "u1" } },
      { id: 2, templateId: "users.disable_enable_signin", action: "failed", createdAt: new Date("2026-07-02"),
        afterSnapshot: { success: false, status: 403, customerId: TESTBED_CUSTOMER.id, errorType: "insufficient_privilege" }, requestVariables: {} },
      { id: 3, templateId: "users.disable_enable_signin", action: "executed", createdAt: new Date("2026-07-03"),
        afterSnapshot: { success: true, status: 204, customerId: 777 }, requestVariables: {} },
    ];

    const res = await auth(request(makeApp()).get(`/api/admin/write-actions/users.disable_enable_signin/runs?customerId=${TESTBED_CUSTOMER.id}`));
    expect(res.status).toBe(200);
    expect(res.body.runs).toHaveLength(2); // customer 777 filtered out
    expect(res.body.runs[0].id).toBe(2); // newest first
    expect(res.body.runs[0].success).toBe(false);
    expect(res.body.runs[1].source).toBe("simulator");
  });
});
