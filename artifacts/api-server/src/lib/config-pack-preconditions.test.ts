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
  isSecurityDefaultsDisableStep,
  type PackPreconditionStep,
} from "./config-pack-preconditions.ts";
import type { TenantLicenseSkuResult } from "./license-gate.ts";

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

const skus = (...parts: string[]): TenantLicenseSkuResult => ({ skuPartNumbers: new Set(parts), error: null });
// The testbed tenant's real SKU set from tenant-scans/2026-09-17-testbed-full-scan.json.
const NO_P1 = skus("FLOW_FREE", "ENTERPRISEPACK", "POWER_BI_STANDARD", "Power_Pages_vTrial_for_Makers");
const WITH_P1 = skus("ENTERPRISEPACK", "AAD_PREMIUM");
const payload = { breakGlassGroupId: "" };

const evaluate = (steps: PackPreconditionStep[], tenantSkus: TenantLicenseSkuResult | null) =>
  evaluateConfigPackPreconditions({ packKey: "quickstart-v1", steps, payload, tenantSkus });

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

  it("fails closed when the tenant's licenses could not be read", () => {
    const unreadable: TenantLicenseSkuResult = { skuPartNumbers: new Set(), error: "Graph /subscribedSkus returned 403" };
    const refusal = evaluate([caBaseline("enabled")], unreadable);
    expect(refusal?.code).toBe("license_required");
    expect(refusal?.details).toMatchObject({ skuReadError: "Graph /subscribedSkus returned 403" });
  });

  it("requires every recorded list when a template has more than one catalog row", () => {
    const step = caBaseline("enabled", { requiredLicenseSkuLists: [P1_SKUS, ["INTUNE_A"]] });
    expect(evaluate([step], WITH_P1)?.code).toBe("license_required");
    expect(evaluate([step], skus("AAD_PREMIUM", "INTUNE_A"))).toBeNull();
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
    expect(evaluateConfigPackPreconditions({ packKey: "p", steps, payload: { caState: "enabled" }, tenantSkus: WITH_P1 })).toBeNull();
    expect(evaluateConfigPackPreconditions({ packKey: "p", steps, payload: {}, tenantSkus: WITH_P1 })?.code).toBe(
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
