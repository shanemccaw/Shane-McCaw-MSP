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

vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    eq: (col: any, val: unknown) => ({ __op: "eq", col, val }),
    and: (...cs: any[]) => ({ __op: "and", cs: cs.filter(Boolean) }),
    desc: (col: any) => ({ __op: "desc", col }),
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
  };

  const fixturesFor = (name: string): Row[] =>
    name === "config_packs"
      ? configPacks
      : name === "config_pack_templates"
        ? configPackTemplates
        : name === "tenants"
          ? tenants
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

vi.mock("../lib/logger", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));

// The step that would ACTUALLY run the pack against the tenant — spied so the
// test can prove it is never reached for a non-testbed customer.
const fireWorkflowForDefinition = vi.fn();
vi.mock("./workflow-executor", () => ({
  fireWorkflowForDefinition: (...a: unknown[]) => fireWorkflowForDefinition(...a),
}));
vi.mock("./graph", () => ({ graphFetchForTenant: vi.fn() }));
vi.mock("../routes/break-glass-verification", () => ({ generateStrongPassword: () => "PW-generated" }));

import { ConfigPackError, runConfigPackForCustomer } from "./config-pack-orchestrator";

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
  fireWorkflowForDefinition.mockReset();
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
