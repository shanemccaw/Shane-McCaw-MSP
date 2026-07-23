/**
 * msp-staff-search.ts
 *
 * Cross-domain search backing the MSP-staff branch of the Cmd+K command
 * palette (command-palette.tsx). Customer-name search already exists via
 * GET /api/msp/customers?search= (unchanged, still called separately by the
 * palette) — this route adds the two other real sources MSP staff want to
 * jump to: cross-tenant alerts and cross-tenant documents.
 *
 * Reuses the exact scoping/query patterns already landed in msp-alerts.ts
 * (open policy_rule_incidents + latest-run warning/critical
 * msp_diagnostic_findings, resolveMspIdStrict + resolveStaffScopedCustomerIds)
 * and msp-documents-hub.ts (insights_generated_documents bridged from
 * msp_users, same scoping helpers) rather than inventing a third cross-tenant
 * join strategy. Neither of those files is modified — this is a read-only,
 * search-narrowed sibling of both.
 *
 * Routes (MSPOperator+, mspId from JWT claim via resolveMspIdStrict):
 *   GET /api/msp/staff-search?q=... — alerts + documents matching q, scoped
 *   to the caller's own MSP book (and staff-scoped customer set, if any).
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspCustomersTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  policyRuleIncidentsTable,
  policyRulesTable,
  insightsGeneratedDocumentsTable,
  mspUsersTable,
} from "@workspace/db";
import { eq, and, inArray, or, ilike, desc } from "drizzle-orm";
import { requireRole, resolveStaffScopedCustomerIds } from "../middlewares/requireAuth";
import { resolveMspIdStrict } from "../lib/resolve-msp-id.ts";
import { evaluateDocGateCoverage } from "../lib/doc-gate-coverage";
import { logger } from "../lib/logger";

const log = logger.child({ channel: "engine.dashboard" });

const router: IRouter = Router();

const RESULTS_PER_SOURCE = 5;

interface AlertSearchResult {
  type: "alert";
  id: string;
  title: string;
  description: string | null;
  severity: string;
  customerName: string | null;
  deepLink: string;
}

interface DocumentSearchResult {
  type: "document";
  id: string;
  title: string;
  description: string | null;
  status: string;
  customerName: string | null;
  deepLink: string;
}

router.get("/msp/staff-search", requireRole("MSPOperator"), async (req: Request, res: Response) => {
  try {
    const mspId = resolveMspIdStrict(req);
    if (mspId === null) {
      res.status(403).json({ error: "MSP context required" });
      return;
    }

    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      res.json({ alerts: [], documents: [] });
      return;
    }
    const like = `%${q}%`;

    // Same per-staff customer scoping used by msp-alerts.ts / msp-documents-hub.ts.
    // null = unrestricted (historical default).
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

    // ── Alerts: same two sources as GET /api/msp/alerts, narrowed by q ──
    const incidentRows = await db
      .select({
        id: policyRuleIncidentsTable.id,
        customerId: policyRuleIncidentsTable.customerId,
        currentLevel: policyRuleIncidentsTable.currentLevel,
        ruleName: policyRulesTable.name,
        ruleSeverity: policyRulesTable.severity,
      })
      .from(policyRuleIncidentsTable)
      .innerJoin(policyRulesTable, eq(policyRuleIncidentsTable.ruleId, policyRulesTable.id))
      .where(
        and(
          eq(policyRuleIncidentsTable.mspId, mspId),
          eq(policyRuleIncidentsTable.status, "open"),
          ilike(policyRulesTable.name, like),
          ...(scopedIds === null ? [] : [inArray(policyRuleIncidentsTable.customerId, scopedIds)]),
        ),
      )
      .limit(RESULTS_PER_SOURCE);

    // Graded coverage gate (evaluateDocGateCoverage, same helper as the
    // alerts feed / sales-offer trigger): searchable findings come from each
    // customer's latest coverage-sufficient run (completed OR partial), so a
    // tenant whose runs are permanently "partial" still has its real findings
    // searchable; a near-dark run defers to the last sufficient one.
    const finishedRuns = await db
      .select({
        runId: mspDiagnosticRunsTable.runId,
        customerId: mspDiagnosticRunsTable.customerId,
        checksOk: mspDiagnosticRunsTable.checksOk,
        checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
        checksError: mspDiagnosticRunsTable.checksError,
        checksTotal: mspDiagnosticRunsTable.checksTotal,
      })
      .from(mspDiagnosticRunsTable)
      .where(
        and(
          eq(mspDiagnosticRunsTable.mspId, mspId),
          inArray(mspDiagnosticRunsTable.status, ["completed", "partial"]),
          ...(scopedIds === null ? [] : [inArray(mspDiagnosticRunsTable.customerId, scopedIds)]),
        ),
      )
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

    const findingRows = latestRunIds.length
      ? await db
          .select({
            findingId: mspDiagnosticFindingsTable.findingId,
            customerId: mspDiagnosticFindingsTable.customerId,
            severity: mspDiagnosticFindingsTable.severity,
            title: mspDiagnosticFindingsTable.title,
            description: mspDiagnosticFindingsTable.description,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.mspId, mspId),
              inArray(mspDiagnosticFindingsTable.runId, latestRunIds),
              inArray(mspDiagnosticFindingsTable.severity, ["warning", "critical"]),
              or(ilike(mspDiagnosticFindingsTable.title, like), ilike(mspDiagnosticFindingsTable.description, like)),
            ),
          )
          .limit(RESULTS_PER_SOURCE)
      : [];

    const alerts: AlertSearchResult[] = [
      ...incidentRows.map((row): AlertSearchResult => ({
        type: "alert",
        id: `incident-${row.id}`,
        title: row.ruleName,
        description: row.currentLevel > 1 ? `Escalated to level ${row.currentLevel}` : null,
        severity: row.ruleSeverity ?? "info",
        customerName: row.customerId ? (customerNameById.get(row.customerId) ?? null) : null,
        deepLink: "/alerts",
      })),
      ...findingRows.map((row): AlertSearchResult => ({
        type: "alert",
        id: `finding-${row.findingId}`,
        title: row.title,
        description: row.description,
        severity: row.severity,
        customerName: row.customerId ? (customerNameById.get(row.customerId) ?? null) : null,
        deepLink: "/alerts",
      })),
    ].slice(0, RESULTS_PER_SOURCE);

    // ── Documents: same mspUsers bridge as msp-documents-hub.ts, narrowed by q ──
    const bridgeRows = await db
      .select({
        userId: mspUsersTable.userId,
        customerId: mspUsersTable.customerId,
      })
      .from(mspUsersTable)
      .where(eq(mspUsersTable.mspId, mspId));

    let eligibleUserIds = bridgeRows.map((r) => r.userId);
    const customerIdByUserId = new Map(bridgeRows.map((r) => [r.userId, r.customerId]));
    if (scopedIds !== null) {
      eligibleUserIds = eligibleUserIds.filter((uid) => {
        const cid = customerIdByUserId.get(uid);
        return cid != null && scopedIds.includes(cid);
      });
    }

    const documentRows = eligibleUserIds.length
      ? await db
          .select({
            id: insightsGeneratedDocumentsTable.id,
            title: insightsGeneratedDocumentsTable.title,
            docType: insightsGeneratedDocumentsTable.docType,
            status: insightsGeneratedDocumentsTable.status,
            customerId: insightsGeneratedDocumentsTable.customerId,
          })
          .from(insightsGeneratedDocumentsTable)
          .where(
            and(
              inArray(insightsGeneratedDocumentsTable.customerId, eligibleUserIds),
              inArray(insightsGeneratedDocumentsTable.status, ["delivered", "approved"]),
              ilike(insightsGeneratedDocumentsTable.title, like),
            ),
          )
          .orderBy(desc(insightsGeneratedDocumentsTable.createdAt))
          .limit(RESULTS_PER_SOURCE)
      : [];

    const documents: DocumentSearchResult[] = documentRows.map((row): DocumentSearchResult => {
      const mspCustomerId = row.customerId != null ? customerIdByUserId.get(row.customerId) : null;
      return {
        type: "document",
        id: `document-${row.id}`,
        title: row.title,
        description: row.docType ?? null,
        status: row.status ?? "delivered",
        customerName: mspCustomerId ? (customerNameById.get(mspCustomerId) ?? null) : null,
        deepLink: "/documents-hub",
      };
    });

    res.json({ alerts, documents });
  } catch (err) {
    log.error({ err }, "msp-staff-search: GET /msp/staff-search failed");
    res.status(500).json({ error: "Search is unavailable right now. Please try again shortly." });
  }
});

export default router;
