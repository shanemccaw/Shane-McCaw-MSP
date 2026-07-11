/**
 * msp-scope-creep.ts
 *
 * MSP-scoped Scope Creep Engine API surface.
 * Authenticated via MSP JWT (requireRole("MSPOperator")).
 * All queries are automatically scoped to the calling MSP's mspId —
 * an MSPOperator can only see data for their own organisation.
 *
 * Route prefix: /api/msp/scope-creep
 * Contrast with /api/admin/scope-creep/* which requires PlatformAdmin.
 */

import { Router, Request, Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  runScopeCreepEngineForMsp,
  fireScopeCreepViolation,
  escalateScopeCreep,
  resolveScopeCreepViolation,
  evaluatePolicyEscalations,
  type ScopeCreepPolicy,
} from "../lib/scope-creep-engine";

const router = Router();

// ── GET /api/msp/scope-creep/policies ─────────────────────────────────────────
// Returns active policies that apply to this MSP (own + global defaults).

router.get("/msp/scope-creep/policies", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             drift_threshold_pct AS "driftThresholdPct",
             expansion_threshold_pct AS "expansionThresholdPct",
             timeline_slip_days AS "timelineSlipDays",
             violation_score_threshold AS "violationScoreThreshold",
             escalation_rules AS "escalationRules",
             is_active AS "isActive",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM scope_creep_policies
      WHERE is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)
      ORDER BY msp_id NULLS LAST, id
    `);
    res.json({ policies: rows.rows });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: list policies failed");
    res.status(500).json({ error: "Failed to list policies" });
  }
});

// ── GET /api/msp/scope-creep/detections ───────────────────────────────────────
// Open detections for this MSP's customers. Optional ?customerId filter.

router.get("/msp/scope-creep/detections", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  const status = (req.query["status"] as string) || "open";
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", detection_type AS "detectionType", ref,
                     baseline_value AS "baselineValue", current_value AS "currentValue",
                     change_pct AS "changePct", status, metadata, detected_at AS "detectedAt",
                     resolved_at AS "resolvedAt"
              FROM scope_creep_detections
              WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND status = ${status}
              ORDER BY detected_at DESC LIMIT 200`
        : sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", detection_type AS "detectionType", ref,
                     baseline_value AS "baselineValue", current_value AS "currentValue",
                     change_pct AS "changePct", status, metadata, detected_at AS "detectedAt",
                     resolved_at AS "resolvedAt"
              FROM scope_creep_detections
              WHERE msp_id = ${mspId} AND status = ${status}
              ORDER BY detected_at DESC LIMIT 200`,
    );
    res.json({ detections: rows.rows });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: list detections failed");
    res.status(500).json({ error: "Failed to list detections" });
  }
});

// ── GET /api/msp/scope-creep/violations ───────────────────────────────────────
// Open violations for this MSP's portfolio. Optional ?customerId filter.

router.get("/msp/scope-creep/violations", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, violation_id AS "violationId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", detection_id AS "detectionId",
                     severity, composite_score AS "compositeScore", threshold,
                     resolved_at AS "resolvedAt", resolution_notes AS "resolutionNotes",
                     created_at AS "createdAt"
              FROM scope_creep_violations
              WHERE msp_id = ${mspId} AND customer_id = ${customerId}
              ORDER BY created_at DESC LIMIT 100`
        : sql`SELECT id, violation_id AS "violationId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", detection_id AS "detectionId",
                     severity, composite_score AS "compositeScore", threshold,
                     resolved_at AS "resolvedAt", resolution_notes AS "resolutionNotes",
                     created_at AS "createdAt"
              FROM scope_creep_violations
              WHERE msp_id = ${mspId}
              ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ violations: rows.rows });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: list violations failed");
    res.status(500).json({ error: "Failed to list violations" });
  }
});

// ── GET /api/msp/scope-creep/escalations ──────────────────────────────────────
// Open escalations for this MSP. Includes SOW amendment and pricing review flags.

router.get("/msp/scope-creep/escalations", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const rows = await db.execute(sql`
      SELECT id, escalation_id AS "escalationId", violation_id AS "violationId",
             msp_id AS "mspId", customer_id AS "customerId", level,
             escalation_type AS "escalationType",
             flag_sow_amendment AS "flagSowAmendment",
             flag_pricing_review AS "flagPricingReview",
             assigned_to AS "assignedTo", status, metadata,
             resolved_at AS "resolvedAt", created_at AS "createdAt"
      FROM scope_creep_escalations
      WHERE msp_id = ${mspId} AND status IN ('pending', 'in_progress')
      ORDER BY level DESC, created_at DESC LIMIT 100
    `);
    res.json({ escalations: rows.rows });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: list escalations failed");
    res.status(500).json({ error: "Failed to list escalations" });
  }
});

// ── GET /api/msp/scope-creep/compliance ───────────────────────────────────────
// Monthly compliance history for this MSP.

router.get("/msp/scope-creep/compliance", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_detections AS "totalDetections", violation_count AS "violationCount",
                     compliance_pct AS "compliancePct", avg_composite_score AS "avgCompositeScore",
                     notes, created_at AS "createdAt"
              FROM scope_creep_compliance
              WHERE msp_id = ${mspId} AND customer_id = ${customerId}
              ORDER BY period_start DESC LIMIT 24`
        : sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_detections AS "totalDetections", violation_count AS "violationCount",
                     compliance_pct AS "compliancePct", avg_composite_score AS "avgCompositeScore",
                     notes, created_at AS "createdAt"
              FROM scope_creep_compliance
              WHERE msp_id = ${mspId}
              ORDER BY period_start DESC LIMIT 100`,
    );
    res.json({ records: rows.rows });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: list compliance failed");
    res.status(500).json({ error: "Failed to list compliance records" });
  }
});

// ── POST /api/msp/scope-creep/evaluate ────────────────────────────────────────
// Run the engine for this MSP's portfolio. Returns composite score, breakdown,
// raw signals, and fired policy escalations.
// Optionally fires violations for customers whose score exceeds threshold.

router.post("/msp/scope-creep/evaluate", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const b = req.body as Record<string, unknown>;
  const autoFire = b.autoFireViolations === true;
  try {
    const output = await runScopeCreepEngineForMsp(mspId);

    // Optionally auto-fire violations + escalations for threshold breaches
    const autoFired: Array<{
      policyId: number;
      violationId: string | null;
      severity: string | null;
      belowThreshold: boolean;
      escalations: Array<{ escalationId: string; level: number; type: string; alreadyExisted: boolean }>;
    }> = [];

    if (autoFire && output.score.compositeScore > 0) {
      for (const policyMeta of output.policies) {
        // Fetch full policy to get threshold + escalation_rules
        const policyRows = await db.execute(sql`
          SELECT id, escalation_rules AS "escalationRules", violation_score_threshold AS "violationScoreThreshold"
          FROM scope_creep_policies WHERE id = ${policyMeta.id} LIMIT 1
        `);
        if (policyRows.rows.length === 0) continue;
        const policy = policyRows.rows[0] as Pick<ScopeCreepPolicy, "id" | "escalationRules" | "violationScoreThreshold">;
        const escalationRules = Array.isArray(policy.escalationRules) ? policy.escalationRules : [];
        const threshold = policy.violationScoreThreshold;

        const vResult = await fireScopeCreepViolation(
          {
            mspId,
            customerId: b.customerId != null ? Number(b.customerId) : mspId,
            policyId: policy.id,
            compositeScore: output.score.compositeScore,
            threshold,
          },
          { id: policy.id, escalationRules },
        );

        const escalations =
          !vResult.belowThreshold && vResult.violationId
            ? await evaluatePolicyEscalations(
                { id: policy.id, escalationRules },
                vResult.violationId,
                output.score.compositeScore,
                mspId,
                b.customerId != null ? Number(b.customerId) : mspId,
              )
            : [];

        autoFired.push({ policyId: policy.id, ...vResult, escalations });
      }
    }

    res.json({ ...output, autoFired: autoFire ? autoFired : undefined });
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: evaluate failed");
    res.status(500).json({ error: "Scope creep engine evaluation failed" });
  }
});

// ── POST /api/msp/scope-creep/violations/:violationId/resolve ─────────────────

router.post(
  "/msp/scope-creep/violations/:violationId/resolve",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = req.user!.mspId;
    if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
    const violationId = req.params["violationId"] as string;
    const b = req.body as Record<string, unknown>;
    try {
      // Confirm this violation belongs to the calling MSP before resolving
      const check = await db.execute(sql`
        SELECT violation_id FROM scope_creep_violations
        WHERE violation_id = ${violationId} AND msp_id = ${mspId} LIMIT 1
      `);
      if (check.rows.length === 0) {
        res.status(404).json({ error: "Violation not found" });
        return;
      }
      const resolved = await resolveScopeCreepViolation(violationId, b.notes as string | undefined);
      res.json({ resolved });
    } catch (err) {
      logger.error({ err, mspId, violationId }, "msp-scope-creep: resolve violation failed");
      res.status(500).json({ error: "Failed to resolve violation" });
    }
  },
);

// ── POST /api/msp/scope-creep/escalations ─────────────────────────────────────
// MSP operators can manually create escalations for their own violations.

router.post("/msp/scope-creep/escalations", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const b = req.body as Record<string, unknown>;
  try {
    // Confirm the violation belongs to this MSP
    const check = await db.execute(sql`
      SELECT violation_id FROM scope_creep_violations
      WHERE violation_id = ${b.violationId as string} AND msp_id = ${mspId} LIMIT 1
    `);
    if (check.rows.length === 0) {
      res.status(404).json({ error: "Violation not found" });
      return;
    }
    const result = await escalateScopeCreep({
      violationId: b.violationId as string,
      mspId,
      customerId: b.customerId as number,
      level: (b.level as number) ?? 1,
      escalationType: (b.escalationType as "operator_task" | "email" | "sms" | "webhook") ?? "operator_task",
      flagSowAmendment: (b.flagSowAmendment as boolean) ?? false,
      flagPricingReview: (b.flagPricingReview as boolean) ?? false,
      assignedTo: b.assignedTo as string | undefined,
      target: b.target as string | undefined,
      idempotencyKey: b.idempotencyKey as string | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err, mspId }, "msp-scope-creep: create escalation failed");
    res.status(500).json({ error: "Failed to create escalation" });
  }
});

export default router;
