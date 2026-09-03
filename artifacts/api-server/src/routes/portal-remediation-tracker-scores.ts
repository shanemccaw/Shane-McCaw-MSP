/**
 * portal-remediation-tracker-scores.ts — Git #1381, epic #1045.
 *
 *   GET /api/portal/remediation-tracker/pillar-scores
 *
 * The Remediation Tracker's headline "Tenant score N → M", its six pillar cells
 * and the Copilot gate were, until this route, computed entirely from hardcoded
 * fixture constants (`RT_PILLAR_BASE` / `RT_PILLAR_TARGET` in
 * `msp-portal/.../remediationData.ts`) — they never touched the database, so a
 * tenant's real state was invisible on the one surface that markets fixing it.
 * This route serves the REAL numbers the rest of the portal already trusts, and
 * the tracker consumes it in place of the fixture.
 *
 * ── WHAT THIS SERVES, AND FROM WHERE (all real, nothing invented) ──────────────
 *
 * Per pillar (the tracker's six: governance, security, compliance, licensing,
 * adoption, health), from `tenant_pillar_snapshots` — the customer-facing 0-100
 * DISPLAY scores `pillar-snapshot.ts` writes ONE row per pillar each time a real
 * scan finishes with sufficient coverage (#1106):
 *
 *   • now     — the current scan's real score (the latest snapshot row's `score`).
 *   • before  — the PREVIOUS scan's real score (that same latest row's
 *               `previousScore`, which pillar-snapshot.ts already stamps as the
 *               prior row's score at capture time). This is the rolling
 *               "what did my last fix do" delta Shane specified: scan 2 shows
 *               28→30, scan 3 shows 30→32 — never a fixed baseline or a projected
 *               target. One scan only ⇒ before is null (nothing to compare yet).
 *   • dayOne  — the tenant's VERY FIRST real score per pillar, kept forever (the
 *               EARLIEST snapshot row's `score`), for the long-arc "day 1 you were
 *               at 28, six weeks later you're at 84" narrative. Distinct from
 *               `before` once there are ≥3 scans.
 *
 * The Copilot gate: `computeCopilotGate()` (copilot-gate.ts) — the engine's real
 * Copilot pillar display score vs the fixed 82 threshold, go/no-go, honestly
 * null when the tenant has too little coverage to gate on. NOT a 7th pillar cell.
 *
 * Per-task point chips: each task traces back to a real finding via its platform
 * step id (STEP_CHECK_KEYS → monitor_checks.key → msp_diagnostic_findings), and
 * every finding carries a real severity. The chip's point value is that finding's
 * severity weight, full stop (Shane #1381): critical 3, warning 2, info 1, ok 0.
 * A step whose mapped checks map to more than one finding takes the WORST (a step
 * is only as clean as its dirtiest mapped check).
 *
 * ── HONESTY GATES (they change the UI, deliberately) ───────────────────────────
 * A pillar with no snapshot row yet is `insufficient_data` and the tracker shows
 * "not enough data yet" for it, never a fabricated number. A pillar with exactly
 * one snapshot is `single_scan` (now present, before null). This is the whole
 * point: the tracker stops inventing its own scores.
 *
 * Scoped to the JWT's customerId, same floor + resolution as every other route on
 * the Copilot Readiness journey (portal-assessment.ts / portal-remediation-tracker.ts).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantPillarSnapshotsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
} from "@workspace/db";
import { and, asc, desc, eq } from "drizzle-orm";

import { requireRole } from "../middlewares/requireAuth";
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

/** tenants.id off the JWT's `customerId` claim — same resolution as the sibling routes. */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

router.get(
  "/portal/remediation-tracker/pillar-scores",
  // Same floor as the rest of the Copilot Readiness journey (portal-assessment.ts).
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // ── Rolling before/now + permanent day-one, from tenant_pillar_snapshots ──
      // Oldest→newest so each pillar's earliest row is its permanent day-one
      // baseline and its latest row is "now" — the exact ordering the reducer
      // depends on. Same read shape as /portal/pillars/history.
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

      // ── Per-task point chips, from the latest run's real findings ─────────────
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
        // Worst severity per check key, in case a run has more than one finding row
        // for the same check.
        for (const f of findings) {
          const prev = findingSeverityByCheckKey.get(f.checkKey);
          const prevWeight = prev ? (SEVERITY_WEIGHT[prev] ?? 0) : -1;
          const thisWeight = SEVERITY_WEIGHT[f.severity] ?? 0;
          if (thisWeight > prevWeight) findingSeverityByCheckKey.set(f.checkKey, f.severity);
        }
      }
      const taskPoints = buildTaskPoints(findingSeverityByCheckKey, REMEDIATION_TRACKER_STEP_CHECK_KEYS);

      // ── The real Copilot gate — never throws (degrades to no-score) ───────────
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
      log.error({ err, customerId }, "GET /portal/remediation-tracker/pillar-scores failed");
      res.status(500).json({ error: "Failed to load remediation tracker pillar scores" });
    }
  },
);

export default router;
