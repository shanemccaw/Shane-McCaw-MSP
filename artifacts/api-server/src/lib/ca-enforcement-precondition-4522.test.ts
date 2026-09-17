/**
 * ca-enforcement-precondition-4522.test.ts — Git #4522.
 *
 * Shane's #4518 decision: Conditional Access policies are report-only
 * (monitor-first) unless a run explicitly overrides it, and an existing policy is
 * enforced only through the promotion workflow. Covers:
 *   - caEnforcementMode parsing / state mapping / the {{caPolicyState}} default
 *   - classifyCaEnforcementWrite on real template write shapes
 *   - precondition rule 0 (monitor-first refuses an enforcing write; "immediate" allows it)
 *   - the #4531 existence lookup, as #4522's migration rewrites it, skipping onto a
 *     policy that has since been PROMOTED rather than failing the re-run closed
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  CA_STATE_ENABLED,
  CA_STATE_REPORT_ONLY,
  caPolicyStateForMode,
  classifyCaEnforcementWrite,
  parseCaEnforcementMode,
  withCaPolicyStateDefault,
} from "./ca-enforcement-mode.ts";
import { evaluateConfigPackPreconditions, type PackPreconditionStep } from "./config-pack-preconditions.ts";
import { runTemplateResolveSteps, type BaselineTemplateResolveStep } from "./resolve-then-write.ts";
import type { TenantServicePlanResult } from "./license-gate.ts";

// #4535 — provisioned service plans: P1 held through a Microsoft 365 E5 bundle.
const P1: TenantServicePlanResult = { servicePlanNames: new Set(["EXCHANGE_S_ENTERPRISE", "AAD_PREMIUM", "AAD_PREMIUM_P2"]), error: null };

// Real baseline_action_templates rows after the #4522 migration.
const mfaAllUsers: PackPreconditionStep = {
  templateId: "action.create-ca-mfa-all-users-policy",
  method: "POST",
  endpoint: "/identity/conditionalAccess/policies",
  bodyTemplate: {
    state: "{{caPolicyState}}",
    conditions: {
      users: { includeUsers: ["All"], excludeGroups: ["{{breakGlassGroupId}}"] },
      applications: { includeApplications: ["All"] },
      clientAppTypes: ["all"],
    },
    displayName: "Baseline: Require MFA for All Users (report-only)",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
  requiredLicenseSkuLists: [["AAD_PREMIUM", "AAD_PREMIUM_P2"]],
};
const enforceExisting: PackPreconditionStep = {
  templateId: "microrem.enforce-ca-policy",
  method: "PATCH",
  endpoint: "/identity/conditionalAccess/policies/{{policyId}}",
  bodyTemplate: { state: "enabled" },
  requiredLicenseSkuLists: [],
};
const setState: PackPreconditionStep = {
  templateId: "action.set-ca-policy-state",
  method: "PATCH",
  endpoint: "/identity/conditionalAccess/policies/{{policyId}}",
  bodyTemplate: { state: "{{state}}" },
  requiredLicenseSkuLists: [["AAD_PREMIUM", "AAD_PREMIUM_P2"]],
};
const disableSecurityDefaults: PackPreconditionStep = {
  templateId: "quickstart-v1.disable-security-defaults",
  method: "PATCH",
  endpoint: "/policies/identitySecurityDefaultsEnforcementPolicy",
  bodyTemplate: { isEnabled: false },
  requiredLicenseSkuLists: [],
};
const POLICY_ID = "6f2a1b0e-2c1d-4d8e-9a55-0b7f1c3e9d21";

describe("caEnforcementMode", () => {
  it("defaults to monitor-first and rejects anything that is not a known mode", () => {
    expect(parseCaEnforcementMode(undefined)).toBe("monitor-first");
    expect(parseCaEnforcementMode("")).toBe("monitor-first");
    expect(parseCaEnforcementMode("immediate")).toBe("immediate");
    expect(parseCaEnforcementMode("enabled")).toBeNull();
    expect(parseCaEnforcementMode("IMMEDIATE")).toBeNull();
  });

  it("maps monitor-first to report-only and immediate to enabled", () => {
    expect(caPolicyStateForMode("monitor-first")).toBe(CA_STATE_REPORT_ONLY);
    expect(caPolicyStateForMode("immediate")).toBe(CA_STATE_ENABLED);
  });

  it("defaults an absent or empty caPolicyState to report-only, and leaves a chosen one alone", () => {
    expect(withCaPolicyStateDefault({}).caPolicyState).toBe(CA_STATE_REPORT_ONLY);
    expect(withCaPolicyStateDefault({ caPolicyState: "" }).caPolicyState).toBe(CA_STATE_REPORT_ONLY);
    expect(withCaPolicyStateDefault({ caPolicyState: "enabled" }).caPolicyState).toBe("enabled");
  });
});

describe("classifyCaEnforcementWrite", () => {
  it("flags a create with state enabled and a PATCH of one policy to enabled", () => {
    expect(classifyCaEnforcementWrite({ method: "POST", endpoint: "/identity/conditionalAccess/policies", body: { state: "enabled" } }))
      .toBe("create_enforced");
    expect(classifyCaEnforcementWrite({ method: "patch", endpoint: `/v1.0/identity/conditionalAccess/policies/${POLICY_ID}`, body: { state: "enabled" } }))
      .toBe("enable_existing");
    expect(classifyCaEnforcementWrite({
      method: "PATCH", endpoint: `https://graph.microsoft.com/beta/identity/conditionalAccess/policies/${POLICY_ID}/`, body: { state: "enabled" },
    })).toBe("enable_existing");
  });

  it("does not flag report-only, disabled, state-less, or non-policy writes", () => {
    const policies = "/identity/conditionalAccess/policies";
    expect(classifyCaEnforcementWrite({ method: "POST", endpoint: policies, body: { state: CA_STATE_REPORT_ONLY } })).toBeNull();
    expect(classifyCaEnforcementWrite({ method: "PATCH", endpoint: `${policies}/${POLICY_ID}`, body: { state: "disabled" } })).toBeNull();
    expect(classifyCaEnforcementWrite({ method: "PATCH", endpoint: `${policies}/${POLICY_ID}`, body: { displayName: "x" } })).toBeNull();
    expect(classifyCaEnforcementWrite({ method: "DELETE", endpoint: `${policies}/${POLICY_ID}`, body: {} })).toBeNull();
    expect(classifyCaEnforcementWrite({ method: "POST", endpoint: "/identity/conditionalAccess/namedLocations", body: { state: "enabled" } }))
      .toBeNull();
    expect(classifyCaEnforcementWrite({ method: "PATCH", endpoint: "/policies/authorizationPolicy", body: { state: "enabled" } })).toBeNull();
  });
});

describe("precondition rule 0 — CA enforcement only by explicit choice", () => {
  const evaluate = (steps: PackPreconditionStep[], payload: Record<string, unknown>, mode?: "monitor-first" | "immediate") =>
    evaluateConfigPackPreconditions({ packKey: "p", steps, payload, tenantPlans: P1, ...(mode ? { caEnforcementMode: mode } : {}) });

  it("lets a monitor-first CA create through — {{caPolicyState}} resolves report-only", () => {
    expect(evaluate([mfaAllUsers], { breakGlassGroupId: "g", caEnforcementMode: "monitor-first", caPolicyState: CA_STATE_REPORT_ONLY }, "monitor-first"))
      .toBeNull();
    // A caller that never stamped a state (execute_action / SOP) gets the same default.
    expect(evaluate([mfaAllUsers], { breakGlassGroupId: "g" })).toBeNull();
  });

  it("refuses an enforcing create when the state was slipped in without the immediate mode", () => {
    const refusal = evaluate([mfaAllUsers], { breakGlassGroupId: "g", caPolicyState: "enabled" });
    expect(refusal?.code).toBe("ca_enforcement_requires_promotion");
    expect(refusal?.details).toMatchObject({
      caEnforcementMode: "monitor-first",
      enforcingSteps: [{ templateId: "action.create-ca-mfa-all-users-policy", kind: "create_enforced" }],
    });
    expect(refusal?.message).toContain("Nothing was written");
  });

  it("refuses enabling an existing policy on a monitor-first run (the conditional-access-baseline-v1 microrem step)", () => {
    expect(evaluate([enforceExisting], { policyId: POLICY_ID })?.code).toBe("ca_enforcement_requires_promotion");
    expect(evaluate([setState], { policyId: POLICY_ID, state: "enabled" })?.code).toBe("ca_enforcement_requires_promotion");
    // Setting report-only or disabled through the same template is not enforcement.
    expect(evaluate([setState], { policyId: POLICY_ID, state: CA_STATE_REPORT_ONLY })).toBeNull();
    expect(evaluate([setState], { policyId: POLICY_ID, state: "disabled" })).toBeNull();
  });

  it("is refused ahead of the license rule, whatever the tenant holds", () => {
    const refusal = evaluateConfigPackPreconditions({
      packKey: "p", steps: [enforceExisting, mfaAllUsers], payload: { policyId: POLICY_ID, breakGlassGroupId: "g" },
      tenantPlans: { servicePlanNames: new Set(["EXCHANGE_S_ENTERPRISE", "SHAREPOINTENTERPRISE"]), error: null },
    });
    expect(refusal?.code).toBe("ca_enforcement_requires_promotion");
  });

  it("allows the same writes under the explicit immediate override", () => {
    expect(evaluate([enforceExisting], { policyId: POLICY_ID }, "immediate")).toBeNull();
    expect(evaluate([mfaAllUsers], { breakGlassGroupId: "g", caPolicyState: "enabled" }, "immediate")).toBeNull();
  });

  it("quickstart: Security Defaults stays on under monitor-first, and comes off only with an immediate enforcing replacement", () => {
    const quickstartCa: PackPreconditionStep = { ...mfaAllUsers, templateId: "quickstart-v1.create-ca-baseline-policy" };
    const monitorFirst = evaluate(
      [disableSecurityDefaults, quickstartCa],
      { breakGlassGroupId: "g", caPolicyState: caPolicyStateForMode("monitor-first") },
      "monitor-first",
    );
    expect(monitorFirst?.code).toBe("security_defaults_replacement_not_enforcing");
    expect(evaluate(
      [disableSecurityDefaults, quickstartCa],
      { breakGlassGroupId: "g", caPolicyState: caPolicyStateForMode("immediate") },
      "immediate",
    )).toBeNull();
  });
});

// ── #4531 lookup, as the #4522 migration rewrites its state requirement ──
const LOOKUP_MIGRATION = fileURLToPath(
  new URL("../../../../lib/db/migrations/manual/2026-09-17-ca-policy-existence-lookup-4531.sql", import.meta.url),
);
const ENFORCEMENT_MIGRATION = fileURLToPath(
  new URL("../../../../lib/db/migrations/manual/2026-09-17-ca-enforcement-mode-and-promotions-4522.sql", import.meta.url),
);

describe("#4522 migration — re-run after promotion", () => {
  const migrationSql = readFileSync(ENFORCEMENT_MIGRATION, "utf8");
  const rewrittenState = /jsonb_set\(s\.step, '\{skipRequires,state\}', '"([^"]+)"'::jsonb\)/.exec(migrationSql)?.[1];

  const lookups: Record<string, BaselineTemplateResolveStep> = {};
  for (const m of readFileSync(LOOKUP_MIGRATION, "utf8").matchAll(/\('([\w.-]+)', \$json\$(\{[\s\S]*?\})\$json\$::jsonb\)/g)) {
    const step = JSON.parse(m[2]) as BaselineTemplateResolveStep;
    lookups[m[1]] = { ...step, skipRequires: { ...step.skipRequires, state: rewrittenState ?? "" } };
  }
  const step = lookups["action.create-ca-mfa-all-users-policy"]!;
  const BG = "2bf1151a-724d-454d-8037-9e56daeda834";
  const existing = (state: string) => ({
    id: POLICY_ID,
    displayName: "Baseline: Require MFA for All Users (report-only)",
    state,
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] }, clientAppTypes: ["all"] },
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  });
  const run = (state: string) => runTemplateResolveSteps([step], { breakGlassGroupId: BG }, async () => ({ value: [existing(state)] }));

  it("rewrites the state requirement to accept report-only or enabled, and switches the six bodies to {{caPolicyState}}", () => {
    expect(rewrittenState).toBe("in:enabledForReportingButNotEnforced,enabled");
    expect(migrationSql).toContain(`jsonb_set(body_template, '{state}', '"{{caPolicyState}}"'::jsonb)`);
    expect(Object.keys(lookups)).toHaveLength(6);
  });

  it("skips onto the pack's own policy whether it is still report-only or has been promoted", async () => {
    for (const state of [CA_STATE_REPORT_ONLY, CA_STATE_ENABLED]) {
      const outcome = await run(state);
      expect(outcome.failed).toBe(false);
      expect(outcome.skipWrite?.item).toMatchObject({ id: POLICY_ID, state });
    }
  });

  it("still fails closed on a same-named policy that is disabled", async () => {
    const outcome = await run("disabled");
    expect(outcome.failed).toBe(true);
    expect(outcome.reason).toContain("state expected");
  });
});
