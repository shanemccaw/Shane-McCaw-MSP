/**
 * config-pack-orchestrator.test.ts
 *
 * The load-bearing safety requirement for whole-pack execution, asserted at its
 * enforcement point: a Config Pack run performs REAL Graph writes against the
 * customer's live tenant, so runConfigPackForCustomer must refuse any customer
 * not flagged isTestbed — SERVER-SIDE, before any workflow is fired. The test is
 * written to FAIL if that guard regresses: it proves the refusal AND that
 * fireWorkflowForDefinition (which would materialize + run the pack against the
 * tenant) is never reached.
 *
 * The heavy collaborators (workflow-executor, graph, break-glass password gen)
 * are mocked so this isolates the orchestrator's own guard logic — the pure
 * dependency-ordering itself is covered separately in config-pack-graph.test.ts.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  [k: string]: unknown;
}
let configPacks: Row[] = [];
let configPackTemplates: Row[] = [];
let tenants: Row[] = [];
let baselineTemplates: Row[] = [];
let writeActionCatalog: Row[] = [];

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    and: (...cs: any[]) => ({ __op: "and", cs: cs.filter(Boolean) }),
    desc: (col: any) => ({ __op: "desc", col }),
    inArray: (col: any, vals: unknown[]) => ({ __op: "inArray", col, vals }),
  };
});

// Table-keyed, read-only db mock. loadConfigPack + the customer lookup are all
// reads via select().from(...).where(...); the testbed guard throws before any
// persist/insert, so only reads need to be served here.
vi.mock("@workspace/db", () => {
  const table = (name: string) => ({ __table: name });
  const tables = {
    configPacksTable: table("config_packs"),
    configPackTemplatesTable: table("config_pack_templates"),
    baselineActionTemplatesTable: table("baseline_action_templates"),
    tenantsTable: table("tenants"),
    wfDefinitionsTable: table("wf_definitions"),
    wfVersionsTable: table("wf_versions"),
    writeActionCatalogTable: table("write_action_catalog"),
  };

  const fixturesFor = (name: string): Row[] =>
    name === "config_packs"
      ? configPacks
      : name === "config_pack_templates"
        ? configPackTemplates
        : name === "tenants"
          ? tenants
          : name === "baseline_action_templates"
            ? baselineTemplates
            : name === "write_action_catalog"
              ? writeActionCatalog
              : [];

  const chainFor = () => {
    let primaryTable = "";
    const exec = () => fixturesFor(primaryTable).map((r) => ({ ...r }));
    const chain: any = {
      from: (t: any) => ((primaryTable = t.__table), chain),
      innerJoin: () => chain,
      leftJoin: () => chain,
      where: () => chain,
      orderBy: () => chain,
      limit: () => chain,
      then: (ok: any, err: any) => Promise.resolve(exec()).then(ok, err),
    };
    return chain;
  };

  return {
    db: { select: vi.fn(() => chainFor()) },
    ...tables,
  };
});

vi.mock("../lib/logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The step that would ACTUALLY run the pack against the tenant — spied so the
// test can prove it is never reached for a non-testbed customer.
const fireWorkflowForDefinition = vi.fn();
vi.mock("./workflow-executor.ts", () => ({
  fireWorkflowForDefinition: (...a: unknown[]) => fireWorkflowForDefinition(...a),
}));
vi.mock("./graph.ts", () => ({ graphFetchForTenant: vi.fn() }));
// #4513 — the tenant's live SKU read; spied so a test can prove it happened.
const getSubscribedSkuPartNumbersForTenant = vi.fn();
vi.mock("./license-gate.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getSubscribedSkuPartNumbersForTenant: (...a: unknown[]) => getSubscribedSkuPartNumbersForTenant(...a),
}));
vi.mock("../routes/break-glass-verification.ts", () => ({ generateStrongPassword: () => "PW-generated" }));

import { ConfigPackError, runConfigPackForCustomer } from "./config-pack-orchestrator.ts";

const ACTIVE_PACK = { id: 1, packKey: "sample-pack", label: "Sample Pack", status: "active" };
const ONE_STEP = {
  templateId: "entra-security-defaults-enable",
  sortOrder: 1,
  dependsOnOverride: null,
  baseDependsOn: [],
  requiresVerificationGate: false,
  requiredVariables: [],
  label: "Enable Security Defaults",
};
const TESTBED_CUSTOMER = { id: 42, name: "Testbed Co", tenantId: "tenant-guid-abc", isTestbed: true, domain: "testbed.onmicrosoft.com" };
const LIVE_CUSTOMER = { id: 99, name: "Real Paying Customer", tenantId: "tenant-guid-live", isTestbed: false, domain: "live.example.com" };

beforeEach(() => {
  configPacks = [{ ...ACTIVE_PACK }];
  configPackTemplates = [{ ...ONE_STEP }];
  // The db mock resolves the customer lookup to the first fixture row (it does
  // not evaluate the where clause), so each test seeds exactly the one customer
  // it targets. TESTBED_CUSTOMER is only referenced by the no-tenant case below.
  tenants = [{ ...LIVE_CUSTOMER }];
  baselineTemplates = [];
  writeActionCatalog = [];
  fireWorkflowForDefinition.mockReset();
  getSubscribedSkuPartNumbersForTenant.mockReset();
});

describe("runConfigPackForCustomer testbed enforcement", () => {
  it("REFUSES a non-testbed customer and never fires a workflow against the live tenant", async () => {
    await expect(
      runConfigPackForCustomer({ packKey: "sample-pack", customerId: LIVE_CUSTOMER.id }),
    ).rejects.toMatchObject({ code: "customer_not_testbed" });

    // THE critical assertion: no pack run was ever materialized or fired.
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
  });

  it("raises a typed ConfigPackError (so the route maps it to 422, not a 500)", async () => {
    await expect(
      runConfigPackForCustomer({ packKey: "sample-pack", customerId: LIVE_CUSTOMER.id }),
    ).rejects.toBeInstanceOf(ConfigPackError);
  });

  it("refuses a customer with no connected tenant before any testbed/write attempt", async () => {
    tenants = [{ ...TESTBED_CUSTOMER, id: 7, tenantId: null }];
    await expect(
      runConfigPackForCustomer({ packKey: "sample-pack", customerId: 7 }),
    ).rejects.toMatchObject({ code: "customer_not_connected" });
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
  });
});

// #4513 — the tenant preconditions fire before ANY authorization path, including
// the testbed one, so even a testbed run cannot reach a write on a tenant that
// lacks the license, or remove Security Defaults without an enforcing replacement.
describe("runConfigPackForCustomer tenant preconditions (#4513)", () => {
  const SD_STEP = { templateId: "quickstart-v1.disable-security-defaults", sortOrder: 1, dependsOnOverride: null, baseDependsOn: [], requiresVerificationGate: false, requiredVariables: [], label: "Disable Security Defaults" };
  const CA_STEP = { templateId: "quickstart-v1.create-ca-baseline-policy", sortOrder: 2, dependsOnOverride: null, baseDependsOn: [], requiresVerificationGate: false, requiredVariables: [], label: "Create CA baseline" };
  const caBody = (state: string) => ({
    state,
    conditions: { users: { includeUsers: ["All"] }, applications: { includeApplications: ["All"] } },
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  });

  beforeEach(() => {
    tenants = [{ ...TESTBED_CUSTOMER }];
    configPackTemplates = [{ ...SD_STEP }, { ...CA_STEP }];
    writeActionCatalog = [{ templateId: CA_STEP.templateId, requiredLicenseSkus: ["AAD_PREMIUM", "AAD_PREMIUM_P2"] }];
  });

  const withCaState = (state: string) => {
    baselineTemplates = [
      { templateId: SD_STEP.templateId, method: "PATCH", endpoint: "/policies/identitySecurityDefaultsEnforcementPolicy", bodyTemplate: { isEnabled: false } },
      { templateId: CA_STEP.templateId, method: "POST", endpoint: "/identity/conditionalAccess/policies", bodyTemplate: caBody(state) },
    ];
  };

  it("refuses license_required on a testbed tenant without Entra ID P1 and never fires", async () => {
    withCaState("enabled");
    getSubscribedSkuPartNumbersForTenant.mockResolvedValue({ skuPartNumbers: new Set(["ENTERPRISEPACK"]), error: null });
    await expect(
      runConfigPackForCustomer({ packKey: "sample-pack", customerId: TESTBED_CUSTOMER.id }),
    ).rejects.toMatchObject({ code: "license_required" });
    expect(getSubscribedSkuPartNumbersForTenant).toHaveBeenCalledWith(TESTBED_CUSTOMER.tenantId);
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
  });

  it("refuses a licensed tenant when the CA replacement is report-only, and never fires", async () => {
    withCaState("enabledForReportingButNotEnforced");
    getSubscribedSkuPartNumbersForTenant.mockResolvedValue({ skuPartNumbers: new Set(["AAD_PREMIUM"]), error: null });
    await expect(
      runConfigPackForCustomer({ packKey: "sample-pack", customerId: TESTBED_CUSTOMER.id }),
    ).rejects.toMatchObject({ code: "security_defaults_replacement_not_enforcing" });
    expect(fireWorkflowForDefinition).not.toHaveBeenCalled();
  });
});
