/**
 * break-glass-admin-override.live-verify.ts — Git #4015
 *
 * LIVE round trip from the break_glass_verification_gate's account-identity stamp
 * to performBreakGlassAdminOverride()'s real tenant reset. Nothing tested that
 * round trip before #4015, which is how the override came to PATCH
 * `/users/%5Bredacted%5D` on every gated run. Opt-in, like the #1911 harness:
 *
 *   npx vitest run --config vitest.live-verify.config.ts src/routes/break-glass-admin-override.live-verify.ts
 *
 * Requires .env.local loaded, WITH the generated-secret store unconfigured
 * (GENERATED_SECRET_VAULT_URL="" — empty, not unset, so it does not fall back to
 * AZURE_KEY_VAULT_URL). Locally that fallback is the production Key Vault, which
 * is outside agent reach (Git #1913), so this harness refuses to run otherwise.
 *
 * What that leaves observable, and why it is enough: the override resets the
 * tenant credential FIRST and only then asks the store to take the replacement.
 * With the store unconfigured the override answers 503 — which it can only reach
 * after `graphWriteForTenant` returned success. A wrong account id stops at 502.
 * The reset is then corroborated independently by the user's own
 * lastPasswordChangeDateTime moving on a real Graph read.
 *
 * The ONLY tenant write is a password reset on the sanctioned synthetic identity
 * `zz-test-graphwrite-01@mccawsoft2.onmicrosoft.com` (Git #2840) — no roles, no
 * groups, no licences. Its password is not held anywhere, so replacing it with a
 * discarded random value breaks nothing. Every row created here is removed.
 */

import { describe, it, expect, afterAll } from "vitest";
import {
  db,
  breakGlassPendingSecretsTable,
  breakGlassVerificationAttemptsTable,
  breakGlassOverrideAuditTable,
  tenantsTable,
  wfDefinitionsTable,
  wfNodeOutputSamplesTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfVersionsTable,
} from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";

import { fireWorkflowForDefinition } from "../lib/workflow-executor.ts";
import { generatedSecretStoreConfigured } from "../lib/generated-secret-store.ts";
import { graphFetchForTenant } from "../lib/graph.ts";
import {
  generateStrongPassword,
  performBreakGlassAdminOverride,
  resolvePendingContext,
} from "./break-glass-verification.ts";
// @ts-expect-error — plain .mjs script with no declarations; its CLI only runs when invoked directly.
import { TEST_USER_PREFIX, TEST_USER_UPN, TESTBED_INITIAL_DOMAIN, TESTBED_TENANT_ID } from "../../../../scripts/azure/testbed-test-user-2840.mjs";

const CUSTOMER_ID = 1; // the testbed tenant row

let definitionId = 0;
let runId = 0;
let accountObjectId = "";
let passwordChangedBefore: string | null = null;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function readTestUser(): Promise<{ id: string; userPrincipalName: string; lastPasswordChangeDateTime: string | null }> {
  const res = await graphFetchForTenant(
    TESTBED_TENANT_ID,
    `/users/${encodeURIComponent(TEST_USER_UPN)}?$select=id,userPrincipalName,lastPasswordChangeDateTime`,
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { id: string; userPrincipalName: string; lastPasswordChangeDateTime: string | null };
}

afterAll(async () => {
  if (runId) {
    const secretIds = (await db.select({ id: breakGlassPendingSecretsTable.id })
      .from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId))).map((r) => r.id);
    if (secretIds.length > 0) {
      await db.delete(breakGlassOverrideAuditTable).where(inArray(breakGlassOverrideAuditTable.newPendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassVerificationAttemptsTable).where(inArray(breakGlassVerificationAttemptsTable.pendingSecretId, secretIds)).catch(() => {});
      await db.delete(breakGlassPendingSecretsTable).where(inArray(breakGlassPendingSecretsTable.id, secretIds)).catch(() => {});
    }
    await db.delete(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId)).catch(() => {});
    await db.execute(sql`DELETE FROM wf_run_node_logs WHERE run_id = ${runId}`).catch(() => {});
    await db.delete(wfRunsTable).where(eq(wfRunsTable.id, runId)).catch(() => {});
  }
  if (definitionId) {
    await db.delete(wfNodeOutputSamplesTable).where(eq(wfNodeOutputSamplesTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfVersionsTable).where(eq(wfVersionsTable.definitionId, definitionId)).catch(() => {});
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, definitionId)).catch(() => {});
  }
});

describe("#4015 — break-glass admin-override resets the gated account, live", () => {
  it("refuses to run anywhere it could reach the vault or a non-synthetic identity", async () => {
    expect(generatedSecretStoreConfigured()).toBe(false);

    const [tenant] = await db.select({ tenantId: tenantsTable.tenantId, isTestbed: tenantsTable.isTestbed })
      .from(tenantsTable).where(eq(tenantsTable.id, CUSTOMER_ID)).limit(1);
    expect(tenant?.tenantId).toBe(TESTBED_TENANT_ID);
    expect(tenant?.isTestbed).toBe(true);

    const user = await readTestUser();
    expect(user.userPrincipalName.startsWith(TEST_USER_PREFIX)).toBe(true);
    expect(user.userPrincipalName.endsWith(`@${TESTBED_INITIAL_DOMAIN}`)).toBe(true);
    accountObjectId = user.id;
    passwordChangedBefore = user.lastPasswordChangeDateTime;
  });

  it("the gate keeps the account identity usable in the paused run and on its pending secret", async () => {
    expect(accountObjectId).not.toBe("");
    const plaintext = generateStrongPassword();

    // The shape config-pack-graph.ts builds for a gated create step: the map node
    // emits all four casings of the created user's id, then the gate pauses.
    const graph = {
      nodes: [
        { id: "start", type: "start", position: { x: 0, y: 0 }, data: { label: "Start" } },
        {
          id: "gate",
          type: "break_glass_verification_gate",
          position: { x: 200, y: 0 },
          data: { label: "Break-glass gate", secretField: "generatedPassword", customerIdField: "customerId", accountIdField: "breakGlassAccountId" },
        },
      ],
      edges: [{ id: "e1", source: "start", target: "gate" }],
    };

    const [def] = await db.insert(wfDefinitionsTable).values({
      name: "zz-test #4015 live verify", description: "temporary — removed by the test",
    }).returning({ id: wfDefinitionsTable.id });
    definitionId = def.id;
    const [ver] = await db.insert(wfVersionsTable).values({
      definitionId, versionNumber: 1, status: "published", graph: graph as never,
    }).returning({ id: wfVersionsTable.id });

    const fired = await fireWorkflowForDefinition(definitionId, "manual", "zz-test-4015-live-verify", {
      customerId: CUSTOMER_ID,
      generatedPassword: plaintext,
      breakglassUserId: accountObjectId,
      breakGlassUserId: accountObjectId,
      principalId: accountObjectId,
      breakGlassAccountId: accountObjectId,
    }, { versionId: ver.id });
    expect(fired).not.toBeNull();
    runId = fired!;

    let status = "";
    for (let i = 0; i < 60 && status !== "awaiting_approval"; i += 1) {
      await sleep(250);
      const [row] = await db.select({ status: wfRunsTable.status }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
      status = row?.status ?? "";
      if (status === "failed" || status === "completed" || status === "cancelled") break;
    }
    expect(status).toBe("awaiting_approval");

    // Soft, so a regression still reaches the override below and shows its real answer.
    const [run] = await db.select({ payload: wfRunsTable.payload }).from(wfRunsTable).where(eq(wfRunsTable.id, runId)).limit(1);
    const persisted = run.payload as Record<string, unknown>;
    console.log("[#4015] persisted run payload identity keys:", {
      breakGlassAccountId: persisted.breakGlassAccountId,
      breakGlassUserId: persisted.breakGlassUserId,
      principalId: persisted.principalId,
    });
    // What resume hands to quickstart-v1.assign-global-admin-role ({{breakGlassUserId}}).
    expect.soft(persisted.breakGlassUserId).toBe(accountObjectId);
    expect.soft(persisted.principalId).toBe(accountObjectId);
    expect.soft(persisted.breakGlassAccountId).toBe(accountObjectId);

    const [pending] = await db.select().from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId)).limit(1);
    expect(pending?.status).toBe("pending_delivery");
    expect.soft((pending as Record<string, unknown>).breakGlassAccountId).toBe(accountObjectId);

    // #1911's guarantee is untouched: the credential itself is nowhere in the database.
    const leaks = await db.execute(sql`
      SELECT 'wf_runs.payload' AS col, count(*) AS n FROM wf_runs
        WHERE id = ${runId} AND payload::text LIKE ${"%" + plaintext + "%"}
      UNION ALL SELECT 'wf_run_node_outputs', count(*) FROM wf_run_node_outputs
        WHERE run_id = ${runId} AND (output::text LIKE ${"%" + plaintext + "%"} OR input::text LIKE ${"%" + plaintext + "%"})
      UNION ALL SELECT 'wf_run_node_logs', count(*) FROM wf_run_node_logs
        WHERE run_id = ${runId} AND (message LIKE ${"%" + plaintext + "%"} OR metadata::text LIKE ${"%" + plaintext + "%"})
      UNION ALL SELECT 'wf_node_output_samples', count(*) FROM wf_node_output_samples
        WHERE definition_id = ${definitionId} AND sample::text LIKE ${"%" + plaintext + "%"}
    `);
    const rows = (leaks as unknown as { rows: Array<{ col: string; n: string }> }).rows
      ?? (leaks as unknown as Array<{ col: string; n: string }>);
    for (const row of rows) expect(`${row.col}=${row.n}`).toBe(`${row.col}=0`);
  });

  it("admin-override resets the real tenant account", async () => {
    expect(runId).not.toBe(0);
    const [pending] = await db.select({ id: breakGlassPendingSecretsTable.id }).from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.runId, runId)).limit(1);
    const ctx = await resolvePendingContext(pending.id);
    expect(ctx).not.toBeNull();

    const result = await performBreakGlassAdminOverride(ctx!, pending.id, 0, "zz-test #4015 live verify", undefined);
    console.log("[#4015] override result:", result);

    // 503 "store not configured" is only reachable once the tenant reset succeeded.
    expect(result).toMatchObject({ ok: false, status: 503 });

    // Corroborate on the directory object itself (Entra replication can lag a few seconds).
    let changedAfter = passwordChangedBefore;
    for (let i = 0; i < 12 && changedAfter === passwordChangedBefore; i += 1) {
      await sleep(5000);
      changedAfter = (await readTestUser()).lastPasswordChangeDateTime;
    }
    console.log("[#4015] lastPasswordChangeDateTime:", { before: passwordChangedBefore, after: changedAfter });
    expect(changedAfter).not.toBe(passwordChangedBefore);

    // Refused before the supersede/insert transaction, so the pending secret is untouched.
    const [after] = await db.select({ status: breakGlassPendingSecretsTable.status }).from(breakGlassPendingSecretsTable)
      .where(eq(breakGlassPendingSecretsTable.id, pending.id)).limit(1);
    expect(after.status).toBe("pending_delivery");
  }, 120_000);
});
