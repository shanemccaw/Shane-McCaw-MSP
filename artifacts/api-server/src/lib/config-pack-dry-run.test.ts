/**
 * config-pack-dry-run.test.ts — Git #1316 (Phase 7 of Epic #1309).
 *
 * Drives the REAL dry-run builder and the orchestrator's new purchase-
 * authorization guards against the REAL local Postgres (the live quickstart-v1
 * config pack + baseline_action_templates rows — the same rows production
 * execution materializes), because the property under test is that the
 * previewed payload/requests are derived by the same single implementation the
 * real run uses. ONLY ./graph's fetch is mocked: a dry-run must never require
 * a live tenant in a unit suite. Tenants rows are created under this run's own
 * ids and deleted in afterAll; nothing here ever fires a workflow run.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { randomUUID } from "crypto";
import { db, baselineActionTemplatesTable, tenantsTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const mockGraphFetchForTenant = vi.fn();
vi.mock("./graph", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  graphFetchForTenant: (...args: unknown[]) => mockGraphFetchForTenant(...args),
}));

import { buildConfigPackDryRun, DRY_RUN_REDACTED } from "./config-pack-dry-run.ts";
import {
  ConfigPackError,
  prepareConfigPackRun,
  runConfigPackForCustomer,
} from "./config-pack-orchestrator.ts";

const RUN_TAG = randomUUID().slice(0, 8);
const createdTenantRowIds: number[] = [];

let consentedCustomerId = 0; // graph + writeBack granted
let readOnlyCustomerId = 0; // graph granted, writeBack NOT granted
const TENANT_DOMAIN = `dryrun-1316-${RUN_TAG}.onmicrosoft.com`;
let consentedTenantGuid = "";

// The restrict-guest-access template has no required variables, so its planned
// body IS its stored bodyTemplate — used to prove alreadySatisfied against a
// mocked GET that returns exactly the planned values.
let guestAccessBody: Record<string, unknown> = {};

beforeAll(async () => {
  consentedTenantGuid = randomUUID();
  const [a] = await db
    .insert(tenantsTable)
    .values({
      mspId: 1,
      customerName: `DryRun Test Co 1316 ${RUN_TAG}`,
      tenantId: consentedTenantGuid,
      domain: TENANT_DOMAIN,
      consent: {
        graph: { status: "granted" },
        writeBack: { status: "granted" },
      },
    })
    .returning({ id: tenantsTable.id });
  consentedCustomerId = a.id;
  createdTenantRowIds.push(a.id);

  const [b] = await db
    .insert(tenantsTable)
    .values({
      mspId: 1,
      customerName: `ReadOnly Test Co 1316 ${RUN_TAG}`,
      tenantId: randomUUID(),
      domain: `readonly-1316-${RUN_TAG}.onmicrosoft.com`,
      consent: { graph: { status: "granted" } },
    })
    .returning({ id: tenantsTable.id });
  readOnlyCustomerId = b.id;
  createdTenantRowIds.push(b.id);

  const [guestTpl] = await db
    .select({ bodyTemplate: baselineActionTemplatesTable.bodyTemplate })
    .from(baselineActionTemplatesTable)
    .where(eq(baselineActionTemplatesTable.templateId, "quickstart-v1.restrict-guest-access"))
    .limit(1);
  guestAccessBody = (guestTpl?.bodyTemplate ?? {}) as Record<string, unknown>;
});

afterAll(async () => {
  if (createdTenantRowIds.length > 0) {
    await db.delete(tenantsTable).where(inArray(tenantsTable.id, createdTenantRowIds));
  }
});

function mockTenantReads() {
  mockGraphFetchForTenant.mockReset().mockImplementation(async (_tenantId: string, path: string) => {
    if (path.startsWith("/policies/identitySecurityDefaultsEnforcementPolicy")) {
      return { ok: true, status: 200, json: async () => ({ isEnabled: true }) };
    }
    if (path.startsWith("/policies/authorizationPolicy")) {
      // Exactly the planned values — the live analogue of "already true".
      return { ok: true, status: 200, json: async () => ({ ...guestAccessBody }) };
    }
    if (path.includes("/branding/")) {
      return { ok: true, status: 200, json: async () => ({ signInPageText: "old text" }) };
    }
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

describe("prepareConfigPackRun (Git #1316 derivations)", () => {
  it("derives domain/tenantId aliases and leaves quickstart-v1 with zero missing variables", async () => {
    mockTenantReads();
    const ctx = await prepareConfigPackRun({ packKey: "quickstart-v1", customerId: consentedCustomerId });

    expect(ctx.payload.domain).toBe(TENANT_DOMAIN);
    expect(ctx.payload.tenantDomain).toBe(TENANT_DOMAIN);
    expect(ctx.payload.tenantId).toBe(consentedTenantGuid);
    expect(ctx.payload.organizationId).toBe(consentedTenantGuid);
    // The gate's mapped outputs AND the pack's own parameterMapping key (the
    // 2026-08-25 #1316 migration wires breakGlassGroupId) are mid-run provided.
    expect(ctx.midRunProvided.has("breakGlassUserId")).toBe(true);
    expect(ctx.midRunProvided.has("breakGlassGroupId")).toBe(true);
    // The whole point of Phase 7: the flagship pack is fully self-derivable.
    expect(ctx.missingVariables).toEqual([]);
    expect(ctx.gatedTemplateId).toBe("quickstart-v1.create-break-glass-account");
  });
});

describe("buildConfigPackDryRun (real tenant state, real substitution)", () => {
  it("builds the real dry-run for quickstart-v1 with live current values and redacted secrets", async () => {
    mockTenantReads();
    const dry = await buildConfigPackDryRun("quickstart-v1", consentedCustomerId);

    expect(dry.packKey).toBe("quickstart-v1");
    expect(dry.executable).toBe(true);
    expect(dry.missingOperatorVariables).toEqual([]);
    expect(dry.gated).toBe(true);
    expect(dry.actions).toHaveLength(8);

    // Every read went to the consented tenant, none anywhere else.
    for (const call of mockGraphFetchForTenant.mock.calls) {
      expect(call[0]).toBe(consentedTenantGuid);
    }

    const byId = new Map(dry.actions.map((a) => [a.templateId, a]));

    // The break-glass create: a POST whose resolved body must carry the
    // redaction sentinel and never any real generated password.
    const create = byId.get("quickstart-v1.create-break-glass-account")!;
    expect(create.changeKind).toBe("create");
    expect(create.gatedHere).toBe(true);
    const createBody = JSON.stringify(create.plannedWrite);
    expect(createBody).toContain(DRY_RUN_REDACTED);
    // The resolved endpoint/body must carry the real derived domain.
    expect(createBody).toContain(TENANT_DOMAIN);

    // A mid-run-dependent step keeps its placeholder honestly and reads nothing.
    const addToGroup = byId.get("quickstart-v1.add-break-glass-to-exclusion-group")!;
    expect(addToGroup.endpoint).toContain("{{breakGlassGroupId}}");
    expect(addToGroup.dependsOnRunOutputs).toContain("breakGlassGroupId");
    expect(addToGroup.currentState.fetched).toBe(false);

    // An update whose current live value differs from the planned one.
    const secDefaults = byId.get("quickstart-v1.disable-security-defaults")!;
    expect(secDefaults.changeKind).toBe("update");
    expect(secDefaults.currentState.fetched).toBe(true);
    expect(secDefaults.currentState.values).toHaveProperty("isEnabled", true);
    expect(secDefaults.alreadySatisfied).toBe(false);

    // An update the tenant already satisfies — the live mayBeSatisfied.
    const guest = byId.get("quickstart-v1.restrict-guest-access")!;
    expect(guest.alreadySatisfied).toBe(true);
  });

  it("reports a per-entity pack as not self-executable instead of guessing values", async () => {
    mockTenantReads();
    const dry = await buildConfigPackDryRun("onboarding-v1", consentedCustomerId);
    expect(dry.executable).toBe(false);
    expect(dry.missingOperatorVariables.length).toBeGreaterThan(0);
  });
});

describe("runConfigPackForCustomer guards (Git #1316 purchase authorization)", () => {
  it("refuses a non-testbed customer without purchase authorization", async () => {
    await expect(
      runConfigPackForCustomer({ packKey: "quickstart-v1", customerId: consentedCustomerId }),
    ).rejects.toMatchObject({ code: "customer_not_testbed" });
  });

  it("refuses a purchase-authorized run when write-back consent is not granted", async () => {
    await expect(
      runConfigPackForCustomer({
        packKey: "quickstart-v1",
        customerId: readOnlyCustomerId,
        purchaseAuthorization: { checkoutSessionId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "customer_write_consent_missing" });
  });

  it("fails fast on a pack with underivable variables BEFORE anything is persisted or fired", async () => {
    await expect(
      runConfigPackForCustomer({
        packKey: "onboarding-v1",
        customerId: consentedCustomerId,
        purchaseAuthorization: { checkoutSessionId: randomUUID() },
      }),
    ).rejects.toMatchObject({ code: "missing_variables" });
  });
});
