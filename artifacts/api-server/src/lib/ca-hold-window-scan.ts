/**
 * ca-hold-window-scan.ts — Git #4550.
 *
 * #4522 built `evaluateCaPolicyImpact(tenantId, policyId)`: the real read of a
 * Conditional Access policy's report-only sign-in impact
 * (ca-policy-promotion.ts). Until now it was wired to exactly one caller — the
 * MSP-operator on-demand read endpoint (`GET .../ca-policies/:policyId/impact`)
 * — which returns the result to the browser and discards it. Nothing ever
 * wrote it to `portal_hold_windows`, the table the CUSTOMER-facing Runbooks
 * page (`portal-runbook-wire.ts` → `/portal/runbooks`) actually reads for its
 * `scan_verdict` / `scan_line` card.
 *
 * This is that write. `handleCaPolicyHoldWindowScan` is a Workflow Engine node
 * (`ca_policy_hold_window_scan`, seeded hourly in seed-system-workflows.ts —
 * matching the column's own `scan_cadence` default and the established #1163
 * hourly-reconciliation convention): it finds every OPEN hold window that
 * names a CA policy (`policy_id`, added by this issue — a hold window not
 * gating a CA policy, e.g. a SharePoint site-admin notice period, has none and
 * is left untouched), re-runs the exact same #4522 evaluator against it, and
 * writes a real, data-derived verdict and evidence sentence.
 *
 * A non-"ok" read (consent revoked, license gap, Graph error, the policy no
 * longer exists) is written HONESTLY as "watch" with the real reason in
 * `scan_line` — not skipped. Silently dropping that case would just move this
 * issue's own failure mode one layer down.
 */

import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, portalHoldWindowsTable, tenantsTable, type PortalHoldScanVerdict } from "@workspace/db";
import { evaluateCaPolicyImpact, type CaPolicyImpact } from "./ca-policy-promotion.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.ca-promotion" });

export const CA_HOLD_SCAN_SOURCE = "Report-only sign-in logs";

export interface CaHoldWindowScanSummary {
  scopedCustomerId: number | null;
  windowsConsidered: number;
  clear: number;
  signals: number;
  watch: number;
  errors: number;
}

function pluralize(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/**
 * Turn a real `evaluateCaPolicyImpact` result into the verdict + evidence
 * sentence the design's hold-window card shows. Every number and name in the
 * sentence comes from `impact` — nothing here is a canned string.
 */
export function deriveHoldScanFromImpact(impact: CaPolicyImpact): { verdict: PortalHoldScanVerdict; scanLine: string } {
  if (impact.status !== "ok" || !impact.summary || !impact.window) {
    const reason = impact.detail ? `${impact.status}: ${impact.detail}` : impact.status;
    return {
      verdict: "watch",
      scanLine: `Report-only impact could not be read from Microsoft Entra (${reason}). Re-scan before deciding.`,
    };
  }

  const { wouldBlock, wouldInterrupt, affectedUserCount, evaluated } = impact.summary;
  const days = impact.window.reportOnlyDays;
  const period = days !== null ? pluralize(days, "day") : "the observation window";
  const incomplete = impact.complete ? "" : " Not every sign-in in the period could be read, so this is a lower bound.";

  if (wouldBlock > 0) {
    const scope = affectedUserCount > 0 ? ` across ${pluralize(affectedUserCount, "user")}` : "";
    return {
      verdict: "signals",
      scanLine: `${pluralize(wouldBlock, "sign-in")} would have been blocked in the last ${period}${scope}. Enforcing today breaks this.${incomplete}`,
    };
  }

  if (wouldInterrupt > 0) {
    const scope = affectedUserCount > 0 ? `, affecting ${pluralize(affectedUserCount, "user")}` : "";
    return {
      verdict: "watch",
      scanLine: `${pluralize(wouldInterrupt, "sign-in")} would have been interrupted for a grant control in the last ${period}${scope}. Worth a look before the window closes.${incomplete}`,
    };
  }

  if (evaluated === 0) {
    return {
      verdict: "watch",
      scanLine: `No sign-in in the last ${period} has been evaluated against this policy yet, so there is no evidence of its impact so far.${incomplete}`,
    };
  }

  return {
    verdict: "clear",
    scanLine: `No sign-in would have been blocked or interrupted in the last ${period} (${pluralize(evaluated, "sign-in")} evaluated). Clear to close early.${incomplete}`,
  };
}

/**
 * The `ca_policy_hold_window_scan` node handler. `payload.customerId`
 * (tenants.id), when present, scopes the sweep to one tenant — matching the
 * event/schedule split `handlePolicyEvaluateDue` already established; today
 * only the unscoped hourly schedule is seeded, so every open CA-gated window
 * on every tenant is rescanned each pass.
 */
export async function handleCaPolicyHoldWindowScan(
  _nodeData: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<CaHoldWindowScanSummary> {
  const scopedCustomerId = typeof payload.customerId === "number" ? payload.customerId : null;

  const rows = await db
    .select({
      hold: portalHoldWindowsTable,
      tenantId: tenantsTable.tenantId,
    })
    .from(portalHoldWindowsTable)
    .innerJoin(tenantsTable, eq(tenantsTable.id, portalHoldWindowsTable.customerId))
    .where(
      and(
        isNotNull(portalHoldWindowsTable.policyId),
        isNull(portalHoldWindowsTable.closedAt),
        scopedCustomerId !== null ? eq(portalHoldWindowsTable.customerId, scopedCustomerId) : undefined,
      ),
    );

  const summary: CaHoldWindowScanSummary = {
    scopedCustomerId,
    windowsConsidered: rows.length,
    clear: 0,
    signals: 0,
    watch: 0,
    errors: 0,
  };

  for (const row of rows) {
    const policyId = row.hold.policyId;
    if (!policyId || !row.tenantId) continue;
    try {
      const impact = await evaluateCaPolicyImpact(row.tenantId, policyId);
      const { verdict, scanLine } = deriveHoldScanFromImpact(impact);
      const now = new Date();
      await db
        .update(portalHoldWindowsTable)
        .set({ scanVerdict: verdict, scanLine, scanSource: CA_HOLD_SCAN_SOURCE, scanAt: now, updatedAt: now })
        .where(eq(portalHoldWindowsTable.id, row.hold.id));
      summary[verdict]++;
    } catch (err) {
      summary.errors++;
      log.error({ err, holdWindowId: row.hold.id, policyId, customerId: row.hold.customerId }, "ca-hold-window-scan: scan pass failed for this window");
    }
  }

  log.info({ ...summary }, "ca-hold-window-scan: scan pass complete");
  return summary;
}
