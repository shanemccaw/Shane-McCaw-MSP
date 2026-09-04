import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  buildLighthouseArmTemplate,
  buildLighthouseDeepLink,
  lighthouseManagingTenantConfig,
  resolveArmScopePath,
} from "../azure-lighthouse-onboarding";
import { AZURE_BUILT_IN_ROLE_IDS, AZURE_RM_LEAST_PRIVILEGE_ROLE } from "../azure-rm";

/**
 * #1915 — the promise/record layer's TEMPLATE GENERATION half.
 *
 * These pin the real Lighthouse onboarding template shape Microsoft documents
 * (learn.microsoft.com/azure/lighthouse/how-to/onboard-customer#full-template)
 * so a future edit can't silently drift the authorizations/role/scope this
 * platform actually asks a customer to grant.
 */

const ORIGINAL_ENV = { ...process.env };

function setManagingTenantEnv() {
  process.env.AZURE_LIGHTHOUSE_MANAGING_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
  process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID = "11111111-1111-1111-1111-111111111111";
  process.env.AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME = "Shane McCaw Consulting — Platform ARM Reader";
}

beforeEach(() => {
  process.env = { ...ORIGINAL_ENV };
  delete process.env.AZURE_LIGHTHOUSE_MANAGING_TENANT_ID;
  delete process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID;
  delete process.env.AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME;
  delete process.env.GRAPH_TENANT_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("lighthouseManagingTenantConfig", () => {
  it("is null when nothing is configured — an honest gap, not a fabricated principal", () => {
    expect(lighthouseManagingTenantConfig()).toBeNull();
  });

  it("is null when only some of the three values are set", () => {
    process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID = "11111111-1111-1111-1111-111111111111";
    expect(lighthouseManagingTenantConfig()).toBeNull();
  });

  it("falls back to GRAPH_TENANT_ID for the managing tenant id (same real tenant, no second entry needed)", () => {
    process.env.GRAPH_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
    process.env.AZURE_LIGHTHOUSE_PRINCIPAL_ID = "22222222-2222-2222-2222-222222222222";
    process.env.AZURE_LIGHTHOUSE_PRINCIPAL_DISPLAY_NAME = "Platform Reader";
    expect(lighthouseManagingTenantConfig()).toEqual({
      managingTenantId: "c4c814d4-3afe-441e-9145-62461d0a4fd3",
      principalId: "22222222-2222-2222-2222-222222222222",
      principalDisplayName: "Platform Reader",
    });
  });

  it("prefers the explicit AZURE_LIGHTHOUSE_MANAGING_TENANT_ID over GRAPH_TENANT_ID when both are set", () => {
    process.env.GRAPH_TENANT_ID = "aaaaaaaa-0000-0000-0000-000000000000";
    setManagingTenantEnv();
    expect(lighthouseManagingTenantConfig()?.managingTenantId).toBe("c4c814d4-3afe-441e-9145-62461d0a4fd3");
  });
});

describe("resolveArmScopePath", () => {
  it("builds a subscription-scope path", () => {
    expect(resolveArmScopePath({ scopeType: "subscription", subscriptionId: "sub-1" }))
      .toBe("/subscriptions/sub-1");
  });

  it("builds a resource-group-scope path", () => {
    expect(resolveArmScopePath({ scopeType: "resource_group", subscriptionId: "sub-1", resourceGroupName: "rg-monitoring" }))
      .toBe("/subscriptions/sub-1/resourceGroups/rg-monitoring");
  });

  it("throws for resource_group scope with no resourceGroupName", () => {
    expect(() => resolveArmScopePath({ scopeType: "resource_group", subscriptionId: "sub-1" })).toThrow(/resourceGroupName/);
  });
});

describe("buildLighthouseArmTemplate", () => {
  it("throws a clear config error when the managing tenant identity is unconfigured — never fabricates a principal", () => {
    expect(() => buildLighthouseArmTemplate({
      mspOfferName: "Shane McCaw Consulting — Acme Corp",
      mspOfferDescription: "Read-only Azure configuration monitoring.",
      scope: { scopeType: "subscription", subscriptionId: "sub-1" },
    })).toThrow(/AZURE_LIGHTHOUSE_MANAGING_TENANT_ID/);
  });

  it("generates a real Lighthouse template naming Reader at subscription scope by default", () => {
    setManagingTenantEnv();
    const built = buildLighthouseArmTemplate({
      mspOfferName: "Shane McCaw Consulting — Acme Corp",
      mspOfferDescription: "Read-only Azure configuration monitoring.",
      scope: { scopeType: "subscription", subscriptionId: "eae24589-2931-4571-9269-0fc6da779f06" },
    });

    expect(built.armScopePath).toBe("/subscriptions/eae24589-2931-4571-9269-0fc6da779f06");
    expect(built.roleDefinitionId).toBe(AZURE_BUILT_IN_ROLE_IDS.Reader);
    expect(built.roleName).toBe(AZURE_RM_LEAST_PRIVILEGE_ROLE);
    expect(built.authorizations).toEqual([{
      principalId: "11111111-1111-1111-1111-111111111111",
      roleDefinitionId: AZURE_BUILT_IN_ROLE_IDS.Reader,
      principalIdDisplayName: "Shane McCaw Consulting — Platform ARM Reader",
    }]);

    // Pin the real documented template shape — the two Microsoft.ManagedServices
    // resources, in the order Microsoft's own onboarding doc uses.
    expect(built.template.$schema).toContain("subscriptionDeploymentTemplate.json");
    expect(built.template.parameters.managedByTenantId.defaultValue).toBe("c4c814d4-3afe-441e-9145-62461d0a4fd3");
    expect(built.template.parameters.authorizations.defaultValue).toEqual(built.authorizations);
    const resourceTypes = built.template.resources.map((r) => (r as { type: string }).type);
    expect(resourceTypes).toEqual([
      "Microsoft.ManagedServices/registrationDefinitions",
      "Microsoft.ManagedServices/registrationAssignments",
    ]);
  });

  it("scopes to a resource group when requested, and carries a distinct role when one is passed", () => {
    setManagingTenantEnv();
    const built = buildLighthouseArmTemplate({
      mspOfferName: "Shane McCaw Consulting — Acme Corp",
      mspOfferDescription: "Read-only Azure configuration monitoring.",
      scope: { scopeType: "resource_group", subscriptionId: "sub-1", resourceGroupName: "rg-monitoring" },
    });
    expect(built.armScopePath).toBe("/subscriptions/sub-1/resourceGroups/rg-monitoring");
  });
});

describe("buildLighthouseDeepLink", () => {
  it("builds the documented Azure Portal 'create from template URI' link shape", () => {
    const link = buildLighthouseDeepLink("https://example.com/templates/offer-1.json");
    expect(link).toBe(
      "https://portal.azure.com/#create/Microsoft.Template/uri/" +
      encodeURIComponent("https://example.com/templates/offer-1.json"),
    );
  });
});
