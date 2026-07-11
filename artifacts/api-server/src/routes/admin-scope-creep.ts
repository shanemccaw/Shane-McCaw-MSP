/**
 * admin-scope-creep.ts
 *
 * Admin routes for the Scope Creep Engine — policy CRUD, assignment management,
 * detection/violation/escalation/compliance read access, and unified engine
 * evaluate endpoint (/api/scope-creep/evaluate).
 *
 * All routes require admin auth. MSP-scoped portal routes use msp-engines.ts.
 * ruleOwnership: "msp" — mirrors SLA Engine's shared scaffolding.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  computeScopeCreepEngine,
  runScopeCreepEngineForMsp,
  runScopeCreepEngineForTenant,
  recordScopeCreepDetection,
  computeAndPersistScore,
  fireScopeCreepViolation,
  escalateScopeCreep,
  resolveScopeCreepViolation,
  acknowledgeScopeCreepDetection,
  computeScopeCreepCompliance,
  type ScopeCreepPolicy,
} from "../lib/scope-creep-engine";

const router: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function rowToPolicy(r: Record<string, unknown>): ScopeCreepPolicy {
  return {
    id: r.id as number,
    mspId: r.mspId as number | null,
    name: r.name as string,
    description: r.description as string | null,
    driftThresholdPct: r.driftThresholdPct as number,
    expansionThresholdPct: r.expansionThresholdPct as number,
    timelineSlipDays: r.timelineSlipDays as number,
    driftWeight: r.driftWeight as number,
    expansionWeight: r.expansionWeight as number,
    timelineSlipWeight: r.timelineSlipWeight as number,
    violationScoreThreshold: r.violationScoreThreshold as number,
    escalationRules: Array.isArray(r.escalationRules) ? (r.escalationRules as ScopeCreepPolicy["escalationRules"]) : [],
    isActive: r.isActive as boolean,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

async function fetchAllPolicies(): Promise<ScopeCreepPolicy[]> {
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
    FROM scope_creep_policies ORDER BY id DESC
  `);
  return (rows.rows as Record<string, unknown>[]).map(rowToPolicy);
}

// ── Scope Creep Policies ──────────────────────────────────────────────────────

router.get("/admin/scope-creep/policies", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const policies = await fetchAllPolicies();
    res.json({ policies });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list policies failed");
    res.status(500).json({ error: "Failed to list scope creep policies" });
  }
});

router.get("/admin/scope-creep/policies/:id", requireAdmin, async (req: Request, res: Response) => {
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
      FROM scope_creep_policies WHERE id = ${id}
    `);
    if (rows.rows.length === 0) { res.status(404).json({ error: "Policy not found" }); return; }
    res.json({ policy: rowToPolicy(rows.rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err, id }, "admin-scope-creep: get policy failed");
    res.status(500).json({ error: "Failed to get policy" });
  }
});

router.post("/admin/scope-creep/policies", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      INSERT INTO scope_creep_policies (
        msp_id, name, description,
        drift_threshold_pct, expansion_threshold_pct, timeline_slip_days,
        drift_weight, expansion_weight, timeline_slip_weight,
        violation_score_threshold, escalation_rules, is_active
      ) VALUES (
        ${(b.mspId ?? null) as number | null},
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
    logger.info({ id: newId }, "admin-scope-creep: policy created");
    res.status(201).json({ id: newId });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: create policy failed");
    res.status(500).json({ error: "Failed to create policy" });
  }
});

router.patch("/admin/scope-creep/policies/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  try {
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
      WHERE id = ${id}
    `);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-scope-creep: update policy failed");
    res.status(500).json({ error: "Failed to update policy" });
  }
});

router.delete("/admin/scope-creep/policies/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`UPDATE scope_creep_policies SET is_active = false, updated_at = NOW() WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-scope-creep: delete policy failed");
    res.status(500).json({ error: "Failed to deactivate policy" });
  }
});

// ── Scope Creep Assignments ───────────────────────────────────────────────────

router.get("/admin/scope-creep/assignments", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId != null ? Number(req.query.mspId) : null;
  try {
    const rows = await db.execute(
      mspId != null
        ? sql`SELECT id, msp_id AS "mspId", customer_id AS "customerId", policy_id AS "policyId",
                     assigned_by_user_id AS "assignedByUserId", idempotency_key AS "idempotencyKey",
                     created_at AS "createdAt", updated_at AS "updatedAt"
              FROM scope_creep_assignments WHERE msp_id = ${mspId} ORDER BY id DESC`
        : sql`SELECT id, msp_id AS "mspId", customer_id AS "customerId", policy_id AS "policyId",
                     assigned_by_user_id AS "assignedByUserId", idempotency_key AS "idempotencyKey",
                     created_at AS "createdAt", updated_at AS "updatedAt"
              FROM scope_creep_assignments ORDER BY id DESC`,
    );
    res.json({ assignments: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list assignments failed");
    res.status(500).json({ error: "Failed to list assignments" });
  }
});

router.post("/admin/scope-creep/assignments", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const key = (b.idempotencyKey as string | undefined) ?? randomUUID();
  try {
    const result = await db.execute(sql`
      INSERT INTO scope_creep_assignments (msp_id, customer_id, policy_id, assigned_by_user_id, idempotency_key)
      VALUES (${b.mspId as number}, ${b.customerId as number}, ${b.policyId as number},
              ${(b.assignedByUserId ?? null) as number | null}, ${key})
      ON CONFLICT (msp_id, customer_id) DO UPDATE SET
        policy_id = EXCLUDED.policy_id,
        updated_at = NOW()
      RETURNING id
    `);
    const id = (result.rows[0] as { id: number }).id;
    logger.info({ id, mspId: b.mspId, customerId: b.customerId }, "admin-scope-creep: assignment upserted");
    res.status(201).json({ id, idempotencyKey: key });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: create assignment failed");
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

router.delete("/admin/scope-creep/assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`DELETE FROM scope_creep_assignments WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-scope-creep: delete assignment failed");
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

// ── Scope Creep Detections ────────────────────────────────────────────────────

router.get("/admin/scope-creep/detections", requireAdmin, async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", detection_type AS "detectionType", ref,
                     baseline_value AS "baselineValue", current_value AS "currentValue",
                     change_pct AS "changePct", status, metadata, detected_at AS "detectedAt",
                     resolved_at AS "resolvedAt"
              FROM scope_creep_detections WHERE customer_id = ${customerId}
              ORDER BY detected_at DESC LIMIT 100`
        : status
          ? sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", detection_type AS "detectionType", ref,
                       baseline_value AS "baselineValue", current_value AS "currentValue",
                       change_pct AS "changePct", status, metadata, detected_at AS "detectedAt",
                       resolved_at AS "resolvedAt"
                FROM scope_creep_detections WHERE status = ${status}
                ORDER BY detected_at DESC LIMIT 100`
          : sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", detection_type AS "detectionType", ref,
                       baseline_value AS "baselineValue", current_value AS "currentValue",
                       change_pct AS "changePct", status, metadata, detected_at AS "detectedAt",
                       resolved_at AS "resolvedAt"
                FROM scope_creep_detections ORDER BY detected_at DESC LIMIT 100`,
    );
    res.json({ detections: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list detections failed");
    res.status(500).json({ error: "Failed to list detections" });
  }
});

router.post("/admin/scope-creep/detections", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await recordScopeCreepDetection({
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      policyId: b.policyId as number,
      detectionType: b.detectionType as "drift" | "expansion" | "timeline_slip",
      ref: b.ref as string | undefined,
      baselineValue: (b.baselineValue as number) ?? 0,
      currentValue: (b.currentValue as number) ?? 0,
      changePct: (b.changePct as number) ?? 0,
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
      metadata: b.metadata as Record<string, unknown> | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: record detection failed");
    res.status(500).json({ error: "Failed to record detection" });
  }
});

router.post("/admin/scope-creep/detections/:detectionId/acknowledge", requireAdmin, async (req: Request, res: Response) => {
  const detectionId = req.params["detectionId"] as string;
  const b = req.body as Record<string, unknown>;
  try {
    const acked = await acknowledgeScopeCreepDetection(detectionId, b.notes as string | undefined);
    res.json({ ok: acked });
  } catch (err) {
    logger.error({ err, detectionId }, "admin-scope-creep: acknowledge detection failed");
    res.status(500).json({ error: "Failed to acknowledge detection" });
  }
});

// ── Scope Creep Scores ────────────────────────────────────────────────────────

router.get("/admin/scope-creep/scores", requireAdmin, async (req: Request, res: Response) => {
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, score_id AS "scoreId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", drift_score AS "driftScore",
                     expansion_score AS "expansionScore", timeline_slip_score AS "timelineSlipScore",
                     composite_score AS "compositeScore", open_detections AS "openDetections",
                     computed_at AS "computedAt"
              FROM scope_creep_scores WHERE customer_id = ${customerId}
              ORDER BY computed_at DESC LIMIT 50`
        : sql`SELECT id, score_id AS "scoreId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", drift_score AS "driftScore",
                     expansion_score AS "expansionScore", timeline_slip_score AS "timelineSlipScore",
                     composite_score AS "compositeScore", open_detections AS "openDetections",
                     computed_at AS "computedAt"
              FROM scope_creep_scores ORDER BY computed_at DESC LIMIT 100`,
    );
    res.json({ scores: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list scores failed");
    res.status(500).json({ error: "Failed to list scores" });
  }
});

router.post("/admin/scope-creep/scores/compute", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await computeAndPersistScore({
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      policyId: b.policyId as number,
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: compute score failed");
    res.status(500).json({ error: "Failed to compute score" });
  }
});

// ── Scope Creep Violations ────────────────────────────────────────────────────

router.get("/admin/scope-creep/violations", requireAdmin, async (req: Request, res: Response) => {
  const resolved = req.query.resolved === "true";
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const baseSelect = sql`SELECT id, violation_id AS "violationId", msp_id AS "mspId",
                     customer_id AS "customerId", policy_id AS "policyId",
                     detection_id AS "detectionId", severity,
                     composite_score AS "compositeScore", threshold,
                     operator_task_id AS "operatorTaskId",
                     resolved_at AS "resolvedAt", resolution_notes AS "resolutionNotes",
                     created_at AS "createdAt"
              FROM scope_creep_violations`;
    const rows = await db.execute(
      customerId != null && resolved
        ? sql`${baseSelect} WHERE customer_id = ${customerId} AND resolved_at IS NOT NULL ORDER BY created_at DESC LIMIT 100`
        : customerId != null
          ? sql`${baseSelect} WHERE customer_id = ${customerId} AND resolved_at IS NULL ORDER BY created_at DESC LIMIT 100`
          : resolved
            ? sql`${baseSelect} WHERE resolved_at IS NOT NULL ORDER BY created_at DESC LIMIT 100`
            : sql`${baseSelect} WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ violations: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list violations failed");
    res.status(500).json({ error: "Failed to list violations" });
  }
});

router.post("/admin/scope-creep/violations", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await fireScopeCreepViolation({
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      policyId: b.policyId as number,
      detectionId: b.detectionId as string | undefined,
      compositeScore: (b.compositeScore as number) ?? 0,
      threshold: (b.threshold as number) ?? 60,
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
    });
    if (result.belowThreshold) {
      res.status(200).json({ ...result, message: "Score below threshold — violation not fired" });
      return;
    }
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: fire violation failed");
    res.status(500).json({ error: "Failed to fire violation" });
  }
});

router.post("/admin/scope-creep/violations/:violationId/resolve", requireAdmin, async (req: Request, res: Response) => {
  const violationId = req.params["violationId"] as string;
  const b = req.body as Record<string, unknown>;
  try {
    const resolved = await resolveScopeCreepViolation(violationId, b.notes as string | undefined);
    res.json({ ok: resolved });
  } catch (err) {
    logger.error({ err, violationId }, "admin-scope-creep: resolve violation failed");
    res.status(500).json({ error: "Failed to resolve violation" });
  }
});

// ── Scope Creep Escalations ───────────────────────────────────────────────────

router.get("/admin/scope-creep/escalations", requireAdmin, async (req: Request, res: Response) => {
  const violationId = req.query.violationId as string | undefined;
  try {
    const rows = await db.execute(
      violationId
        ? sql`SELECT id, escalation_id AS "escalationId", violation_id AS "violationId",
                     msp_id AS "mspId", customer_id AS "customerId", level,
                     escalation_type AS "escalationType", status,
                     flag_sow_amendment AS "flagSowAmendment",
                     flag_pricing_review AS "flagPricingReview",
                     assigned_to AS "assignedTo", target,
                     escalated_at AS "escalatedAt", resolved_at AS "resolvedAt",
                     metadata, trace_id AS "traceId"
              FROM scope_creep_escalations WHERE violation_id = ${violationId} ORDER BY level ASC`
        : sql`SELECT id, escalation_id AS "escalationId", violation_id AS "violationId",
                     msp_id AS "mspId", customer_id AS "customerId", level,
                     escalation_type AS "escalationType", status,
                     flag_sow_amendment AS "flagSowAmendment",
                     flag_pricing_review AS "flagPricingReview",
                     assigned_to AS "assignedTo", target,
                     escalated_at AS "escalatedAt", resolved_at AS "resolvedAt",
                     metadata, trace_id AS "traceId"
              FROM scope_creep_escalations WHERE status IN ('pending','in_progress')
              ORDER BY escalated_at DESC LIMIT 100`,
    );
    res.json({ escalations: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list escalations failed");
    res.status(500).json({ error: "Failed to list escalations" });
  }
});

router.post("/admin/scope-creep/escalations", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await escalateScopeCreep({
      violationId: b.violationId as string,
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      level: (b.level as number) ?? 1,
      escalationType: b.escalationType as "operator_task" | "email" | "sms" | "webhook" | undefined,
      flagSowAmendment: b.flagSowAmendment as boolean | undefined,
      flagPricingReview: b.flagPricingReview as boolean | undefined,
      assignedTo: b.assignedTo as string | undefined,
      target: b.target as string | undefined,
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
      metadata: b.metadata as Record<string, unknown> | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: create escalation failed");
    res.status(500).json({ error: "Failed to create escalation" });
  }
});

// ── Scope Creep Compliance Records ───────────────────────────────────────────

router.get("/admin/scope-creep/compliance", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId != null ? Number(req.query.mspId) : null;
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_detections AS "totalDetections", violation_count AS "violationCount",
                     compliance_pct AS "compliancePct", avg_composite_score AS "avgCompositeScore",
                     notes, created_at AS "createdAt"
              FROM scope_creep_compliance WHERE customer_id = ${customerId} ORDER BY period_start DESC LIMIT 24`
        : mspId != null
          ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                       total_detections AS "totalDetections", violation_count AS "violationCount",
                       compliance_pct AS "compliancePct", avg_composite_score AS "avgCompositeScore",
                       notes, created_at AS "createdAt"
                FROM scope_creep_compliance WHERE msp_id = ${mspId} ORDER BY period_start DESC LIMIT 100`
          : sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                       total_detections AS "totalDetections", violation_count AS "violationCount",
                       compliance_pct AS "compliancePct", avg_composite_score AS "avgCompositeScore",
                       notes, created_at AS "createdAt"
                FROM scope_creep_compliance ORDER BY period_start DESC LIMIT 100`,
    );
    res.json({ records: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: list compliance records failed");
    res.status(500).json({ error: "Failed to list compliance records" });
  }
});

router.post("/admin/scope-creep/compliance/snapshot", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const periodStart = new Date(b.periodStart as string);
    const periodEnd = new Date(b.periodEnd as string);
    const snapshot = await computeScopeCreepCompliance(
      b.mspId as number,
      b.customerId as number,
      b.policyId as number,
      periodStart,
      periodEnd,
    );
    const recordId = randomUUID();
    await db.execute(sql`
      INSERT INTO scope_creep_compliance (
        record_id, msp_id, customer_id, policy_id,
        period_start, period_end,
        total_detections, violation_count, compliance_pct, avg_composite_score, notes
      ) VALUES (
        ${recordId}, ${b.mspId as number}, ${b.customerId as number}, ${b.policyId as number},
        ${periodStart.toISOString()}, ${periodEnd.toISOString()},
        ${snapshot.totalDetections}, ${snapshot.violationCount},
        ${snapshot.compliancePct}, ${snapshot.avgCompositeScore}, ${(b.notes as string | null) ?? null}
      )
      ON CONFLICT DO NOTHING
    `);
    res.status(201).json({ recordId, ...snapshot });
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: compliance snapshot failed");
    res.status(500).json({ error: "Failed to compute compliance snapshot" });
  }
});

// ── Unified engine evaluate endpoint ─────────────────────────────────────────

router.post("/admin/scope-creep/evaluate", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const mspId = b.mspId != null ? Number(b.mspId) : null;
  const customerId = b.customerId != null ? Number(b.customerId) : null;
  try {
    let output;
    if (customerId != null) {
      output = await runScopeCreepEngineForTenant(customerId);
    } else if (mspId != null) {
      output = await runScopeCreepEngineForMsp(mspId);
    } else {
      output = await runScopeCreepEngineForMsp(0);
    }
    res.json(output);
  } catch (err) {
    logger.error({ err }, "admin-scope-creep: evaluate failed");
    res.status(500).json({ error: "Scope creep engine evaluation failed" });
  }
});

export default router;
