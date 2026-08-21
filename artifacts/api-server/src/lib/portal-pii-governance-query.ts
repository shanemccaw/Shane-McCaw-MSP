/**
 * portal-pii-governance-query.ts — the scoped SELECT that feeds the pure PII
 * governance transform in `portal-pii-governance.ts`.
 *
 * Kept separate from the transform so the transform imports no database and can
 * be unit-tested directly (portal-pii-governance.test.ts). This module is the one
 * that touches `@workspace/db`.
 */

import { db, tenantMonitorProfilesTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";

import { logger } from "./logger";
import {
  buildPiiGovernance,
  PII_GOVERNANCE_CHECKS,
  type PiiCheckRow,
  type PiiGovernancePayload,
} from "./portal-pii-governance";

const log = logger.child({ channel: "engine.dashboard" });

const CHECK_KEYS = new Set(PII_GOVERNANCE_CHECKS.map((c) => c.key));

/**
 * Fetch the most-recent tenant_monitor_profiles row for each backing check for a
 * tenant. The rows are keyed on the M365 tenant identifier (the same TEXT key
 * latestCheckProps uses), NOT the numeric customerId — the caller resolves that
 * via resolveTenantScope.
 */
export async function fetchLatestPiiChecks(tenantId: string): Promise<Map<string, PiiCheckRow>> {
  const keys = PII_GOVERNANCE_CHECKS.map((c) => c.key);
  const rows = await db
    .select({
      checkKey: tenantMonitorProfilesTable.checkKey,
      status: tenantMonitorProfilesTable.status,
      itemCount: tenantMonitorProfilesTable.itemCount,
      severityMatched: tenantMonitorProfilesTable.severityMatched,
      severityLabel: tenantMonitorProfilesTable.severityLabel,
      extractedProperties: tenantMonitorProfilesTable.extractedProperties,
      errorMessage: tenantMonitorProfilesTable.errorMessage,
      collectedAt: tenantMonitorProfilesTable.collectedAt,
    })
    .from(tenantMonitorProfilesTable)
    .where(
      and(
        eq(tenantMonitorProfilesTable.tenantId, tenantId),
        inArray(tenantMonitorProfilesTable.checkKey, keys),
      ),
    )
    .orderBy(desc(tenantMonitorProfilesTable.collectedAt));

  // rows are newest-first; keep the first (latest) seen per key.
  const byKey = new Map<string, PiiCheckRow>();
  for (const r of rows) {
    if (!CHECK_KEYS.has(r.checkKey) || byKey.has(r.checkKey)) continue;
    byKey.set(r.checkKey, {
      checkKey: r.checkKey,
      status: r.status,
      itemCount: r.itemCount,
      severityMatched: r.severityMatched,
      severityLabel: r.severityLabel,
      extractedProperties: (r.extractedProperties as Record<string, unknown> | null) ?? null,
      errorMessage: r.errorMessage,
      collectedAt: r.collectedAt,
    });
  }
  return byKey;
}

/** Fetch + build for a tenant. */
export async function computePiiGovernance(tenantId: string): Promise<PiiGovernancePayload> {
  try {
    const rows = await fetchLatestPiiChecks(tenantId);
    return buildPiiGovernance(rows);
  } catch (err: unknown) {
    log.error({ err, tenantId }, "computePiiGovernance failed");
    throw err;
  }
}
