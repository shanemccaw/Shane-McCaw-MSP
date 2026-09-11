/**
 * msp-alerts.ts
 *
 * Cross-Tenant Alerts view for MSP staff — a single feed of triage-worthy
 * items across every customer in the caller's own MSP, so MSPOperator/
 * MSPAdmin don't have to check each customer's dashboard individually.
 *
 * Merges two real, already-triaged sources (deliberately NOT a raw dump of
 * every msp_diagnostic_findings row — see PLATFORM_BUILD.md for the reasoning):
 *   - policy_rule_incidents (status="open") — the Signal Policy Engine's
 *     deduplicated, escalation-tracked view of a firing rule. Severity comes
 *     from the parent policy_rules row.
 *   - msp_diagnostic_findings restricted to severity IN (warning, critical)
 *     AND only each customer's latest coverage-sufficient diagnostics run
 *     (completed OR partial, graded via evaluateDocGateCoverage — see
 *     doc-gate-coverage.ts) — mirrors the triage restriction
 *     portal-mission-control.ts's overview endpoint already applies for a
 *     single customer, extended across the MSP's book.
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict):
 *   GET  /api/msp/alerts                      — merged, filterable (severity/category/customerId), paginated
 *   POST /api/msp/alerts/:alertId/acknowledge — real acknowledge/dismiss (Git #3366)
 *
 * Git #3366 — real audit before building the acknowledge action: each source
 * table was checked for an existing real resolution mechanism rather than
 * inventing a parallel "alerts" status.
 *   - policy_rule_incidents: the Signal Policy Engine (policy-engine.ts,
 *     evaluateAllPolicies) already owns status="open"→"resolved" — it
 *     auto-resolves an incident the moment its rule stops firing. No manual,
 *     operator-triggered transition existed. The acknowledge route below
 *     drives that SAME real status transition manually (adding only
 *     resolved_by_user_id to tell manual from automatic apart — see the
 *     #3366 migration) rather than inventing a new status. If the rule is
 *     still firing on the next evaluation cycle, a fresh "open" incident is
 *     correctly reopened — acknowledging does not suppress a real recurrence.
 *   - msp_diagnostic_findings: flagged separately as Git #3399 rather than
 *     invented ad hoc here — genuinely had NO resolution mechanism anywhere in
 *     this codebase (individual finding rows are immutable historical scan
 *     output). #3399 decided: its own acknowledged_at/acknowledged_by_user_id
 *     columns (mirroring policy_rule_incidents.resolved_by_user_id's shape),
 *     NOT routed through remediation_tracker_steps' customer-facing decision
 *     lifecycle — see the schema comment on those columns
 *     (lib/db/src/schema/msp.ts) for the full reasoning. GET below excludes
 *     acknowledged findings from the feed; a fresh scan's re-raised finding is
 *     a brand new row and starts unacknowledged again.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  tenantsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  policyRuleIncidentsTable,
  policyRulesTable,
} from "@workspace/db";
import { eq, and, inArray, desc, isNull } from "drizzle-orm";
import { requireCapability, resolveStaffScopedCustomerIds, isCustomerBlockedByStaffScope } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { evaluateDocGateCoverage } from "../lib/doc-gate-coverage";
import { apiError, ApiErrorCode } from "../lib/api-helpers";
import { createAuditLog } from "../lib/audit";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const SEVERITIES = ["info", "warning", "critical"] as const;
type Severity = (typeof SEVERITIES)[number];
const SEVERITY_RANK: Record<Severity, number> = { critical: 3, warning: 2, info: 1 };

interface CrossTenantAlert {
  id: string;
  source: "policy_incident" | "diagnostic_finding";
  severity: Severity;
  category: string;
  title: string;
  description: string | null;
  customerId: number | null;
  customerName: string | null;
  occurredAt: string;
  escalationLevel: number | null;
  deepLink: string | null;
}

router.get("/msp/alerts", requireCapability("ladder.msp-operator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const severityParam = req.query["severity"] ? String(req.query["severity"]) : undefined;
    const requestedSeverities = severityParam
      ? severityParam.split(",").filter((s): s is Severity => (SEVERITIES as readonly string[]).includes(s))
      : undefined;
    const categoryFilter = req.query["category"] ? String(req.query["category"]) : undefined;
    const customerIdParam = req.query["customerId"] ? Number(req.query["customerId"]) : undefined;
    const customerIdFilter = typeof customerIdParam === "number" && !isNaN(customerIdParam) ? customerIdParam : undefined;
    const limit = Math.min(Number(req.query["limit"] ?? 50), 200);
    const offset = Math.max(Number(req.query["offset"] ?? 0), 0);

    // Per-staff customer scoping: a scoped operator's alerts feed is restricted
    // to their assigned customers. null = unrestricted (historical default).
    // Applied at the DB level so unassigned customers' incidents/findings are
    // never even loaded into memory.
    const scopedIds = await resolveStaffScopedCustomerIds(req.user!);

    // Explicit column list, never a bare .select() — tenants carries the
    // consent jsonb, which has no business in an alerts payload.
    const customers = await db
      .select({ id: tenantsTable.id, name: tenantsTable.customerName })
      .from(tenantsTable)
      .where(
        scopedIds === null
          ? eq(tenantsTable.mspId, mspId)
          : and(eq(tenantsTable.mspId, mspId), inArray(tenantsTable.id, scopedIds)),
      );
    const customerNameById = new Map(customers.map((c) => [c.id, c.name]));

    // ── Source 1: open policy engine incidents (already deduplicated/escalation-tracked) ──
    const incidentRows = await db
      .select({
        id: policyRuleIncidentsTable.id,
        customerId: policyRuleIncidentsTable.customerId,
        currentLevel: policyRuleIncidentsTable.currentLevel,
        openedAt: policyRuleIncidentsTable.openedAt,
        lastEscalatedAt: policyRuleIncidentsTable.lastEscalatedAt,
        ruleName: policyRulesTable.name,
        ruleSeverity: policyRulesTable.severity,
        conditionType: policyRulesTable.conditionType,
      })
      .from(policyRuleIncidentsTable)
      .innerJoin(policyRulesTable, eq(policyRuleIncidentsTable.ruleId, policyRulesTable.id))
      .where(and(
        eq(policyRuleIncidentsTable.mspId, mspId),
        eq(policyRuleIncidentsTable.status, "open"),
        ...(scopedIds === null ? [] : [inArray(policyRuleIncidentsTable.customerId, scopedIds)]),
      ));

    const incidentAlerts: CrossTenantAlert[] = incidentRows.map((row) => ({
      id: `incident-${row.id}`,
      source: "policy_incident",
      severity: (row.ruleSeverity as Severity) ?? "info",
      category: row.conditionType,
      title: row.ruleName,
      description: row.currentLevel > 1 ? `Escalated to level ${row.currentLevel}` : null,
      customerId: row.customerId,
      customerName: row.customerId ? (customerNameById.get(row.customerId) ?? null) : null,
      occurredAt: (row.lastEscalatedAt ?? row.openedAt).toISOString(),
      escalationLevel: row.currentLevel,
      deepLink: row.customerId ? `/customers/${row.customerId}` : null,
    }));

    // ── Source 2: warning/critical findings from each customer's latest
    // coverage-sufficient run ── Graded gate (evaluateDocGateCoverage, same
    // helper as assessment_doc_gate / the sales-offer trigger): a strictly
    // status="completed" filter made every tenant whose runs are permanently
    // "partial" (e.g. two known unrunnable checks) invisible here despite
    // real warning/critical findings. A partial run with sufficient real
    // evaluable coverage is a reliable findings basis; a near-dark run is
    // skipped in favor of the customer's most recent sufficient run.
    const finishedRuns = await db
      .select({
        runId: mspDiagnosticRunsTable.runId,
        customerId: mspDiagnosticRunsTable.customerId,
        completedAt: mspDiagnosticRunsTable.completedAt,
        checksOk: mspDiagnosticRunsTable.checksOk,
        checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
        checksError: mspDiagnosticRunsTable.checksError,
        checksTotal: mspDiagnosticRunsTable.checksTotal,
      })
      .from(mspDiagnosticRunsTable)
      .where(and(
        eq(mspDiagnosticRunsTable.mspId, mspId),
        inArray(mspDiagnosticRunsTable.status, ["completed", "partial"]),
        ...(scopedIds === null ? [] : [inArray(mspDiagnosticRunsTable.customerId, scopedIds)]),
      ))
      .orderBy(desc(mspDiagnosticRunsTable.completedAt));

    const latestRunIdByCustomer = new Map<number, string>();
    for (const run of finishedRuns) {
      if (run.customerId === null) continue;
      if (latestRunIdByCustomer.has(run.customerId)) continue;
      const cov = evaluateDocGateCoverage({
        checksOk: run.checksOk ?? 0,
        checksLicenseGap: run.checksLicenseGap ?? 0,
        checksError: run.checksError ?? 0,
        checksTotal: run.checksTotal ?? 0,
      });
      if (!cov.proceed) continue;
      latestRunIdByCustomer.set(run.customerId, run.runId);
    }
    const latestRunIds = [...latestRunIdByCustomer.values()];

    const findingAlerts: CrossTenantAlert[] = [];
    if (latestRunIds.length > 0) {
      const findingRows = await db
        .select({
          id: mspDiagnosticFindingsTable.id,
          findingId: mspDiagnosticFindingsTable.findingId,
          runId: mspDiagnosticFindingsTable.runId,
          customerId: mspDiagnosticFindingsTable.customerId,
          severity: mspDiagnosticFindingsTable.severity,
          title: mspDiagnosticFindingsTable.title,
          description: mspDiagnosticFindingsTable.description,
          recommendation: mspDiagnosticFindingsTable.recommendation,
          checkKey: mspDiagnosticFindingsTable.checkKey,
          createdAt: mspDiagnosticFindingsTable.createdAt,
        })
        .from(mspDiagnosticFindingsTable)
        .where(
          and(
            eq(mspDiagnosticFindingsTable.mspId, mspId),
            inArray(mspDiagnosticFindingsTable.runId, latestRunIds),
            inArray(mspDiagnosticFindingsTable.severity, ["warning", "critical"]),
            // Git #3399 — a manually acknowledged finding drops out of the feed,
            // same as a resolved policy incident. A fresh scan's re-raised
            // finding is a brand new row (fresh finding_id) and is unaffected.
            isNull(mspDiagnosticFindingsTable.acknowledgedAt),
          ),
        );

      for (const row of findingRows) {
        findingAlerts.push({
          id: `finding-${row.findingId}`,
          source: "diagnostic_finding",
          severity: row.severity as Severity,
          category: row.recommendation?.category ?? row.checkKey,
          title: row.title,
          description: row.description,
          customerId: row.customerId,
          customerName: row.customerId ? (customerNameById.get(row.customerId) ?? null) : null,
          occurredAt: row.createdAt.toISOString(),
          escalationLevel: null,
          deepLink: row.customerId ? `/customers/${row.customerId}` : null,
        });
      }
    }

    let merged = [...incidentAlerts, ...findingAlerts];

    if (requestedSeverities && requestedSeverities.length > 0) {
      merged = merged.filter((a) => requestedSeverities.includes(a.severity));
    }
    if (categoryFilter) {
      merged = merged.filter((a) => a.category === categoryFilter);
    }
    if (customerIdFilter !== undefined) {
      merged = merged.filter((a) => a.customerId === customerIdFilter);
    }

    merged.sort((a, b) => {
      const rankDiff = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
      if (rankDiff !== 0) return rankDiff;
      return new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime();
    });

    const total = merged.length;
    const page = merged.slice(offset, offset + limit);

    res.json({ alerts: page, total, limit, offset });
  } catch (err) {
    log.error({ err }, "msp-alerts: GET /msp/alerts failed");
    res.status(500).json({ error: "Failed to fetch alerts" });
  }
});

// ── POST /msp/alerts/:alertId/acknowledge ───────────────────────────────────
// `alertId` is exactly the composite id GET /msp/alerts already returns
// ("incident-<id>" / "finding-<findingId>") so a caller never needs to know
// which source table backs a given row — it acts on the id it was just shown.
router.post("/msp/alerts/:alertId/acknowledge", requireCapability("ladder.msp-operator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      apiError(res, 403, ApiErrorCode.FORBIDDEN, "MSP context required");
      return;
    }

    const alertId = String(req.params["alertId"] ?? "");
    const incidentMatch = /^incident-(\d+)$/.exec(alertId);
    // finding-<uuid> — the id GET /msp/alerts builds from findingId, a uuid,
    // not the numeric row id (see mspDiagnosticFindingsTable.findingId).
    const findingMatch = /^finding-([0-9a-f-]{36})$/i.exec(alertId);

    if (findingMatch) {
      // Git #3399 — real acknowledge mechanism, added after the #3366 audit
      // found none existed. See the file header + the schema comment on
      // mspDiagnosticFindingsTable.acknowledgedAt for why this is the finding's
      // own column rather than routed through remediation_tracker_steps.
      const findingUuid = findingMatch[1]!;

      const [finding] = await db
        .select({
          id: mspDiagnosticFindingsTable.id,
          findingId: mspDiagnosticFindingsTable.findingId,
          mspId: mspDiagnosticFindingsTable.mspId,
          customerId: mspDiagnosticFindingsTable.customerId,
          checkKey: mspDiagnosticFindingsTable.checkKey,
          acknowledgedAt: mspDiagnosticFindingsTable.acknowledgedAt,
        })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.findingId, findingUuid))
        .limit(1);

      if (!finding || finding.mspId !== mspId) {
        // Same 404 whether the row doesn't exist or belongs to another MSP —
        // never confirm cross-MSP existence to the caller.
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Alert not found");
        return;
      }

      if (finding.customerId !== null && (await isCustomerBlockedByStaffScope(req.user!, finding.customerId))) {
        apiError(res, 404, ApiErrorCode.NOT_FOUND, "Alert not found");
        return;
      }

      if (finding.acknowledgedAt !== null) {
        // Idempotent — acknowledging an already-acknowledged finding is a
        // no-op success, not an error, matching the incident branch below.
        res.json({ id: `finding-${finding.findingId}`, status: "acknowledged", acknowledgedAt: finding.acknowledgedAt });
        return;
      }

      const [updated] = await db
        .update(mspDiagnosticFindingsTable)
        .set({ acknowledgedAt: new Date(), acknowledgedByUserId: req.user!.id })
        .where(eq(mspDiagnosticFindingsTable.id, finding.id))
        .returning();

      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: req.user!.role,
        actionType: "msp_alerts.finding.acknowledged",
        entityType: "msp_diagnostic_finding",
        entityId: finding.id,
        metadata: { mspId, customerId: finding.customerId, checkKey: finding.checkKey },
      });

      log.info({ findingId: finding.findingId, mspId, userId: req.user!.id }, "msp-alerts: finding manually acknowledged");

      res.json({ id: `finding-${updated!.findingId}`, status: "acknowledged", acknowledgedAt: updated!.acknowledgedAt });
      return;
    }

    if (!incidentMatch) {
      apiError(res, 400, ApiErrorCode.VALIDATION, "Unrecognized alert id");
      return;
    }

    const incidentId = Number(incidentMatch[1]);

    const [incident] = await db
      .select({
        id: policyRuleIncidentsTable.id,
        mspId: policyRuleIncidentsTable.mspId,
        customerId: policyRuleIncidentsTable.customerId,
        status: policyRuleIncidentsTable.status,
        currentLevel: policyRuleIncidentsTable.currentLevel,
        ruleId: policyRuleIncidentsTable.ruleId,
      })
      .from(policyRuleIncidentsTable)
      .where(eq(policyRuleIncidentsTable.id, incidentId))
      .limit(1);

    if (!incident || incident.mspId !== mspId) {
      // Same 404 whether the row doesn't exist or belongs to another MSP —
      // never confirm cross-MSP existence to the caller.
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Alert not found");
      return;
    }

    if (incident.customerId !== null && (await isCustomerBlockedByStaffScope(req.user!, incident.customerId))) {
      apiError(res, 404, ApiErrorCode.NOT_FOUND, "Alert not found");
      return;
    }

    if (incident.status === "resolved") {
      // Idempotent — acknowledging an already-resolved incident (auto or
      // manual) is a no-op success, not an error.
      res.json({ id: `incident-${incident.id}`, status: "resolved" });
      return;
    }

    const [updated] = await db
      .update(policyRuleIncidentsTable)
      .set({ status: "resolved", resolvedAt: new Date(), resolvedByUserId: req.user!.id })
      .where(eq(policyRuleIncidentsTable.id, incidentId))
      .returning();

    await createAuditLog({
      actorUserId: req.user!.id,
      actorName: req.user!.name ?? req.user!.email,
      actorRole: req.user!.role,
      actionType: "msp_alerts.incident.acknowledged",
      entityType: "policy_rule_incident",
      entityId: incident.id,
      metadata: { mspId, customerId: incident.customerId, ruleId: incident.ruleId, escalationLevel: incident.currentLevel },
    });

    log.info({ incidentId: incident.id, mspId, userId: req.user!.id }, "msp-alerts: incident manually acknowledged");

    res.json({ id: `incident-${updated.id}`, status: updated.status, resolvedAt: updated.resolvedAt });
  } catch (err) {
    log.error({ err }, "msp-alerts: POST /msp/alerts/:alertId/acknowledge failed");
    res.status(500).json({ error: "Failed to acknowledge alert" });
  }
});

export default router;
