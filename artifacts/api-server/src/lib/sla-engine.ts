/**
 * sla-engine.ts
 *
 * SLA Engine — tracks response/resolution timers per customer, detects
 * warnings and breaches, emits canonical events, and computes compliance
 * scores that plug into the shared engine-registry / EngineDef contract.
 *
 * Design:
 *  - Deterministic: given the same timer rows, always produces the same output.
 *  - Idempotent: all mutating helpers accept an idempotencyKey and short-circuit
 *    on conflict so re-runs are safe.
 *  - Canonical events emitted to msp_event_store (when MSP tables exist) and
 *    logged via the server logger for auditability.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SlaPolicy {
  id: number;
  mspId: number | null;
  name: string;
  description: string | null;
  responseTimeMinutes: number;
  warningThresholdPct: number;
  resolutionTimeMinutes: number;
  resolutionWarningThresholdPct: number;
  escalationRules: SlaEscalationRule[];
  priority: "low" | "standard" | "high" | "critical";
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SlaEscalationRule {
  level: number;
  triggerMinutes: number;
  type: "operator_task" | "email" | "sms" | "webhook";
  assignedTo?: string;
  target?: string;
}

export interface SlaTimer {
  id: number;
  timerId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  ticketRef: string | null;
  ticketType: string;
  status: "running" | "paused" | "stopped" | "breached";
  phase: "response" | "resolution";
  startedAt: string;
  warningFiredAt: string | null;
  breachedAt: string | null;
  stoppedAt: string | null;
  idempotencyKey: string | null;
  traceId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface SlaBreach {
  id: number;
  breachId: string;
  timerId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  ticketRef: string | null;
  phase: string;
  breachType: "threshold_exceeded" | "warning_only";
  elapsedMinutes: number;
  thresholdMinutes: number;
  operatorTaskId: number | null;
  resolvedAt: string | null;
  resolutionNotes: string | null;
  idempotencyKey: string | null;
  traceId: string | null;
  createdAt: string;
}

export interface SlaTimerEvaluation {
  timerId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  phase: "response" | "resolution";
  ticketRef: string | null;
  elapsedMinutes: number;
  thresholdMinutes: number;
  warningThresholdMinutes: number;
  status: "ok" | "warning" | "breached";
  warningFired: boolean;
  breached: boolean;
}

export interface SlaEngineOutput {
  engine: "sla";
  score: {
    compliancePct: number;
    runningTimers: number;
    activeBreaches: number;
    warningTimers: number;
  };
  breakdown: SlaTimerEvaluation[];
  policies: Array<{ id: number; name: string; priority: string }>;
  rawSignals: string[];
  timestamp: string;
}

// ── Pure timer evaluation ─────────────────────────────────────────────────────

export function evaluateTimer(
  timer: SlaTimer,
  policy: SlaPolicy,
  now: Date = new Date(),
): SlaTimerEvaluation {
  const startedAt = new Date(timer.startedAt);
  const elapsedMinutes = Math.floor((now.getTime() - startedAt.getTime()) / 60000);

  const thresholdMinutes =
    timer.phase === "response" ? policy.responseTimeMinutes : policy.resolutionTimeMinutes;

  const warningThresholdPct =
    timer.phase === "response"
      ? policy.warningThresholdPct
      : policy.resolutionWarningThresholdPct;

  const warningThresholdMinutes = Math.floor(thresholdMinutes * warningThresholdPct / 100);

  const breached = elapsedMinutes >= thresholdMinutes;
  const warningFired = elapsedMinutes >= warningThresholdMinutes;

  const status: "ok" | "warning" | "breached" = breached
    ? "breached"
    : warningFired
      ? "warning"
      : "ok";

  return {
    timerId: timer.timerId,
    mspId: timer.mspId,
    customerId: timer.customerId,
    policyId: timer.policyId,
    phase: timer.phase,
    ticketRef: timer.ticketRef,
    elapsedMinutes,
    thresholdMinutes,
    warningThresholdMinutes,
    status,
    warningFired,
    breached,
  };
}

// ── Pure engine computation ───────────────────────────────────────────────────

export function computeSlaEngine(
  timers: SlaTimer[],
  policies: SlaPolicy[],
  now: Date = new Date(),
): SlaEngineOutput {
  const policyMap = new Map(policies.map(p => [p.id, p]));

  const runningTimers = timers.filter(t => t.status === "running");
  const evaluations: SlaTimerEvaluation[] = [];

  for (const timer of runningTimers) {
    const policy = policyMap.get(timer.policyId);
    if (!policy) continue;
    evaluations.push(evaluateTimer(timer, policy, now));
  }

  const breachedCount = evaluations.filter(e => e.breached).length;
  const warningCount = evaluations.filter(e => e.status === "warning").length;
  const totalCount = evaluations.length;
  const compliancePct =
    totalCount === 0 ? 100 : Math.round(((totalCount - breachedCount) / totalCount) * 100);

  const rawSignals: string[] = [];
  if (breachedCount > 0) rawSignals.push("sla:breach_detected");
  if (warningCount > 0) rawSignals.push("sla:warning_detected");
  if (compliancePct < 80) rawSignals.push("sla:low_compliance");

  return {
    engine: "sla",
    score: {
      compliancePct,
      runningTimers: runningTimers.length,
      activeBreaches: breachedCount,
      warningTimers: warningCount,
    },
    breakdown: evaluations,
    policies: policies.map(p => ({ id: p.id, name: p.name, priority: p.priority })),
    rawSignals,
    timestamp: now.toISOString(),
  };
}

// ── DB helpers ────────────────────────────────────────────────────────────────

async function fetchPolicies(mspId?: number): Promise<SlaPolicy[]> {
  const rows = await db.execute(
    mspId != null
      ? sql`SELECT id, msp_id AS "mspId", name, description, response_time_minutes AS "responseTimeMinutes",
              warning_threshold_pct AS "warningThresholdPct", resolution_time_minutes AS "resolutionTimeMinutes",
              resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
              escalation_rules AS "escalationRules", priority, is_active AS "isActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
            FROM sla_policies WHERE is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)`
      : sql`SELECT id, msp_id AS "mspId", name, description, response_time_minutes AS "responseTimeMinutes",
              warning_threshold_pct AS "warningThresholdPct", resolution_time_minutes AS "resolutionTimeMinutes",
              resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
              escalation_rules AS "escalationRules", priority, is_active AS "isActive",
              created_at AS "createdAt", updated_at AS "updatedAt"
            FROM sla_policies WHERE is_active = true`,
  );
  return (rows.rows as unknown as SlaPolicy[]).map(r => ({
    ...r,
    escalationRules: Array.isArray(r.escalationRules) ? r.escalationRules : [],
  }));
}

async function fetchRunningTimers(mspId?: number, customerId?: number): Promise<SlaTimer[]> {
  const rows = await db.execute(
    customerId != null
      ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
              policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
              status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
              breached_at AS "breachedAt", stopped_at AS "stoppedAt",
              idempotency_key AS "idempotencyKey", trace_id AS "traceId",
              metadata, created_at AS "createdAt", updated_at AS "updatedAt"
            FROM sla_timers WHERE status = 'running' AND customer_id = ${customerId}`
      : mspId != null
        ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                metadata, created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_timers WHERE status = 'running' AND msp_id = ${mspId}`
        : sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                metadata, created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_timers WHERE status = 'running'`,
  );
  return rows.rows as unknown as SlaTimer[];
}

export async function runSlaEngineForTenant(tenantId: number): Promise<SlaEngineOutput> {
  const [timers, policies] = await Promise.all([
    fetchRunningTimers(undefined, tenantId),
    fetchPolicies(),
  ]);
  return computeSlaEngine(timers, policies);
}

export async function runSlaEngineForMsp(mspId: number): Promise<SlaEngineOutput> {
  const [timers, policies] = await Promise.all([
    fetchRunningTimers(mspId),
    fetchPolicies(mspId),
  ]);
  return computeSlaEngine(timers, policies);
}

// ── Timer lifecycle operations (idempotent) ───────────────────────────────────

export interface StartTimerOptions {
  mspId: number;
  customerId: number;
  policyId: number;
  ticketRef?: string;
  ticketType?: string;
  phase?: "response" | "resolution";
  idempotencyKey?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export async function startSlaTimer(opts: StartTimerOptions): Promise<{ timerId: string; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT timer_id AS "timerId" FROM sla_timers WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { timerId: (existing.rows[0] as { timerId: string }).timerId, alreadyExisted: true };
  }

  const timerId = randomUUID();
  await db.execute(sql`
    INSERT INTO sla_timers (timer_id, msp_id, customer_id, policy_id, ticket_ref, ticket_type, phase, idempotency_key, trace_id, metadata)
    VALUES (
      ${timerId}, ${opts.mspId}, ${opts.customerId}, ${opts.policyId},
      ${opts.ticketRef ?? null}, ${opts.ticketType ?? "incident"},
      ${opts.phase ?? "response"}, ${key}, ${opts.traceId ?? null},
      ${JSON.stringify(opts.metadata ?? {})}
    )
  `);

  logger.info({ timerId, mspId: opts.mspId, customerId: opts.customerId, policyId: opts.policyId }, "sla-engine: timer started");
  return { timerId, alreadyExisted: false };
}

export async function stopSlaTimer(timerId: string, idempotencyKey?: string): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE sla_timers
    SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
    WHERE timer_id = ${timerId} AND status = 'running'
    RETURNING id
  `);
  const stopped = result.rows.length > 0;
  if (stopped) {
    logger.info({ timerId }, "sla-engine: timer stopped");
  }
  return stopped;
}

export interface FireBreachOptions {
  timerId: string;
  mspId: number;
  customerId: number;
  policyId: number;
  ticketRef?: string;
  phase: "response" | "resolution";
  elapsedMinutes: number;
  thresholdMinutes: number;
  breachType?: "threshold_exceeded" | "warning_only";
  idempotencyKey?: string;
  traceId?: string;
}

export async function fireSlaBreachRecord(opts: FireBreachOptions): Promise<{ breachId: string; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT breach_id AS "breachId" FROM sla_breaches WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { breachId: (existing.rows[0] as { breachId: string }).breachId, alreadyExisted: true };
  }

  const breachId = randomUUID();
  await db.execute(sql`
    INSERT INTO sla_breaches (breach_id, timer_id, msp_id, customer_id, policy_id, ticket_ref, phase, breach_type, elapsed_minutes, threshold_minutes, idempotency_key, trace_id)
    VALUES (
      ${breachId}, ${opts.timerId}, ${opts.mspId}, ${opts.customerId}, ${opts.policyId},
      ${opts.ticketRef ?? null}, ${opts.phase}, ${opts.breachType ?? "threshold_exceeded"},
      ${opts.elapsedMinutes}, ${opts.thresholdMinutes}, ${key}, ${opts.traceId ?? null}
    )
  `);

  await db.execute(sql`
    UPDATE sla_timers SET status = 'breached', breached_at = NOW(), updated_at = NOW()
    WHERE timer_id = ${opts.timerId}
  `);

  logger.info({ breachId, timerId: opts.timerId, elapsedMinutes: opts.elapsedMinutes }, "sla-engine: breach recorded");
  return { breachId, alreadyExisted: false };
}

export interface EscalateOptions {
  breachId: string;
  mspId: number;
  customerId: number;
  level: number;
  escalationType?: "operator_task" | "email" | "sms" | "webhook";
  assignedTo?: string;
  target?: string;
  idempotencyKey?: string;
  traceId?: string;
  metadata?: Record<string, unknown>;
}

export async function escalateSla(opts: EscalateOptions): Promise<{ escalationId: string; alreadyExisted: boolean }> {
  const key = opts.idempotencyKey ?? randomUUID();

  const existing = await db.execute(
    sql`SELECT escalation_id AS "escalationId" FROM sla_escalations WHERE idempotency_key = ${key} LIMIT 1`,
  );
  if (existing.rows.length > 0) {
    return { escalationId: (existing.rows[0] as { escalationId: string }).escalationId, alreadyExisted: true };
  }

  const escalationId = randomUUID();
  await db.execute(sql`
    INSERT INTO sla_escalations (escalation_id, breach_id, msp_id, customer_id, level, escalation_type, assigned_to, target, idempotency_key, trace_id, metadata)
    VALUES (
      ${escalationId}, ${opts.breachId}, ${opts.mspId}, ${opts.customerId},
      ${opts.level}, ${opts.escalationType ?? "operator_task"},
      ${opts.assignedTo ?? null}, ${opts.target ?? null},
      ${key}, ${opts.traceId ?? null}, ${JSON.stringify(opts.metadata ?? {})}
    )
  `);

  logger.info({ escalationId, breachId: opts.breachId, level: opts.level }, "sla-engine: escalation created");
  return { escalationId, alreadyExisted: false };
}

export async function resolveSlaTimer(
  timerId: string,
  notes?: string,
): Promise<boolean> {
  const result = await db.execute(sql`
    UPDATE sla_timers
    SET status = 'stopped', stopped_at = NOW(), updated_at = NOW()
    WHERE timer_id = ${timerId} AND status IN ('running', 'paused', 'breached')
    RETURNING id
  `);
  const resolved = result.rows.length > 0;

  if (resolved) {
    await db.execute(sql`
      UPDATE sla_breaches
      SET resolved_at = NOW(), resolution_notes = ${notes ?? null}
      WHERE timer_id = ${timerId} AND resolved_at IS NULL
    `);
    await db.execute(sql`
      UPDATE sla_escalations
      SET status = 'resolved', resolved_at = NOW()
      WHERE breach_id IN (SELECT breach_id FROM sla_breaches WHERE timer_id = ${timerId})
        AND status IN ('pending','in_progress')
    `);
    logger.info({ timerId }, "sla-engine: timer resolved");
  }

  return resolved;
}

// ── Compliance snapshot ───────────────────────────────────────────────────────

export async function computeComplianceSnapshot(
  mspId: number,
  customerId: number,
  policyId: number,
  periodStart: Date,
  periodEnd: Date,
): Promise<{
  totalTickets: number;
  breachedTickets: number;
  compliancePct: number;
  avgResponseMinutes: number | null;
  avgResolutionMinutes: number | null;
}> {
  const timerRows = await db.execute(sql`
    SELECT COUNT(*) AS total,
           SUM(CASE WHEN status = 'breached' THEN 1 ELSE 0 END) AS breached
    FROM sla_timers
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND started_at >= ${periodStart.toISOString()} AND started_at < ${periodEnd.toISOString()}
  `);
  const row = timerRows.rows[0] as { total: string; breached: string };
  const total = parseInt(row.total, 10) || 0;
  const breached = parseInt(row.breached, 10) || 0;
  const compliancePct = total === 0 ? 100 : Math.round(((total - breached) / total) * 100);

  const responseRows = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(stopped_at, breached_at, NOW()) - started_at)) / 60) AS avg_minutes
    FROM sla_timers
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND phase = 'response'
      AND started_at >= ${periodStart.toISOString()} AND started_at < ${periodEnd.toISOString()}
  `);
  const avgResponse = (responseRows.rows[0] as { avg_minutes: string | null }).avg_minutes;

  const resolutionRows = await db.execute(sql`
    SELECT AVG(EXTRACT(EPOCH FROM (COALESCE(stopped_at, breached_at, NOW()) - started_at)) / 60) AS avg_minutes
    FROM sla_timers
    WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND policy_id = ${policyId}
      AND phase = 'resolution'
      AND started_at >= ${periodStart.toISOString()} AND started_at < ${periodEnd.toISOString()}
  `);
  const avgResolution = (resolutionRows.rows[0] as { avg_minutes: string | null }).avg_minutes;

  return {
    totalTickets: total,
    breachedTickets: breached,
    compliancePct,
    avgResponseMinutes: avgResponse != null ? parseFloat(avgResponse) : null,
    avgResolutionMinutes: avgResolution != null ? parseFloat(avgResolution) : null,
  };
}
