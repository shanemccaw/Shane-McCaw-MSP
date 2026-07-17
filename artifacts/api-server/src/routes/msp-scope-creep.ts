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
const log = logger.child({ channel: "engine.scope-creep" });
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
    log.error({ err, mspId }, "msp-scope-creep: list policies failed");
    res.status(500).json({ error: "Failed to list policies" });
  }
});

// ── GET /api/msp/scope-creep/policies/:id ──────────────────────────────────────

router.get("/msp/scope-creep/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const id = Number(req.params.id);
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             drift_threshold_pct AS "driftThresholdPct",
             expansion_threshold_pct AS "expansionThresholdPct",
             timeline_slip_days AS "timelineSlipDays",
             drift_weight AS "driftWeight",
             expansion_weight AS "expansionWeight",
             timeline_slip_weight AS "timelineSlipWeight",
             violation_score_threshold AS "violationScoreThreshold",
             escalation_rules AS "escalationRules",
             is_active AS "isActive",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM scope_creep_policies
      WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    res.json({ policy: rows.rows[0] });
  } catch (err) {
    log.error({ err, mspId, id }, "msp-scope-creep: get policy failed");
    res.status(500).json({ error: "Failed to get policy" });
  }
});

// ── POST /api/msp/scope-creep/policies ─────────────────────────────────────────

router.post("/msp/scope-creep/policies", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const b = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      INSERT INTO scope_creep_policies (
        msp_id, name, description,
        drift_threshold_pct, expansion_threshold_pct, timeline_slip_days,
        drift_weight, expansion_weight, timeline_slip_weight,
        violation_score_threshold, escalation_rules, is_active
      ) VALUES (
        ${mspId},
        ${b.name as string},
        ${(b.description ?? null) as string | null},
        ${(b.driftThresholdPct ?? 20) as number},
        ${(b.expansionThresholdPct ?? 15) as number},
        ${(b.timelineSlipDays ?? 7) as number},
        ${(b.driftWeight ?? 33) as number},
        ${(b.expansionWeight ?? 33) as number},
        ${(b.timelineSlipWeight ?? 34) as number},
        ${(b.violationScoreThreshold ?? 60) as number},
        ${JSON.stringify(b.escalationRules ?? [])},
        ${(b.isActive ?? true) as boolean}
      ) RETURNING id
    `);
    const newId = (result.rows[0] as { id: number }).id;
    log.info({ id: newId, mspId }, "msp-scope-creep: policy created");
    res.status(201).json({ id: newId });
  } catch (err) {
    log.error({ err, mspId }, "msp-scope-creep: create policy failed");
    res.status(500).json({ error: "Failed to create policy" });
  }
});

// ── PATCH /api/msp/scope-creep/policies/:id ─────────────────────────────────────

router.patch("/msp/scope-creep/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             drift_threshold_pct AS "driftThresholdPct",
             expansion_threshold_pct AS "expansionThresholdPct",
             timeline_slip_days AS "timelineSlipDays",
             drift_weight AS "driftWeight",
             expansion_weight AS "expansionWeight",
             timeline_slip_weight AS "timelineSlipWeight",
             violation_score_threshold AS "violationScoreThreshold",
             escalation_rules AS "escalationRules",
             is_active AS "isActive"
      FROM scope_creep_policies
      WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    const original = rows.rows[0] as Record<string, any>;
    if (original.mspId === null || original.mspId === 0) {
      const name = b.name !== undefined ? b.name : original.name;
      const description = b.description !== undefined ? b.description : original.description;
      const driftThresholdPct = b.driftThresholdPct !== undefined ? b.driftThresholdPct : original.driftThresholdPct;
      const expansionThresholdPct = b.expansionThresholdPct !== undefined ? b.expansionThresholdPct : original.expansionThresholdPct;
      const timelineSlipDays = b.timelineSlipDays !== undefined ? b.timelineSlipDays : original.timelineSlipDays;
      const driftWeight = b.driftWeight !== undefined ? b.driftWeight : original.driftWeight;
      const expansionWeight = b.expansionWeight !== undefined ? b.expansionWeight : original.expansionWeight;
      const timelineSlipWeight = b.timelineSlipWeight !== undefined ? b.timelineSlipWeight : original.timelineSlipWeight;
      const violationScoreThreshold = b.violationScoreThreshold !== undefined ? b.violationScoreThreshold : original.violationScoreThreshold;
      const escalationRules = b.escalationRules !== undefined ? JSON.stringify(b.escalationRules) : JSON.stringify(original.escalationRules);
      const isActive = b.isActive !== undefined ? b.isActive : original.isActive;

      const result = await db.execute(sql`
        INSERT INTO scope_creep_policies (
          msp_id, name, description,
          drift_threshold_pct, expansion_threshold_pct, timeline_slip_days,
          drift_weight, expansion_weight, timeline_slip_weight,
          violation_score_threshold, escalation_rules, is_active
        ) VALUES (
          ${mspId}, ${name}, ${description},
          ${driftThresholdPct}, ${expansionThresholdPct}, ${timelineSlipDays},
          ${driftWeight}, ${expansionWeight}, ${timelineSlipWeight},
          ${violationScoreThreshold}, ${escalationRules}, ${isActive}
        ) RETURNING id
      `);
      const newId = (result.rows[0] as { id: number }).id;
      log.info({ id: newId, mspId, originalId: id }, "msp-scope-creep: policy override created");
      res.status(201).json({ id: newId, override: true });
    } else {
      await db.execute(sql`
        UPDATE scope_creep_policies SET
          name = COALESCE(${(b.name ?? null) as string | null}, name),
          description = COALESCE(${(b.description ?? null) as string | null}, description),
          drift_threshold_pct = COALESCE(${(b.driftThresholdPct ?? null) as number | null}, drift_threshold_pct),
          expansion_threshold_pct = COALESCE(${(b.expansionThresholdPct ?? null) as number | null}, expansion_threshold_pct),
          timeline_slip_days = COALESCE(${(b.timelineSlipDays ?? null) as number | null}, timeline_slip_days),
          drift_weight = COALESCE(${(b.driftWeight ?? null) as number | null}, drift_weight),
          expansion_weight = COALESCE(${(b.expansionWeight ?? null) as number | null}, expansion_weight),
          timeline_slip_weight = COALESCE(${(b.timelineSlipWeight ?? null) as number | null}, timeline_slip_weight),
          violation_score_threshold = COALESCE(${(b.violationScoreThreshold ?? null) as number | null}, violation_score_threshold),
          escalation_rules = COALESCE(${b.escalationRules != null ? JSON.stringify(b.escalationRules) : null}, escalation_rules::text)::jsonb,
          is_active = COALESCE(${(b.isActive ?? null) as boolean | null}, is_active),
          updated_at = NOW()
        WHERE id = ${id} AND msp_id = ${mspId}
      `);
      res.json({ ok: true });
    }
  } catch (err) {
    log.error({ err, mspId, id }, "msp-scope-creep: update policy failed");
    res.status(500).json({ error: "Failed to update policy" });
  }
});

// ── DELETE /api/msp/scope-creep/policies/:id ───────────────────────────────────

router.delete("/msp/scope-creep/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const id = Number(req.params.id);
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             drift_threshold_pct AS "driftThresholdPct",
             expansion_threshold_pct AS "expansionThresholdPct",
             timeline_slip_days AS "timelineSlipDays",
             drift_weight AS "driftWeight",
             expansion_weight AS "expansionWeight",
             timeline_slip_weight AS "timelineSlipWeight",
             violation_score_threshold AS "violationScoreThreshold",
             escalation_rules AS "escalationRules",
             is_active AS "isActive"
      FROM scope_creep_policies WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    const original = rows.rows[0] as Record<string, any>;
    if (original.mspId === null || original.mspId === 0) {
      const result = await db.execute(sql`
        INSERT INTO scope_creep_policies (
          msp_id, name, description,
          drift_threshold_pct, expansion_threshold_pct, timeline_slip_days,
          drift_weight, expansion_weight, timeline_slip_weight,
          violation_score_threshold, escalation_rules, is_active
        ) VALUES (
          ${mspId}, ${original.name}, ${original.description},
          ${original.driftThresholdPct}, ${original.expansionThresholdPct}, ${original.timelineSlipDays},
          ${original.driftWeight}, ${original.expansionWeight}, ${original.timelineSlipWeight},
          ${original.violationScoreThreshold}, ${JSON.stringify(original.escalationRules)}, false
        ) RETURNING id
      `);
      const newId = (result.rows[0] as { id: number }).id;
      log.info({ id: newId, mspId, originalId: id }, "msp-scope-creep: policy override created (deactivated)");
      res.status(201).json({ id: newId, override: true });
    } else {
      await db.execute(sql`
        UPDATE scope_creep_policies SET is_active = false, updated_at = NOW() WHERE id = ${id} AND msp_id = ${mspId}
      `);
      res.json({ ok: true });
    }
  } catch (err) {
    log.error({ err, mspId, id }, "msp-scope-creep: delete policy failed");
    res.status(500).json({ error: "Failed to deactivate policy" });
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
    log.error({ err, mspId }, "msp-scope-creep: list detections failed");
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
    log.error({ err, mspId }, "msp-scope-creep: list violations failed");
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
    log.error({ err, mspId }, "msp-scope-creep: list escalations failed");
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
    log.error({ err, mspId }, "msp-scope-creep: list compliance failed");
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
          FROM scope_creep_policies WHERE id = ${policyMeta.id} AND (msp_id = ${mspId} OR msp_id IS NULL) LIMIT 1
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
    log.error({ err, mspId }, "msp-scope-creep: evaluate failed");
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
      log.error({ err, mspId, violationId }, "msp-scope-creep: resolve violation failed");
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
    log.error({ err, mspId }, "msp-scope-creep: create escalation failed");
    res.status(500).json({ error: "Failed to create escalation" });
  }
});

export default router;
