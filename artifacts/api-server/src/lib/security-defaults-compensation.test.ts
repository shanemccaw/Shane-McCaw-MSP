/**
 * security-defaults-compensation.test.ts — Git #4529.
 *
 * The rule for when a finished run must re-enable Security Defaults. Template
 * shapes mirror the real quickstart-v1 rows (disable-security-defaults,
 * create-ca-baseline-policy); `data` is what Graph returns for a created policy.
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

import { planSecurityDefaultsCompensation, type ExecutedTemplateStep } from "./security-defaults-compensation.ts";

const TENANT = "00000000-0000-0000-0000-000000000abc";

function disableStep(over: Partial<ExecutedTemplateStep> = {}): ExecutedTemplateStep {
  return {
    nodeId: "sd",
    templateId: "quickstart-v1.disable-security-defaults",
    method: "PATCH",
    endpoint: "/policies/identitySecurityDefaultsEnforcementPolicy",
    bodyTemplate: { isEnabled: false },
    input: { customerId: 42 },
    output: { success: true, status: 204, data: null, templateId: "quickstart-v1.disable-security-defaults", tenantId: TENANT, customerId: 42 },
    ...over,
  };
}

function enforcingPolicy(state = "enabled"): Record<string, unknown> {
  return {
    id: "pol-1",
    state,
    conditions: {
      users: { includeUsers: ["All"], excludeGroups: ["g1"] },
      applications: { includeApplications: ["All"] },
      clientAppTypes: ["all"],
    },
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  };
}

function caStep(output: Record<string, unknown>, over: Partial<ExecutedTemplateStep> = {}): ExecutedTemplateStep {
  return {
    nodeId: "ca",
    templateId: "quickstart-v1.create-ca-baseline-policy",
    method: "POST",
    endpoint: "/identity/conditionalAccess/policies",
    bodyTemplate: { state: "{{caState}}" },
    input: { customerId: 42 },
    output: { templateId: "quickstart-v1.create-ca-baseline-policy", ...output },
    ...over,
  };
}

describe("planSecurityDefaultsCompensation", () => {
  it("needs compensation when Security Defaults was disabled and no CA step ran", () => {
    const plan = planSecurityDefaultsCompensation([disableStep()]);
    expect(plan.needed).toBe(true);
    if (!plan.needed) return;
    expect(plan.disableNodeId).toBe("sd");
    expect(plan.tenantId).toBe(TENANT);
    expect(plan.customerId).toBe(42);
    expect(plan.reason).toContain("no Conditional Access policy was created");
  });

  it("needs compensation when the CA create step failed (output.success false)", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep(),
      caStep({ success: false, status: 503, errorType: "unexpected" }),
    ]);
    expect(plan.needed).toBe(true);
  });

  it("does not compensate once Graph returned an enforcing policy", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep(),
      caStep({ success: true, status: 201, data: enforcingPolicy() }),
    ]);
    expect(plan.needed).toBe(false);
  });

  it("compensates when the created policy is report-only", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep(),
      caStep({ success: true, status: 201, data: enforcingPolicy("enabledForReportingButNotEnforced") }),
    ]);
    expect(plan.needed).toBe(true);
    if (!plan.needed) return;
    expect(plan.unconfirmedPolicies).toEqual([
      { nodeId: "ca", templateId: "quickstart-v1.create-ca-baseline-policy", gap: expect.stringContaining("not 'enabled'") },
    ]);
  });

  it("compensates when a CA create succeeded but returned no policy object", () => {
    const plan = planSecurityDefaultsCompensation([disableStep(), caStep({ success: true, status: 201, data: null })]);
    expect(plan.needed).toBe(true);
  });

  it("accepts an existing enforcing policy reported by a #4514 skip", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep(),
      caStep({ success: true, status: 200, skippedExisting: true, data: enforcingPolicy() }),
    ]);
    expect(plan.needed).toBe(false);
  });

  it("an enforcing policy created BEFORE the disable does not count", () => {
    const plan = planSecurityDefaultsCompensation([
      caStep({ success: true, status: 201, data: enforcingPolicy() }),
      disableStep(),
    ]);
    expect(plan.needed).toBe(true);
  });

  it("does nothing when the disable step itself failed", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep({ output: { success: false, status: 403, templateId: "quickstart-v1.disable-security-defaults" } }),
    ]);
    expect(plan.needed).toBe(false);
  });

  it("does nothing when a later step already re-enabled Security Defaults", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep(),
      disableStep({ nodeId: "sd-on", bodyTemplate: { isEnabled: true } }),
    ]);
    expect(plan.needed).toBe(false);
  });

  it("resolves a templated isEnabled against the node's own input", () => {
    const templated = { bodyTemplate: { isEnabled: "{{sdEnabled}}" } };
    expect(planSecurityDefaultsCompensation([disableStep({ ...templated, input: { sdEnabled: "false" } })]).needed).toBe(true);
    // A string "true" does not resolve to the boolean true, so it counts as a disable.
    expect(planSecurityDefaultsCompensation([disableStep({ ...templated, input: { sdEnabled: "true" } })]).needed).toBe(true);
  });

  it("ignores unrelated template steps", () => {
    const plan = planSecurityDefaultsCompensation([
      {
        nodeId: "grp", templateId: "quickstart-v1.create-exclusion-group", method: "POST", endpoint: "/groups",
        bodyTemplate: {}, input: {}, output: { success: true, status: 201, data: { id: "g" } },
      },
    ]);
    expect(plan.needed).toBe(false);
  });

  it("falls back to the input customerId when the output has none", () => {
    const plan = planSecurityDefaultsCompensation([
      disableStep({ input: { customerId: "7" }, output: { success: true, status: 204, tenantId: TENANT } }),
    ]);
    expect(plan.needed && plan.customerId).toBe(7);
  });
});
