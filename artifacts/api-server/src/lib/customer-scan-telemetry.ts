/**
 * customer-scan-telemetry.ts — the "your own scan, as it actually stands" read,
 * keyed by tenants.id.
 *
 * Extracted verbatim from GET /api/public/flow/scan-telemetry (#436,
 * public-assessment-account.ts) so the Free Scan return link (#1359,
 * public-free-scan-return.ts) reports the SAME run, counts and finding titles
 * through the same query — not a second, independently-derived summary that
 * could disagree with it.
 *
 * Every number is read from the latest msp_diagnostic_runs row for the customer
 * and its msp_diagnostic_findings; nothing is derived, estimated or filled in.
 * No PII and no evidence bodies: check labels, finding titles and severities.
 */

import { db, mspDiagnosticRunsTable, mspDiagnosticFindingsTable } from "@workspace/db";
import { and, desc, eq, sql } from "drizzle-orm";

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

export interface CustomerScanTelemetry {
  everScanned: boolean;
  tenantConnected: boolean;
  run: {
    status: string;
    active: boolean;
    packageKey: string | null;
    checksTotal: number;
    checksOk: number;
    checksError: number;
    checksLicenseGap: number;
    startedAt: Date;
    completedAt: Date | null;
  } | null;
  severityCounts: { critical: number; warning: number; info: number; ok: number } | null;
  topFindings: Array<{ checkLabel: string | null; severity: string; title: string | null }>;
}

export async function readCustomerScanTelemetry(customerId: number): Promise<CustomerScanTelemetry> {
  const [latestRun] = await db
    .select({
      runId: mspDiagnosticRunsTable.runId,
      status: mspDiagnosticRunsTable.status,
      packageKey: mspDiagnosticRunsTable.packageKey,
      checksTotal: mspDiagnosticRunsTable.checksTotal,
      checksOk: mspDiagnosticRunsTable.checksOk,
      checksError: mspDiagnosticRunsTable.checksError,
      checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
      startedAt: mspDiagnosticRunsTable.startedAt,
      completedAt: mspDiagnosticRunsTable.completedAt,
      createdAt: mspDiagnosticRunsTable.createdAt,
    })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, customerId))
    .orderBy(desc(mspDiagnosticRunsTable.createdAt))
    .limit(1);

  if (!latestRun) {
    return { everScanned: false, tenantConnected: true, run: null, severityCounts: null, topFindings: [] };
  }

  // Severity mix of the findings THIS run produced. Grouped in the database
  // rather than counted in JS so a large run does not stream every row back
  // just to be tallied.
  const severityRows = await db
    .select({
      severity: mspDiagnosticFindingsTable.severity,
      count: sql<number>`count(*)::int`,
    })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.runId, latestRun.runId))
    .groupBy(mspDiagnosticFindingsTable.severity);

  const severityCounts = { critical: 0, warning: 0, info: 0, ok: 0 };
  for (const row of severityRows) {
    if (row.severity in severityCounts) {
      severityCounts[row.severity as keyof typeof severityCounts] = row.count;
    }
  }

  // A short, real sample — the actual finding titles, worst first. `title` is
  // the severity_rules label the pipeline resolved (#408), not a generic
  // placeholder, so these are the same words the report will use.
  const topFindings = await db
    .select({
      checkLabel: mspDiagnosticFindingsTable.checkLabel,
      severity: mspDiagnosticFindingsTable.severity,
      title: mspDiagnosticFindingsTable.title,
    })
    .from(mspDiagnosticFindingsTable)
    .where(
      and(
        eq(mspDiagnosticFindingsTable.runId, latestRun.runId),
        sql`${mspDiagnosticFindingsTable.severity} IN ('critical','warning')`,
      ),
    )
    .orderBy(sql`CASE ${mspDiagnosticFindingsTable.severity} WHEN 'critical' THEN 0 ELSE 1 END`, desc(mspDiagnosticFindingsTable.id))
    .limit(5);

  const active = (ACTIVE_RUN_STATUSES as readonly string[]).includes(latestRun.status);

  return {
    everScanned: true,
    tenantConnected: true,
    run: {
      status: latestRun.status,
      active,
      packageKey: latestRun.packageKey,
      checksTotal: latestRun.checksTotal ?? 0,
      checksOk: latestRun.checksOk ?? 0,
      checksError: latestRun.checksError ?? 0,
      checksLicenseGap: latestRun.checksLicenseGap ?? 0,
      startedAt: latestRun.startedAt ?? latestRun.createdAt,
      completedAt: latestRun.completedAt ?? null,
    },
    severityCounts,
    topFindings,
  };
}
