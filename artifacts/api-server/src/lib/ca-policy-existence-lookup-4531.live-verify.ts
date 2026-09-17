/**
 * ca-policy-existence-lookup-4531.live-verify.ts — Git #4531
 *
 * Live verification against the testbed tenant (mccawsoft2, tenants.id 2080) of the
 * CA policy existence lookup the #4531 migration appended to six templates. Runs
 * ONLY the resolve lookups (resolveTemplateLookups) — never
 * runBaselineTemplateAgainstTenant — so no template write can fire.
 *
 * The testbed holds 0 CA policies, so a skip/fail-closed decision can only be seen
 * against a real policy. As of 2026-09-17 it also has no Entra ID P1, and the POST
 * below is refused (403 "Your tenant is not licensed for this feature"): the three
 * policy-dependent tests then SKIP with that reason rather than pass, and nothing is
 * created. They run as written once the tenant is licensed.
 * The one tenant write here is a synthetic policy created and
 * deleted by this file, via the DEV write app registration (9f6f4772-…):
 *   - state "disabled" (evaluates for nobody, enforces nothing, logs nothing)
 *   - includeUsers only the sanctioned synthetic identity zz-test-graphwrite-01
 *     (#2840, no roles/groups/licences)
 *   - deleted in afterAll, and any leftover disabled copy targeting only that
 *     identity is swept on start
 *
 *   node --env-file=<repo>/.env.local node_modules/vitest/vitest.mjs run \
 *     --config vitest.live-verify.config.ts src/lib/ca-policy-existence-lookup-4531.live-verify.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, baselineActionTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveTemplateLookups } from "./workflow-executor.ts";
import { getWriteAccessTokenForTenant, graphReadForTenantWithWriteToken } from "./graph.ts";
import type { BaselineTemplateResolveStep } from "./resolve-then-write.ts";

const TESTBED_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";
const SYNTHETIC_USER_ID = "bdb21dc3-146a-4d97-a128-a2b8ff618d35"; // zz-test-graphwrite-01 (#2840)
const EXCLUSION_GROUP = "2bf1151a-724d-454d-8037-9e56daeda834"; // a real testbed "Break-Glass Accounts - CA Exclusion" group
const OTHER_GROUP = "19219599-c6c4-40fe-9a22-7badc05519ed"; // the testbed's second one
const POLICY_NAME = "Baseline: Require MFA for All Users (report-only)";
const POLICIES = "/identity/conditionalAccess/policies";

const TEMPLATES = [
  "action.create-ca-legacy-auth-block-policy",
  "action.create-ca-mfa-all-users-policy",
  "action.create-ca-signin-risk-policy",
  "action.create-ca-user-risk-policy",
  "action.create-ca-guest-mfa-policy",
  "quickstart-v1.create-ca-baseline-policy",
];

const show = (label: string, v: unknown) => console.log(`#4531 live — ${label}:`, JSON.stringify(v, null, 2));

async function stepsOf(templateId: string): Promise<BaselineTemplateResolveStep[]> {
  const [row] = await db
    .select({ resolveSteps: baselineActionTemplatesTable.resolveSteps })
    .from(baselineActionTemplatesTable)
    .where(eq(baselineActionTemplatesTable.templateId, templateId))
    .limit(1);
  return (row?.resolveSteps ?? []) as BaselineTemplateResolveStep[];
}

const lookupOf = async (templateId: string) => (await stepsOf(templateId)).at(-1)!;

async function graphWrite(method: "POST" | "DELETE", path: string, body?: unknown): Promise<{ status: number; json: any }> {
  const token = await getWriteAccessTokenForTenant(TESTBED_TENANT_ID);
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Only ever deletes a disabled policy by this name that targets nothing but the synthetic identity. */
async function sweepSynthetic(): Promise<string[]> {
  const list = await graphReadForTenantWithWriteToken(TESTBED_TENANT_ID, `${POLICIES}?$select=id,displayName,state,conditions`);
  const deleted: string[] = [];
  for (const p of list.value as any[]) {
    const users = p.conditions?.users ?? {};
    if (
      p.displayName === POLICY_NAME &&
      p.state === "disabled" &&
      JSON.stringify(users.includeUsers) === JSON.stringify([SYNTHETIC_USER_ID]) &&
      (users.includeGroups ?? []).length === 0 &&
      (users.includeRoles ?? []).length === 0
    ) {
      const del = await graphWrite("DELETE", `${POLICIES}/${p.id}`);
      show(`DELETE synthetic ${p.id}`, del.status);
      deleted.push(p.id);
    }
  }
  return deleted;
}

/** A just-created policy can lag on a list read; poll (bounded, 15 × 2s) until every id is visible. */
async function waitUntilListed(ids: string[]): Promise<void> {
  for (let i = 0; i < 15; i++) {
    const list = await graphReadForTenantWithWriteToken(TESTBED_TENANT_ID, `${POLICIES}?$select=id`);
    const seen = new Set((list.value as Array<{ id: string }>).map((p) => p.id));
    if (ids.every((id) => seen.has(id))) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`created policies ${ids.join(", ")} never appeared in the list read`);
}

const synthetic = (): Record<string, unknown> => ({
  displayName: POLICY_NAME,
  state: "disabled",
  conditions: {
    users: { includeUsers: [SYNTHETIC_USER_ID], excludeGroups: [EXCLUSION_GROUP] },
    applications: { includeApplications: ["All"] },
    clientAppTypes: ["all"],
  },
  grantControls: { operator: "OR", builtInControls: ["mfa"] },
});

describe("#4531 CA policy existence lookup (live)", () => {
  const created: string[] = [];
  let unlicensed: string | null = null;

  beforeAll(async () => {
    show("pre-run sweep", await sweepSynthetic());
  });

  afterAll(async () => {
    for (const id of created) {
      const del = await graphWrite("DELETE", `${POLICIES}/${id}`);
      show(`cleanup DELETE ${id}`, del.status);
    }
    const after = await graphReadForTenantWithWriteToken(TESTBED_TENANT_ID, `${POLICIES}?$select=id,displayName,state`);
    show("CA policies after cleanup", after.value);
  });

  it("all six templates end in the skip-write lookup, and with no policy by that name the POST would proceed", async () => {
    for (const templateId of TEMPLATES) {
      const lookup = await lookupOf(templateId);
      expect(lookup.onMatch).toBe("skip-write");
      const out = await resolveTemplateLookups([lookup], TESTBED_TENANT_ID, { breakGlassGroupId: EXCLUSION_GROUP });
      show(`${templateId} (no existing policy)`, out);
      expect(out.failed).toBe(false);
      expect(out.skipWrite).toBeUndefined();
      expect(out.lookups[0].pages).toBe(1);
      expect(out.lookups[0].matchedCount).toBe(0);
    }
  });

  it("the four break-glass templates still stop at #4514's ambiguous-group check before reaching the lookup", async () => {
    for (const templateId of TEMPLATES.slice(0, 4)) {
      const out = await resolveTemplateLookups(await stepsOf(templateId), TESTBED_TENANT_ID, {});
      expect(out.failed).toBe(true);
      expect(out.reason).toContain("ambiguous");
      expect(out.lookups).toHaveLength(1);
    }
  });

  it("a real same-named policy that is not the template's (disabled, other users) fails closed; its real excludeGroups shape satisfies has:", async ({ skip }) => {
    const post = await graphWrite("POST", POLICIES, synthetic());
    show("POST synthetic policy", { status: post.status, id: post.json?.id, error: post.json?.error });
    // Run 2026-09-17: 403 AccessDenied "Your tenant is not licensed for this feature" —
    // the testbed has no Entra ID P1, so no CA policy can exist there to look up.
    if (post.status === 403 && /not licensed/i.test(String(post.json?.error?.message))) {
      unlicensed = String(post.json.error.message);
      skip(`tenant cannot hold a CA policy: ${unlicensed}`);
    }
    expect(post.status).toBe(201);
    created.push(post.json.id);
    await waitUntilListed(created);

    const lookup = await lookupOf("action.create-ca-mfa-all-users-policy");
    const out = await resolveTemplateLookups([lookup], TESTBED_TENANT_ID, { breakGlassGroupId: EXCLUSION_GROUP });
    show("mfa-all-users vs synthetic (right group)", out);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain(`(id ${post.json.id})`);
    expect(out.reason).toContain('state expected "enabledForReportingButNotEnforced", found "disabled"');
    expect(out.reason).toContain("conditions.users.includeUsers");
    expect(out.reason).not.toContain("conditions.users.excludeGroups");
    expect(out.reason).not.toContain("grantControls.builtInControls");

    const wrongGroup = await resolveTemplateLookups([lookup], TESTBED_TENANT_ID, { breakGlassGroupId: OTHER_GROUP });
    show("mfa-all-users vs synthetic (other group)", wrongGroup.reason);
    expect(wrongGroup.failed).toBe(true);
    expect(wrongGroup.reason).toContain(`conditions.users.excludeGroups expected "has:${OTHER_GROUP}", found ["${EXCLUSION_GROUP}"]`);

    // The other templates' names do not match it — their POST would still proceed.
    const legacy = await resolveTemplateLookups([await lookupOf("action.create-ca-legacy-auth-block-policy")], TESTBED_TENANT_ID, { breakGlassGroupId: EXCLUSION_GROUP });
    expect(legacy.failed).toBe(false);
    expect(legacy.skipWrite).toBeUndefined();
  });

  it("the skip path fires on real Graph data when every requirement holds (requirements re-pointed at the synthetic policy's safe shape)", async ({ skip }) => {
    if (unlicensed) skip(`tenant cannot hold a CA policy: ${unlicensed}`);
    const lookup = await lookupOf("action.create-ca-mfa-all-users-policy");
    const repointed: BaselineTemplateResolveStep = {
      ...lookup,
      skipRequires: {
        ...lookup.skipRequires,
        state: "disabled",
        "conditions.users.includeUsers": `has:${SYNTHETIC_USER_ID}`,
      },
    };
    const out = await resolveTemplateLookups([repointed], TESTBED_TENANT_ID, { breakGlassGroupId: EXCLUSION_GROUP });
    show("repointed skip", { failed: out.failed, reason: out.reason, skippedOnto: (out.skipWrite?.item as any)?.id });
    expect(out.failed).toBe(false);
    expect((out.skipWrite?.item as { id: string }).id).toBe(created[0]);
  });

  it("two real policies by that name → fail closed with both ids", async ({ skip }) => {
    if (unlicensed) skip(`tenant cannot hold a CA policy: ${unlicensed}`);
    const post = await graphWrite("POST", POLICIES, synthetic());
    show("POST second synthetic policy", { status: post.status, id: post.json?.id });
    expect(post.status).toBe(201);
    created.push(post.json.id);
    await waitUntilListed(created);

    const out = await resolveTemplateLookups([await lookupOf("action.create-ca-mfa-all-users-policy")], TESTBED_TENANT_ID, { breakGlassGroupId: EXCLUSION_GROUP });
    show("two same-named", out.reason);
    expect(out.failed).toBe(true);
    expect(out.reason).toContain("ambiguous");
    expect(out.lookups[0].matchedIds.sort()).toEqual([...created].sort());
  });
});
