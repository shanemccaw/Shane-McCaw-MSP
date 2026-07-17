/**
 * scope-creep-engine.ts
 *
 * Scope Creep Engine — detects deliverable/requirement/ticket/timeline/engagement
 * drift and SOW expansion, scores scope-creep risk, raises violations, escalates
 * (including SOW amendment and pricing review recommendations), and tracks
 * monthly compliance.
 *
 * Design:
 *  - Deterministic: given the same detection rows and policy, always produces the same output.
 *  - Idempotent: all mutating helpers accept an idempotencyKey and short-circuit
 *    on conflict so re-runs are safe.
 *  - Canonical events emitted via logger for auditability.
 *  - Mirrors SLA Engine's shared EngineDef contract so EnginePanel renders it
 *    without any special-casing.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScopeCreepEscalationRule {
  level: number;
  triggerScore: number;
  type: "operator_task" | "email" | "sms" | "webhook";
  flagSowAmendment?: boolean;
  flagPricingReview?: boolean;
  assignedTo?: string;
  target?: string;
}

export interface ScopeCreepPolicy {
  id: number;
  mspId: number | null;
  name: string;
  description: string | null;
  driftThresholdPct: number;
  expansionThresholdPct: number;
  timelineSlipDays: number;
  driftWeight: number;
  expansionWeight: number;
  timelineSlipWeight: number;
  violationScoreThreshold: number;
  escalationRules: ScopeCreepEscalationRule[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ScopeCreepDetection {
  id: number;
  detectionId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  detectionType: "drift" | "expansion" | "timeline_slip";
  ref: string | null;
  baselineValue: number;
  currentValue: number;
  changePct: number;
  status: "open" | "acknowledged" | "resolved";
  idempotencyKey: string | null;
  traceId: string | null;
  metadata: Record<string, unknown>;
  detectedAt: string;
  resolvedAt: string | null;
}

export interface ScopeCreepScore {
  id: number;
  scoreId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  driftScore: number;
  expansionScore: number;
  timelineSlipScore: number;
  compositeScore: number;
  openDetections: number;
  idempotencyKey: string | null;
  traceId: string | null;
  computedAt: string;
}

export interface ScopeCreepViolation {
  id: number;
  violationId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  detectionId: string | null;
  severity: "low" | "medium" | "high" | "critical";
  compositeScore: number;
  threshold: number;
  operatorTaskId: number | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  idempotencyKey: string | null;
  traceId: string | null;
  createdAt: string;
}

export interface ScopeCreepEscalation {
  id: number;
  escalationId: string;
  violationId: string;
  mspId: number;
  customerId: number;
  level: number;
  escalationType: "operator_task" | "email" | "sms" | "webhook";
  status: "pending" | "in_progress" | "resolved";
  flagSowAmendment: boolean;
  flagPricingReview: boolean;
  assignedTo: string | null;
  target: string | null;
  idempotencyKey: string | null;
  traceId: string | null;
  metadata: Record<string, unknown>;
  escalatedAt: string;
  resolvedAt: string | null;
}

export interface ScopeCreepDetectionEvaluation {
  detectionId: string;
  detectionType: "drift" | "expansion" | "timeline_slip";
  changePct: number;
  threshold: number;
  exceeded: boolean;
  contribution: number;
}

export interface ScopeCreepEngineOutput {
  engine: "scope_creep";
  score: {
    compositeScore: number;
    driftScore: number;
    expansionScore: number;
    timelineSlipScore: number;
    openDetections: number;
    openViolations: number;
    compliancePct: number;
  };
  breakdown: ScopeCreepDetectionEvaluation[];
  policies: Array<{ id: number; name: string }>;
  rawSignals: string[];
  timestamp: string;
}

// ── Pure computation ──────────────────────────────────────────────────────────

export function evaluateDetection(
  detection: ScopeCreepDetection,
  policy: ScopeCreepPolicy,
): ScopeCreepDetectionEvaluation {
  const threshold =
    detection.detectionType === "drift"
      ? policy.driftThresholdPct
      : detection.detectionType === "expansion"
        ? policy.expansionThresholdPct
        : policy.timelineSlipDays;

  const weight =
    detection.detectionType === "drift"
      ? policy.driftWeight
      : detection.detectionType === "expansion"
        ? policy.expansionWeight
        : policy.timelineSlipWeight;

  const exceeded = detection.changePct >= threshold;
  const contribution = exceeded ? Math.min(100, Math.round((detection.changePct / threshold) * weight)) : 0;

  return {
    detectionId: detection.detectionId,
    detectionType: detection.detectionType,
    changePct: detection.changePct,
    threshold,
    exceeded,
    contribution,
  };
}

export function computeScopeCreepEngine(
  detections: ScopeCreepDetection[],
  policies: ScopeCreepPolicy[],
  openViolations: number = 0,
  now: Date = new Date(),
): ScopeCreepEngineOutput {
  const policyMap = new Map(policies.map(p => [p.id, p]));
  const openDetections = detections.filter(d => d.status === "open");
  const evaluations: ScopeCreepDetectionEvaluation[] = [];

  let driftTotal = 0;
  let expansionTotal = 0;
  let timelineSlipTotal = 0;

  for (const detection of openDetections) {
    const policy = policyMap.get(detection.policyId);
    if (!policy) continue;
    const ev = evaluateDetection(detection, policy);
    evaluations.push(ev);
    if (ev.detectionType === "drift") driftTotal += ev.contribution;
    else if (ev.detectionType === "expansion") expansionTotal += ev.contribution;
    else timelineSlipTotal += ev.contribution;
  }

  const compositeScore = Math.min(100, Math.round((driftTotal + expansionTotal + timelineSlipTotal) / 3));
  const compliancePct =
    (openDetections.length + openViolations) === 0
      ? 100
      : Math.max(0, Math.round(100 - compositeScore));

  const rawSignals: string[] = [];
  if (driftTotal > 20) rawSignals.push("scope_creep:drift_detected");
  if (expansionTotal > 20) rawSignals.push("scope_creep:expansion_detected");
  if (timelineSlipTotal > 20) rawSignals.push("scope_creep:timeline_slip_detected");
  if (openViolations > 0) rawSignals.push("scope_creep:violation_open");
  if (compliancePct < 80) rawSignals.push("scope_creep:low_compliance");
  if (compositeScore >= 70) rawSignals.push("scope_creep:high_risk");

  return {
    engine: "scope_creep",
    score: {
      compositeScore,
      driftScore: Math.min(100, driftTotal),
      expansionScore: Math.min(100, expansionTotal),
      timelineSlipScore: Math.min(100, timelineSlipTotal),
      openDetections: openDetections.length,
      openViolations,
      compliancePct,
    },
    breakdown: evaluations,
    policies: policies.map(p => ({ id: p.id, name: p.name })),
    rawSignals,
    timestamp: now.toISOString(),
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchPolicies(mspId?: number): Promise<ScopeCreepPolicy[]> {
  const rows = await db.execute(
    mspId != null
      ? sql`SELECT id, msp_id AS "mspId", name, description,
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
            FROM scope_creep_policies WHERE is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)`
      : sql`SELECT id, msp_id AS "mspId", name, description,
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
            FROM scope_creep_policies WHERE is_active = true`,
  );
  return (rows.rows as unknown as ScopeCreepPolicy[]).map(r => ({
    ...r,
    escalationRules: Array.isArray(r.escalationRules) ? r.escalationRules : [],
  }));
}

async function fetchOpenDetections(mspId?: number, customerId?: number): Promise<ScopeCreepDetection[]> {
  const rows = await db.execute(
    customerId != null
      ? sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
              policy_id AS "policyId", detection_type AS "detectionType", ref,
              baseline_value AS "baselineValue", current_value AS "currentValue",
              change_pct AS "changePct", status, idempotency_key AS "idempotencyKey",
              trace_id AS "traceId", metadata, detected_at AS "detectedAt", resolved_at AS "resolvedAt"
            FROM scope_creep_detections WHERE status = 'open' AND customer_id = ${customerId}`
      : mspId != null
        ? sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                policy_id AS "policyId", detection_type AS "detectionType", ref,
                baseline_value AS "baselineValue", current_value AS "currentValue",
                change_pct AS "changePct", status, idempotency_key AS "idempotencyKey",
                trace_id AS "traceId", metadata, detected_at AS "detectedAt", resolved_at AS "resolvedAt"
              FROM scope_creep_detections WHERE status = 'open' AND msp_id = ${mspId}`
        : sql`SELECT id, detection_id AS "detectionId", msp_id AS "mspId", customer_id AS "customerId",
                policy_id AS "policyId", detection_type AS "detectionType", ref,
                baseline_value AS "baselineValue", current_value AS "currentValue",
                change_pct AS "changePct", status, idempotency_key AS "idempotencyKey",
                trace_id AS "traceId", metadata, detected_at AS "detectedAt", resolved_at AS "resolvedAt"
              FROM scope_creep_detections WHERE status = 'open'`,
  );
  return rows.rows as unknown as ScopeCreepDetection[];
}

async function countOpenViolations(customerId?: number, mspId?: number): Promise<number> {
  const rows = await db.execute(
    customerId != null
      ? sql`SELECT COUNT(*) AS cnt FROM scope_creep_violations WHERE resolved_at IS NULL AND customer_id = ${customerId}`
      : mspId != null
        ? sql`SELECT COUNT(*) AS cnt FROM scope_creep_violations WHERE resolved_at IS NULL AND msp_id = ${mspId}`
        : sql`SELECT COUNT(*) AS cnt FROM scope_creep_violations WHERE resolved_at IS NULL`,
  );
  return parseInt((rows.rows[0] as { cnt: string }).cnt, 10) || 0;
}

export async function runScopeCreepEngineForTenant(customerId: number, ctx?: { evaluationTimestamp?: Date }): Promise<ScopeCreepEngineOutput> {
  const [detections, policies, openViolations] = await Promise.all([
    fetchOpenDetections(undefined, customerId),
    fetchPolicies(),
    countOpenViolations(customerId),
  ]);
  return computeScopeCreepEngine(detections, policies, openViolations, ctx?.evaluationTimestamp);
}

export async function runScopeCreepEngineForMsp(mspId: number, ctx?: { evaluationTimestamp?: Date }): Promise<ScopeCreepEngineOutput> {
  const [detections, policies, openViolations] = await Promise.all([
    fetchOpenDetections(mspId),
    fetchPolicies(mspId),
    countOpenViolations(undefined, mspId),  // MSP-scoped: only this MSP's violations
  ]);
  return computeScopeCreepEngine(detections, policies, openViolations, ctx?.evaluationTimestamp);
}

// ── Detection (idempotent) ────────────────────────────────────────────────────

export interface RecordDetectionOptions {
  mspId: number;
  customerId: number;
  policyId: number;
  detectionType: "drift" | "expansion" | "timeline_slip";
  ref?: string;
  baselineValue: number;
  currentValue: number;
  changePct: number;
  idempotencyKey?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export async function recordScopeCreepDetection(
  opts: RecordDetectionOptions,
): Promise<{ detectionId: string; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT detection_id AS "detectionId" FROM scope_creep_detections WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { detectionId: (existing.rows[0] as { detectionId: string }).detectionId, alreadyExisted: true };
  }

  const detectionId = randomUUID();
  await db.execute(sql`
    INSERT INTO scope_creep_detections (
      detection_id, msp_id, customer_id, policy_id, detection_type, ref,
      baseline_value, current_value, change_pct, idempotency_key, trace_id, metadata
    ) VALUES (
      ${detectionId}, ${opts.mspId}, ${opts.customerId}, ${opts.policyId},
      ${opts.detectionType}, ${opts.ref ?? null},
      ${opts.baselineValue}, ${opts.currentValue}, ${opts.changePct},
      ${key}, ${opts.traceId ?? null}, ${JSON.stringify(opts.metadata ?? {})}
    )
  `);

  logger.info(
    { detectionId, mspId: opts.mspId, customerId: opts.customerId, type: opts.detectionType, changePct: opts.changePct },
    "scope-creep-engine: detection recorded",
  );
  return { detectionId, alreadyExisted: false };
}

// ── Scoring (idempotent) ──────────────────────────────────────────────────────

export interface ComputeScoreOptions {
  mspId: number;
  customerId: number;
  policyId: number;
  idempotencyKey?: string;
  traceId?: string;
}

export async function computeAndPersistScore(
  opts: ComputeScoreOptions,
): Promise<{ scoreId: string; compositeScore: number; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT score_id AS "scoreId", composite_score AS "compositeScore"
        FROM scope_creep_scores WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { scoreId: string; compositeScore: number };
    return { scoreId: row.scoreId, compositeScore: row.compositeScore, alreadyExisted: true };
  }

  const [detections, policies, openViolations] = await Promise.all([
    fetchOpenDetections(opts.mspId, opts.customerId),
    fetchPolicies(opts.mspId),
    countOpenViolations(opts.customerId),
  ]);

  const engineOutput = computeScopeCreepEngine(detections, policies, openViolations);
  const scoreId = randomUUID();

  await db.execute(sql`
    INSERT INTO scope_creep_scores (
      score_id, msp_id, customer_id, policy_id,
      drift_score, expansion_score, timeline_slip_score, composite_score,
      open_detections, idempotency_key, trace_id
    ) VALUES (
      ${scoreId}, ${opts.mspId}, ${opts.customerId}, ${opts.policyId},
      ${engineOutput.score.driftScore}, ${engineOutput.score.expansionScore},
      ${engineOutput.score.timelineSlipScore}, ${engineOutput.score.compositeScore},
      ${engineOutput.score.openDetections}, ${key}, ${opts.traceId ?? null}
    )
  `);

  logger.info(
    { scoreId, customerId: opts.customerId, compositeScore: engineOutput.score.compositeScore },
    "scope-creep-engine: score persisted",
  );
  return { scoreId, compositeScore: engineOutput.score.compositeScore, alreadyExisted: false };
}

// ── Violation (idempotent) ────────────────────────────────────────────────────

export interface FireViolationOptions {
  mspId: number;
  customerId: number;
  policyId: number;
  detectionId?: string;
  compositeScore: number;
  threshold: number;
  idempotencyKey?: string;
  traceId?: string;
}

function deriveSeverity(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 85) return "critical";
  if (score >= 65) return "high";
  if (score >= 40) return "medium";
  return "low";
}

// ── Policy-driven escalation evaluation ───────────────────────────────────────
// Called after a violation fires. Reads the policy's escalation_rules and
// auto-creates escalations for every rule whose triggerScore <= compositeScore.
// Each escalation is idempotent: keyed on violationId + level so re-runs are safe.
export async function evaluatePolicyEscalations(
  policy: Pick<ScopeCreepPolicy, "id" | "escalationRules">,
  violationId: string,
  compositeScore: number,
  mspId: number,
  customerId: number,
  traceId?: string,
): Promise<Array<{ escalationId: string; level: number; type: string; alreadyExisted: boolean }>> {
  const triggered = (policy.escalationRules ?? []).filter(r => compositeScore >= r.triggerScore);
  if (triggered.length === 0) return [];

  const results: Array<{ escalationId: string; level: number; type: string; alreadyExisted: boolean }> = [];

  for (const rule of triggered) {
    // Idempotency key: violation + level guarantees one escalation per level per violation
    const ikey = `esc:${violationId}:level:${rule.level}`;
    const result = await escalateScopeCreep({
      violationId,
      mspId,
      customerId,
      level: rule.level,
      escalationType: rule.type,
      flagSowAmendment: rule.flagSowAmendment ?? false,
      flagPricingReview: rule.flagPricingReview ?? false,
      assignedTo: rule.assignedTo,
      target: rule.target,
      idempotencyKey: ikey,
      traceId,
      metadata: { autoFiredByPolicy: true, policyId: policy.id, triggerScore: rule.triggerScore },
    });
    results.push({ ...result, level: rule.level, type: rule.type });
  }

  logger.info(
    { violationId, compositeScore, triggeredRules: triggered.length },
    "scope-creep-engine: policy escalation evaluation complete",
  );
  return results;
}

export async function fireScopeCreepViolation(
  opts: FireViolationOptions,
  policy?: Pick<ScopeCreepPolicy, "id" | "escalationRules">,
): Promise<{ violationId: string | null; severity: string | null; alreadyExisted: boolean; belowThreshold: boolean }> {
  // Threshold enforcement: do not fire violation if score has not crossed threshold
  if (opts.compositeScore < opts.threshold) {
    logger.debug(
      { customerId: opts.customerId, compositeScore: opts.compositeScore, threshold: opts.threshold },
      "scope-creep-engine: violation skipped — composite score below threshold",
    );
    return { violationId: null, severity: null, alreadyExisted: false, belowThreshold: true };
  }

  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT violation_id AS "violationId", severity FROM scope_creep_violations WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { violationId: string; severity: string };
    return { violationId: row.violationId, severity: row.severity, alreadyExisted: true, belowThreshold: false };
  }

  const violationId = randomUUID();
  const severity = deriveSeverity(opts.compositeScore);

  await db.execute(sql`
    INSERT INTO scope_creep_violations (
      violation_id, msp_id, customer_id, policy_id, detection_id,
      severity, composite_score, threshold, idempotency_key, trace_id
    ) VALUES (
      ${violationId}, ${opts.mspId}, ${opts.customerId}, ${opts.policyId},
      ${opts.detectionId ?? null}, ${severity}, ${opts.compositeScore}, ${opts.threshold},
      ${key}, ${opts.traceId ?? null}
    )
  `);

  logger.info(
    { violationId, customerId: opts.customerId, severity, compositeScore: opts.compositeScore },
    "scope-creep-engine: violation fired",
  );

  // Auto-evaluate policy escalation rules (SOW amendment, pricing review, operator tasks)
  if (policy) {
    await evaluatePolicyEscalations(
      policy,
      violationId,
      opts.compositeScore,
      opts.mspId,
      opts.customerId,
      opts.traceId,
    ).catch(err => {
      logger.warn({ err, violationId }, "scope-creep-engine: policy escalation evaluation failed (non-fatal)");
    });
  }

  return { violationId, severity, alreadyExisted: false, belowThreshold: false };
}

// ── Escalation (idempotent) ───────────────────────────────────────────────────

export interface EscalateScopeCreepOptions {
  violationId: string;
  mspId: number;
  customerId: number;
  level: number;
  escalationType?: "operator_task" | "email" | "sms" | "webhook";
  flagSowAmendment?: boolean;
  flagPricingReview?: boolean;
  assignedTo?: string;
  target?: string;
  idempotencyKey?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export async function escalateScopeCreep(
  opts: EscalateScopeCreepOptions,
): Promise<{ escalationId: string; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT escalation_id AS "escalationId" FROM scope_creep_escalations WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { escalationId: (existing.rows[0] as { escalationId: string }).escalationId, alreadyExisted: true };
  }

  const escalationId = randomUUID();
  await db.execute(sql`
    INSERT INTO scope_creep_escalations (
      escalation_id, violation_id, msp_id, customer_id, level,
      escalation_type, flag_sow_amendment, flag_pricing_review,
      assigned_to, target, idempotency_key, trace_id, metadata
    ) VALUES (
      ${escalationId}, ${opts.violationId}, ${opts.mspId}, ${opts.customerId}, ${opts.level},
      ${opts.escalationType ?? "operator_task"},
      ${opts.flagSowAmendment ?? false}, ${opts.flagPricingReview ?? false},
      ${opts.assignedTo ?? null}, ${opts.target ?? null},
      ${key}, ${opts.traceId ?? null}, ${JSON.stringify(opts.metadata ?? {})}
    )
  `);

  logger.info(
    { escalationId, violationId: opts.violationId, level: opts.level, flagSowAmendment: opts.flagSowAmendment, flagPricingReview: opts.flagPricingReview },
    "scope-creep-engine: escalation created",
  );
  return { escalationId, alreadyExisted: false };
}

// ── Resolution ────────────────────────────────────────────────────────────────

export async function resolveScopeCreepViolation(
  violationId: string,
  notes?: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE scope_creep_violations
    SET resolved_at = NOW(), resolution_notes = ${notes ?? null}
    WHERE violation_id = ${violationId} AND resolved_at IS NULL
    RETURNING id
  `);
  const resolved = result.rows.length > 0;

  if (resolved) {
    await db.execute(sql`
      UPDATE scope_creep_escalations
      SET status = 'resolved', resolved_at = NOW()
      WHERE violation_id = ${violationId} AND status IN ('pending', 'in_progress')
    `);
    logger.info({ violationId }, "scope-creep-engine: violation resolved");
  }

  return resolved;
}

export async function acknowledgeScopeCreepDetection(
  detectionId: string,
  notes?: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE scope_creep_detections
    SET status = 'acknowledged', metadata = jsonb_set(COALESCE(metadata, '{}'), '{acknowledgedNotes}', ${JSON.stringify(notes ?? "")})
    WHERE detection_id = ${detectionId} AND status = 'open'
    RETURNING id
  `);
  const acked = result.rows.length > 0;
  if (acked) {
    logger.info({ detectionId }, "scope-creep-engine: detection acknowledged");
  }
  return acked;
}

// ── Monthly compliance snapshot ───────────────────────────────────────────────

export async function computeScopeCreepCompliance(
  mspId: number,
  customerId: number,
  policyId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  totalDetections: number;
  violationCount: number;
  compliancePct: number;
  avgCompositeScore: number | null;
}> {
  const detRows = await db.execute(sql`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN EXISTS (
             SELECT 1 FROM scope_creep_violations v WHERE v.customer_id = ${customerId} AND v.resolved_at IS NULL
           ) THEN 1 ELSE 0 END) AS violations
    FROM scope_creep_detections
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND detected_at >= ${periodStart.toISOString()} AND detected_at < ${periodEnd.toISOString()}
  `);
  const row = detRows.rows[0] as { total: string; violations: string };
  const totalDetections = parseInt(row.total, 10) || 0;

  const violRows = await db.execute(sql`
    SELECT COUNT(*) AS cnt FROM scope_creep_violations
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND created_at >= ${periodStart.toISOString()} AND created_at < ${periodEnd.toISOString()}
  `);
  const violationCount = parseInt((violRows.rows[0] as { cnt: string }).cnt, 10) || 0;

  const scoreRows = await db.execute(sql`
    SELECT AVG(composite_score) AS avg_score
    FROM scope_creep_scores
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND computed_at >= ${periodStart.toISOString()} AND computed_at < ${periodEnd.toISOString()}
  `);
  const avgScore = (scoreRows.rows[0] as { avg_score: string | null }).avg_score;
  const avgCompositeScore = avgScore != null ? parseFloat(avgScore) : null;

  const compliancePct =
    totalDetections === 0 && violationCount === 0
      ? 100
      : Math.max(0, 100 - (violationCount * 20 + (avgCompositeScore ?? 0) / 2));

  return {
    totalDetections,
    violationCount,
    compliancePct: Math.round(compliancePct),
    avgCompositeScore,
  };
}

// ── DB bootstrap ──────────────────────────────────────────────────────────────

export async function ensureScopeCreepTables(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_policies (
      id SERIAL PRIMARY KEY,
      msp_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      drift_threshold_pct NUMERIC NOT NULL DEFAULT 20,
      expansion_threshold_pct NUMERIC NOT NULL DEFAULT 15,
      timeline_slip_days NUMERIC NOT NULL DEFAULT 7,
      drift_weight NUMERIC NOT NULL DEFAULT 33,
      expansion_weight NUMERIC NOT NULL DEFAULT 33,
      timeline_slip_weight NUMERIC NOT NULL DEFAULT 34,
      violation_score_threshold NUMERIC NOT NULL DEFAULT 60,
      escalation_rules JSONB NOT NULL DEFAULT '[]',
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_assignments (
      id SERIAL PRIMARY KEY,
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      policy_id INTEGER NOT NULL REFERENCES scope_creep_policies(id) ON DELETE RESTRICT,
      assigned_by_user_id INTEGER,
      idempotency_key TEXT UNIQUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(msp_id, customer_id)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_detections (
      id SERIAL PRIMARY KEY,
      detection_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      policy_id INTEGER NOT NULL,
      detection_type TEXT NOT NULL CHECK (detection_type IN ('drift','expansion','timeline_slip')),
      ref TEXT,
      baseline_value NUMERIC NOT NULL DEFAULT 0,
      current_value NUMERIC NOT NULL DEFAULT 0,
      change_pct NUMERIC NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')),
      idempotency_key TEXT UNIQUE,
      trace_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_scores (
      id SERIAL PRIMARY KEY,
      score_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      policy_id INTEGER NOT NULL,
      drift_score NUMERIC NOT NULL DEFAULT 0,
      expansion_score NUMERIC NOT NULL DEFAULT 0,
      timeline_slip_score NUMERIC NOT NULL DEFAULT 0,
      composite_score NUMERIC NOT NULL DEFAULT 0,
      open_detections INTEGER NOT NULL DEFAULT 0,
      idempotency_key TEXT UNIQUE,
      trace_id TEXT,
      computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_violations (
      id SERIAL PRIMARY KEY,
      violation_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      policy_id INTEGER NOT NULL,
      detection_id UUID,
      severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high','critical')),
      composite_score NUMERIC NOT NULL DEFAULT 0,
      threshold NUMERIC NOT NULL DEFAULT 60,
      operator_task_id INTEGER,
      resolved_at TIMESTAMPTZ,
      resolution_notes TEXT,
      idempotency_key TEXT UNIQUE,
      trace_id TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_escalations (
      id SERIAL PRIMARY KEY,
      escalation_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      violation_id UUID NOT NULL,
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      escalation_type TEXT NOT NULL DEFAULT 'operator_task' CHECK (escalation_type IN ('operator_task','email','sms','webhook')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','resolved')),
      flag_sow_amendment BOOLEAN NOT NULL DEFAULT FALSE,
      flag_pricing_review BOOLEAN NOT NULL DEFAULT FALSE,
      assigned_to TEXT,
      target TEXT,
      idempotency_key TEXT UNIQUE,
      trace_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}',
      escalated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS scope_creep_compliance (
      id SERIAL PRIMARY KEY,
      record_id UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      msp_id INTEGER NOT NULL,
      customer_id INTEGER NOT NULL,
      policy_id INTEGER NOT NULL,
      period_start TIMESTAMPTZ NOT NULL,
      period_end TIMESTAMPTZ NOT NULL,
      total_detections INTEGER NOT NULL DEFAULT 0,
      violation_count INTEGER NOT NULL DEFAULT 0,
      compliance_pct NUMERIC NOT NULL DEFAULT 100,
      avg_composite_score NUMERIC,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  logger.info("scope-creep-engine: tables ensured");
}
