/**
 * portal-assessment-debug-reset-session.test.ts
 *
 * Regression coverage for #284's POST /portal/diagnostics/debug-reset-session:
 *  - a full reset clears the quiz key, diagnostic runs, the owned
 *    doc-generation workflow runs, and generated documents, while leaving
 *    client_services (the real Copilot entitlement) completely untouched
 *    (the route never imports or references clientServicesTable at all);
 *  - the route is genuinely blocked (403) server-side for a non-testbed
 *    account even hitting the endpoint directly, not just hidden client-side.
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

const state = vi.hoisted(() => ({
  testbedCustomerRow: {
    isTestbed: true,
    copilotAssessment: { quiz: { profile: { role: "IT Admin" }, completedAt: "2026-01-01T00:00:00.000Z" }, other: "keep-me" },
  } as { isTestbed: boolean; copilotAssessment: Record<string, unknown> },
  wfRunsFound: [{ id: 501 }, { id: 502 }],
  deletedRuns: [{ id: 10 }, { id: 11 }],
  deletedWfRuns: [{ id: 501 }, { id: 502 }],
  deletedDocs: [{ id: 900 }],
  updateCalls: [] as Array<{ table: unknown; values: Record<string, unknown> }>,
  deleteCalls: [] as Array<{ table: unknown; where: unknown }>,
}));

vi.mock("@workspace/db", () => {
  const tenantsTable = { id: "tenants.id", isTestbed: "tenants.is_testbed", copilotAssessment: "tenants.copilot_assessment", updatedAt: "tenants.updated_at", mspId: "tenants.msp_id", tenantId: "tenants.tenant_id" };
  const mspDiagnosticRunsTable = { id: "msp_diagnostic_runs.id", customerId: "msp_diagnostic_runs.customer_id" };
  const wfRunsTable = { id: "wf_runs.id", definitionId: "wf_runs.definition_id", payload: "wf_runs.payload" };
  const wfDefinitionsTable = { id: "wf_definitions.id", name: "wf_definitions.name" };
  const insightsGeneratedDocumentsTable = { id: "insights_generated_documents.id", customerId: "insights_generated_documents.customer_id" };

  function makeChain(result: unknown) {
    const chain: Record<string, unknown> = {
      from: () => chain,
      innerJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve(result),
      returning: () => Promise.resolve(result),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  }

  const select = vi.fn().mockImplementation((selection: Record<string, unknown>) => {
    if (selection.isTestbed !== undefined) {
      return makeChain([state.testbedCustomerRow]);
    }
    if (selection.id === wfRunsTable.id) {
      return makeChain(state.wfRunsFound);
    }
    return makeChain([]);
  });

  const update = vi.fn().mockImplementation((table: unknown) => ({
    set: vi.fn().mockImplementation((values: Record<string, unknown>) => {
      state.updateCalls.push({ table, values });
      return makeChain(undefined);
    }),
  }));

  const del = vi.fn().mockImplementation((table: unknown) => ({
    where: vi.fn().mockImplementation((whereClause: unknown) => ({
      returning: vi.fn().mockImplementation(() => {
        state.deleteCalls.push({ table, where: whereClause });
        if (table === mspDiagnosticRunsTable) return Promise.resolve(state.deletedRuns);
        if (table === wfRunsTable) return Promise.resolve(state.deletedWfRuns);
        if (table === insightsGeneratedDocumentsTable) return Promise.resolve(state.deletedDocs);
        return Promise.resolve([]);
      }),
    })),
  }));

  const insert = vi.fn().mockReturnValue({ values: vi.fn().mockReturnValue(Promise.resolve([])) });

  return {
    db: { select, update, delete: del, insert },
    mspDiagnosticRunsTable,
    tenantsTable,
    clientServicesTable: { id: "client_services.id", clientUserId: "client_services.client_user_id", serviceId: "client_services.service_id", status: "client_services.status" },
    servicesTable: { id: "services.id", slug: "services.slug", typeAttributes: "services.type_attributes" },
    usersTable: { id: "users.id", tenantId: "users.tenant_id" },
    insightsGeneratedDocumentsTable,
    mfaEnrollmentsTable: {},
    webauthnCredentialsTable: {},
    couponsTable: {},
    assessmentSowAgreementsTable: {},
    wfRunsTable,
    wfDefinitionsTable,
    presentationDocViewsTable: {},
  };
});

vi.mock("../lib/diagnostics-runner", () => ({ runDiagnostics: vi.fn() }));
vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) },
}));

let mockUser: { id: number; customerId: number } = { id: 99, customerId: 10 };
vi.mock("../middlewares/requireAuth", () => ({
  requireRole: () => (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    (req as unknown as Record<string, unknown>).user = mockUser;
    next();
  },
}));

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
vi.mock("../lib/tenant-signals", () => ({
  resolveCustomerIdForPortalUser: vi.fn(),
  resolveSiblingUserIds: vi.fn().mockResolvedValue([99, 199]),
}));
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

describe("POST /portal/diagnostics/debug-reset-session (#284)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser = { id: 99, customerId: 10 };
    state.testbedCustomerRow = {
      isTestbed: true,
      copilotAssessment: { quiz: { profile: { role: "IT Admin" }, completedAt: "2026-01-01T00:00:00.000Z" }, other: "keep-me" },
    };
    state.wfRunsFound = [{ id: 501 }, { id: 502 }];
    state.updateCalls = [];
    state.deleteCalls = [];
  });

  it("clears the quiz key, diagnostic runs, owned workflow runs, and documents for a testbed customer — never touches client_services", async () => {
    const { default: portalAssessmentRouter } = await import("./portal-assessment");
    const app = express();
    app.use(express.json());
    app.use("/api", portalAssessmentRouter);

    const res = await request(app).post("/api/portal/diagnostics/debug-reset-session").send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      reset: true,
      cleared: { quiz: true, diagnosticRuns: 2, workflowRuns: 2, documents: 1 },
    });

    // Quiz key removed from the jsonb map, but a sibling key under the same
    // column survives — this is a scoped delete of "quiz", not a column wipe.
    expect(state.updateCalls).toHaveLength(1);
    expect(state.updateCalls[0].values.copilotAssessment).toEqual({ other: "keep-me" });

    // Exactly the three scoped tables were deleted from — client_services is
    // never among them (the route file has no import of clientServicesTable
    // used in a delete call at all).
    const deletedTables = state.deleteCalls.map((c) => c.table);
    expect(deletedTables).toHaveLength(3);
    expect(deletedTables).not.toContain(undefined);
  });

  it("skips the wf_runs delete entirely when the customer owns no doc-gen workflow run", async () => {
    state.wfRunsFound = [];
    const { default: portalAssessmentRouter } = await import("./portal-assessment");
    const app = express();
    app.use(express.json());
    app.use("/api", portalAssessmentRouter);

    const res = await request(app).post("/api/portal/diagnostics/debug-reset-session").send({});

    expect(res.status).toBe(200);
    expect(res.body.cleared.workflowRuns).toBe(0);
    // Two deletes only (diagnostic runs + documents), not three.
    expect(state.deleteCalls).toHaveLength(2);
  });

  it("blocks a non-testbed account server-side with 403, even hitting the endpoint directly", async () => {
    state.testbedCustomerRow = { isTestbed: false, copilotAssessment: {} };
    const { default: portalAssessmentRouter } = await import("./portal-assessment");
    const app = express();
    app.use(express.json());
    app.use("/api", portalAssessmentRouter);

    const res = await request(app).post("/api/portal/diagnostics/debug-reset-session").send({});

    expect(res.status).toBe(403);
    // Blocked before any mutation ran — no update/delete calls at all.
    expect(state.updateCalls).toHaveLength(0);
    expect(state.deleteCalls).toHaveLength(0);
  });

  it("rejects a token with no customer identity", async () => {
    mockUser = { id: 99, customerId: undefined as unknown as number };
    const { default: portalAssessmentRouter } = await import("./portal-assessment");
    const app = express();
    app.use(express.json());
    app.use("/api", portalAssessmentRouter);

    const res = await request(app).post("/api/portal/diagnostics/debug-reset-session").send({});

    expect(res.status).toBe(403);
    expect(state.deleteCalls).toHaveLength(0);
  });
});
