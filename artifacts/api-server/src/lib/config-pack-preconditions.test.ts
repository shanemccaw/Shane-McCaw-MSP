/**
 * config-pack-preconditions.test.ts — Git #4513.
 *
 * The pure precondition rules a Config Pack must pass before any write. The step
 * bodies below are the shapes of the real quickstart-v1 / identity-ca-hardening-v1
 * baseline_action_templates rows (the live-DB path is exercised in
 * config-pack-dry-run.test.ts); only the CA `state` is varied, which is exactly the
 * enforce-vs-report-only question #4518 leaves open.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("./logger.ts", () => ({
  logger: { child: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) },
}));
vi.mock("./graph.ts", () => ({
  graphFetchForTenant: vi.fn(),
  ConsentRevokedError: class extends Error {},
  LicenseGapError: class extends Error {},
}));

import {
  enforcingReplacementGap,
  evaluateConfigPackPreconditions,
  graphWriteShape,
  isSecurityDefaultsDisableStep,
  type PackPreconditionStep,
} from "./config-pack-preconditions.ts";
import type { TenantServicePlanResult } from "./license-gate.ts";

const P1_SKUS = ["AAD_PREMIUM", "AAD_PREMIUM_P2"];

const disableSecurityDefaults: PackPreconditionStep = {
  templateId: "quickstart-v1.disable-security-defaults",
  method: "PATCH",
  endpoint: "/policies/identitySecurityDefaultsEnforcementPolicy",
  bodyTemplate: { isEnabled: false },
  requiredLicenseSkuLists: [],
};

const caBaseline = (state: string, over: Partial<PackPreconditionStep> = {}): PackPreconditionStep => ({
  templateId: "quickstart-v1.create-ca-baseline-policy",
  method: "POST",
  endpoint: "/identity/conditionalAccess/policies",
  bodyTemplate: {
    state,
    conditions: {
      users: { includeUsers: ["All"], excludeGroups: ["{{breakGlassGroupId}}"] },
      applications: { includeApplications: ["All"] },
    },
    displayName: "Quick-Start Baseline: Require MFA for All Users",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
  requiredLicenseSkuLists: [P1_SKUS],
  ...over,
});

const restrictGuests: PackPreconditionStep = {
  templateId: "quickstart-v1.restrict-guest-access",
  method: "PATCH",
  endpoint: "/policies/authorizationPolicy",
  bodyTemplate: { guestUserRoleId: "2af84b1e-32c8-42b7-82bc-daa82404023b" },
  requiredLicenseSkuLists: [],
};

const plans = (...names: string[]): TenantServicePlanResult => ({ servicePlanNames: new Set(names), error: null });
// #4535 — license is matched against provisioned service plans, not skuPartNumbers.
// A sample of the testbed tenant's real provisioned plans (ENTERPRISEPACK, FLOW_FREE,
// POWER_BI_STANDARD) from tenant-scans/2026-09-17-testbed-full-scan.json — no Entra ID P1.
const NO_P1 = plans("EXCHANGE_S_ENTERPRISE", "SHAREPOINTENTERPRISE", "TEAMS1", "RMS_S_ENTERPRISE", "FLOW_P2_VIRAL", "BI_AZURE_P0");
// P1 held only through a Microsoft 365 E5 bundle: no standalone AAD_PREMIUM SKU exists.
const WITH_P1 = plans("EXCHANGE_S_ENTERPRISE", "AAD_PREMIUM", "AAD_PREMIUM_P2", "INTUNE_A");
const payload = { breakGlassGroupId: "" };

// #4522 — an enforcing CA create is only allowed under the explicit "immediate"
// override, so the license and Security Defaults rules below are exercised in that
// mode; the monitor-first refusal has its own suite (ca-enforcement-precondition-4522.test.ts).
const evaluate = (steps: PackPreconditionStep[], tenantPlans: TenantServicePlanResult | null) =>
  evaluateConfigPackPreconditions({ packKey: "quickstart-v1", steps, payload, tenantPlans, caEnforcementMode: "immediate" });

describe("license precondition", () => {
  it("refuses license_required when a step's recorded SKUs are not held (tenant 2080's case)", () => {
    const refusal = evaluate([disableSecurityDefaults, caBaseline("enabledForReportingButNotEnforced")], NO_P1);
    expect(refusal?.code).toBe("license_required");
    expect(refusal?.details).toMatchObject({
      unlicensedTemplateIds: ["quickstart-v1.create-ca-baseline-policy"],
      requiredLicenses: ["Requires Microsoft Entra ID P1 or P2"],
      skuReadError: null,
    });
    expect(refusal?.message).toContain("Nothing was written");
  });

  it("is checked before the Security Defaults rule, even when the CA policy would enforce", () => {
    expect(evaluate([disableSecurityDefaults, caBaseline("enabled")], NO_P1)?.code).toBe("license_required");
  });

  it("passes a tenant holding P1 only through a bundle (Microsoft 365 E5 / Business Premium)", () => {
    expect(evaluate([caBaseline("enabled")], WITH_P1)).toBeNull();
    expect(evaluate([caBaseline("enabled")], plans("AAD_PREMIUM", "EXCHANGE_S_STANDARD", "INTUNE_A"))).toBeNull();
  });

  it("fails closed when the tenant's licenses could not be read", () => {
    const unreadable: TenantServicePlanResult = { servicePlanNames: new Set(), error: "Graph /subscribedSkus returned 403" };
    const refusal = evaluate([caBaseline("enabled")], unreadable);
    expect(refusal?.code).toBe("license_required");
    expect(refusal?.details).toMatchObject({ skuReadError: "Graph /subscribedSkus returned 403" });
  });

  it("requires every recorded list when a template has more than one catalog row", () => {
    const step = caBaseline("enabled", { requiredLicenseSkuLists: [P1_SKUS, ["INTUNE_A"]] });
    expect(evaluate([step], plans("EXCHANGE_S_ENTERPRISE", "AAD_PREMIUM"))?.code).toBe("license_required");
    expect(evaluate([step], plans("AAD_PREMIUM", "INTUNE_A"))).toBeNull();
  });

  it("passes a pack with no license requirements without reading licenses", () => {
    expect(evaluate([restrictGuests], null)).toBeNull();
  });
});

describe("Security Defaults precondition", () => {
  it("refuses a licensed tenant when the replacement CA policy is report-only (the seeded quickstart-v1)", () => {
    const refusal = evaluate([disableSecurityDefaults, caBaseline("enabledForReportingButNotEnforced"), restrictGuests], WITH_P1);
    expect(refusal?.code).toBe("security_defaults_replacement_not_enforcing");
    expect(refusal?.details).toMatchObject({
      securityDefaultsTemplateIds: ["quickstart-v1.disable-security-defaults"],
      conditionalAccessCandidates: [
        {
          templateId: "quickstart-v1.create-ca-baseline-policy",
          gap: "policy state is 'enabledForReportingButNotEnforced', not 'enabled'",
        },
      ],
    });
  });

  it("allows it only with a licensed, enabled MFA-for-all replacement in the same pack", () => {
    expect(evaluate([disableSecurityDefaults, caBaseline("enabled"), restrictGuests], WITH_P1)).toBeNull();
  });

  it("refuses when the pack creates no Conditional Access policy at all", () => {
    const refusal = evaluate([disableSecurityDefaults, restrictGuests], null);
    expect(refusal?.code).toBe("security_defaults_replacement_not_enforcing");
    expect(refusal?.message).toContain("creates no Conditional Access policy");
  });

  it("resolves a {{state}} variable the same way execution does, and an unresolved one is not 'enabled'", () => {
    const variableState = caBaseline("{{caState}}");
    const steps = [disableSecurityDefaults, variableState];
    expect(evaluateConfigPackPreconditions({ packKey: "p", steps, payload: { caState: "enabled" }, tenantPlans: WITH_P1, caEnforcementMode: "immediate" })).toBeNull();
    expect(evaluateConfigPackPreconditions({ packKey: "p", steps, payload: {}, tenantPlans: WITH_P1 })?.code).toBe(
      "security_defaults_replacement_not_enforcing",
    );
  });

  it("does not count a replacement with no recorded license requirement (cannot be confirmed on this tenant)", () => {
    const unrecorded = caBaseline("enabled", { requiredLicenseSkuLists: [] });
    expect(evaluate([disableSecurityDefaults, unrecorded], WITH_P1)?.code).toBe("security_defaults_replacement_not_enforcing");
  });

  it("does not count a policy that is not MFA for all users, all apps and all client app types", () => {
    const body = caBaseline("enabled").bodyTemplate as Record<string, any>;
    const guestsOnly = caBaseline("enabled", {
      bodyTemplate: { ...body, conditions: { ...body.conditions, users: { includeUsers: ["GuestsOrExternalUsers"] } } },
    });
    const blockOnly = caBaseline("enabled", { bodyTemplate: { ...body, grantControls: { operator: "OR", builtInControls: ["block"] } } });
    const browserOnly = caBaseline("enabled", {
      bodyTemplate: { ...body, conditions: { ...body.conditions, clientAppTypes: ["browser"] } },
    });
    expect(enforcingReplacementGap(guestsOnly, payload)).toBe("policy does not include All users");
    expect(enforcingReplacementGap(blockOnly, payload)).toBe("policy does not require MFA");
    expect(enforcingReplacementGap(browserOnly, payload)).toMatch(/client app types/);
    const withAll = caBaseline("enabled", { bodyTemplate: { ...body, conditions: { ...body.conditions, clientAppTypes: ["all"] } } });
    expect(enforcingReplacementGap(withAll, payload)).toBeNull();
  });

  it("treats only an explicit isEnabled: true as not disabling", () => {
    const enable = { ...disableSecurityDefaults, bodyTemplate: { isEnabled: true } };
    const unresolved = { ...disableSecurityDefaults, bodyTemplate: { isEnabled: "{{sd}}" } };
    const versioned = { ...disableSecurityDefaults, endpoint: "/v1.0/policies/identitySecurityDefaultsEnforcementPolicy/" };
    expect(isSecurityDefaultsDisableStep(enable, {})).toBe(false);
    expect(isSecurityDefaultsDisableStep(unresolved, {})).toBe(true);
    expect(isSecurityDefaultsDisableStep(versioned, {})).toBe(true);
    expect(evaluate([enable, restrictGuests], null)).toBeNull();
  });
});

// #4528 — the same evaluation gates execute_action and SOP runs.
describe("graphWriteShape (#4528)", () => {
  it("matches an SOP step to the catalog template addressing the same Graph write", () => {
    // Real rows: SOP-SEED-IAM-07 step vs action.set-ca-policy-state.
    expect(graphWriteShape("PATCH", "/v1.0/identity/conditionalAccess/policies/{{policyId}}")).toBe(
      graphWriteShape("patch", "/identity/conditionalAccess/policies/{{id}}"),
    );
    expect(graphWriteShape("POST", "https://graph.microsoft.com/beta/identity/conditionalAccess/policies/")).toBe(
      "POST /identity/conditionalaccess/policies",
    );
  });

  it("does not match a different method or a different resource", () => {
    const createPolicy = graphWriteShape("POST", "/identity/conditionalAccess/policies");
    expect(graphWriteShape("PATCH", "/identity/conditionalAccess/policies")).not.toBe(createPolicy);
    expect(graphWriteShape("POST", "/identity/conditionalAccess/namedLocations")).not.toBe(createPolicy);
    expect(graphWriteShape("POST", "/users/{{id}}/revokeSignInSessions")).toBe("POST /users/{}/revokesigninsessions");
  });
});

describe("evaluateConfigPackPreconditions subject (#4528)", () => {
  it("names an SOP or action instead of a pack", () => {
    const refusal = evaluateConfigPackPreconditions({
      packKey: "SOP-SEED-IAM-03",
      subject: "SOP 'SOP-SEED-IAM-03'",
      steps: [caBaseline("enabled")],
      payload: {},
      tenantPlans: NO_P1,
      caEnforcementMode: "immediate",
    });
    expect(refusal?.code).toBe("license_required");
    expect(refusal?.message).toMatch(/^SOP 'SOP-SEED-IAM-03' cannot run on this tenant/);
  });

  it("refuses a lone Security Defaults disable (an execute_action has no replacement)", () => {
    const refusal = evaluateConfigPackPreconditions({
      packKey: "a", subject: "Action 'a'", steps: [disableSecurityDefaults], payload: {}, tenantPlans: null,
    });
    expect(refusal?.code).toBe("security_defaults_replacement_not_enforcing");
  });
});
