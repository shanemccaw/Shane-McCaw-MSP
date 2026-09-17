/**
 * break-glass-resolve-steps-4514.live-verify.ts — Git #4514
 *
 * READ-ONLY live verification against the testbed tenant (mccawsoft2, tenants.id
 * 2080). Loads the real resolve_steps rows the #4514 migration wrote and runs ONLY
 * the resolve lookups (resolveTemplateLookups: Graph GETs with the write-app token).
 * It never calls runBaselineTemplateAgainstTenant, so no write can fire and no
 * audit row is written, whatever a lookup returns.
 *
 *   node --env-file=<repo>/.env.local node_modules/vitest/vitest.mjs run \
 *     --config vitest.live-verify.config.ts src/lib/break-glass-resolve-steps-4514.live-verify.ts
 */

import { describe, it, expect } from "vitest";
import { db, baselineActionTemplatesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { resolveTemplateLookups } from "./workflow-executor.ts";
import { loadConfigPack } from "./config-pack-orchestrator.ts";
import { buildConfigPackGraph, operatorRequiredVariables } from "./config-pack-graph.ts";
import { graphReadForTenantWithWriteToken } from "./graph.ts";
import type { BaselineTemplateResolveStep } from "./resolve-then-write.ts";

const TESTBED_TENANT_ID = "c4c814d4-3afe-441e-9145-62461d0a4fd3";

async function stepsOf(templateId: string): Promise<BaselineTemplateResolveStep[]> {
  const [row] = await db
    .select({ resolveSteps: baselineActionTemplatesTable.resolveSteps })
    .from(baselineActionTemplatesTable)
    .where(eq(baselineActionTemplatesTable.templateId, templateId))
    .limit(1);
  return (row?.resolveSteps ?? []) as BaselineTemplateResolveStep[];
}

const show = (label: string, v: unknown) => console.log(`#4514 live — ${label}:`, JSON.stringify(v, null, 2));

describe("#4514 break-glass resolve steps (live, read-only)", () => {
  it("identity-ca-hardening-v1 no longer asks the operator for breakGlassGroupId", async () => {
    const { templates } = await loadConfigPack("identity-ca-hardening-v1");
    const { ordered } = buildConfigPackGraph(templates);
    const operatorVars = operatorRequiredVariables(ordered);
    show("identity-ca-hardening-v1 operator variables", operatorVars);
    expect(operatorVars).not.toContain("breakGlassGroupId");
  });

  it("the CA pack refuses the testbed's two exclusion groups as ambiguous", async () => {
    for (const templateId of [
      "action.create-ca-legacy-auth-block-policy",
      "action.create-ca-mfa-all-users-policy",
      "action.create-ca-signin-risk-policy",
      "action.create-ca-user-risk-policy",
    ]) {
      const steps = await stepsOf(templateId);
      expect(steps).toHaveLength(3);
      const out = await resolveTemplateLookups(steps, TESTBED_TENANT_ID, { breakGlassGroupId: "operator-typed-guid" });
      show(`${templateId} resolve`, out);
      expect(out.failed).toBe(true);
      expect(out.reason).toContain("ambiguous");
      expect(out.lookups[0].matchedIds.sort()).toEqual(
        ["19219599-c6c4-40fe-9a22-7badc05519ed", "2bf1151a-724d-454d-8037-9e56daeda834"],
      );
    }
  });

  it("each testbed exclusion group on its own would still fail closed: no enabled Global Admin member", async () => {
    const steps = (await stepsOf("action.create-ca-mfa-all-users-policy")).slice(1);
    for (const groupId of ["19219599-c6c4-40fe-9a22-7badc05519ed", "2bf1151a-724d-454d-8037-9e56daeda834"]) {
      const out = await resolveTemplateLookups(steps, TESTBED_TENANT_ID, { breakGlassGroupId: groupId });
      show(`membership verification for ${groupId}`, out);
      expect(out.failed).toBe(true);
      expect(out.reason).toContain("an enabled user in the break-glass CA exclusion group");
    }
  });

  it("the membership + Global Admin verification resolves positively on a real group that holds an active GA", async () => {
    // Positive control for steps 2-3 only: a real tenant group whose enabled members
    // include an active tenant-wide Global Administrator. Read-only.
    const steps = (await stepsOf("action.create-ca-mfa-all-users-policy")).slice(1);
    const groups = await graphReadForTenantWithWriteToken(TESTBED_TENANT_ID, "/groups?$select=id,displayName&$top=50");
    let verified: Awaited<ReturnType<typeof resolveTemplateLookups>> | null = null;
    let controlGroup: string | null = null;
    for (const g of groups.value as Array<{ id: string; displayName: string }>) {
      const out = await resolveTemplateLookups(steps, TESTBED_TENANT_ID, { breakGlassGroupId: g.id });
      if (!out.failed) { verified = out; controlGroup = `${g.displayName} (${g.id})`; break; }
    }
    show(`positive control via ${controlGroup}`, verified);
    expect(verified?.resolvedVars.breakGlassVerifiedAdminId).toBeTruthy();
  });

  it("quickstart-v1 recognizes the two existing break-glass accounts and refuses to create a third", async () => {
    const out = await resolveTemplateLookups(
      await stepsOf("quickstart-v1.create-break-glass-account"),
      TESTBED_TENANT_ID,
      { domain: "some-other-verified-domain.example" },
    );
    show("quickstart-v1.create-break-glass-account resolve", out);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.reason).toContain("ambiguous");
    expect(out.lookups[0].matchedIds.sort()).toEqual(
      ["00b799b7-e544-4389-b4ef-1968c24ed6f8", "be87e536-2e86-4b29-9152-db0f580cfad4"],
    );
  });

  it("quickstart-v1 recognizes the two existing exclusion groups and refuses to create a third", async () => {
    const out = await resolveTemplateLookups(
      await stepsOf("quickstart-v1.create-ca-exclusion-group"),
      TESTBED_TENANT_ID,
      {},
    );
    show("quickstart-v1.create-ca-exclusion-group resolve", out);
    expect(out.failed).toBe(true);
    expect(out.skipWrite).toBeUndefined();
    expect(out.lookups[0].matchedIds.sort()).toEqual(
      ["19219599-c6c4-40fe-9a22-7badc05519ed", "2bf1151a-724d-454d-8037-9e56daeda834"],
    );
  });
});
