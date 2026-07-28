/**
 * admin-simulator-assessments.test.ts
 *
 * Regression tests for the Simulator Studio "Assessments" catalog + packageKey
 * audit route (simulator-studio-assessments Phase 1, Issue #23). Fixtures below
 * are the real, live `services` (category='assessment') and
 * `monitoring_package_checks` rows recorded in the issue — not guesses — so a
 * correctness break here is a correctness break against real data.
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";

process.env["DATABASE_URL"] = "postgres://test";
process.env["ADMIN_PASSWORD"] = "test-admin-pass";

const ADMIN_PASS = "test-admin-pass";

// The real 21 assessment services (id, name, slug, isFreeOffering, packageKey).
const REAL_ASSESSMENT_SERVICES = [
  { id: 13, name: "Tenant Governance Snapshot", slug: "tenant-governance-snapshot", isFreeOffering: true, packageKey: null },
  { id: 14, name: "Copilot Readiness Snapshot", slug: "copilot-readiness-snapshot", isFreeOffering: true, packageKey: "assess:copilot-readiness" },
  { id: 15, name: "License Waste Audit", slug: "license-waste-audit-free", isFreeOffering: true, packageKey: "assess:license-cost-optimization" },
  { id: 16, name: "M365 Tenant Health Audit", slug: "m365-tenant-health-audit", isFreeOffering: false, packageKey: null },
  { id: 17, name: "Security Posture Assessment", slug: "security-posture-assessment", isFreeOffering: false, packageKey: null },
  { id: 18, name: "Compliance Framework Mapping Audit — SOC 2", slug: "compliance-mapping-soc2", isFreeOffering: false, packageKey: null },
  { id: 19, name: "Compliance Framework Mapping Audit — NIST CSF", slug: "compliance-mapping-nist-csf", isFreeOffering: false, packageKey: null },
  { id: 20, name: "Compliance Framework Mapping Audit — ISO 27001", slug: "compliance-mapping-iso27001", isFreeOffering: false, packageKey: null },
  { id: 21, name: "Compliance Framework Mapping Audit — CMMC Level 1–2", slug: "compliance-mapping-cmmc-l1-2", isFreeOffering: false, packageKey: null },
  { id: 22, name: "Data Governance Assessment", slug: "data-governance-assessment", isFreeOffering: false, packageKey: null },
  { id: 23, name: "Conditional Access Assessment", slug: "conditional-access-assessment", isFreeOffering: false, packageKey: null },
  { id: 24, name: "Migration Readiness Assessment", slug: "migration-readiness-assessment", isFreeOffering: false, packageKey: null },
  { id: 25, name: "Copilot Readiness Assessment", slug: "copilot-readiness-assessment", isFreeOffering: false, packageKey: "assess:copilot-readiness" },
  { id: 26, name: "Copilot Data Exposure Assessment", slug: "copilot-data-exposure-assessment", isFreeOffering: false, packageKey: null },
  { id: 27, name: "License & Cost Optimization Assessment", slug: "license-cost-optimization-assessment", isFreeOffering: false, packageKey: "assess:license-cost-optimization" },
  { id: 28, name: "Adoption & Change Management Maturity Assessment", slug: "adoption-change-management-assessment", isFreeOffering: false, packageKey: "assess:adoption-maturity" },
  { id: 29, name: "SharePoint Assessment", slug: "sharepoint-assessment", isFreeOffering: false, packageKey: null },
  { id: 30, name: "Teams Assessment", slug: "teams-assessment", isFreeOffering: false, packageKey: "assess:teams-governance" },
  { id: 31, name: "Exchange Online Assessment", slug: "exchange-online-assessment", isFreeOffering: false, packageKey: null },
  { id: 32, name: "Entra ID / Identity Assessment", slug: "entra-id-identity-assessment", isFreeOffering: false, packageKey: null },
  { id: 33, name: "Intune / Device Management Assessment", slug: "intune-device-management-assessment", isFreeOffering: false, packageKey: null },
];

function serviceRow(s: (typeof REAL_ASSESSMENT_SERVICES)[number]) {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    isFreeOffering: s.isFreeOffering,
    typeAttributes: s.packageKey ? { packageKey: s.packageKey } : null,
  };
}

// The real, ordered monitoring_package_checks rows for the 4 dedicated packages
// (sort_order 5 is genuinely absent for assess:copilot-readiness in live data —
// the gap is preserved here rather than renumbered).
const REAL_PACKAGE_CHECKS: Array<{ packageKey: string; checkKey: string; sortOrder: number }> = [
  { packageKey: "assess:copilot-readiness", checkKey: "license:copilot-assignment", sortOrder: 1 },
  { packageKey: "assess:copilot-readiness", checkKey: "copilot:usage-activity", sortOrder: 2 },
  { packageKey: "assess:copilot-readiness", checkKey: "copilot:licensed-but-inactive", sortOrder: 3 },
  { packageKey: "assess:copilot-readiness", checkKey: "identity:mfa-registration", sortOrder: 4 },
  { packageKey: "assess:copilot-readiness", checkKey: "sharepoint:tenant-sharing-capability", sortOrder: 6 },
  { packageKey: "assess:copilot-readiness", checkKey: "appgov:risky-permission-grants", sortOrder: 7 },
  { packageKey: "assess:copilot-readiness", checkKey: "copilot:sensitivity-labels-exist", sortOrder: 8 },
  { packageKey: "assess:license-cost-optimization", checkKey: "license:sku-utilization", sortOrder: 1 },
  { packageKey: "assess:license-cost-optimization", checkKey: "license:unused-assigned", sortOrder: 2 },
  { packageKey: "assess:license-cost-optimization", checkKey: "license:copilot-assignment", sortOrder: 3 },
  { packageKey: "assess:adoption-maturity", checkKey: "copilot:usage-activity", sortOrder: 1 },
  { packageKey: "assess:adoption-maturity", checkKey: "copilot:licensed-but-inactive", sortOrder: 2 },
  { packageKey: "assess:adoption-maturity", checkKey: "teams:inventory-count", sortOrder: 3 },
  { packageKey: "assess:adoption-maturity", checkKey: "identity:mfa-registration", sortOrder: 4 },
  { packageKey: "assess:adoption-maturity", checkKey: "identity:stale-accounts", sortOrder: 5 },
  { packageKey: "assess:teams-governance", checkKey: "teams:inventory-count", sortOrder: 1 },
  { packageKey: "assess:teams-governance", checkKey: "teams:guest-settings-governance", sortOrder: 2 },
  { packageKey: "assess:teams-governance", checkKey: "teams:channel-sprawl", sortOrder: 3 },
];

/** Rows the mocked select chain resolves, in call order (services list, then checkLinks). */
let selectQueue: unknown[][] = [];

vi.mock("@workspace/db", () => {
  return {
    db: {
      select: vi.fn(() => ({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            then: (resolve: (v: unknown) => unknown) => resolve(selectQueue.shift() ?? []),
          })),
        })),
      })),
    },
    servicesTable: {
      id: "id",
      name: "name",
      slug: "slug",
      isFreeOffering: "is_free_offering",
      typeAttributes: "type_attributes",
      category: "category",
    },
    monitoringPackageChecksTable: {
      packageKey: "package_key",
      checkKey: "check_key",
      sortOrder: "sort_order",
    },
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

import router from "./admin-simulator-assessments";

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
});

function queueRealFixtures() {
  selectQueue = [REAL_ASSESSMENT_SERVICES.map(serviceRow), REAL_PACKAGE_CHECKS];
}

describe("GET /admin/simulator/assessments", () => {
  it("requires auth", async () => {
    const res = await request(makeApp()).get("/api/admin/simulator/assessments");
    expect(res.status).toBe(401);
  });

  it("returns all 21 real assessment rows", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    expect(res.status).toBe(200);
    expect(res.body.assessments).toHaveLength(21);
  });

  it("groups Free/Paid correctly against the real data (3 free, 18 paid)", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const free = res.body.assessments.filter((a: any) => a.isFreeOffering);
    const paid = res.body.assessments.filter((a: any) => !a.isFreeOffering);
    expect(free.map((a: any) => a.id).sort((a: number, b: number) => a - b)).toEqual([13, 14, 15]);
    expect(paid).toHaveLength(18);
  });

  it("hasDedicatedPackage is false for a known-null row (id 17)", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 17);
    expect(row.packageKey).toBeNull();
    expect(row.hasDedicatedPackage).toBe(false);
    expect(row.checkKeys).toBeNull();
    expect(row.checkCount).toBeNull();
  });

  it("hasDedicatedPackage is true for a known-non-null row (id 25)", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 25);
    expect(row.packageKey).toBe("assess:copilot-readiness");
    expect(row.hasDedicatedPackage).toBe(true);
  });

  it("resolves the real 15-null / 6-dedicated split", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const nullCount = res.body.assessments.filter((a: any) => a.packageKey === null).length;
    const dedicatedCount = res.body.assessments.filter((a: any) => a.hasDedicatedPackage).length;
    expect(nullCount).toBe(15);
    expect(dedicatedCount).toBe(6);
  });

  it("returns the exact ordered check_key list for assess:copilot-readiness, preserving the sort_order gap", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 25);
    expect(row.checkKeys).toEqual([
      "license:copilot-assignment",
      "copilot:usage-activity",
      "copilot:licensed-but-inactive",
      "identity:mfa-registration",
      "sharepoint:tenant-sharing-capability",
      "appgov:risky-permission-grants",
      "copilot:sensitivity-labels-exist",
    ]);
    expect(row.checkCount).toBe(7);
  });

  it("returns the exact ordered check_key list for assess:license-cost-optimization", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 27);
    expect(row.checkKeys).toEqual(["license:sku-utilization", "license:unused-assigned", "license:copilot-assignment"]);
    expect(row.checkCount).toBe(3);
  });

  it("returns the exact ordered check_key list for assess:adoption-maturity", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 28);
    expect(row.checkKeys).toEqual([
      "copilot:usage-activity",
      "copilot:licensed-but-inactive",
      "teams:inventory-count",
      "identity:mfa-registration",
      "identity:stale-accounts",
    ]);
    expect(row.checkCount).toBe(5);
  });

  it("returns the exact ordered check_key list for assess:teams-governance", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const row = res.body.assessments.find((a: any) => a.id === 30);
    expect(row.checkKeys).toEqual(["teams:inventory-count", "teams:guest-settings-governance", "teams:channel-sprawl"]);
    expect(row.checkCount).toBe(3);
  });

  it("two services sharing one packageKey (14 and 25) both resolve the same check list", async () => {
    queueRealFixtures();
    const res = await auth(request(makeApp()).get("/api/admin/simulator/assessments"));
    const snapshot = res.body.assessments.find((a: any) => a.id === 14);
    const full = res.body.assessments.find((a: any) => a.id === 25);
    expect(snapshot.checkKeys).toEqual(full.checkKeys);
  });
});
