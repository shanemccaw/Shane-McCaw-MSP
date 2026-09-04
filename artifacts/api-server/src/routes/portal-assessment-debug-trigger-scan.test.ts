/**
 * portal-assessment-debug-trigger-scan.test.ts
 *
 * Regression test for #242: POST /portal/diagnostics/debug-trigger-scan must
 * resolve packageKey off the customer's active Copilot entitlement
 * (client_services row for copilot-readiness-snapshot / copilot-readiness-assessment,
 * read via services.type_attributes->>'packageKey'), not the unrelated
 * monitoring_subscription join (the bug from #242 that produced a 30-check
 * run instead of the correct 7-check assess:copilot-readiness package).
 *
 * Run with: pnpm --filter @workspace/api-server run test
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// portal-assessment.ts statically imports copilot-readiness-narrative-generator,
// which pulls in the Anthropic AI integration client — that throws at module
// load if these are unset (see consent.test.ts for the same precedent).
process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = "https://anthropic.test";
process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-anthropic-key";

let insertedPackageKey: string | null = null;
let runDiagnosticsPackageKey: string | null = null;

// The real, live services rows for the two Copilot products (see
// admin-simulator-assessments.test.ts's REAL_ASSESSMENT_SERVICES) — both
// carry the same packageKey, "assess:copilot-readiness".
const COPILOT_SNAPSHOT_SERVICE = { id: 14, slug: "copilot-readiness-snapshot", typeAttributes: { packageKey: "assess:copilot-readiness" } };
const COPILOT_ASSESSMENT_SERVICE = { id: 25, slug: "copilot-readiness-assessment", typeAttributes: { packageKey: "assess:copilot-readiness" } };

vi.mock("@workspace/db", () => {
  const fakeTestbedCustomer = { isTestbed: true, mspId: 1, tenantId: "tenant-abc" };

  const mockDb = {
    select: vi.fn().mockImplementation((selection: Record<string, unknown>) => ({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockImplementation(() => {
            // First select() in the route is the isTestbed guard (selects isTestbed/mspId/tenantId).
            if ("isTestbed" in selection) return Promise.resolve([fakeTestbedCustomer]);
            return Promise.resolve([]);
          }),
        }),
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              orderBy: vi.fn().mockReturnValue({
                limit: vi.fn().mockImplementation(() =>
                  Promise.resolve([{ packageKey: COPILOT_ASSESSMENT_SERVICE.typeAttributes.packageKey }]),
                ),
              }),
            }),
          }),
        }),
      }),
    })),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockImplementation((row: { packageKey: string }) => {
        insertedPackageKey = row.packageKey;
        return Promise.resolve([]);
      }),
    }),
  };

  return {
    db: mockDb,
    mspDiagnosticRunsTable: { runId: "run_id", customerId: "customer_id", packageKey: "package_key" },
    tenantsTable: { id: "id", isTestbed: "is_testbed", mspId: "msp_id", tenantId: "tenant_id" },
    clientServicesTable: { id: "id", clientUserId: "client_user_id", serviceId: "service_id", status: "status" },
    servicesTable: { id: "id", slug: "slug", typeAttributes: "type_attributes", fulfillmentTypeKey: "fulfillment_type_key" },
    usersTable: { id: "id", tenantId: "tenant_id" },
    insightsGeneratedDocumentsTable: {},
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    couponsTable: {},
    assessmentSowAgreementsTable: {},
    wfRunsTable: {},
    wfDefinitionsTable: {},
    presentationDocViewsTable: {},
  };
});

vi.mock("../lib/diagnostics-runner", () => ({
  runDiagnostics: vi.fn().mockImplementation(({ packageKey }: { packageKey: string }) => {
    runDiagnosticsPackageKey = packageKey;
    return Promise.resolve({ runId: "test-run", status: "completed", checksTotal: 7, checksOk: 7, checksError: 0, requiresScript: 0, findingsCount: 0 });
  }),
}));

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (req: express.Request, res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).user = { id: 99, customerId: 10 };
    next();
  },
}));

// Everything else portal-assessment.ts imports but this route doesn't exercise.
vi.mock("../lib/sse-channels", () => ({ registerWorkflowRunSSEClient: vi.fn() }));
vi.mock("../lib/document-engine-sow.ts", () => ({ generateSowDocument: vi.fn() }));
vi.mock("../lib/stripe", () => ({ getStripeKey: vi.fn() }));
vi.mock("../lib/captcha", () => ({ verifyCaptchaToken: vi.fn() }));
vi.mock("../lib/portal-url", () => ({ getMspPortalBaseUrl: vi.fn() }));
vi.mock("../lib/pillar-coverage", () => ({ getPillarCoverage: vi.fn() }));
vi.mock("../lib/license-waste-source", () => ({ resolveLicenseWasteCounts: vi.fn() }));
vi.mock("../lib/cost-engine", () => ({ computeSkuCostBreakdown: vi.fn() }));
vi.mock("../lib/doc-gate-coverage", () => ({ evaluateDocGateCoverage: vi.fn(), DOC_GATE_MIN_COVERAGE_PCT: 50 }));
vi.mock("../lib/copilot-readiness", () => ({ computeCopilotReadiness: vi.fn() }));
vi.mock("../lib/sales-offer-engine", () => ({ runSalesOfferEngineForTenant: vi.fn() }));
vi.mock("../lib/priority-engine", () => ({ fetchSignalRulesAndGroups: vi.fn() }));
vi.mock("../lib/tenant-signals", () => ({ resolveCustomerIdForPortalUser: vi.fn(), resolveSiblingUserIds: vi.fn() }));
vi.mock("../lib/graph", () => ({ REQUIRED_MT_SCOPES: [] }));
vi.mock("../lib/sharepoint-admin", () => ({
  REQUIRED_SHAREPOINT_APP_PERMISSIONS: [],
  // monitor-executor.ts (pulled in transitively via portal-assessment.ts)
  // indexes SHARING_CAPABILITY_NAMES by this enum's members at module load
  // time — real numeric values, not just the export existing.
  SharingCapability: {
    Disabled: 0,
    ExternalUserSharingOnly: 1,
    ExternalUserAndGuestSharing: 2,
    ExistingExternalUserSharingOnly: 3,
  },
}));

describe("POST /portal/diagnostics/debug-trigger-scan — packageKey resolution (#242)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertedPackageKey = null;
    runDiagnosticsPackageKey = null;
  });

  it("resolves packageKey from the customer's active Copilot entitlement, not the monitoring_subscription join", async () => {
    const { default: portalAssessmentRouter } = await import("./portal-assessment");
    const app = express();
    app.use(express.json());
    app.use("/api", portalAssessmentRouter);

    const res = await request(app).post("/api/portal/diagnostics/debug-trigger-scan").send({});

    expect(res.status).toBe(202);
    // The 7-check assess:copilot-readiness package, not the old
    // core:security-baseline fallback (which is what a broken/no-match join produced).
    expect(insertedPackageKey).toBe("assess:copilot-readiness");
    expect(runDiagnosticsPackageKey).toBe("assess:copilot-readiness");
  });
});
