/**
 * admin-sla.ts
 *
 * Admin routes for the SLA Engine — policy CRUD, assignment management,
 * timer/breach/escalation read access, compliance snapshots, and the unified
 * engine output endpoint (/api/sla/evaluate).
 *
 * All routes require admin auth. MSP-scoped portal routes live in msp-engines.ts.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { requireAdmin } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import {
  computeSlaEngine,
  runSlaEngineForMsp,
  runSlaEngineForTenant,
  startSlaTimer,
  stopSlaTimer,
  fireSlaBreachRecord,
  escalateSla,
  resolveSlaTimer,
  computeComplianceSnapshot,
  type SlaPolicy,
} from "../lib/sla-engine";

const router: IRouter = Router();

// ── Helper ────────────────────────────────────────────────────────────────────

function rowToPolicy(r: Record<string, unknown>): SlaPolicy {
  return {
    id: r.id as number,
    mspId: r.mspId as number | null,
    name: r.name as string,
    description: r.description as string | null,
    responseTimeMinutes: r.responseTimeMinutes as number,
    warningThresholdPct: r.warningThresholdPct as number,
    resolutionTimeMinutes: r.resolutionTimeMinutes as number,
    resolutionWarningThresholdPct: r.resolutionWarningThresholdPct as number,
    escalationRules: Array.isArray(r.escalationRules) ? (r.escalationRules as typeof r.escalationRules) : [],
    priority: r.priority as SlaPolicy["priority"],
    isActive: r.isActive as boolean,
    createdAt: r.createdAt as string,
    updatedAt: r.updatedAt as string,
  };
}

async function fetchAllPolicies(): Promise<SlaPolicy[]> {
  const rows = await db.execute(sql`
    SELECT id, msp_id AS "mspId", name, description,
           response_time_minutes AS "responseTimeMinutes",
           warning_threshold_pct AS "warningThresholdPct",
           resolution_time_minutes AS "resolutionTimeMinutes",
           resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
           escalation_rules AS "escalationRules", priority,
           is_active AS "isActive",
           created_at AS "createdAt", updated_at AS "updatedAt"
    FROM sla_policies ORDER BY id DESC
  `);
  return (rows.rows as Record<string, unknown>[]).map(rowToPolicy);
}

// ── SLA Policies ──────────────────────────────────────────────────────────────

router.get("/admin/sla/policies", requireAdmin, async (_req: Request, res: Response) => {
  try {
    const policies = await fetchAllPolicies();
    res.json({ policies });
  } catch (err) {
    logger.error({ err }, "admin-sla: list policies failed");
    res.status(500).json({ error: "Failed to list SLA policies" });
  }
});

router.get("/admin/sla/policies/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             response_time_minutes AS "responseTimeMinutes",
             warning_threshold_pct AS "warningThresholdPct",
             resolution_time_minutes AS "resolutionTimeMinutes",
             resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
             escalation_rules AS "escalationRules", priority,
             is_active AS "isActive",
             created_at AS "createdAt", updated_at AS "updatedAt"
      FROM sla_policies WHERE id = ${id}
    `);
    if (rows.rows.length === 0) { res.status(404).json({ error: "Policy not found" }); return; }
    res.json({ policy: rowToPolicy(rows.rows[0] as Record<string, unknown>) });
  } catch (err) {
    logger.error({ err, id }, "admin-sla: get policy failed");
    res.status(500).json({ error: "Failed to get policy" });
  }
});

router.post("/admin/sla/policies", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      INSERT INTO sla_policies (
        msp_id, name, description, response_time_minutes, warning_threshold_pct,
        resolution_time_minutes, resolution_warning_threshold_pct, escalation_rules, priority, is_active
      ) VALUES (
        ${(b.mspId ?? null) as number | null},
        ${b.name as string},
        ${(b.description ?? null) as string | null},
        ${(b.responseTimeMinutes ?? 60) as number},
        ${(b.warningThresholdPct ?? 75) as number},
        ${(b.resolutionTimeMinutes ?? 480) as number},
        ${(b.resolutionWarningThresholdPct ?? 75) as number},
        ${JSON.stringify(b.escalationRules ?? [])},
        ${(b.priority ?? "standard") as string},
        ${(b.isActive ?? true) as boolean}
      ) RETURNING id
    `);
    const newId = (result.rows[0] as { id: number }).id;
    logger.info({ id: newId }, "admin-sla: policy created");
    res.status(201).json({ id: newId });
  } catch (err) {
    logger.error({ err }, "admin-sla: create policy failed");
    res.status(500).json({ error: "Failed to create policy" });
  }
});

router.patch("/admin/sla/policies/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  try {
    await db.execute(sql`
      UPDATE sla_policies SET
        name = COALESCE(${(b.name ?? null) as string | null}, name),
        description = COALESCE(${(b.description ?? null) as string | null}, description),
        response_time_minutes = COALESCE(${(b.responseTimeMinutes ?? null) as number | null}, response_time_minutes),
        warning_threshold_pct = COALESCE(${(b.warningThresholdPct ?? null) as number | null}, warning_threshold_pct),
        resolution_time_minutes = COALESCE(${(b.resolutionTimeMinutes ?? null) as number | null}, resolution_time_minutes),
        resolution_warning_threshold_pct = COALESCE(${(b.resolutionWarningThresholdPct ?? null) as number | null}, resolution_warning_threshold_pct),
        escalation_rules = COALESCE(${b.escalationRules != null ? JSON.stringify(b.escalationRules) : null}, escalation_rules::text)::jsonb,
        priority = COALESCE(${(b.priority ?? null) as string | null}, priority),
        is_active = COALESCE(${(b.isActive ?? null) as boolean | null}, is_active),
        updated_at = NOW()
      WHERE id = ${id}
    `);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-sla: update policy failed");
    res.status(500).json({ error: "Failed to update policy" });
  }
});

router.delete("/admin/sla/policies/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`UPDATE sla_policies SET is_active = false, updated_at = NOW() WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-sla: delete policy failed");
    res.status(500).json({ error: "Failed to deactivate policy" });
  }
});

// ── SLA Assignments ───────────────────────────────────────────────────────────

router.get("/admin/sla/assignments", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId != null ? Number(req.query.mspId) : null;
  try {
    const rows = await db.execute(
      mspId != null
        ? sql`SELECT id, msp_id AS "mspId", customer_id AS "customerId", policy_id AS "policyId",
                     assigned_by_user_id AS "assignedByUserId", idempotency_key AS "idempotencyKey",
                     created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_assignments WHERE msp_id = ${mspId} ORDER BY id DESC`
        : sql`SELECT id, msp_id AS "mspId", customer_id AS "customerId", policy_id AS "policyId",
                     assigned_by_user_id AS "assignedByUserId", idempotency_key AS "idempotencyKey",
                     created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_assignments ORDER BY id DESC`,
    );
    res.json({ assignments: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-sla: list assignments failed");
    res.status(500).json({ error: "Failed to list assignments" });
  }
});

router.post("/admin/sla/assignments", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const key = (b.idempotencyKey as string | undefined) ?? randomUUID();
  try {
    const result = await db.execute(sql`
      INSERT INTO sla_assignments (msp_id, customer_id, policy_id, assigned_by_user_id, idempotency_key)
      VALUES (${b.mspId as number}, ${b.customerId as number}, ${b.policyId as number},
              ${(b.assignedByUserId ?? null) as number | null}, ${key})
      ON CONFLICT (msp_id, customer_id) DO UPDATE SET
        policy_id = EXCLUDED.policy_id,
        updated_at = NOW()
      RETURNING id
    `);
    const id = (result.rows[0] as { id: number }).id;
    logger.info({ id, mspId: b.mspId, customerId: b.customerId }, "admin-sla: assignment upserted");
    res.status(201).json({ id, idempotencyKey: key });
  } catch (err) {
    logger.error({ err }, "admin-sla: create assignment failed");
    res.status(500).json({ error: "Failed to create assignment" });
  }
});

router.delete("/admin/sla/assignments/:id", requireAdmin, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  try {
    await db.execute(sql`DELETE FROM sla_assignments WHERE id = ${id}`);
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err, id }, "admin-sla: delete assignment failed");
    res.status(500).json({ error: "Failed to delete assignment" });
  }
});

// ── SLA Timers ────────────────────────────────────────────────────────────────

router.get("/admin/sla/timers", requireAdmin, async (req: Request, res: Response) => {
  const status = req.query.status as string | undefined;
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                     status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                     breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                     idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                     metadata, created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_timers WHERE customer_id = ${customerId}
              ORDER BY created_at DESC LIMIT 100`
        : status
          ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                       status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                       breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                       idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                       metadata, created_at AS "createdAt", updated_at AS "updatedAt"
                FROM sla_timers WHERE status = ${status}
                ORDER BY created_at DESC LIMIT 100`
          : sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                       status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                       breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                       idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                       metadata, created_at AS "createdAt", updated_at AS "updatedAt"
                FROM sla_timers ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ timers: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-sla: list timers failed");
    res.status(500).json({ error: "Failed to list timers" });
  }
});

router.post("/admin/sla/timers/start", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await startSlaTimer({
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      policyId: b.policyId as number,
      ticketRef: b.ticketRef as string | undefined,
      ticketType: b.ticketType as string | undefined,
      phase: (b.phase as "response" | "resolution" | undefined) ?? "response",
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
      metadata: b.metadata as Record<string, unknown> | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-sla: start timer failed");
    res.status(500).json({ error: "Failed to start timer" });
  }
});

router.post("/admin/sla/timers/:timerId/stop", requireAdmin, async (req: Request, res: Response) => {
  const timerId = req.params["timerId"] as string;
  try {
    const stopped = await stopSlaTimer(timerId);
    res.json({ ok: stopped });
  } catch (err) {
    logger.error({ err, timerId }, "admin-sla: stop timer failed");
    res.status(500).json({ error: "Failed to stop timer" });
  }
});

router.post("/admin/sla/timers/:timerId/resolve", requireAdmin, async (req: Request, res: Response) => {
  const timerId = req.params["timerId"] as string;
  const b = req.body as Record<string, unknown>;
  try {
    const resolved = await resolveSlaTimer(timerId, b.notes as string | undefined);
    res.json({ ok: resolved });
  } catch (err) {
    logger.error({ err, timerId }, "admin-sla: resolve timer failed");
    res.status(500).json({ error: "Failed to resolve timer" });
  }
});

// ── SLA Breaches ──────────────────────────────────────────────────────────────

router.get("/admin/sla/breaches", requireAdmin, async (req: Request, res: Response) => {
  const resolved = req.query.resolved === "true";
  try {
    const rows = await db.execute(
      resolved
        ? sql`SELECT id, breach_id AS "breachId", timer_id AS "timerId", msp_id AS "mspId",
                     customer_id AS "customerId", policy_id AS "policyId",
                     ticket_ref AS "ticketRef", phase, breach_type AS "breachType",
                     elapsed_minutes AS "elapsedMinutes", threshold_minutes AS "thresholdMinutes",
                     operator_task_id AS "operatorTaskId", resolved_at AS "resolvedAt",
                     resolution_notes AS "resolutionNotes", created_at AS "createdAt"
              FROM sla_breaches WHERE resolved_at IS NOT NULL ORDER BY created_at DESC LIMIT 100`
        : sql`SELECT id, breach_id AS "breachId", timer_id AS "timerId", msp_id AS "mspId",
                     customer_id AS "customerId", policy_id AS "policyId",
                     ticket_ref AS "ticketRef", phase, breach_type AS "breachType",
                     elapsed_minutes AS "elapsedMinutes", threshold_minutes AS "thresholdMinutes",
                     operator_task_id AS "operatorTaskId", resolved_at AS "resolvedAt",
                     resolution_notes AS "resolutionNotes", created_at AS "createdAt"
              FROM sla_breaches WHERE resolved_at IS NULL ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ breaches: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-sla: list breaches failed");
    res.status(500).json({ error: "Failed to list breaches" });
  }
});

// ── SLA Escalations ───────────────────────────────────────────────────────────

router.get("/admin/sla/escalations", requireAdmin, async (req: Request, res: Response) => {
  const breachId = req.query.breachId as string | undefined;
  try {
    const rows = await db.execute(
      breachId
        ? sql`SELECT id, escalation_id AS "escalationId", breach_id AS "breachId",
                     msp_id AS "mspId", customer_id AS "customerId", level,
                     escalation_type AS "escalationType", status, assigned_to AS "assignedTo",
                     target, escalated_at AS "escalatedAt", resolved_at AS "resolvedAt",
                     metadata, created_at AS "createdAt"
              FROM sla_escalations WHERE breach_id = ${breachId} ORDER BY level ASC`
        : sql`SELECT id, escalation_id AS "escalationId", breach_id AS "breachId",
                     msp_id AS "mspId", customer_id AS "customerId", level,
                     escalation_type AS "escalationType", status, assigned_to AS "assignedTo",
                     target, escalated_at AS "escalatedAt", resolved_at AS "resolvedAt",
                     metadata, created_at AS "createdAt"
              FROM sla_escalations WHERE status IN ('pending','in_progress') ORDER BY created_at DESC LIMIT 100`,
    );
    res.json({ escalations: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-sla: list escalations failed");
    res.status(500).json({ error: "Failed to list escalations" });
  }
});

router.post("/admin/sla/escalations", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const result = await escalateSla({
      breachId: b.breachId as string,
      mspId: b.mspId as number,
      customerId: b.customerId as number,
      level: (b.level as number) ?? 1,
      escalationType: b.escalationType as "operator_task" | "email" | "sms" | "webhook" | undefined,
      assignedTo: b.assignedTo as string | undefined,
      target: b.target as string | undefined,
      idempotencyKey: b.idempotencyKey as string | undefined,
      traceId: b.traceId as string | undefined,
      metadata: b.metadata as Record<string, unknown> | undefined,
    });
    res.status(result.alreadyExisted ? 200 : 201).json(result);
  } catch (err) {
    logger.error({ err }, "admin-sla: create escalation failed");
    res.status(500).json({ error: "Failed to create escalation" });
  }
});

// ── SLA Compliance Records ────────────────────────────────────────────────────

router.get("/admin/sla/compliance", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId != null ? Number(req.query.mspId) : null;
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_tickets AS "totalTickets", breached_tickets AS "breachedTickets",
                     compliance_pct AS "compliancePct", avg_response_minutes AS "avgResponseMinutes",
                     avg_resolution_minutes AS "avgResolutionMinutes", notes, created_at AS "createdAt"
              FROM sla_compliance_records WHERE customer_id = ${customerId} ORDER BY period_start DESC LIMIT 24`
        : mspId != null
          ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                       total_tickets AS "totalTickets", breached_tickets AS "breachedTickets",
                       compliance_pct AS "compliancePct", avg_response_minutes AS "avgResponseMinutes",
                       avg_resolution_minutes AS "avgResolutionMinutes", notes, created_at AS "createdAt"
                FROM sla_compliance_records WHERE msp_id = ${mspId} ORDER BY period_start DESC LIMIT 100`
          : sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                       total_tickets AS "totalTickets", breached_tickets AS "breachedTickets",
                       compliance_pct AS "compliancePct", avg_response_minutes AS "avgResponseMinutes",
                       avg_resolution_minutes AS "avgResolutionMinutes", notes, created_at AS "createdAt"
                FROM sla_compliance_records ORDER BY period_start DESC LIMIT 100`,
    );
    res.json({ records: rows.rows });
  } catch (err) {
    logger.error({ err }, "admin-sla: list compliance records failed");
    res.status(500).json({ error: "Failed to list compliance records" });
  }
});

router.post("/admin/sla/compliance/snapshot", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  try {
    const periodStart = new Date(b.periodStart as string);
    const periodEnd = new Date(b.periodEnd as string);
    const snapshot = await computeComplianceSnapshot(
      b.mspId as number,
      b.customerId as number,
      b.policyId as number,
      periodStart,
      periodEnd,
    );
    const recordId = randomUUID();
    await db.execute(sql`
      INSERT INTO sla_compliance_records (
        record_id, msp_id, customer_id, policy_id, period_start, period_end,
        total_tickets, breached_tickets, compliance_pct, avg_response_minutes,
        avg_resolution_minutes, notes
      ) VALUES (
        ${recordId}, ${b.mspId as number}, ${b.customerId as number}, ${b.policyId as number},
        ${periodStart.toISOString()}, ${periodEnd.toISOString()},
        ${snapshot.totalTickets}, ${snapshot.breachedTickets}, ${snapshot.compliancePct},
        ${snapshot.avgResponseMinutes}, ${snapshot.avgResolutionMinutes},
        ${(b.notes as string | null) ?? null}
      )
      ON CONFLICT DO NOTHING
    `);
    res.status(201).json({ recordId, ...snapshot });
  } catch (err) {
    logger.error({ err }, "admin-sla: compliance snapshot failed");
    res.status(500).json({ error: "Failed to compute compliance snapshot" });
  }
});

// ── Unified engine evaluate endpoint ─────────────────────────────────────────

router.post("/admin/sla/evaluate", requireAdmin, async (req: Request, res: Response) => {
  const b = req.body as Record<string, unknown>;
  const mspId = b.mspId != null ? Number(b.mspId) : null;
  const customerId = b.customerId != null ? Number(b.customerId) : null;
  try {
    let output;
    if (customerId != null) {
      output = await runSlaEngineForTenant(customerId);
    } else if (mspId != null) {
      output = await runSlaEngineForMsp(mspId);
    } else {
      output = await runSlaEngineForMsp(0);
    }
    res.json(output);
  } catch (err) {
    logger.error({ err }, "admin-sla: evaluate failed");
    res.status(500).json({ error: "SLA engine evaluation failed" });
  }
});

router.get("/admin/sla/evaluate", requireAdmin, async (req: Request, res: Response) => {
  const mspId = req.query.mspId != null ? Number(req.query.mspId) : null;
  const customerId = req.query.customerId != null ? Number(req.query.customerId) : null;
  try {
    let output;
    if (customerId != null) {
      output = await runSlaEngineForTenant(customerId);
    } else if (mspId != null) {
      output = await runSlaEngineForMsp(mspId);
    } else {
      output = await runSlaEngineForMsp(0);
    }
    res.json(output);
  } catch (err) {
    logger.error({ err }, "admin-sla: evaluate failed");
    res.status(500).json({ error: "SLA engine evaluation failed" });
  }
});

export default router;
