/**
 * msp-remediation-tracker-scores.ts — Git #2670, Feature #1684 (Remediation
 * Tracking, MSP Console). MSP-side mirror of `portal-remediation-tracker-
 * scores.ts` (#1381) — same real pillar-score reduction, same Copilot gate,
 * same per-task point chips, resolved for `:customerId` under an MSP
 * ownership check instead of the caller's own JWT `customerId` claim.
 *
 *   GET /api/msp/customers/:customerId/remediation-tracker/pillar-scores
 *
 * See portal-remediation-tracker-scores.ts's own header for the full
 * provenance of every number this serves (tenant_pillar_snapshots,
 * computeCopilotGate, msp_diagnostic_findings) — unchanged here, just reused.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantPillarSnapshotsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { requireRole, assertCustomerAccess } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { computeCopilotGate, type CopilotGateResult } from "../lib/copilot-gate";
import { REMEDIATION_TRACKER_STEP_CHECK_KEYS } from "../lib/remediation-tracker-verification";
import {
  reducePillarScores,
  buildTaskPoints,
  SEVERITY_WEIGHT,
  type PillarScore,
  type TaskPoint,
} from "../lib/remediation-pillar-scores";

const log = logger.child({ channel: "engine.remediation-tracker" });

const router: IRouter = Router();

interface PillarScoresResponse {
  readonly pillars: Record<string, PillarScore>;
  readonly copilotGate: CopilotGateResult;
  readonly taskPoints: Record<string, TaskPoint>;
  readonly meta: {
    readonly hasAnyHistory: boolean;
    readonly latestRunId: string | null;
  };
}

/** Same resolve+authorize idiom as msp-remediation-tracker.ts. */
async function resolveAuthorizedCustomerId(req: Request, res: Response): Promise<number | null> {
  const customerId = parseInt(req.params.customerId as string, 10);
  if (isNaN(customerId)) {
    res.status(400).json({ error: "Invalid customerId" });
    return null;
  }
  if (!(await assertCustomerAccess(req.user!, customerId))) {
    res.status(404).json({ error: "Customer not found" });
    return null;
  }
  return customerId;
}

router.get(
  "/msp/customers/:customerId/remediation-tracker/pillar-scores",
  requireRole("MSPOperator"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = await resolveAuthorizedCustomerId(req, res);
    if (customerId === null) return;

    try {
      const snapshotRows = await db
        .select({
          pillarKey: tenantPillarSnapshotsTable.pillarKey,
          score: tenantPillarSnapshotsTable.score,
          previousScore: tenantPillarSnapshotsTable.previousScore,
          capturedAt: tenantPillarSnapshotsTable.capturedAt,
        })
        .from(tenantPillarSnapshotsTable)
        .where(eq(tenantPillarSnapshotsTable.customerId, customerId))
        .orderBy(asc(tenantPillarSnapshotsTable.capturedAt));

      const pillars = reducePillarScores(snapshotRows);

      const [latestRun] = await db
        .select({ runId: mspDiagnosticRunsTable.runId })
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const findingSeverityByCheckKey = new Map<string, string>();
      if (latestRun?.runId) {
        const findings = await db
          .select({
            checkKey: mspDiagnosticFindingsTable.checkKey,
            severity: mspDiagnosticFindingsTable.severity,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.runId, latestRun.runId),
              eq(mspDiagnosticFindingsTable.customerId, customerId),
            ),
          );
        for (const f of findings) {
          const prev = findingSeverityByCheckKey.get(f.checkKey);
          const prevWeight = prev ? (SEVERITY_WEIGHT[prev] ?? 0) : -1;
          const thisWeight = SEVERITY_WEIGHT[f.severity] ?? 0;
          if (thisWeight > prevWeight) findingSeverityByCheckKey.set(f.checkKey, f.severity);
        }
      }
      const taskPoints = buildTaskPoints(findingSeverityByCheckKey, REMEDIATION_TRACKER_STEP_CHECK_KEYS);

      const copilotGate = await computeCopilotGate(customerId);

      const response: PillarScoresResponse = {
        pillars,
        copilotGate,
        taskPoints,
        meta: {
          hasAnyHistory: snapshotRows.length > 0,
          latestRunId: latestRun?.runId ?? null,
        },
      };

      res.json(response);
    } catch (err) {
      log.error({ err, customerId }, "GET /msp/customers/:customerId/remediation-tracker/pillar-scores failed");
      res.status(500).json({ error: "Failed to load remediation tracker pillar scores" });
    }
  },
);

export default router;
