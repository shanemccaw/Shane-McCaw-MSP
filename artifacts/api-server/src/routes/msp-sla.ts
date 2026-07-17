/**
 * msp-sla.ts
 *
 * MSP-scoped SLA Engine API surface.
 * Authenticated via MSP JWT (requireRole("MSPOperator")).
 * All queries are automatically scoped to the calling MSP's mspId.
 *
 * Route prefix: /api/msp/sla
 * Contrast with /api/admin/sla/* which requires PlatformAdmin.
 */

import { Router, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
const log = logger.child({ channel: "engine.sla" });
import { runSlaEngineForMsp, resolveSlaTimer } from "../lib/sla-engine";
import { registerMspEngineEventClient } from "../lib/sse-broadcast";

const router = Router();

// ── GET /api/msp/sla/policies ──────────────────────────────────────────────────
// Active policies that apply to this MSP (own + global defaults).

router.get("/msp/sla/policies", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
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
      FROM sla_policies
      WHERE is_active = true AND (msp_id = ${mspId} OR msp_id IS NULL)
      ORDER BY msp_id NULLS LAST, id
    `);
    res.json({ policies: rows.rows });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: list policies failed");
    res.status(500).json({ error: "Failed to list SLA policies" });
  }
});

// ── GET /api/msp/sla/policies/:id ──────────────────────────────────────────────

router.get("/msp/sla/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
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
      FROM sla_policies
      WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    res.json({ policy: rows.rows[0] });
  } catch (err) {
    log.error({ err, mspId, id }, "msp-sla: get policy failed");
    res.status(500).json({ error: "Failed to get SLA policy" });
  }
});

// ── POST /api/msp/sla/policies ─────────────────────────────────────────────────

router.post("/msp/sla/policies", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const b = req.body as Record<string, unknown>;
  try {
    const result = await db.execute(sql`
      INSERT INTO sla_policies (
        msp_id, name, description, response_time_minutes, warning_threshold_pct,
        resolution_time_minutes, resolution_warning_threshold_pct, escalation_rules, priority, is_active
      ) VALUES (
        ${mspId},
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
    log.info({ id: newId, mspId }, "msp-sla: policy created");
    res.status(201).json({ id: newId });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: create policy failed");
    res.status(500).json({ error: "Failed to create SLA policy" });
  }
});

// ── PATCH /api/msp/sla/policies/:id ─────────────────────────────────────────────

router.patch("/msp/sla/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const id = Number(req.params.id);
  const b = req.body as Record<string, unknown>;
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             response_time_minutes AS "responseTimeMinutes",
             warning_threshold_pct AS "warningThresholdPct",
             resolution_time_minutes AS "resolutionTimeMinutes",
             resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
             escalation_rules AS "escalationRules", priority,
             is_active AS "isActive"
      FROM sla_policies WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    const original = rows.rows[0] as Record<string, any>;
    if (original.mspId === null || original.mspId === 0) {
      const name = b.name !== undefined ? b.name : original.name;
      const description = b.description !== undefined ? b.description : original.description;
      const responseTimeMinutes = b.responseTimeMinutes !== undefined ? b.responseTimeMinutes : original.responseTimeMinutes;
      const warningThresholdPct = b.warningThresholdPct !== undefined ? b.warningThresholdPct : original.warningThresholdPct;
      const resolutionTimeMinutes = b.resolutionTimeMinutes !== undefined ? b.resolutionTimeMinutes : original.resolutionTimeMinutes;
      const resolutionWarningThresholdPct = b.resolutionWarningThresholdPct !== undefined ? b.resolutionWarningThresholdPct : original.resolutionWarningThresholdPct;
      const escalationRules = b.escalationRules !== undefined ? JSON.stringify(b.escalationRules) : JSON.stringify(original.escalationRules);
      const priority = b.priority !== undefined ? b.priority : original.priority;
      const isActive = b.isActive !== undefined ? b.isActive : original.isActive;

      const result = await db.execute(sql`
        INSERT INTO sla_policies (
          msp_id, name, description, response_time_minutes, warning_threshold_pct,
          resolution_time_minutes, resolution_warning_threshold_pct, escalation_rules, priority, is_active
        ) VALUES (
          ${mspId}, ${name}, ${description}, ${responseTimeMinutes}, ${warningThresholdPct},
          ${resolutionTimeMinutes}, ${resolutionWarningThresholdPct}, ${escalationRules}, ${priority}, ${isActive}
        ) RETURNING id
      `);
      const newId = (result.rows[0] as { id: number }).id;
      log.info({ id: newId, mspId, originalId: id }, "msp-sla: policy override created");
      res.status(201).json({ id: newId, override: true });
    } else {
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
        WHERE id = ${id} AND msp_id = ${mspId}
      `);
      res.json({ ok: true });
    }
  } catch (err) {
    log.error({ err, mspId, id }, "msp-sla: update policy failed");
    res.status(500).json({ error: "Failed to update SLA policy" });
  }
});

// ── DELETE /api/msp/sla/policies/:id ───────────────────────────────────────────

router.delete("/msp/sla/policies/:id", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const id = Number(req.params.id);
  try {
    const rows = await db.execute(sql`
      SELECT id, msp_id AS "mspId", name, description,
             response_time_minutes AS "responseTimeMinutes",
             warning_threshold_pct AS "warningThresholdPct",
             resolution_time_minutes AS "resolutionTimeMinutes",
             resolution_warning_threshold_pct AS "resolutionWarningThresholdPct",
             escalation_rules AS "escalationRules", priority,
             is_active AS "isActive"
      FROM sla_policies WHERE id = ${id} AND (msp_id = ${mspId} OR msp_id IS NULL)
    `);
    if (rows.rows.length === 0) {
      res.status(404).json({ error: "Policy not found" });
      return;
    }
    const original = rows.rows[0] as Record<string, any>;
    if (original.mspId === null || original.mspId === 0) {
      const result = await db.execute(sql`
        INSERT INTO sla_policies (
          msp_id, name, description, response_time_minutes, warning_threshold_pct,
          resolution_time_minutes, resolution_warning_threshold_pct, escalation_rules, priority, is_active
        ) VALUES (
          ${mspId}, ${original.name}, ${original.description}, ${original.responseTimeMinutes}, ${original.warningThresholdPct},
          ${original.resolutionTimeMinutes}, ${original.resolutionWarningThresholdPct}, ${JSON.stringify(original.escalationRules)}, ${original.priority}, false
        ) RETURNING id
      `);
      const newId = (result.rows[0] as { id: number }).id;
      log.info({ id: newId, mspId, originalId: id }, "msp-sla: policy override created (deactivated)");
      res.status(201).json({ id: newId, override: true });
    } else {
      await db.execute(sql`
        UPDATE sla_policies SET is_active = false, updated_at = NOW() WHERE id = ${id} AND msp_id = ${mspId}
      `);
      res.json({ ok: true });
    }
  } catch (err) {
    log.error({ err, mspId, id }, "msp-sla: delete policy failed");
    res.status(500).json({ error: "Failed to deactivate SLA policy" });
  }
});

// ── GET /api/msp/sla/timers ────────────────────────────────────────────────────
// Active timers for this MSP's customers. Optional ?customerId and ?status filters.

router.get("/msp/sla/timers", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  const status = (req.query["status"] as string) || null;
  try {
    const rows = await db.execute(
      customerId != null && status
        ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                     status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                     breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                     idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                     metadata, created_at AS "createdAt", updated_at AS "updatedAt"
              FROM sla_timers
              WHERE msp_id = ${mspId} AND customer_id = ${customerId} AND status = ${status}
              ORDER BY created_at DESC LIMIT 200`
        : customerId != null
          ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                       policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                       status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                       breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                       idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                       metadata, created_at AS "createdAt", updated_at AS "updatedAt"
                FROM sla_timers
                WHERE msp_id = ${mspId} AND customer_id = ${customerId}
                ORDER BY created_at DESC LIMIT 200`
          : status
            ? sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                         policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                         status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                         breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                         idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                         metadata, created_at AS "createdAt", updated_at AS "updatedAt"
                  FROM sla_timers
                  WHERE msp_id = ${mspId} AND status = ${status}
                  ORDER BY created_at DESC LIMIT 200`
            : sql`SELECT id, timer_id AS "timerId", msp_id AS "mspId", customer_id AS "customerId",
                         policy_id AS "policyId", ticket_ref AS "ticketRef", ticket_type AS "ticketType",
                         status, phase, started_at AS "startedAt", warning_fired_at AS "warningFiredAt",
                         breached_at AS "breachedAt", stopped_at AS "stoppedAt",
                         idempotency_key AS "idempotencyKey", trace_id AS "traceId",
                         metadata, created_at AS "createdAt", updated_at AS "updatedAt"
                  FROM sla_timers
                  WHERE msp_id = ${mspId}
                  ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ timers: rows.rows });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: list timers failed");
    res.status(500).json({ error: "Failed to list SLA timers" });
  }
});

// ── GET /api/msp/sla/breaches ──────────────────────────────────────────────────
// Unresolved breaches for this MSP. Optional ?customerId and ?resolved filters.

router.get("/msp/sla/breaches", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  const resolved = req.query["resolved"] === "true";
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, breach_id AS "breachId", timer_id AS "timerId", msp_id AS "mspId",
                     customer_id AS "customerId", policy_id AS "policyId",
                     ticket_ref AS "ticketRef", phase, breach_type AS "breachType",
                     elapsed_minutes AS "elapsedMinutes", threshold_minutes AS "thresholdMinutes",
                     operator_task_id AS "operatorTaskId", resolved_at AS "resolvedAt",
                     resolution_notes AS "resolutionNotes", created_at AS "createdAt"
              FROM sla_breaches
              WHERE msp_id = ${mspId} AND customer_id = ${customerId}
              ORDER BY created_at DESC LIMIT 100`
        : resolved
          ? sql`SELECT id, breach_id AS "breachId", timer_id AS "timerId", msp_id AS "mspId",
                       customer_id AS "customerId", policy_id AS "policyId",
                       ticket_ref AS "ticketRef", phase, breach_type AS "breachType",
                       elapsed_minutes AS "elapsedMinutes", threshold_minutes AS "thresholdMinutes",
                       operator_task_id AS "operatorTaskId", resolved_at AS "resolvedAt",
                       resolution_notes AS "resolutionNotes", created_at AS "createdAt"
                FROM sla_breaches
                WHERE msp_id = ${mspId} AND resolved_at IS NOT NULL
                ORDER BY created_at DESC LIMIT 100`
          : sql`SELECT id, breach_id AS "breachId", timer_id AS "timerId", msp_id AS "mspId",
                       customer_id AS "customerId", policy_id AS "policyId",
                       ticket_ref AS "ticketRef", phase, breach_type AS "breachType",
                       elapsed_minutes AS "elapsedMinutes", threshold_minutes AS "thresholdMinutes",
                       operator_task_id AS "operatorTaskId", resolved_at AS "resolvedAt",
                       resolution_notes AS "resolutionNotes", created_at AS "createdAt"
                FROM sla_breaches
                WHERE msp_id = ${mspId} AND resolved_at IS NULL
                ORDER BY created_at DESC LIMIT 200`,
    );
    res.json({ breaches: rows.rows });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: list breaches failed");
    res.status(500).json({ error: "Failed to list SLA breaches" });
  }
});

// ── GET /api/msp/sla/escalations ───────────────────────────────────────────────
// Open escalations for this MSP.

router.get("/msp/sla/escalations", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const rows = await db.execute(sql`
      SELECT id, escalation_id AS "escalationId", breach_id AS "breachId",
             msp_id AS "mspId", customer_id AS "customerId", level,
             escalation_type AS "escalationType", status, assigned_to AS "assignedTo",
             target, escalated_at AS "escalatedAt", resolved_at AS "resolvedAt",
             metadata, created_at AS "createdAt"
      FROM sla_escalations
      WHERE msp_id = ${mspId} AND status IN ('pending', 'in_progress')
      ORDER BY level DESC, created_at DESC LIMIT 100
    `);
    res.json({ escalations: rows.rows });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: list escalations failed");
    res.status(500).json({ error: "Failed to list SLA escalations" });
  }
});

// ── GET /api/msp/sla/compliance ────────────────────────────────────────────────
// Monthly compliance history for this MSP. Optional ?customerId filter.

router.get("/msp/sla/compliance", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  const customerId = req.query["customerId"] ? Number(req.query["customerId"]) : null;
  try {
    const rows = await db.execute(
      customerId != null
        ? sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_tickets AS "totalTickets", breached_tickets AS "breachedTickets",
                     compliance_pct AS "compliancePct", avg_response_minutes AS "avgResponseMinutes",
                     avg_resolution_minutes AS "avgResolutionMinutes", notes, created_at AS "createdAt"
              FROM sla_compliance_records
              WHERE msp_id = ${mspId} AND customer_id = ${customerId}
              ORDER BY period_start DESC LIMIT 24`
        : sql`SELECT id, record_id AS "recordId", msp_id AS "mspId", customer_id AS "customerId",
                     policy_id AS "policyId", period_start AS "periodStart", period_end AS "periodEnd",
                     total_tickets AS "totalTickets", breached_tickets AS "breachedTickets",
                     compliance_pct AS "compliancePct", avg_response_minutes AS "avgResponseMinutes",
                     avg_resolution_minutes AS "avgResolutionMinutes", notes, created_at AS "createdAt"
              FROM sla_compliance_records
              WHERE msp_id = ${mspId}
              ORDER BY period_start DESC LIMIT 100`,
    );
    res.json({ records: rows.rows });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: list compliance failed");
    res.status(500).json({ error: "Failed to list SLA compliance records" });
  }
});

// ── POST /api/msp/sla/evaluate ─────────────────────────────────────────────────
// Run the SLA engine for this MSP's portfolio. Returns summary, timers, breaches.

router.post("/msp/sla/evaluate", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const output = await runSlaEngineForMsp(mspId);
    res.json(output);
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: evaluate failed");
    res.status(500).json({ error: "SLA engine evaluation failed" });
  }
});

// ── POST /api/msp/sla/timers/:timerId/resolve ──────────────────────────────────
// MSP operators can resolve an SLA timer that belongs to their MSP.

router.post(
  "/msp/sla/timers/:timerId/resolve",
  requireRole("MSPOperator"),
  async (req: Request, res: Response) => {
    const mspId = req.user!.mspId;
    if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
    const timerId = req.params["timerId"] as string;
    const b = req.body as Record<string, unknown>;
    try {
      const check = await db.execute(sql`
        SELECT timer_id FROM sla_timers WHERE timer_id = ${timerId} AND msp_id = ${mspId} LIMIT 1
      `);
      if (check.rows.length === 0) {
        res.status(404).json({ error: "Timer not found" });
        return;
      }
      const resolved = await resolveSlaTimer(timerId, b.notes as string | undefined);
      res.json({ resolved });
    } catch (err) {
      log.error({ err, mspId, timerId }, "msp-sla: resolve timer failed");
      res.status(500).json({ error: "Failed to resolve timer" });
    }
  },
);

// ── GET /api/msp/sla/summary ───────────────────────────────────────────────────
// Aggregate stats for the SLA dashboard header cards.

router.get("/msp/sla/summary", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const [timerRows, breachRows, complianceRows] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'active') AS active_timers,
          COUNT(*) FILTER (WHERE status = 'warning') AS warning_timers,
          COUNT(*) FILTER (WHERE status = 'breached') AS breached_timers
        FROM sla_timers WHERE msp_id = ${mspId}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS open_breaches FROM sla_breaches
        WHERE msp_id = ${mspId} AND resolved_at IS NULL
      `),
      db.execute(sql`
        SELECT ROUND(AVG(compliance_pct)::numeric, 1) AS avg_compliance_pct
        FROM sla_compliance_records
        WHERE msp_id = ${mspId}
          AND period_start >= NOW() - INTERVAL '90 days'
      `),
    ]);

    const timerStats = timerRows.rows[0] as Record<string, unknown>;
    const breachStats = breachRows.rows[0] as Record<string, unknown>;
    const complianceStats = complianceRows.rows[0] as Record<string, unknown>;

    res.json({
      activeTimers: Number(timerStats["active_timers"] ?? 0),
      warningTimers: Number(timerStats["warning_timers"] ?? 0),
      breachedTimers: Number(timerStats["breached_timers"] ?? 0),
      openBreaches: Number(breachStats["open_breaches"] ?? 0),
      avgCompliancePct: complianceStats["avg_compliance_pct"] != null
        ? Number(complianceStats["avg_compliance_pct"])
        : null,
    });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: summary failed");
    res.status(500).json({ error: "Failed to load SLA summary" });
  }
});

// ── GET /api/msp/operator-tasks ────────────────────────────────────────────────
// Virtual operator task queue: aggregates unresolved SLA breaches and scope-creep
// violations as tasks with deep links to the Admin Panel engine detail pages.

router.get("/msp/operator-tasks", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }
  try {
    const [slaRows, scRows] = await Promise.all([
      db.execute(sql`
        SELECT b.breach_id AS "id",
               'sla_breach' AS "type",
               'SLA Breach' AS "category",
               b.customer_id AS "customerId",
               c.name AS "customerName",
               CONCAT(b.phase, ' threshold exceeded — ', ROUND(b.elapsed_minutes::numeric, 0), ' min elapsed (limit: ', b.threshold_minutes, ' min)') AS "description",
               COALESCE(b.breach_type, 'breach') AS "severity",
               b.created_at AS "createdAt",
               NULL AS "resolvedAt",
               '/admin-panel/#/sla' AS "deepLink"
        FROM sla_breaches b
        LEFT JOIN msp_customers c ON c.id = b.customer_id
        WHERE b.msp_id = ${mspId} AND b.resolved_at IS NULL
        ORDER BY b.created_at DESC LIMIT 50
      `),
      db.execute(sql`
        SELECT v.violation_id AS "id",
               'scope_creep_violation' AS "type",
               'Scope Creep Violation' AS "category",
               v.customer_id AS "customerId",
               c.name AS "customerName",
               CONCAT(v.severity, ' violation — composite score ', ROUND(v.composite_score::numeric, 1), ' (threshold: ', v.threshold, ')') AS "description",
               v.severity AS "severity",
               v.created_at AS "createdAt",
               v.resolved_at AS "resolvedAt",
               '/admin-panel/#/scope-creep' AS "deepLink"
        FROM scope_creep_violations v
        LEFT JOIN msp_customers c ON c.id = v.customer_id
        WHERE v.msp_id = ${mspId} AND v.resolved_at IS NULL
        ORDER BY v.created_at DESC LIMIT 50
      `),
    ]);

    const tasks = [
      ...slaRows.rows,
      ...scRows.rows,
    ].sort((a, b) => {
      const aDate = new Date((a as Record<string, unknown>)["createdAt"] as string);
      const bDate = new Date((b as Record<string, unknown>)["createdAt"] as string);
      return bDate.getTime() - aDate.getTime();
    });

    res.json({ tasks, total: tasks.length });
  } catch (err) {
    log.error({ err, mspId }, "msp-sla: operator tasks failed");
    res.status(500).json({ error: "Failed to load operator tasks" });
  }
});

// ── GET /api/msp/sla/events/stream ────────────────────────────────────────────
// SSE endpoint — MSP Portal subscribes to receive real-time engine events so
// dashboards can refresh without polling. Emits heartbeat every 30s to keep
// the connection alive through proxies.

router.get("/msp/sla/events/stream", requireRole("MSPOperator"), (req: Request, res: Response) => {
  const mspId = req.user!.mspId;
  if (!mspId) { res.status(400).json({ error: "mspId required" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send an immediate connected event
  res.write(`data: ${JSON.stringify({ type: "connected", mspId })}\n\n`);

  // Heartbeat to keep the connection alive through Replit's proxy
  const heartbeat = setInterval(() => {
    try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
  }, 30_000);

  registerMspEngineEventClient(mspId, res, () => {
    clearInterval(heartbeat);
    log.debug({ mspId }, "msp-sla: SSE client disconnected");
  });
});

export default router;
