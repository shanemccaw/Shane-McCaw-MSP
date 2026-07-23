/**
 * admin-monitor-checks-crud.test.ts
 *
 * Regression tests for the monitor-check CRUD routes backing the Simulator
 * Studio's "M365 Endpoints" node: create, edit, and retire.
 *
 * The retire assertions are the load-bearing ones for this feature: retiring an
 * endpoint must be a REVERSIBLE status change to "archived" (the real
 * MONITOR_CHECK_STATUS enum value) and must never issue a db.delete() — the
 * catalog row stays auditable and can be reactivated.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const EXISTING = {
  id: 1,
  key: "identity:mfa-registration",
  label: "MFA registration coverage",
  description: null,
  endpoint: "/reports/authenticationMethods/userRegistrationDetails",
  method: "GET",
  selectParams: null,
  requestBody: null,
  properties: ["isMfaRegistered"],
  mapping: [],
  severityRules: [],
  outputSchema: null,
  engines: [],
  frequency: "daily",
  requiresCustomerScript: false,
  schemaVersion: 3,
  status: "active",
};

/** Rows the mocked select chain resolves, in call order. */
let selectQueue: unknown[][] = [];
/** Rows returned by the mocked insert/update .returning(). */
let returningRows: unknown[] = [];
/** Every db.update().set() payload, for asserting the retire is a status change. */
const updateSets: Record<string, unknown>[] = [];
const insertValues: Record<string, unknown>[] = [];
const deleteCalls: unknown[] = [];

vi.mock("@workspace/db", () => {
  const selectChain = () => ({
    from: vi.fn(() => {
      const whereObj = {
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
          // package-reference lookup resolves without .limit()
          then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
        })),
        orderBy: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
        limit: vi.fn(() => Promise.resolve(selectQueue.shift() ?? [])),
      };
      return whereObj;
    }),
  });

  return {
    db: {
      select: vi.fn(selectChain),
      insert: vi.fn(() => ({
        values: vi.fn((v: Record<string, unknown>) => {
          insertValues.push(v);
          return {
            returning: vi.fn(() => Promise.resolve(returningRows)),
            onConflictDoNothing: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve(returningRows)),
            })),
            then: (resolve: (v: unknown) => unknown) => resolve(undefined),
          };
        }),
      })),
      update: vi.fn(() => ({
        set: vi.fn((s: Record<string, unknown>) => {
          updateSets.push(s);
          return {
            where: vi.fn(() => ({
              returning: vi.fn(() => Promise.resolve(returningRows)),
            })),
          };
        }),
      })),
      delete: vi.fn((t: unknown) => {
        deleteCalls.push(t);
        return { where: vi.fn(() => Promise.resolve({ rowCount: 0 })) };
      }),
    },
    monitorChecksTable: { key: "key" },
    monitoringPackagesTable: { key: "key" },
    monitoringPackageChecksTable: { packageKey: "package_key", checkKey: "check_key", sortOrder: "sort_order" },
    monitorCheckAuditLogTable: { createdAt: "created_at" },
    tenantMonitorProfilesTable: { collectedAt: "collected_at", tenantId: "tenant_id" },
    usersTable: { id: "id" },
    mspCustomersTable: { tenantId: "tenant_id", name: "name", domain: "domain" },
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (req.headers["authorization"] === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: {
    child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Mapping/severity helpers belong to monitor-executor; the CRUD routes only
// import them for the script-ingest path. Mocked, never reimplemented.
vi.mock("../lib/monitor-executor", () => ({
  applyMapping: vi.fn(() => ({})),
  classifySeverity: vi.fn(() => null),
  validateOutputShape: vi.fn(() => ({ valid: true, errors: [] })),
}));

import router from "./admin-monitor-checks";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  return app;
}

const auth = (r: request.Test) => r.set("Authorization", `Bearer ${ADMIN_PASS}`);

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue = [];
  returningRows = [];
  updateSets.length = 0;
  insertValues.length = 0;
  deleteCalls.length = 0;
});

// ── Create ────────────────────────────────────────────────────────────────────

describe("POST /admin/monitor-checks — create", () => {
  it("requires auth", async () => {
    const res = await request(makeApp()).post("/api/admin/monitor-checks").send({ key: "a:b", label: "L", endpoint: "/x" });
    expect(res.status).toBe(401);
  });

  it("400s when key, label or endpoint is missing", async () => {
    for (const body of [{}, { key: "a:b" }, { key: "a:b", label: "L" }, { label: "L", endpoint: "/x" }]) {
      const res = await auth(request(makeApp()).post("/api/admin/monitor-checks")).send(body);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/required/i);
    }
  });

  it("creates a real active row with the submitted fields", async () => {
    const created = { ...EXISTING, key: "governance:new-check" };
    returningRows = [created];

    const res = await auth(request(makeApp()).post("/api/admin/monitor-checks")).send({
      key: "governance:new-check",
      label: "New check",
      endpoint: "/groups",
      method: "GET",
      properties: ["displayName"],
    });

    expect(res.status).toBe(201);
    expect(res.body.check.key).toBe("governance:new-check");
    const values = insertValues[0]!;
    expect(values.key).toBe("governance:new-check");
    expect(values.endpoint).toBe("/groups");
    expect(values.properties).toEqual(["displayName"]);
    // New checks start active and at schema version 1.
    expect(values.status).toBe("active");
    expect(values.schemaVersion).toBe(1);
  });
});

// ── Edit ──────────────────────────────────────────────────────────────────────

describe("PATCH /admin/monitor-checks/:key — edit", () => {
  it("404s for an unknown key", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).patch("/api/admin/monitor-checks/nope:missing")).send({ label: "x" });
    expect(res.status).toBe(404);
  });

  it("updates endpoint/method/params and bumps schemaVersion when the endpoint changes", async () => {
    selectQueue = [[EXISTING]];
    returningRows = [{ ...EXISTING, endpoint: "/users", schemaVersion: 4 }];

    const res = await auth(request(makeApp()).patch("/api/admin/monitor-checks/identity:mfa-registration")).send({
      endpoint: "/users",
      method: "POST",
      selectParams: "$select=id",
    });

    expect(res.status).toBe(200);
    const set = updateSets[0]!;
    expect(set.endpoint).toBe("/users");
    expect(set.method).toBe("POST");
    expect(set.selectParams).toBe("$select=id");
    // Stored results are keyed by schema version — an endpoint change must bump it.
    expect(set.schemaVersion).toBe(EXISTING.schemaVersion + 1);
  });

  it("does not bump schemaVersion for a label-only edit", async () => {
    selectQueue = [[EXISTING]];
    returningRows = [{ ...EXISTING, label: "Renamed" }];

    await auth(request(makeApp()).patch("/api/admin/monitor-checks/identity:mfa-registration")).send({ label: "Renamed" });

    expect(updateSets[0]!.schemaVersion).toBe(EXISTING.schemaVersion);
  });

  it("reactivates an archived check by setting status back to active", async () => {
    selectQueue = [[{ ...EXISTING, status: "archived" }]];
    returningRows = [{ ...EXISTING, status: "active" }];

    const res = await auth(request(makeApp()).patch("/api/admin/monitor-checks/identity:mfa-registration")).send({ status: "active" });

    expect(res.status).toBe(200);
    expect(updateSets[0]!.status).toBe("active");
  });
});

// ── Retire ────────────────────────────────────────────────────────────────────

describe("DELETE /admin/monitor-checks/:key — retire is a reversible archive", () => {
  it("404s for an unknown key", async () => {
    selectQueue = [[]];
    const res = await auth(request(makeApp()).delete("/api/admin/monitor-checks/nope:missing"));
    expect(res.status).toBe(404);
  });

  it("archives rather than hard-deleting an unreferenced check", async () => {
    selectQueue = [[EXISTING], []];
    returningRows = [{ ...EXISTING, status: "archived" }];

    const res = await auth(request(makeApp()).delete("/api/admin/monitor-checks/identity:mfa-registration"));

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.check.status).toBe("archived");
    // The load-bearing assertion: a status change, never a row deletion.
    expect(updateSets.some((s) => s.status === "archived")).toBe(true);
    expect(deleteCalls).toHaveLength(0);
  });

  it("archives (never deletes) a check still referenced by a package, and names the packages", async () => {
    selectQueue = [[EXISTING], [{ packageKey: "core:security-baseline" }]];
    returningRows = [{ ...EXISTING, status: "archived" }];

    const res = await auth(request(makeApp()).delete("/api/admin/monitor-checks/identity:mfa-registration"));

    expect(res.status).toBe(200);
    expect(res.body.archived).toBe(true);
    expect(res.body.packages).toEqual(["core:security-baseline"]);
    expect(deleteCalls).toHaveLength(0);
  });
});
