/**
 * admin-signal-rules-from-tenant.test.ts
 *
 * Regression test for: "Import from Tenant" (Simulation Profiles) rebuilt onto
 * the real, current data model.
 *
 * Before the rebuild, GET /admin/signal-rules/clients-with-runs and
 * POST /admin/signal-rules/simulation-profiles/from-client queried the pre-wipe
 * manual-script model (users role='client' JOIN script_run_results). After the
 * platform wipe that table is empty, so no tenant could be selected despite real
 * customers having actively-consented Microsoft Graph app registrations.
 *
 * The rebuilt endpoints query msp_customers JOIN tenant_consent
 * (consent_status='granted') for the picker, and seed the profile from the real
 * buildTenantProfile() merge (tenant_monitor_profiles), never script_run_results.
 *
 * These tests assert:
 *  - the picker returns ONLY granted-consent customers and excludes
 *    pending/declined/revoked (proven by the SQL WHERE clause), testbeds first;
 *  - from-client re-checks granted consent server-side (404 when not granted);
 *  - from-client calls the real buildTenantProfile() and stores its mergedProfile
 *    into profile_updates and its findings into parsed_findings.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

const { mockExecute, mockTransaction, mockBuildTenantProfile } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockTransaction: vi.fn(),
  mockBuildTenantProfile: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mockExecute,
    transaction: mockTransaction,
  },
  scriptRunResultsTable: {},
  engagementProjectsTable: {},
  usersTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAdmin: (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const auth = req.headers["authorization"] ?? "";
    if (auth === `Bearer ${ADMIN_PASS}`) return next();
    res.status(401).json({ error: "Unauthorized" });
  },
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

vi.mock("../lib/tenant-signals", () => ({
  getAllSignalDefinitions: vi.fn().mockResolvedValue([]),
  getProjectSignalDefinitions: vi.fn().mockResolvedValue([]),
  getAdjustmentSignalDefinitions: vi.fn().mockResolvedValue([]),
  getBuiltinSignalKeys: vi.fn().mockResolvedValue(new Set()),
  computeTenantSignals: vi.fn().mockReturnValue({ firedSignals: new Set(), trace: [] }),
  projectMatchesSignals: vi.fn().mockReturnValue({ included: false }),
  getDisabledSignalKeys: vi.fn().mockResolvedValue(new Set()),
  SIGNAL_TREND_DIRECTIONS: ["up", "down", "flat"],
  SIGNAL_SEVERITIES: ["informational", "low", "medium", "high", "critical"],
  coerceDecayRate: (rows: unknown[]) => rows,
  buildTenantProfile: mockBuildTenantProfile,
}));

vi.mock("../lib/signal-conflict-detector", () => ({
  detectRuleConflicts: vi.fn().mockReturnValue([]),
}));

// Drizzle SQL object helpers — flatten a drizzle sql`` template to raw text/params.
function extractSqlText(node: unknown): string {
  if (node === null || node === undefined || typeof node !== "object") return "";
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).map(extractSqlText).join("");
  }
  if ("value" in obj && Array.isArray(obj.value)) return (obj.value as string[]).join("");
  return "";
}
function extractSqlParams(node: unknown): unknown[] {
  if (node === null || node === undefined) return [];
  if (typeof node !== "object") return [node];
  const obj = node as Record<string, unknown>;
  if ("queryChunks" in obj && Array.isArray(obj.queryChunks)) {
    return (obj.queryChunks as unknown[]).flatMap(extractSqlParams);
  }
  if ("value" in obj && Array.isArray(obj.value)) return []; // raw SQL text chunk
  return [obj];
}

let app: Express;

beforeEach(async () => {
  vi.clearAllMocks();
  app = express();
  app.use(express.json());
  const { default: adminSignalRulesRouter } = await import("./admin-signal-rules");
  app.use(adminSignalRulesRouter);
});

const authHeader = { Authorization: `Bearer ${ADMIN_PASS}` };

describe("GET /api/admin/signal-rules/clients-with-runs (rebuilt onto tenant_consent)", () => {
  it("selects only granted-consent customers and excludes pending/declined/revoked", async () => {
    let capturedSql = "";
    mockExecute.mockImplementation(async (q: unknown) => {
      capturedSql = extractSqlText(q);
      return {
        rows: [
          { id: 7, name: "Shane Testbed", tenantId: "aaaa-tenant", isTestbed: true, consentStatus: "granted", consentedAt: "2026-07-20T00:00:00Z" },
          { id: 4, name: "Mark Perry Co", tenantId: "bbbb-tenant", isTestbed: false, consentStatus: "granted", consentedAt: "2026-07-10T00:00:00Z" },
        ],
        rowCount: 2,
      };
    });

    const res = await request(app).get("/admin/signal-rules/clients-with-runs").set(authHeader);

    expect(res.status).toBe(200);
    // The query itself must filter to granted consent and join the real tables —
    // this is what structurally excludes pending/declined/revoked rows.
    expect(capturedSql).toContain("FROM msp_customers");
    expect(capturedSql).toContain("tenant_consent");
    expect(capturedSql).toContain("tc.consent_status = 'granted'");
    expect(capturedSql).not.toContain("script_run_results");
    expect(capturedSql).not.toContain("role = 'client'");

    // Shape is customer/tenant-centric, and testbed surfaces first.
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toMatchObject({ id: 7, name: "Shane Testbed", tenantId: "aaaa-tenant", isTestbed: true });
    expect(res.body[1]).toMatchObject({ id: 4, isTestbed: false });
    // Old user-centric fields are gone.
    expect(res.body[0].email).toBeUndefined();
    expect(res.body[0].runCount).toBeUndefined();
  });
});

describe("POST /api/admin/signal-rules/simulation-profiles/from-client (rebuilt onto buildTenantProfile)", () => {
  it("404s when the customer has no granted consent (re-checked server-side)", async () => {
    // Consent gate SELECT returns nothing → not granted.
    mockExecute.mockImplementation(async () => ({ rows: [], rowCount: 0 }));

    const res = await request(app)
      .post("/admin/signal-rules/simulation-profiles/from-client")
      .set(authHeader)
      .send({ customerId: 999 });

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/granted tenant consent/i);
    expect(mockBuildTenantProfile).not.toHaveBeenCalled();
  });

  it("400s when no customer id is provided", async () => {
    const res = await request(app)
      .post("/admin/signal-rules/simulation-profiles/from-client")
      .set(authHeader)
      .send({});
    expect(res.status).toBe(400);
    expect(mockBuildTenantProfile).not.toHaveBeenCalled();
  });

  it("422s when the consented tenant has no monitor-derived profile data yet", async () => {
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = extractSqlText(q);
      if (text.includes("FROM msp_customers")) {
        return { rows: [{ id: 4, name: "Mark Perry Co", tenantId: "bbbb-tenant", isTestbed: false }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    mockBuildTenantProfile.mockResolvedValue({
      mergedProfile: {}, findings: [], customerId: 4, mspId: 1, tenantId: "bbbb-tenant",
    });

    const res = await request(app)
      .post("/admin/signal-rules/simulation-profiles/from-client")
      .set(authHeader)
      .send({ customerId: 4 });

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no monitor-derived profile data/i);
  });

  it("stores the real buildTenantProfile() merge into profile_updates + parsed_findings", async () => {
    let insertParams: unknown[] = [];
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = extractSqlText(q);
      if (text.includes("FROM msp_customers")) {
        return { rows: [{ id: 7, name: "Shane Testbed", tenantId: "aaaa-tenant", isTestbed: true }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO signal_simulation_profiles")) {
        insertParams = extractSqlParams(q);
        return { rows: [{ id: 555, name: "profile", profileUpdates: {}, parsedFindings: [] }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });

    const mergedProfile = { hasAADP1orP2: false, mfaCoveragePercent: 42, __itemCount_users: 12 };
    const findings = ["MFA not enforced for all users", "Legacy auth still enabled"];
    mockBuildTenantProfile.mockResolvedValue({
      mergedProfile, findings, customerId: 7, mspId: 1, tenantId: "aaaa-tenant",
    });

    const res = await request(app)
      .post("/admin/signal-rules/simulation-profiles/from-client")
      .set(authHeader)
      .send({ customerId: 7, tags: ["tenant-import"] });

    expect(res.status).toBe(201);
    // The real merge helper was used, keyed by the customer id (not a users.id).
    expect(mockBuildTenantProfile).toHaveBeenCalledWith(7);

    // profile_updates got the real merged profile; parsed_findings got the real
    // findings — both serialized as JSON bound params on the INSERT.
    expect(insertParams).toContain(JSON.stringify(mergedProfile));
    expect(insertParams).toContain(JSON.stringify(findings));
  });

  it("accepts the legacy clientUserId body field as a customerId alias", async () => {
    mockExecute.mockImplementation(async (q: unknown) => {
      const text = extractSqlText(q);
      if (text.includes("FROM msp_customers")) {
        return { rows: [{ id: 4, name: "Mark Perry Co", tenantId: "bbbb-tenant", isTestbed: false }], rowCount: 1 };
      }
      if (text.includes("INSERT INTO signal_simulation_profiles")) {
        return { rows: [{ id: 556 }], rowCount: 1 };
      }
      return { rows: [{ id: 1 }], rowCount: 1 };
    });
    mockBuildTenantProfile.mockResolvedValue({
      mergedProfile: { hasDefender: true }, findings: [], customerId: 4, mspId: 1, tenantId: "bbbb-tenant",
    });

    const res = await request(app)
      .post("/admin/signal-rules/simulation-profiles/from-client")
      .set(authHeader)
      .send({ clientUserId: 4 });

    expect(res.status).toBe(201);
    expect(mockBuildTenantProfile).toHaveBeenCalledWith(4);
  });
});
