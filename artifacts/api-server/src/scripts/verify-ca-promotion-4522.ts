// Git #4522 — live verification of the CA enforcement mode and the promotion gate.
//
//   node artifacts/api-server/run-script.mjs src/scripts/verify-ca-promotion-4522.ts <tenants.id> <mspId>
//
// NO Graph write is fired. Graph calls are GETs (policies, /auditLogs/signIns,
// /subscribedSkus). Every write-shaped call below is one the gate must refuse BEFORE
// graphWriteForTenant, and the script asserts the refusal's typed errorType — a
// value graphWriteForTenant can never return — to prove no request left the process.
// Local-DB side effects, all reported: baseline_action_template_audit_log "failed"
// rows for the refused executor calls, one ca_policy_promotions "refused" row and
// its msp_audit_logs mirror.

import { eq } from "drizzle-orm";
import { db, tenantsTable, caPolicyPromotionsTable, mspAuditLogsTable } from "@workspace/db";
import { graphFetchForTenant } from "../lib/graph.ts";
import { resolveBaselineTemplateRequest, runBaselineTemplateAgainstTenant } from "../lib/workflow-executor.ts";
import { prepareConfigPackRun, ConfigPackError } from "../lib/config-pack-orchestrator.ts";
import { evaluateCaPolicyImpact, listCaPoliciesForTenant, promoteCaPolicy } from "../lib/ca-policy-promotion.ts";

const tenantRowId = Number(process.argv[2]);
const mspId = Number(process.argv[3]);
if (!Number.isInteger(tenantRowId) || !Number.isInteger(mspId)) {
  console.error("usage: verify-ca-promotion-4522.ts <tenants.id> <mspId>");
  process.exit(1);
}

let failures = 0;
const check = (label: string, ok: boolean, detail: unknown) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail === undefined ? "" : ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`}`);
};

const [tenant] = await db
  .select({ id: tenantsTable.id, name: tenantsTable.customerName, tenantId: tenantsTable.tenantId, isTestbed: tenantsTable.isTestbed, mspId: tenantsTable.mspId })
  .from(tenantsTable)
  .where(eq(tenantsTable.id, tenantRowId))
  .limit(1);
if (!tenant?.tenantId) {
  console.error(`tenants.id=${tenantRowId} not found or has no M365 tenant id`);
  process.exit(1);
}
console.log(`tenant ${tenant.id} ${tenant.name} (${tenant.tenantId}) mspId=${tenant.mspId} isTestbed=${tenant.isTestbed}\n`);

// ── 1. Live reads ────────────────────────────────────────────────────────────
const policies = await listCaPoliciesForTenant(tenant.tenantId);
console.log(`live CA policies: status=${policies.status} count=${policies.policies.length}` +
  (policies.policies.length ? ` — ${policies.policies.map((p) => `${p.displayName} [${p.state}, ${p.daysInCurrentState}d]`).join("; ")}` : "") +
  (policies.detail ? ` detail=${policies.detail}` : ""));
const probe = await graphFetchForTenant(tenant.tenantId, "/auditLogs/signIns?$top=1").then(
  async (r) => `HTTP ${r.status} ${r.ok ? "" : (await r.text()).slice(0, 200)}`,
  (err: unknown) => `${(err as Error).name}: ${(err as Error).message}`,
);
console.log(`live /auditLogs/signIns probe: ${probe}`);

const reportOnly = policies.policies.find((p) => p.reportOnly);
const targetPolicyId = reportOnly?.id ?? "00000000-0000-4000-8000-000000004522";
const impact = await evaluateCaPolicyImpact(tenant.tenantId, targetPolicyId);
console.log(`impact for ${reportOnly ? `report-only policy ${reportOnly.displayName}` : `absent policy ${targetPolicyId}`}: ` +
  JSON.stringify({ status: impact.status, detail: impact.detail, window: impact.window, complete: impact.complete, pagesRead: impact.pagesRead,
    counts: impact.summary && { scanned: impact.summary.signInsScanned, evaluated: impact.summary.evaluated, wouldBlock: impact.summary.wouldBlock,
      wouldInterrupt: impact.summary.wouldInterrupt, affectedUsers: impact.summary.affectedUserCount }, readiness: impact.readiness }));
if (!reportOnly) check("impact read reports a real non-ok status rather than inventing numbers", impact.status !== "ok" && impact.summary === null, impact.status);
console.log("");

// ── 2. Template resolution ───────────────────────────────────────────────────
for (const [label, payload, expected] of [
  ["no caller state → report-only", { breakGlassGroupId: "g" }, "enabledForReportingButNotEnforced"],
  ["immediate stamp → enabled", { breakGlassGroupId: "g", caPolicyState: "enabled" }, "enabled"],
] as const) {
  const r = await resolveBaselineTemplateRequest("action.create-ca-mfa-all-users-policy", payload);
  check(`create-ca-mfa-all-users-policy resolves (${label})`, r.body.state === expected, r.body.state);
}

// ── 3. Executor gate — refused before any Graph write ────────────────────────
// Always a policy id that does not exist on the tenant: this tenant is also a real
// production M365 tenant, so even a regressed gate could not enable a real policy here.
const ABSENT_POLICY_ID = "00000000-0000-4000-8000-000000004522";
const enableOne = { policyId: ABSENT_POLICY_ID, state: "enabled", customerId: tenant.id };
const noAuth = await runBaselineTemplateAgainstTenant("action.set-ca-policy-state", tenant.tenantId, tenant.id, enableOne, "verify_4522");
check("set-ca-policy-state → enabled with no authorization is refused pre-write", noAuth.errorType === "ca_enforcement_refused" && noAuth.status === 409,
  { status: noAuth.status, errorType: noAuth.errorType });
const forged = await runBaselineTemplateAgainstTenant("action.set-ca-policy-state", tenant.tenantId, tenant.id, enableOne, "verify_4522",
  { caEnforcement: { kind: "verified_promotion", promotionId: 2_000_000_000 } });
check("a promotion id that does not exist is refused pre-write", forged.errorType === "ca_enforcement_refused", { status: forged.status, errorType: forged.errorType });
const packImmediateWrongPayload = await runBaselineTemplateAgainstTenant("action.set-ca-policy-state", tenant.tenantId, tenant.id, enableOne, "verify_4522",
  { caEnforcement: { kind: "config_pack_immediate", packKey: "conditional-access-baseline-v1" } });
check("pack-immediate authorization without the stamped payload is refused pre-write", packImmediateWrongPayload.errorType === "ca_enforcement_refused",
  { status: packImmediateWrongPayload.status, errorType: packImmediateWrongPayload.errorType });
console.log("");

// ── 4. Config Pack preparation (no run fired) ───────────────────────────────
const prep = async (packKey: string, opts: Parameters<typeof prepareConfigPackRun>[0]) => {
  try {
    const ctx = await prepareConfigPackRun(opts);
    return { mode: ctx.caEnforcementMode, caPolicyState: ctx.payload["caPolicyState"], refusal: ctx.preconditionRefusal?.code ?? null, missing: ctx.missingVariables };
  } catch (err) {
    return { thrown: err instanceof ConfigPackError ? err.code : String(err) };
  }
};
const hardeningDefault = await prep("identity-ca-hardening-v1", { packKey: "identity-ca-hardening-v1", customerId: tenant.id });
console.log("identity-ca-hardening-v1 (no mode):", JSON.stringify(hardeningDefault));
check("default mode is monitor-first with a report-only stamp", (hardeningDefault as { mode?: string }).mode === "monitor-first"
  && (hardeningDefault as { caPolicyState?: string }).caPolicyState === "enabledForReportingButNotEnforced", hardeningDefault);
const hardeningImmediate = await prep("identity-ca-hardening-v1", { packKey: "identity-ca-hardening-v1", customerId: tenant.id, caEnforcementMode: "immediate" });
console.log("identity-ca-hardening-v1 (immediate):", JSON.stringify(hardeningImmediate));
check("immediate mode stamps enabled", (hardeningImmediate as { caPolicyState?: string }).caPolicyState === "enabled", hardeningImmediate);
const baselineDefault = await prep("conditional-access-baseline-v1", {
  packKey: "conditional-access-baseline-v1", customerId: tenant.id, variables: { policyId: "00000000-0000-4000-8000-000000004522" },
});
console.log("conditional-access-baseline-v1 (no mode):", JSON.stringify(baselineDefault));
check("a monitor-first pack whose step enforces a policy is refused", (baselineDefault as { refusal?: string }).refusal === "ca_enforcement_requires_promotion", baselineDefault);
const smuggled = await prep("identity-ca-hardening-v1", { packKey: "identity-ca-hardening-v1", customerId: tenant.id, variables: { caPolicyState: "enabled" } });
check("caPolicyState passed as a variable is refused", (smuggled as { thrown?: string }).thrown === "invalid_ca_enforcement_mode", smuggled);
console.log("");

// ── 5. Promotion attempt through the real workflow (refused) ────────────────
const attempt = await promoteCaPolicy({
  mspId, customerId: tenant.id, policyId: targetPolicyId, reviewedFingerprint: "0".repeat(64), acknowledgeImpact: false,
  note: "Git #4522 live verification — expected refusal", actor: { userId: null, name: "verify-ca-promotion-4522", role: "system", email: null },
});
console.log("promoteCaPolicy:", JSON.stringify({ outcome: attempt.outcome, ...(attempt.outcome === "refused" ? { code: attempt.code, message: attempt.message, promotionId: attempt.promotionId } : {}) }));
check("promotion without verifiable impact / on a non-testbed tenant is refused", attempt.outcome === "refused", attempt.outcome);
if (attempt.outcome === "refused" && attempt.promotionId) {
  const [row] = await db.select().from(caPolicyPromotionsTable).where(eq(caPolicyPromotionsTable.id, attempt.promotionId));
  check("refused attempt is recorded in ca_policy_promotions", row?.outcome === "refused", { id: row?.id, outcome: row?.outcome, reason: row?.outcomeReason });
  const audits = await db.select({ id: mspAuditLogsTable.id, actionType: mspAuditLogsTable.actionType, outcome: mspAuditLogsTable.outcome, metadata: mspAuditLogsTable.metadata })
    .from(mspAuditLogsTable).where(eq(mspAuditLogsTable.entityId, targetPolicyId));
  const mirror = audits.find((a) => (a.metadata as { promotionId?: number } | null)?.promotionId === attempt.promotionId);
  check("refused attempt is mirrored to msp_audit_logs", mirror?.actionType === "ca_policy.promotion_refused", mirror && { id: mirror.id, actionType: mirror.actionType, outcome: mirror.outcome });
}

console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
