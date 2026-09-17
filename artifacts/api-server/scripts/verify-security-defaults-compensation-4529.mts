#!/usr/bin/env node
/**
 * #4529 — live verification of the Security Defaults compensating re-enable on the
 * real testbed tenant (tenants.id = 2080, mccawsoft2.onmicrosoft.com). Writes go
 * through the DEV write app registration (MT_APP_WRITE_CLIENT_ID).
 *
 * Scenario, through the real engine (executeWorkflowRun):
 *   start → quickstart-v1.disable-security-defaults (real PATCH isEnabled:false)
 *         → quickstart-v1.create-ca-baseline-policy, run WITHOUT breakGlassGroupId,
 *           so it fails on missing variables before any Graph call → run "failed".
 * Expect: the compensation re-enables Security Defaults and records it on the run.
 *
 * mccawsoft2 is also Shane's production M365 tenant, so the harness:
 *   - refuses to start unless Security Defaults is currently ON,
 *   - proves the CA step cannot write (missingVariables non-empty) before running,
 *   - restores Security Defaults itself if it is still off at the end (and FAILs),
 *   - deletes its throwaway workflow definition so it cannot be re-run from the UI.
 *
 * Needs the tenant's write-back consent (tenants.consent.writeBack.status = "granted");
 * the default mode refuses to start without it.
 *
 * --recorded-disable: for a tenant WITHOUT write-back consent. The run's
 * "disable succeeded" step is recorded directly on the run (output.simulated =
 * "verify-4529") instead of being executed; the graph is start → CA step only.
 * The real engine then fails the run, the real compensation reads the recorded
 * steps, fires the real re-enable, which the real consent gate blocks — so this
 * verifies detection + recording of a FAILED compensation, never a tenant write.
 *
 * Usage (from artifacts/api-server):
 *   node --env-file=../../.env.local --import tsx scripts/verify-security-defaults-compensation-4529.mts [--recorded-disable]
 */

import {
  db,
  baselineActionTemplateAuditLogTable,
  wfDefinitionsTable,
  wfRunNodeLogsTable,
  wfRunNodeOutputsTable,
  wfRunsTable,
  wfVersionsTable,
  tenantsTable,
} from "@workspace/db";
import type { WfGraph } from "@workspace/db";
import { asc, eq, sql } from "drizzle-orm";
import { graphFetchForTenant, graphWriteForTenant } from "../src/lib/graph.ts";
import { executeWorkflowRun, resolveBaselineTemplateRequest } from "../src/lib/workflow-executor.ts";
import { COMPENSATION_NODE_ID, SECURITY_DEFAULTS_ENDPOINT } from "../src/lib/security-defaults-compensation-run.ts";

const TESTBED_CUSTOMER_ID = 2080;
const SD_TEMPLATE = "quickstart-v1.disable-security-defaults";
const CA_TEMPLATE = "quickstart-v1.create-ca-baseline-policy";
const RECORDED_DISABLE = process.argv.includes("--recorded-disable");

async function securityDefaultsEnabled(tenantId: string): Promise<boolean | string> {
  const res = await graphFetchForTenant(tenantId, SECURITY_DEFAULTS_ENDPOINT);
  if (!res.ok) return `read failed: ${res.status}`;
  const v = ((await res.json()) as { isEnabled?: unknown }).isEnabled;
  return typeof v === "boolean" ? v : `unexpected isEnabled: ${String(v)}`;
}

async function main() {
  const [tenant] = await db.select().from(tenantsTable).where(eq(tenantsTable.id, TESTBED_CUSTOMER_ID)).limit(1);
  if (!tenant?.tenantId || tenant.isTestbed !== true) {
    console.error("ABORT — tenant 2080 missing or not flagged testbed");
    process.exit(2);
  }
  const tenantId = tenant.tenantId;
  console.log(`customer ${TESTBED_CUSTOMER_ID} tenant ${tenantId} isTestbed=${tenant.isTestbed} writeApp=${process.env.MT_APP_WRITE_CLIENT_ID}`);

  const writeConsent = (tenant.consent as { writeBack?: { status?: string } } | null)?.writeBack?.status ?? "no_row";
  console.log(`mode=${RECORDED_DISABLE ? "recorded-disable" : "real-disable"} writeBack consent=${writeConsent}`);
  if (!RECORDED_DISABLE && writeConsent !== "granted") {
    console.error("ABORT — no write-back consent for this tenant, so the disable step cannot run. Use --recorded-disable.");
    process.exit(2);
  }

  const sdBefore = await securityDefaultsEnabled(tenantId);
  console.log(`before: securityDefaults.isEnabled=${String(sdBefore)}`);
  if (sdBefore !== true) {
    console.error("ABORT — Security Defaults is not currently enabled; not touching it.");
    process.exit(2);
  }

  const payload = { customerId: String(TESTBED_CUSTOMER_ID) };
  const caResolved = await resolveBaselineTemplateRequest(CA_TEMPLATE, payload);
  console.log(`CA step missingVariables with this payload: ${JSON.stringify(caResolved.missingVariables)}`);
  if (caResolved.missingVariables.length === 0) {
    console.error("ABORT — the CA step would actually fire; this harness must never create a CA policy.");
    process.exit(2);
  }

  const graph: WfGraph = {
    nodes: RECORDED_DISABLE ? [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "verify-4529" } },
      { id: "ca", type: "execute_baseline_template", position: { x: 0, y: 200 },
        data: { nodeType: "execute_baseline_template", label: "Create CA baseline policy", templateId: CA_TEMPLATE, customerId: "{{customerId}}" } },
    ] : [
      { id: "start", type: "start", position: { x: 0, y: 0 }, data: { nodeType: "start", label: "verify-4529" } },
      { id: "sd", type: "execute_baseline_template", position: { x: 0, y: 100 },
        data: { nodeType: "execute_baseline_template", label: "Disable Security Defaults", templateId: SD_TEMPLATE, customerId: "{{customerId}}" } },
      { id: "ca", type: "execute_baseline_template", position: { x: 0, y: 200 },
        data: { nodeType: "execute_baseline_template", label: "Create CA baseline policy", templateId: CA_TEMPLATE, customerId: "{{customerId}}" } },
    ],
    edges: RECORDED_DISABLE ? [{ id: "e1", source: "start", target: "ca" }] : [
      { id: "e1", source: "start", target: "sd" },
      { id: "e2", source: "sd", target: "ca", sourceHandle: "success" },
    ],
  } as unknown as WfGraph;

  const [def] = await db.insert(wfDefinitionsTable).values({
    name: `verify-4529 security-defaults compensation ${new Date().toISOString()}`,
    description: "#4529 live verification harness — deleted by the harness after the run.",
  }).returning();
  const [ver] = await db.insert(wfVersionsTable).values({ definitionId: def!.id, versionNumber: 1, status: "draft", graph }).returning();
  const [run] = await db.insert(wfRunsTable).values({
    versionId: ver!.id, definitionId: def!.id, triggerType: "manual", triggerRef: "verify-4529", status: "pending", payload,
  }).returning();
  const runId = run!.id;
  console.log(`definition ${def!.id} version ${ver!.id} run ${runId}`);

  let exitCode = 1;
  try {
    if (RECORDED_DISABLE) {
      await db.insert(wfRunNodeOutputsTable).values({
        runId, nodeId: "sd", input: payload, status: "ok",
        output: { success: true, status: 204, data: null, templateId: SD_TEMPLATE, tenantId, customerId: TESTBED_CUSTOMER_ID, simulated: "verify-4529" },
      });
    }
    await executeWorkflowRun(runId);

    const [finalRun] = await db.select().from(wfRunsTable).where(eq(wfRunsTable.id, runId));
    const outputs = await db.select().from(wfRunNodeOutputsTable).where(eq(wfRunNodeOutputsTable.runId, runId)).orderBy(asc(wfRunNodeOutputsTable.id));
    const logs = await db.select().from(wfRunNodeLogsTable).where(eq(wfRunNodeLogsTable.runId, runId)).orderBy(asc(wfRunNodeLogsTable.id));
    const audit = await db.select().from(baselineActionTemplateAuditLogTable)
      .where(sql`${baselineActionTemplateAuditLogTable.afterSnapshot}->>'runId' = ${String(runId)}`);

    console.log(`\nrun.status=${finalRun?.status}`);
    console.log(`run.errorMessage=${finalRun?.errorMessage}`);
    for (const o of outputs) {
      console.log(`node ${o.nodeId} status=${o.status} output=${JSON.stringify(o.output)}`);
    }
    for (const l of logs) console.log(`log [${l.level}] ${l.nodeId}: ${l.message}`);
    for (const a of audit) console.log(`audit #${a.id} action=${a.action} after=${JSON.stringify(a.afterSnapshot)}`);

    const sdNode = outputs.find((o) => o.nodeId === "sd");
    const comp = outputs.find((o) => o.nodeId === COMPENSATION_NODE_ID);
    const sdAfter = await securityDefaultsEnabled(tenantId);
    console.log(`\nafter: securityDefaults.isEnabled=${String(sdAfter)}`);

    const compOut = (comp?.output ?? {}) as Record<string, unknown>;
    const checks = RECORDED_DISABLE ? {
      runFailed: finalRun?.status === "failed",
      compensationDetectedAndRecorded: comp !== undefined && compOut.compensation === "security_defaults_reenable",
      compensationAttemptedRealWriteAndWasGated: comp?.status === "error" && compOut.success === false && compOut.errorType === "WriteConsentRequiredError",
      runErrorMessageRecordsFailure: (finalRun?.errorMessage ?? "").includes("Compensation FAILED"),
      errorLogWritten: logs.some((l) => l.nodeId === COMPENSATION_NODE_ID && l.level === "error"),
      auditRowWritten: audit.some((a) => a.action === "failed"),
      tenantSecurityDefaultsStillOn: sdAfter === true,
    } : {
      disableStepSucceeded: sdNode?.status === "ok" && (sdNode.output as Record<string, unknown>).success === true,
      runFailed: finalRun?.status === "failed",
      compensationRecorded: comp?.status === "ok" && (comp.output as Record<string, unknown>).success === true,
      compensationReadBackEnabled: (comp?.output as Record<string, unknown> | undefined)?.readBackIsEnabled === true,
      runErrorMessageRecordsIt: (finalRun?.errorMessage ?? "").includes("Compensation: Security Defaults re-enabled"),
      auditRowWritten: audit.some((a) => a.action === "executed"),
      tenantSecurityDefaultsOn: sdAfter === true,
    };
    console.log(`checks: ${JSON.stringify(checks, null, 2)}`);
    exitCode = Object.values(checks).every(Boolean) ? 0 : 1;
  } finally {
    const sdFinal = await securityDefaultsEnabled(tenantId);
    if (sdFinal !== true) {
      console.error(`SAFETY NET — Security Defaults is ${String(sdFinal)}; restoring it directly.`);
      const restore = await graphWriteForTenant(tenantId, TESTBED_CUSTOMER_ID, SECURITY_DEFAULTS_ENDPOINT, "PATCH", { isEnabled: true }, [200, 204]);
      console.error(`safety-net restore: success=${restore.success} status=${restore.status}; now isEnabled=${String(await securityDefaultsEnabled(tenantId))}`);
      exitCode = 1;
    }
    await db.delete(wfDefinitionsTable).where(eq(wfDefinitionsTable.id, def!.id));
    console.log(`deleted harness definition ${def!.id} (cascades its version and run ${runId})`);
  }

  console.log(`\n── RESULT ── ${exitCode === 0 ? "PASS" : "FAIL"}`);
  process.exit(exitCode);
}

main().catch((err) => {
  console.error("ERROR:", err?.message ?? err);
  process.exit(1);
});
