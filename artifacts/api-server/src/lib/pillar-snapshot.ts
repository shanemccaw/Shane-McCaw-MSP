/**
 * pillar-snapshot.ts (Git #1106, epic #1045)
 *
 * Persists the CUSTOMER-FACING 0-100 pillar DISPLAY scores
 * (getPillarCoverage() / evaluatePillarDisplay()) into tenant_pillar_snapshots,
 * one row per pillar, each time a real scan finishes — so a customer's real
 * first-scan-to-today pillar trend can be charted.
 *
 * This is the "listener" the issue calls for on the existing
 * `diagnostics.run_completed` Workflow Engine event. That event's fan-out is
 * DB-backed (wf_triggers → seeded workflow GRAPHS), which can't call arbitrary
 * TS like getPillarCoverage + a custom write, so the capture is invoked
 * fire-and-forget from the SAME run-completed moment the event is emitted in
 * diagnostics-runner.ts — no new scheduler, no wrapping runForTenant, mirroring
 * how writeEngineSnapshot() is already invoked (`void writeEngineSnapshot(...)`).
 *
 * Deliberately writes to a SEPARATE table from tenant_engine_snapshots: that one
 * holds raw, unbounded per-engine "Security Risk Points" (#1101); this one holds
 * the normalized 0-100 numbers the PillarGrid / HeroHealthScore / radar show.
 *
 * Honesty gate: only writes when the run reported `coverageSufficient` — the same
 * gate /api/portal/diagnostics/status applies before showing these scores live, so
 * a dark/partial run never writes a snapshot that looks like real history. No
 * backfill: absence of history renders "not enough history yet" downstream.
 */

import { db } from "@workspace/db";
import { tenantPillarSnapshotsTable, tenantsTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getPillarCoverage } from "./pillar-coverage";
import { logger } from "./logger";

const log = logger.child({ channel: "engine.health" });

export interface CapturePillarSnapshotInput {
  runId: string;
  /** tenants.id (diagnostics customer id-space). Null on pre-customer/orphaned runs. */
  customerId: number | null;
  /** msps.id, or null. */
  mspId: number | null;
  packageKey: string;
  /** The run's graded coverage decision (evaluateDocGateCoverage.proceed). */
  coverageSufficient: boolean;
}

/**
 * Compute + persist one tenant_pillar_snapshots row per genuinely-scored pillar
 * for this run. Fire-and-forget: every path is non-fatal and swallowed — a
 * snapshot failure must never fail or slow the diagnostics run itself.
 */
export async function capturePillarDisplaySnapshots(input: CapturePillarSnapshotInput): Promise<void> {
  const { runId, customerId, packageKey, coverageSufficient } = input;
  try {
    // Same honesty gate /api/portal/diagnostics/status applies — a dark/partial
    // run must not write a snapshot that looks like real history.
    if (!coverageSufficient) {
      log.info({ runId, customerId }, "pillar-snapshot: skipped — coverage insufficient (no history written)");
      return;
    }
    if (customerId == null) {
      log.info({ runId }, "pillar-snapshot: skipped — no customerId (pre-customer/orphaned run)");
      return;
    }
    if (!packageKey) {
      log.info({ runId, customerId }, "pillar-snapshot: skipped — no packageKey on run");
      return;
    }

    // Validate the tenant exists and resolve its real mspId (the payload's mspId
    // can be stale/null on some run paths) — mirrors writeEngineSnapshot().
    const [customerRow] = await db
      .select({ customerId: tenantsTable.id, mspId: tenantsTable.mspId })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, customerId))
      .limit(1);
    if (customerRow?.customerId == null) {
      log.info({ runId, customerId }, "pillar-snapshot: skipped — no tenants row for this id");
      return;
    }
    const mspId = customerRow.mspId ?? input.mspId ?? null;

    // The SAME function the dashboard already calls live — no separate scoring
    // path, so a captured point can never disagree with what the customer sees.
    const coverage = await getPillarCoverage(packageKey, customerId);
    if (coverage.length === 0) {
      log.info({ runId, customerId, packageKey }, "pillar-snapshot: no scored pillars — nothing to snapshot");
      return;
    }

    // Per-pillar previousScore/delta via prior-row lookup — same pattern
    // writeEngineSnapshot() uses for the raw engine table. Higher is better here
    // (0-100 display score), so a positive delta trends "up" (improving).
    const rows: (typeof tenantPillarSnapshotsTable.$inferInsert)[] = [];
    for (const entry of coverage) {
      const pillarKey = entry.pillar;
      const score = entry.score;
      const [prior] = await db
        .select({ score: tenantPillarSnapshotsTable.score })
        .from(tenantPillarSnapshotsTable)
        .where(and(eq(tenantPillarSnapshotsTable.customerId, customerId), eq(tenantPillarSnapshotsTable.pillarKey, pillarKey)))
        .orderBy(desc(tenantPillarSnapshotsTable.capturedAt))
        .limit(1);
      const previousScore = prior?.score ?? null;
      const delta = previousScore != null ? score - previousScore : null;
      const trendDirection = delta == null ? null : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
      rows.push({ customerId, mspId, pillarKey, score, previousScore, delta, trendDirection, packageKey, runId });
    }

    await db.insert(tenantPillarSnapshotsTable).values(rows);

    log.info(
      { runId, customerId, mspId, packageKey, pillars: rows.length },
      `pillar-snapshot: recorded ${rows.length} pillar display snapshot(s) for customer ${customerId}`,
    );
  } catch (err) {
    log.warn({ err, runId, customerId }, "pillar-snapshot: failed to record pillar snapshots (non-fatal)");
  }
}
