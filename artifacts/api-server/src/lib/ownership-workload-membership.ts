/**
 * ownership-workload-membership.ts — per-workload RACI-membership toggle
 * (#1933), and the finding it emits when it fires.
 *
 * ── What this is, corrected from the issue body (Shane, 2026-08-30) ────────
 * The issue body's original framing — a "tracking scope" toggle that risked
 * silently suppressing findings, guarded by the #1563 rule — was retracted.
 * Shane's own words: "just because they do not have it in the RACI does not
 * mean we don't still track and alert on things... if the customer decides to
 * disable that service in the RACI in the settings, that honestly should be
 * a finding — disable unused services."
 *
 * So: untracking a workload here does ONE thing — it removes the workload
 * from the RACI accountability matrix (`routes/portal-ownership.ts`'s GET
 * omits it, so nobody is named A/R/C/I on it). It does NOT touch scanning,
 * `tenant_service_plans`, or any `customer_tenant_alert_rules`/monitor-check
 * evaluator — those keep running exactly as before. The #1563 tension the
 * issue body worried about does not arise, because there is no findings path
 * for this toggle to suppress.
 *
 * ── The finding this toggle emits ───────────────────────────────────────────
 * An enabled, disowned workload is a real security position — attack surface
 * nobody is watching. Untracking a still-enabled workload writes a real
 * `msp_diagnostic_findings` row, following the exact provenance pattern
 * `policy-compliance-evaluator.ts` established for a non-Graph, internally-
 * derived check: its own `msp_diagnostic_runs` row (required FK), `severity:
 * "warning"` (an accountability gap, not by itself a compromise), `findingSource:
 * "baseline"` (a platform best-practice check — "disable unused services" —
 * not a customer-declared `standing_policies` target, so "policy" doesn't
 * apply). `checkKey` is namespaced `governance:untracked-workload:<key>`,
 * matching the existing governance-pillar convention
 * (`governance:ownerless-groups` etc. in `customer-tenant-alert-engine.ts`).
 *
 * Re-evaluated on every toggle (either direction) for the customer's WHOLE
 * workload set, not just the one key that changed — mirrors the "latest run
 * wins" convention every other finding reader already follows: toggling a
 * workload back to tracked drops its finding out of the next run's set
 * without needing an explicit "resolved" state on the row.
 *
 * The exit path once this finding exists — accept the risk (#1487's
 * register) or raise a POA&M to actually disable the service in Microsoft —
 * is #1935 (filed separately per the issue's correction comment; not built
 * here, referenced by name only).
 */

import { and, eq } from "drizzle-orm";
import {
  db,
  mspDiagnosticFindingsTable,
  mspDiagnosticRunsTable,
  portalOwnershipWorkloadMembershipTable,
  tenantServicePlansTable,
} from "@workspace/db";
import { groupEnabledServicePlansByWorkload } from "./tenant-workloads.ts";
import { resolveTenantScope, type TenantScope } from "./portal-customer-scope";
import { logger } from "./logger";

const log = logger.child({ channel: "tenant.workload" });

/** No row for a (customer, workload) pair means "tracked" — see the table's own header. */
export const DEFAULT_WORKLOAD_TRACKED = true;

export interface WorkloadMembershipRow {
  readonly workloadKey: string;
  readonly label: string;
  readonly servicePlanNames: readonly string[];
  readonly tracked: boolean;
}

/**
 * This customer's real enabled workloads (Git #2008 derivation), each joined
 * against its saved membership row. A workload with no saved row is
 * `tracked: true` — the default every customer already has.
 */
export async function listWorkloadMembership(customerId: number): Promise<WorkloadMembershipRow[]> {
  const scope = await resolveTenantScope(customerId);
  if (!scope) return [];

  const servicePlanRows = await db
    .select({ servicePlanName: tenantServicePlansTable.servicePlanName })
    .from(tenantServicePlansTable)
    .where(
      and(eq(tenantServicePlansTable.mspId, scope.mspId), eq(tenantServicePlansTable.tenantId, scope.tenantId)),
    );
  const workloadGroups = groupEnabledServicePlansByWorkload(servicePlanRows);
  if (workloadGroups.length === 0) return [];

  const membershipRows = await db
    .select({
      workloadKey: portalOwnershipWorkloadMembershipTable.workloadKey,
      tracked: portalOwnershipWorkloadMembershipTable.tracked,
    })
    .from(portalOwnershipWorkloadMembershipTable)
    .where(eq(portalOwnershipWorkloadMembershipTable.customerId, customerId));
  const trackedByKey = new Map(membershipRows.map((r) => [r.workloadKey, r.tracked]));

  return workloadGroups.map((group) => ({
    workloadKey: group.key,
    label: group.label,
    servicePlanNames: group.servicePlanNames,
    tracked: trackedByKey.get(group.key) ?? DEFAULT_WORKLOAD_TRACKED,
  }));
}

/** Just the set of workload keys this customer has untracked — what `routes/portal-ownership.ts` needs to omit them from the matrix. */
export async function resolveUntrackedWorkloadKeys(customerId: number): Promise<ReadonlySet<string>> {
  const rows = await db
    .select({ workloadKey: portalOwnershipWorkloadMembershipTable.workloadKey })
    .from(portalOwnershipWorkloadMembershipTable)
    .where(
      and(
        eq(portalOwnershipWorkloadMembershipTable.customerId, customerId),
        eq(portalOwnershipWorkloadMembershipTable.tracked, false),
      ),
    );
  return new Set(rows.map((r) => r.workloadKey));
}

export interface SetWorkloadTrackedResult {
  readonly tracked: boolean;
  readonly findingsCreated: readonly string[];
}

/**
 * Upserts one workload's membership row, then re-evaluates the customer's
 * whole untracked-workload set for the "disable unused services" finding.
 * Not deletion — toggling back to tracked is a plain update to the same row.
 */
export async function setWorkloadTracked(
  customerId: number,
  workloadKey: string,
  tracked: boolean,
  updatedBy: number | null,
): Promise<SetWorkloadTrackedResult> {
  await db
    .insert(portalOwnershipWorkloadMembershipTable)
    .values({ customerId, workloadKey, tracked, updatedBy })
    .onConflictDoUpdate({
      target: [portalOwnershipWorkloadMembershipTable.customerId, portalOwnershipWorkloadMembershipTable.workloadKey],
      set: { tracked, updatedBy, updatedAt: new Date() },
    });

  const findingsCreated = await evaluateUntrackedWorkloadFindings(customerId);
  return { tracked, findingsCreated };
}

/**
 * Writes one `msp_diagnostic_findings` row per currently-untracked workload
 * that is STILL enabled on the tenant's real M365 estate — "disable unused
 * services" per Shane's correction. Creates its own `msp_diagnostic_runs` row
 * only when there is at least one such workload (mirrors
 * `policy-compliance-evaluator.ts`'s early-return when there is nothing to
 * evaluate, rather than writing empty runs on every toggle-back-on).
 */
export async function evaluateUntrackedWorkloadFindings(customerId: number): Promise<string[]> {
  const scope = await resolveTenantScope(customerId);
  if (!scope) return [];

  const membership = await listWorkloadMembership(customerId);
  const untrackedEnabled = membership.filter((row) => !row.tracked);
  if (untrackedEnabled.length === 0) return [];

  const [run] = await db
    .insert(mspDiagnosticRunsTable)
    .values({
      mspId: scope.mspId,
      customerId,
      tenantId: scope.tenantId,
      packageKey: "governance:raci-membership",
      status: "completed",
      startedAt: new Date(),
      completedAt: new Date(),
      checksTotal: untrackedEnabled.length,
      checksOk: 0,
      checksError: 0,
      checksRequiresScript: 0,
      checksLicenseGap: 0,
    })
    .returning();

  const findingIds: string[] = [];
  for (const workload of untrackedEnabled) {
    const [finding] = await db
      .insert(mspDiagnosticFindingsTable)
      .values({
        runId: run.runId,
        mspId: scope.mspId,
        customerId,
        checkKey: `governance:untracked-workload:${workload.workloadKey}`,
        checkLabel: "Ownership / RACI: workload untracked while enabled",
        severity: "warning",
        title: `${workload.label} is untracked in the RACI but still enabled in ${scope.tenantName}`,
        description:
          `A customer removed ${workload.label} from the Ownership/RACI accountability matrix while its service ` +
          `plan(s) (${workload.servicePlanNames.join(", ")}) are still enabled. Untracking is not a scan or alert ` +
          `suppression — it only removes the workload's accountable owner. Either accept this as a known risk or ` +
          `raise a POA&M (#1935) to actually disable the service in Microsoft.`,
        recommendation: { category: "governance", priority: 2 },
        extractedProperties: { workloadKey: workload.workloadKey, servicePlanNames: workload.servicePlanNames },
        checkStatus: "ok",
        findingSource: "baseline",
      })
      .returning({ findingId: mspDiagnosticFindingsTable.findingId });
    findingIds.push(finding.findingId);
  }

  log.info(
    { customerId, runId: run.runId, findingsCreated: findingIds.length },
    "untracked-workload findings evaluated",
  );
  return findingIds;
}

export type { TenantScope };
