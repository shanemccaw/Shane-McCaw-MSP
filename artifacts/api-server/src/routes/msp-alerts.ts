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
 *     AND only each customer's latest completed diagnostics run — mirrors
 *     the triage restriction portal-mission-control.ts's overview endpoint
 *     already applies for a single customer, extended across the MSP's book.
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict):
 *   GET /api/msp/alerts — merged, filterable (severity/category/customerId), paginated
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspCustomersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  policyRuleIncidentsTable,
  policyRulesTable,
} from "@workspace/db";
import { eq, and, inArray, desc } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
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

router.get("/msp/alerts", requireRole("MSPOperator"), async (req: Request, res: Response) => {
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

    const customers = await db
      .select({ id: mspCustomersTable.id, name: mspCustomersTable.name })
      .from(mspCustomersTable)
      .where(
        scopedIds === null
          ? eq(mspCustomersTable.mspId, mspId)
          : and(eq(mspCustomersTable.mspId, mspId), inArray(mspCustomersTable.id, scopedIds)),
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

    // ── Source 2: warning/critical findings from each customer's latest completed run ──
    const completedRuns = await db
      .select({
        runId: mspDiagnosticRunsTable.runId,
        customerId: mspDiagnosticRunsTable.customerId,
        completedAt: mspDiagnosticRunsTable.completedAt,
      })
      .from(mspDiagnosticRunsTable)
      .where(and(
        eq(mspDiagnosticRunsTable.mspId, mspId),
        eq(mspDiagnosticRunsTable.status, "completed"),
        ...(scopedIds === null ? [] : [inArray(mspDiagnosticRunsTable.customerId, scopedIds)]),
      ))
      .orderBy(desc(mspDiagnosticRunsTable.completedAt));

    const latestRunIdByCustomer = new Map<number, string>();
    for (const run of completedRuns) {
      if (run.customerId === null) continue;
      if (!latestRunIdByCustomer.has(run.customerId)) {
        latestRunIdByCustomer.set(run.customerId, run.runId);
      }
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

export default router;
