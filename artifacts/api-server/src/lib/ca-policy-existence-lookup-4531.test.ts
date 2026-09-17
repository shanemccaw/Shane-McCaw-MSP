/**
 * ca-policy-existence-lookup-4531.test.ts — Git #4531
 *
 * The six Conditional Access policy create templates (identity-ca-hardening-v1 x5,
 * quickstart-v1's CA baseline) now end in a resolve-then-skip lookup by displayName
 * whose `skipRequires` decides whether a same-named existing policy really is the
 * one the template creates. Skip only when it is; fail closed otherwise.
 *
 * The step JSON is read out of the real migration file
 * (lib/db/migrations/manual/2026-09-17-ca-policy-existence-lookup-4531.sql), not
 * copied, so this suite tests exactly what the database holds. The body templates
 * below are the real baseline_action_templates.body_template rows; Graph responses
 * are injected fakes shaped like GET /identity/conditionalAccess/policies.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it, expect, vi } from "vitest";

import { runTemplateResolveSteps, type BaselineTemplateResolveStep } from "./resolve-then-write.ts";

const MIGRATION = fileURLToPath(
  new URL("../../../../lib/db/migrations/manual/2026-09-17-ca-policy-existence-lookup-4531.sql", import.meta.url),
);

const LOOKUPS: Record<string, BaselineTemplateResolveStep> = {};
for (const m of readFileSync(MIGRATION, "utf8").matchAll(/\('([\w.-]+)', \$json\$(\{[\s\S]*?\})\$json\$::jsonb\)/g)) {
  LOOKUPS[m[1]] = JSON.parse(m[2]) as BaselineTemplateResolveStep;
}

const BG = "2bf1151a-724d-454d-8037-9e56daeda834";

/** The real body_template of each template, with {{breakGlassGroupId}} as the run resolved it. */
const BODIES: Record<string, Record<string, unknown>> = {
  "action.create-ca-legacy-auth-block-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] }, clientAppTypes: ["exchangeActiveSync", "other"] },
    displayName: "Baseline: Block Legacy Authentication (report-only)",
    grantControls: { operator: "OR", builtInControls: ["block"] },
  },
  "action.create-ca-mfa-all-users-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] }, clientAppTypes: ["all"] },
    displayName: "Baseline: Require MFA for All Users (report-only)",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
  "action.create-ca-signin-risk-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] }, clientAppTypes: ["all"], signInRiskLevels: ["high", "medium"] },
    displayName: "Baseline: Require MFA on Sign-In Risk (report-only)",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
  "action.create-ca-user-risk-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] }, userRiskLevels: ["high"] },
    displayName: "Baseline: Secure Password Change on User Risk (report-only)",
    grantControls: { operator: "AND", builtInControls: ["passwordChange", "mfa"] },
  },
  "action.create-ca-guest-mfa-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["GuestsOrExternalUsers"] }, applications: { includeApplications: ["All"] }, clientAppTypes: ["all"] },
    displayName: "Baseline: Require MFA for Guests (report-only)",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
  "quickstart-v1.create-ca-baseline-policy": {
    state: "enabledForReportingButNotEnforced",
    conditions: { users: { includeUsers: ["All"], excludeGroups: [BG] }, applications: { includeApplications: ["All"] } },
    displayName: "Quick-Start Baseline: Require MFA for All Users",
    grantControls: { operator: "OR", builtInControls: ["mfa"] },
  },
};

const EXCLUDES_BREAK_GLASS = Object.keys(BODIES).filter((id) => id !== "action.create-ca-guest-mfa-policy");

/** A Graph policy as it reads back: the created body plus server-assigned fields and defaults. */
function policyFrom(body: Record<string, unknown>, id: string, patch: (p: any) => void = () => {}) {
  const p = structuredClone({ id, createdDateTime: "2026-09-17T15:00:00Z", ...body }) as any;
  p.conditions.users = { excludeUsers: [], includeGroups: [], includeRoles: [], excludeRoles: [], excludeGroups: [], ...p.conditions.users };
  patch(p);
  return p;
}

function policiesGraph(policies: unknown[]) {
  return vi.fn(async (endpoint: string) => {
    if (endpoint.startsWith("/identity/conditionalAccess/policies")) return { value: policies };
    throw new Error(`unexpected GET ${endpoint}`);
  });
}

const run = (templateId: string, policies: unknown[], payload: Record<string, unknown> = { breakGlassGroupId: BG }) =>
  runTemplateResolveSteps([LOOKUPS[templateId]], payload, policiesGraph(policies));

describe("#4531 migration carries a lookup for all six CA create templates", () => {
  it("parses one skip-write lookup per template, each matching its own body's displayName", () => {
    expect(Object.keys(LOOKUPS).sort()).toEqual(Object.keys(BODIES).sort());
    for (const [templateId, step] of Object.entries(LOOKUPS)) {
      expect(step.onMatch).toBe("skip-write");
      expect(step.endpoint.startsWith("/identity/conditionalAccess/policies")).toBe(true);
      expect(step.selectMatch?.displayName).toBe(`ieq:${BODIES[templateId].displayName}`);
      expect(step.skipRequires?.state).toBe("enabledForReportingButNotEnforced");
    }
    for (const templateId of EXCLUDES_BREAK_GLASS) {
      expect(LOOKUPS[templateId].skipRequires?.["conditions.users.excludeGroups"]).toBe("has:{{breakGlassGroupId}}");
    }
  });
});

describe.each(Object.keys(BODIES))("#4531 %s", (templateId) => {
  const body = BODIES[templateId];

  it("no policy by that name → the POST proceeds (no skip, no failure)", async () => {
    const out = await run(templateId, [policyFrom({ ...body, displayName: "Some Other Policy" }, "p-other")]);
    expect(out.failed).toBe(false);
    expect(out.skipWrite).toBeUndefined();
  });

  it("exactly the policy this template creates → skip the POST onto it", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1")]);
    expect(out.failed).toBe(false);
    expect((out.skipWrite?.item as { id: string }).id).toBe("p-1");
  });

  it("name matches case-insensitively → still recognized (skip)", async () => {
    const out = await run(templateId, [policyFrom({ ...body, displayName: String(body.displayName).toUpperCase() }, "p-1")]);
    expect((out.skipWrite?.item as { id: string } | undefined)?.id).toBe("p-1");
  });

  it("two policies by that name → fail closed with both ids", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1"), policyFrom(body, "p-2")]);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain("ambiguous");
    expect(out.reason).toContain("p-1, p-2");
  });

  it("already enforced (state enabled) → fail closed, no skip", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.state = "enabled"; })]);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain("(id p-1)");
    expect(out.reason).toContain('state expected "enabledForReportingButNotEnforced", found "enabled"');
  });

  it("targets different users → fail closed, no skip", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.conditions.users.includeUsers = ["00b799b7-e544-4389-b4ef-1968c24ed6f8"]; })]);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("conditions.users.includeUsers");
  });

  it("different grant control → fail closed, no skip", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.grantControls.builtInControls = ["compliantDevice"]; })]);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("grantControls.builtInControls");
  });
});

describe.each(EXCLUDES_BREAK_GLASS)("#4531 break-glass exclusion rule — %s", (templateId) => {
  const body = BODIES[templateId];

  it("existing policy with NO excluded group → fail closed", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.conditions.users.excludeGroups = []; })]);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain(`conditions.users.excludeGroups expected "has:${BG}", found []`);
  });

  it("existing policy excluding a DIFFERENT group → fail closed", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.conditions.users.excludeGroups = ["19219599-c6c4-40fe-9a22-7badc05519ed"]; })]);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("conditions.users.excludeGroups");
  });

  it("existing policy excluding the break-glass group among others → skip", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1", (p) => { p.conditions.users.excludeGroups = ["19219599-c6c4-40fe-9a22-7badc05519ed", BG.toUpperCase()]; })]);
    expect((out.skipWrite?.item as { id: string } | undefined)?.id).toBe("p-1");
  });

  it("breakGlassGroupId never resolved → an exclusion cannot be confirmed, fail closed", async () => {
    const out = await run(templateId, [policyFrom(body, "p-1")], {});
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain('conditions.users.excludeGroups expected "has:"');
  });
});

describe("#4531 the lookup runs after #4514's break-glass resolve and reads its result", () => {
  it("action.create-ca-mfa-all-users-policy: group resolved + verified, then the existing policy excluding it is skipped onto", async () => {
    const breakGlassSteps: BaselineTemplateResolveStep[] = [
      { subject: "the break-glass CA exclusion group", endpoint: "/groups?$filter=x", unique: true, assign: { breakGlassGroupId: "id" } },
      {
        endpoint: "/groups/{{breakGlassGroupId}}/transitiveMembers/microsoft.graph.user",
        selectMatch: { accountEnabled: "true" },
        collect: { breakGlassEnabledMemberIds: "id" },
        assign: {},
      },
      {
        endpoint: "/roleManagement/directory/roleAssignments",
        selectMatch: { principalId: "in:{{breakGlassEnabledMemberIds}}", directoryScopeId: "/" },
        assign: { breakGlassVerifiedAdminId: "principalId" },
      },
    ];
    const graphGet = vi.fn(async (endpoint: string) => {
      if (endpoint.startsWith("/groups?")) return { value: [{ id: BG }] };
      if (endpoint.startsWith(`/groups/${BG}/transitiveMembers`)) return { value: [{ id: "u-bg", accountEnabled: true }] };
      if (endpoint.startsWith("/roleManagement")) return { value: [{ id: "ra-1", principalId: "u-bg", directoryScopeId: "/" }] };
      if (endpoint.startsWith("/identity/conditionalAccess/policies")) {
        return { value: [policyFrom(BODIES["action.create-ca-mfa-all-users-policy"], "p-mfa")] };
      }
      throw new Error(`unexpected GET ${endpoint}`);
    });
    const out = await runTemplateResolveSteps(
      [...breakGlassSteps, LOOKUPS["action.create-ca-mfa-all-users-policy"]],
      { breakGlassGroupId: "operator-typed-guid" },
      graphGet,
    );
    expect(out.failed).toBe(false);
    expect(out.resolvedVars.breakGlassGroupId).toBe(BG);
    expect((out.skipWrite?.item as { id: string }).id).toBe("p-mfa");
    expect(out.lookups).toHaveLength(4);
  });
});

describe("#4531 has: / ieq: conventions", () => {
  const step = (selectMatch: Record<string, string>): BaselineTemplateResolveStep => ({ endpoint: "/x", selectMatch, assign: { picked: "id" } });
  const graph = (value: unknown[]) => vi.fn(async () => ({ value }));

  it("has: requires every listed value in an array field; a scalar field never matches", async () => {
    const items = [{ id: "a", tags: "x,y" }, { id: "b", tags: ["x"] }, { id: "c", tags: ["Y", "x"] }];
    const out = await runTemplateResolveSteps([step({ tags: "has:x,y" })], {}, graph(items));
    expect(out.resolvedVars.picked).toBe("c");
  });

  it("ieq: never matches an expectation that interpolates to nothing", async () => {
    const out = await runTemplateResolveSteps([step({ displayName: "ieq:{{missing}}" })], {}, graph([{ id: "a", displayName: "" }]));
    expect(out.failed).toBe(true);
  });

  it("skipRequires is ignored on a non-skip step (no behavior change for existing templates)", async () => {
    const out = await runTemplateResolveSteps(
      [{ endpoint: "/x", assign: { picked: "id" }, skipRequires: { state: "never" } }],
      {},
      graph([{ id: "a", state: "enabled" }]),
    );
    expect(out.failed).toBe(false);
    expect(out.resolvedVars.picked).toBe("a");
  });
});
