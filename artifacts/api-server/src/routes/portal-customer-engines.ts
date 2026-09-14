/**
 * portal-customer-engines.ts
 *
 * Customer-facing SLA and Scope Creep status endpoints.
 *
 * These routes translate internal engine outputs into plain-language,
 * customer-safe summaries. No raw scores, rule keys, escalation details,
 * or internal operator data are returned — only what a customer needs to
 * know about their service health.
 *
 * Auth: requireCapability("ladder.customer-user") — MSP JWT with Customer role — for
 * every route here EXCEPT GET /portal/dashboard, which is requireAuth (see the
 * note on that route), and GET /portal/customer/rescoring-status, which is
 * requireCapability("ladder.free") (Git #1051 fix) — its own eligibility query looks
 * for a tenant's active mspRole='Free' user (the free weekly Copilot
 * Assessment rescan's real audience per #1058), so gating the READ one tier
 * above that at Customer blocked the exact free-tier customers the route
 * exists to inform — confirmed live via shaneapp://runTest against the real
 * testbed Assessment account (403 before this fix).
 * The customer's own ID is read from the JWT claim (req.user.customerId).
 *
 * Routes:
 *   GET /api/portal/customer/sla-status
 *   GET /api/portal/customer/scope-status
 *   GET /api/portal/customer/rescoring-status
 *   GET /api/portal/dashboard
 */

import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth, requireCapability } from "../middlewares/requireAuth.ts";
import { randomUUID } from "crypto";
import { getRequestContext } from "../lib/request-context.ts";
import { runSlaEngineForTenant, type SlaEngineOutput } from "../lib/sla-engine.ts";
import { runScopeCreepEngineForTenant, type ScopeCreepEngineOutput } from "../lib/scope-creep-engine.ts";
import { logger } from "../lib/logger.ts";
const log = logger.child({ channel: "tenant.portal" });
import { db, tenantEngineSnapshotsTable, tenantsTable, clientServicesTable, servicesTable, projectsTable, kanbanTasksTable, invoicesTable, reportsTable, notificationsTable, messagesTable, mspSalesBundleAssignmentsTable, mspAuditLogsTable, assessmentSowAgreementsTable, mspDiagnosticRunsTable, mspDiagnosticFindingsTable, usersTable, wfTriggersTable, wfDefinitionsTable, mspRiskDecisionsTable, policyDecisionsTable, mspMessageCenterItemsTable, changeMaintenanceWindowsTable, changeFreezeWindowsTable, remediationTrackerStepsTable, portalOwnershipAssignmentsTable, mspsTable, mspPoamsTable, mspSopRunsTable, mspChangeRequestsTable } from "@workspace/db";
import { eq, desc, and, count, inArray, or, asc, isNull } from "drizzle-orm";
import { createAuditLog } from "../lib/audit.ts";
import { getStripeKey } from "../lib/stripe.ts";
import { computeCopilotGate, type CopilotGateResult } from "../lib/copilot-gate.ts";
import { resolveCustomerUserIds } from "../lib/tenant-signals.ts";
import { resolveTenantScope } from "../lib/portal-customer-scope.ts";
import { hasAddOnEntitlement } from "../lib/portal-addon-entitlements.ts";
import { CHANGE_CONTROL_FEATURE_KEY } from "./portal-change-control.ts";
import { toMaintenanceCandidate, windowOverlapsRange } from "../lib/portal-change-maintenance.ts";
import { displayStatus as changeRequestDisplayStatus } from "../lib/portal-change-control.ts";
import { isWindowActiveAt } from "../lib/portal-change-freeze.ts";
import { kindForPost } from "../lib/portal-message-center.ts";
import { queueStateFor, isSameUtcMonth } from "../lib/portal-sops.ts";
import { remediationTerminalState } from "../lib/remediation-tracker-terminal-state.ts";
import { personIdForUser } from "../lib/portal-ownership.ts";
import { LEGACY_ROLE } from "@workspace/db/rbac/legacy-ladder";
import { WEEKLY_ASSESSMENT_RESCAN_NAME, WEEKLY_RETARGETING_RESCAN_NAME } from "../lib/weekly-rescan-populations.ts";

const router: IRouter = Router();

// ── Friendly translation helpers ──────────────────────────────────────────────

type OverallStatus = "on_track" | "attention_needed" | "action_required";

function slaOverall(output: SlaEngineOutput): OverallStatus {
  if (output.activeBreaches > 0) return "action_required";
  if (output.warningTimers > 0) return "attention_needed";
  return "on_track";
}

function slaHeadline(status: OverallStatus): string {
  switch (status) {
    case "on_track":
      return "Your service is running smoothly";
    case "attention_needed":
      return "A few requests need attention";
    case "action_required":
      return "Some requests are overdue — we're on it";
  }
}

function slaSubtext(output: SlaEngineOutput, status: OverallStatus): string {
  const { activeBreaches, warningTimers, runningTimers } = output;
  if (status === "on_track") {
    if (runningTimers === 0) return "No open requests at the moment. Everything is resolved.";
    return `All ${runningTimers} open request${runningTimers === 1 ? "" : "s"} are being handled within your agreed response times.`;
  }
  if (status === "attention_needed") {
    return `${warningTimers} request${warningTimers === 1 ? " is" : "s are"} approaching the response time limit. Our team is prioritising ${warningTimers === 1 ? "it" : "them"} now.`;
  }
  return `${activeBreaches} request${activeBreaches === 1 ? " has" : "s have"} exceeded the response time target. Our team has been notified and is actively working on resolution.`;
}

function slaComplianceLabel(output: SlaEngineOutput): string {
  const pct = output.compliancePct;
  if (output.runningTimers === 0) return "No open requests";
  if (pct === 100) return "100% on time";
  return `${pct}% resolved within target this period`;
}

function responsePerformanceLabel(output: SlaEngineOutput): "well_within" | "approaching_limit" | "overdue" {
  const { activeBreaches, warningTimers } = output;
  if (activeBreaches > 0) return "overdue";
  if (warningTimers > 0) return "approaching_limit";
  return "well_within";
}

function friendlySlaPerformance(p: "well_within" | "approaching_limit" | "overdue"): string {
  switch (p) {
    case "well_within": return "Well within targets";
    case "approaching_limit": return "Approaching response limit";
    case "overdue": return "Requires immediate attention";
  }
}

// ── Scope Creep helpers ────────────────────────────────────────────────────────

function scopeOverall(output: ScopeCreepEngineOutput): OverallStatus {
  if (output.score.openViolations > 0) return "action_required";
  if (output.score.openDetections > 0) return "attention_needed";
  return "on_track";
}

function scopeHeadline(status: OverallStatus): string {
  switch (status) {
    case "on_track":
      return "Your project is on scope";
    case "attention_needed":
      return "Some scope changes have been detected";
    case "action_required":
      return "Scope review required";
  }
}

function scopeSubtext(output: ScopeCreepEngineOutput, status: OverallStatus): string {
  const { openDetections, openViolations } = output.score;
  if (status === "on_track") {
    return "No significant changes have been detected to your agreed scope of work. Everything is progressing as planned.";
  }
  if (status === "attention_needed") {
    return `We've detected ${openDetections} change${openDetections === 1 ? "" : "s"} to the agreed scope. Your team is reviewing ${openDetections === 1 ? "it" : "them"} and will be in touch if any action is needed.`;
  }
  return `${openViolations} scope ${openViolations === 1 ? "concern requires" : "concerns require"} discussion. Your service manager will reach out to align on next steps.`;
}

type ItemStatus = "ok" | "notice" | "alert";

function driftStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const driftItems = output.breakdown.filter(e => e.detectionType === "drift" && e.exceeded);
  if (driftItems.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function expansionStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const items = output.breakdown.filter(e => e.detectionType === "expansion" && e.exceeded);
  if (items.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function timelineStatus(output: ScopeCreepEngineOutput): ItemStatus {
  const items = output.breakdown.filter(e => e.detectionType === "timeline_slip" && e.exceeded);
  if (items.length === 0) return "ok";
  if (output.score.openViolations > 0) return "alert";
  return "notice";
}

function driftMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "Deliverables are aligned with the original agreement.";
  if (status === "notice") return `${count} deliverable change${count === 1 ? " has" : "s have"} been noted and are under review.`;
  return `Deliverable changes require alignment with your service manager.`;
}

function expansionMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "No additional work has been identified outside the agreed scope.";
  if (status === "notice") return `${count} addition${count === 1 ? " has" : "s have"} been identified and are being assessed.`;
  return `Scope additions need to be discussed and formally agreed before proceeding.`;
}

function timelineMessage(status: ItemStatus, count: number): string {
  if (status === "ok") return "The project timeline is on track.";
  if (status === "notice") return `${count} timeline adjustment${count === 1 ? " has" : "s have"} been detected and are being reviewed.`;
  return `Timeline changes require discussion with your service manager.`;
}

// ── GET /api/portal/customer/sla-status ───────────────────────────────────────

router.get(
  "/portal/customer/sla-status",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const output = await runSlaEngineForTenant(customerId);
      const overall = slaOverall(output);
      const performance = responsePerformanceLabel(output);

      res.json({
        overall,
        headline: slaHeadline(overall),
        subtext: slaSubtext(output, overall),
        complianceLabel: slaComplianceLabel(output),
        activeWarnings: output.warningTimers,
        activeIssues: output.activeBreaches,
        openRequests: output.runningTimers,
        responsePerformance: performance,
        responsePerformanceLabel: friendlySlaPerformance(performance),
        updatedAt: output.timestamp,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: sla-status failed");
      res.status(500).json({ error: "Unable to load your service status right now. Please try again shortly." });
    }
  },
);

// ── GET /api/portal/customer/scope-status ─────────────────────────────────────

router.get(
  "/portal/customer/scope-status",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const output = await runScopeCreepEngineForTenant(customerId);
      const overall = scopeOverall(output);

      const driftItems = output.breakdown.filter(e => e.detectionType === "drift" && e.exceeded);
      const expansionItems = output.breakdown.filter(e => e.detectionType === "expansion" && e.exceeded);
      const timelineItems = output.breakdown.filter(e => e.detectionType === "timeline_slip" && e.exceeded);

      const ds = driftStatus(output);
      const es = expansionStatus(output);
      const ts = timelineStatus(output);

      res.json({
        overall,
        headline: scopeHeadline(overall),
        subtext: scopeSubtext(output, overall),
        openItems: output.score.openDetections + output.score.openViolations,
        areas: [
          {
            key: "deliverables",
            label: "Deliverable Changes",
            status: ds,
            message: driftMessage(ds, driftItems.length),
          },
          {
            key: "scope",
            label: "Scope Additions",
            status: es,
            message: expansionMessage(es, expansionItems.length),
          },
          {
            key: "timeline",
            label: "Timeline",
            status: ts,
            message: timelineMessage(ts, timelineItems.length),
          },
        ],
        updatedAt: output.timestamp,
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: scope-status failed");
      res.status(500).json({ error: "Unable to load your project status right now. Please try again shortly." });
    }
  },
);

// ── GET /api/portal/customer/rescoring-status (Git #1048, epic #1045) ─────────
//
// Customer-facing summary of the Monitoring Engine's rescan state: last scan
// date, next scheduled run, and a plain-language coverage label. Sourced
// entirely from real execution data — `msp_diagnostic_runs` for the scan
// itself, and the real `wf_triggers.next_run_at` row for whichever seeded
// weekly rescan covers the tenant (#1058; split by paid-assessment purchase
// in #3609, see lib/weekly-rescan-populations.ts) — no
// internal engine names, check keys, or raw per-check failure breakdown are
// ever returned, matching this file's existing sla-status/scope-status
// discipline. Deliberately does NOT touch the rescan add-on purchase/checkout
// flow (`assessment-flow-rescan-addon.ts`) — that is owned by the SOW/billing
// pipeline; this route only reads whether the tenant is currently eligible
// for the free weekly schedule (Free-tier, active user, Graph consent
// granted — the same predicate the seeded fan-out queries use), never
// writes to it.
const COMPLETED_RESCAN_RUN_STATUSES = ["completed", "partial"] as const;

type CoverageStatus = { status: "ok"; label: string; checksOk: number; checksTotal: number } | { status: "not_available"; reason: string };
type NextRunStatus = { status: "ok"; expectedAt: Date } | { status: "not_available"; reason: string };
type LastScanStatus = { status: "ok"; scannedAt: Date } | { status: "not_available"; reason: string };

function coverageLabel(checksOk: number, checksTotal: number, checksLicenseGap: number): string {
  if (checksTotal <= 0) return "Coverage pending";
  const ratio = checksOk / checksTotal;
  const base = ratio >= 0.95 ? "Full coverage" : ratio >= 0.7 ? "Partial coverage" : "Limited coverage";
  return checksLicenseGap > 0 ? `${base} (some checks unavailable on your current Microsoft 365 licensing)` : base;
}

router.get(
  "/portal/customer/rescoring-status",
  // Git #1051 fix — was requireCapability("ladder.customer-user"), one tier above the route's
  // real audience (see the file-level doc comment above): its eligibility query
  // looks for an active mspRole='Free' user on the tenant, so a
  // Customer+ floor 403'd the free-tier customers this route
  // exists to inform. Lowered to match /portal/diagnostics/status and
  // /portal/scan-status's own Free floor (same data domain).
  requireCapability("ladder.free"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    try {
      const [lastCompleted] = await db
        .select({
          completedAt: mspDiagnosticRunsTable.completedAt,
          createdAt: mspDiagnosticRunsTable.createdAt,
          checksOk: mspDiagnosticRunsTable.checksOk,
          checksTotal: mspDiagnosticRunsTable.checksTotal,
          checksLicenseGap: mspDiagnosticRunsTable.checksLicenseGap,
        })
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            inArray(mspDiagnosticRunsTable.status, [...COMPLETED_RESCAN_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const lastScan: LastScanStatus = lastCompleted
        ? { status: "ok", scannedAt: lastCompleted.completedAt ?? lastCompleted.createdAt }
        : { status: "not_available", reason: "never_scanned" };

      const coverage: CoverageStatus = lastCompleted
        ? {
            status: "ok",
            label: coverageLabel(lastCompleted.checksOk ?? 0, lastCompleted.checksTotal ?? 0, lastCompleted.checksLicenseGap ?? 0),
            checksOk: lastCompleted.checksOk ?? 0,
            checksTotal: lastCompleted.checksTotal ?? 0,
          }
        : { status: "not_available", reason: "never_scanned" };

      // Eligibility for the free weekly rescan: same predicate as the seeded
      // workflow's fan_out_query (mspRole='Free', active user, Graph
      // consent granted) — mirrored here read-only, never re-derived into a
      // second copy the workflow itself relies on.
      const [tenantRow] = await db
        .select({ consent: tenantsTable.consent })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);
      const consentGranted = tenantRow?.consent?.graph?.status === "granted";

      const eligibleUsers = await db
        .select({ id: usersTable.id })
        .from(usersTable)
        .where(and(eq(usersTable.tenantId, customerId), eq(usersTable.mspRole, LEGACY_ROLE.free), eq(usersTable.isActive, true)));

      const enrolledInWeeklyRescan = consentGranted && eligibleUsers.length > 0;

      let nextScheduledRun: NextRunStatus = { status: "not_available", reason: "not_enrolled" };
      if (enrolledInWeeklyRescan) {
        // #3609 — an active paid assessment moves the tenant from the Monday
        // retargeting rescan to the Sunday assessment rescan.
        const [paidAssessment] = await db
          .select({ id: clientServicesTable.id })
          .from(clientServicesTable)
          .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
          .where(and(
            inArray(clientServicesTable.clientUserId, eligibleUsers.map((u) => u.id)),
            eq(clientServicesTable.status, "active"),
            eq(servicesTable.serviceType, "assessment"),
            eq(servicesTable.isFreeOffering, false),
          ))
          .limit(1);
        const rescanWorkflowName = paidAssessment ? WEEKLY_ASSESSMENT_RESCAN_NAME : WEEKLY_RETARGETING_RESCAN_NAME;

        const [trigger] = await db
          .select({ nextRunAt: wfTriggersTable.nextRunAt, enabled: wfTriggersTable.enabled })
          .from(wfTriggersTable)
          .innerJoin(wfDefinitionsTable, eq(wfDefinitionsTable.id, wfTriggersTable.definitionId))
          .where(and(eq(wfDefinitionsTable.name, rescanWorkflowName), eq(wfTriggersTable.type, "schedule")))
          .limit(1);

        nextScheduledRun = trigger?.enabled && trigger.nextRunAt
          ? { status: "ok", expectedAt: trigger.nextRunAt }
          : { status: "not_available", reason: "schedule_unavailable" };
      }

      res.json({ lastScan, nextScheduledRun, coverage });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: rescoring-status failed");
      res.status(500).json({ error: "Unable to load your monitoring status right now. Please try again shortly." });
    }
  },
);

// ── GET /api/portal/dashboard ─────────────────────────────────────────────────
//
// THE single handler for this path (#327). A second one lived in
// portal-dashboard.ts until #327 deleted it: both files registered the identical
// path, and since Express matches in registration order (this router is mounted
// first in routes/index.ts) that other handler never executed for any request
// from the day it was added. It was not a rival implementation — the block below
// marked "Merge existing dashboard fields for customer-home.tsx" is a verbatim
// copy of its body, so it was already a strict subset of this route's payload,
// short one field (`customerName`, added to the dead file by #315 and carried
// over here). Nothing was lost by deleting it; the only real symptom was #315's
// tenant-name fetch silently reading a field no live route emitted.
//
// requireAuth, not requireCapability("ladder.customer-user") — Shane's call on #327. The
// Assessment role sits BELOW Customer in ROLE_ORDER, so the old floor 403'd
// the War Room and the assessment dashboard, which are Assessment-tier surfaces
// that call this route. Deliberate consequence: Free tier now receive
// the engine payload (`scores`, `results.summary.compositeScore`, per-pillar
// `score`, `telemetryStatus`, `type_attributes`). The #164 paywall below is
// unaffected and still redacts findings/recommendation TEXT for unpaid
// customers — it keys on the SOW agreement, never on the role — but note that
// pillar SCORES were never gated by it and are now visible one tier lower.
// A token with no customerId claim (every MSP-side role) still gets the 400
// below, exactly as it did under the old floor.
router.get(
  "/portal/dashboard",
  requireAuth,
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    // #1397: customer-owned data (projects, paid-tier SOWs, purchased services)
    // is stored under a users.id-shaped `clientUserId` FK, but it belongs to the
    // CUSTOMER, not one login. Scope every such read across the customer's full
    // set of linked logins — the same resolveCustomerUserIds() bridge the rest of
    // the portal (portal-assessment.ts) and admin routes already use — so a
    // second login or a recreated account still sees its own organization's data.
    const customerUserIds = await resolveCustomerUserIds(customerId);

    // #2922 — the (mspId, tenantId) pair the five cross-Feature roll-up counts
    // below are scoped by. Every one of those tables predates `tenants` and is
    // keyed on this free-text tenant identifier, not `customerId` directly
    // (see each table's own scoping rationale in portal-risk-register.ts /
    // portal-change-control.ts / portal-message-center.ts). Null for an
    // account whose tenant row carries no resolvable M365 identifier — every
    // count below reads as a true 0 in that case, not an error (same
    // "unresolvable scope is an honest empty register" rule those routes
    // already follow).
    const tenantScope = await resolveTenantScope(customerId);

    try {
      const snapshots = await db
        .select({
          engineKey: tenantEngineSnapshotsTable.engineKey,
          score: tenantEngineSnapshotsTable.score,
          breakdown: tenantEngineSnapshotsTable.breakdown,
          runId: tenantEngineSnapshotsTable.runId,
          capturedAt: tenantEngineSnapshotsTable.capturedAt,
        })
        .from(tenantEngineSnapshotsTable)
        .where(eq(tenantEngineSnapshotsTable.customerId, customerId))
        .orderBy(desc(tenantEngineSnapshotsTable.capturedAt));

      // Free-tier paywall (#164, Phase 3 of #161): a customer only sees the raw
      // findings/recommendations text once they've paid (or been free-activated)
      // for an assessment SOW. Composite/pillar SCORES are never gated — only the
      // finding/recommendation strings themselves. Same paid/free_activated status
      // set portal-assessment.ts already gates on (see its SOW-checkout dedupe
      // check) — this route has no single docId to scope to (it aggregates every
      // engine snapshot for the customer), so it's keyed on "has this customer
      // paid/activated ANY assessment SOW" rather than a specific document.
      const [paidAgreement] = await db
        .select({ id: assessmentSowAgreementsTable.id })
        .from(assessmentSowAgreementsTable)
        .where(
          and(
            inArray(assessmentSowAgreementsTable.clientUserId, customerUserIds),
            inArray(assessmentSowAgreementsTable.status, ["paid", "free_activated"]),
          ),
        )
        .limit(1);
      const isPaidTier = !!paidAgreement;

      const scores: Record<string, number> = {};
      const pillars: Record<string, any> = {};
      let compositeScore = 0;
      let compositeCount = 0;
      let runId: string | null = null;
      let generatedAt: string | null = null;

      for (const snap of snapshots) {
        if (scores[snap.engineKey] === undefined && snap.score !== null) {
          scores[snap.engineKey] = snap.score;
          compositeScore += snap.score;
          compositeCount++;
          
          if (!runId && snap.runId) runId = snap.runId;
          if (!generatedAt && snap.capturedAt) generatedAt = snap.capturedAt.toISOString();

          // Extract findings/recommendations from breakdown
          const breakdown = Array.isArray(snap.breakdown) ? snap.breakdown : [];
          const findings: string[] = [];
          const recommendations: string[] = [];
          
          for (const item of breakdown) {
            if (typeof item === "object" && item !== null) {
              const b = item as Record<string, any>;
              if (b.finding) findings.push(String(b.finding));
              else if (b.message) findings.push(String(b.message));
              else if (b.label) findings.push(String(b.label));

              if (b.recommendation) recommendations.push(String(b.recommendation));
              else if (b.action) recommendations.push(String(b.action));
            }
          }

          pillars[snap.engineKey] = isPaidTier
            ? { score: snap.score, status: "complete", findings, recommendations }
            : { score: snap.score, status: "complete", findingsCount: findings.length, recommendationsCount: recommendations.length };
        }
      }

      // #2500: priorityItems — the customer's real critical/warning diagnostic
      // findings from their MOST RECENT scan run, worst-severity-first. This was
      // previously a hardcoded `[]` literal with no query behind it at all
      // (found during #2446's contract-pack extraction). Mirrors the same
      // "latest run for this customer" + severity-filter pattern already used by
      // fetchPillarFindings (pillar-summary-stats.ts) and the cross-tenant alert
      // feed (msp-alerts.ts), scoped down to what this route needs — no
      // rank-weight machinery, since this list is a short customer-facing
      // headline, not the full per-pillar radar those callers build.
      // Same #164 paywall as the pillars block above: an unpaid customer sees
      // that priority items exist (count + severity) but not the finding text
      // itself, consistent with how `pillars[engineKey]` gates findings/
      // recommendations text one paragraph up.
      type PriorityItem = {
        checkKey: string;
        severity: "critical" | "warning";
        title: string | null;
        description: string | null;
      };
      let priorityItems: PriorityItem[] = [];
      const [latestFindingsRun] = await db
        .select({ runId: mspDiagnosticFindingsTable.runId })
        .from(mspDiagnosticFindingsTable)
        .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
        .limit(1);

      if (latestFindingsRun) {
        const findingRows = await db
          .select({
            checkKey: mspDiagnosticFindingsTable.checkKey,
            severity: mspDiagnosticFindingsTable.severity,
            title: mspDiagnosticFindingsTable.title,
            description: mspDiagnosticFindingsTable.description,
            createdAt: mspDiagnosticFindingsTable.createdAt,
          })
          .from(mspDiagnosticFindingsTable)
          .where(
            and(
              eq(mspDiagnosticFindingsTable.runId, latestFindingsRun.runId),
              // #3102: defense-in-depth — customer_id is denormalized on this
              // table with only an FK from run_id to msp_diagnostic_runs, not a
              // constraint tying a finding's own customer_id to its run's. Scope
              // this read by tenant on its own terms rather than by inference
              // that run_id never spans customers.
              eq(mspDiagnosticFindingsTable.customerId, customerId),
              inArray(mspDiagnosticFindingsTable.severity, ["critical", "warning"]),
            ),
          );

        const severityRank: Record<string, number> = { critical: 0, warning: 1 };
        findingRows.sort(
          (a, b) =>
            severityRank[a.severity] - severityRank[b.severity] ||
            b.createdAt.getTime() - a.createdAt.getTime(),
        );

        priorityItems = findingRows.slice(0, 5).map((row) => ({
          checkKey: row.checkKey,
          severity: row.severity as "critical" | "warning",
          title: isPaidTier ? row.title : null,
          description: isPaidTier ? row.description : null,
        }));
      }

      // Determine type_attributes / modules to mount
      const activeServices = await db
        .select({ typeAttributes: servicesTable.typeAttributes })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(
          and(
            inArray(clientServicesTable.clientUserId, customerUserIds),
            eq(clientServicesTable.status, "active")
          )
        );

      const dashboardModules = new Set<string>();
      const enabledModules = new Set<string>();
      
      for (const service of activeServices) {
        const attrs = service.typeAttributes as Record<string, unknown> | null;
        if (attrs && Array.isArray(attrs.dashboardModules)) {
          for (const mod of attrs.dashboardModules) {
            if (typeof mod === "string") dashboardModules.add(mod);
          }
        }
        if (attrs && Array.isArray(attrs.enabledModules)) {
          for (const mod of attrs.enabledModules) {
            if (typeof mod === "string") enabledModules.add(mod);
          }
        }
      }
      
      const type_attributes = dashboardModules.size > 0 
        ? Array.from(dashboardModules) 
        : (enabledModules.size > 0 ? Array.from(enabledModules) : ["priority-health", "security", "copilot", "cost"]);

      // customerName rides along on the tenants row this route already reads —
      // no extra query. It is the real tenant identity #315's War Room prelude
      // needs (it replaced a hardcoded "Northline Health"), and it was the ONE
      // field the deleted portal-dashboard.ts emitted that this route did not.
      const [customer] = await db
        .select({ status: tenantsTable.status, customerName: tenantsTable.customerName })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const telemetryStatus = customer?.status === "onboarding" ? "in_progress" : "completed";

      // Git #4002 (Offboarding): the servicing MSP's name, for the "served by
      // <name>, not directly by the platform" copy on a brokered customer's
      // Offboarding page — the JWT's mspId claim alone (already returned below)
      // names the MSP but not its display name, and no route previously
      // exposed one to a CustomerUser.
      const [servicingMsp] = req.user!.mspId
        ? await db.select({ name: mspsTable.name }).from(mspsTable).where(eq(mspsTable.id, req.user!.mspId)).limit(1)
        : [];

      // ── Merge existing dashboard fields for customer-home.tsx ──
      const projects = await db.select().from(projectsTable)
        .where(and(inArray(projectsTable.clientUserId, customerUserIds), eq(projectsTable.status, "active")))
        .orderBy(desc(projectsTable.updatedAt)).limit(5);

      type EnrichedProject = typeof projects[0] & {
        currentTask: { stepNumber: number; totalSteps: number; title: string } | null;
      };
      let enrichedProjects: EnrichedProject[];

      if (projects.length > 0) {
        const projectIds = projects.map(p => p.id);
        const allTasks = await db.select({
          id: kanbanTasksTable.id,
          title: kanbanTasksTable.title,
          order: kanbanTasksTable.order,
          column: kanbanTasksTable.column,
          projectId: kanbanTasksTable.projectId,
        }).from(kanbanTasksTable)
          .where(inArray(kanbanTasksTable.projectId, projectIds))
          .orderBy(asc(kanbanTasksTable.order));

        const tasksByProject = new Map<number, typeof allTasks>();
        for (const task of allTasks) {
          if (!task.projectId) continue;
          const arr = tasksByProject.get(task.projectId) ?? [];
          arr.push(task);
          tasksByProject.set(task.projectId, arr);
        }

        enrichedProjects = projects.map(p => {
          const tasks = tasksByProject.get(p.id) ?? [];
          const inProgressTask = tasks.find(t => t.column === "in_progress");
          if (!inProgressTask) return { ...p, currentTask: null };
          const stepNumber = tasks.indexOf(inProgressTask) + 1;
          return {
            ...p,
            currentTask: { stepNumber, totalSteps: tasks.length, title: inProgressTask.title },
          };
        });
      } else {
        enrichedProjects = [];
      }

      const clientServicesResult = await db.select({
        cs: clientServicesTable,
        service: {
          name: servicesTable.name,
          billingType: servicesTable.billingType,
          price: servicesTable.price,
        },
      }).from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(and(inArray(clientServicesTable.clientUserId, customerUserIds), or(eq(clientServicesTable.status, "active"), eq(clientServicesTable.status, "paused"))))
        .orderBy(desc(clientServicesTable.purchasedAt)).limit(6);

      // Full invoice rows — amount is integer cents (Git #1610). No msp-portal
      // consumer renders this snapshot's invoice amounts as money, so they ride
      // through as cents, consistent with the cents-internal wire.
      const invoices = await db.select().from(invoicesTable)
        .where(inArray(invoicesTable.clientUserId, customerUserIds))
        .orderBy(desc(invoicesTable.createdAt)).limit(5);

      const reports = await db.select().from(reportsTable)
        .where(inArray(reportsTable.clientUserId, customerUserIds))
        .orderBy(desc(reportsTable.createdAt)).limit(3);

      // Notifications stay per-login: a notification feed is the one genuinely
      // user-specific surface Shane named (#1397, "maybe alert preferences"),
      // delivered to a specific login rather than shared across the account.
      const [{ unread }] = await db.select({ unread: count() }).from(notificationsTable)
        .where(and(eq(notificationsTable.userId, req.user!.id), eq(notificationsTable.read, false)));

      // Messages are the customer↔MSP thread (a single readByClient flag per
      // message, not per-login) — scope the unread badge across the account.
      const [{ unreadMessages }] = await db.select({ unreadMessages: count() }).from(messagesTable)
        .where(and(inArray(messagesTable.clientUserId, customerUserIds), eq(messagesTable.readByClient, false)));

      // ── #2922 — real cross-Feature roll-up counts ────────────────────────
      //
      // Six operational counts pulled from the Features that already own this
      // data — Risk Register, Microsoft Message Center, Change Control's
      // maintenance calendar, Remediation Tracker, and Policy Decisions — none
      // of which had a queryable aggregate before this. Every count is 0 when
      // `tenantScope` is null (see its own comment above) rather than
      // attempted against a blank/absent tenant identifier.
      let rbdWaiting = 0;
      let rbdActive = 0;
      let microsoftChangesThisWeek = 0;
      let changeScheduleThisWeek = 0;
      let remediationInProgress = 0;
      let policiesExpiringSoon = 0;
      // #4062 — POA&Ms overdue + the approaching-expiry ladder.
      let poamsOverdue = 0;
      const poamsApproachingExpiry = { within7: 0, within30: 0, within60: 0, within90: 0 };
      // #4063 — open Risk Register entries, and which have a credible plan
      // (a live POA&M) behind them.
      let openRisks = 0;
      let openRisksWithPlan = 0;
      // #4064 — the real SOP queue split, plus the aggregate activity fallback
      // the issue names for the "waiting on customer" state the backend does
      // not yet distinguish from "Queued".
      let sopsRunning = 0;
      let sopsQueued = 0;
      let sopsExecsThisMonth = 0;
      // #4065 — change requests genuinely awaiting the customer's approval,
      // and whether a freeze is in effect right now.
      let changeRequestsAwaitingApproval = 0;
      let freezeActive = false;

      // Seventh count (#3049, filed against #2922's own honest gap): pending
      // Ownership/RACI acceptances named to THIS login. `portal_ownership_assignments`
      // already carries everything needed — `acceptance` moves "" -> "pending" ->
      // "accepted"/"declined" (#1518), and only r/a cells ever carry it (c/i never
      // do). `ownerPersonId` uses the same "u{id}" wire scheme every other route in
      // this codebase resolves the current actor to (`personIdForUser`), so this is
      // a plain count against real rows, no schema change required. Scoped by
      // `customerId` alone, like the ownership matrix route itself — this table has
      // no `(mspId, tenantId)` shape, so it doesn't depend on `tenantScope`.
      const [{ raciPendingAcceptance }] = await db
        .select({ raciPendingAcceptance: count() })
        .from(portalOwnershipAssignmentsTable)
        .where(
          and(
            eq(portalOwnershipAssignmentsTable.customerId, customerId),
            eq(portalOwnershipAssignmentsTable.ownerPersonId, personIdForUser(req.user!.id)),
            eq(portalOwnershipAssignmentsTable.acceptance, "pending"),
            or(
              eq(portalOwnershipAssignmentsTable.roleKey, "r"),
              eq(portalOwnershipAssignmentsTable.roleKey, "a"),
            ),
          ),
        );

      const now = new Date();
      const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

      if (tenantScope) {
        // RBD waiting / active — RISK_ACCEPTANCE_STATUSES's own two live-in-flight
        // values (`pending_signature`, `active`; the third, `revoked`, is neither
        // waiting nor active and is excluded). One grouped query, not two counts.
        const rbdCounts = await db
          .select({ status: mspRiskDecisionsTable.status, n: count() })
          .from(mspRiskDecisionsTable)
          .where(
            and(
              eq(mspRiskDecisionsTable.mspId, tenantScope.mspId),
              eq(mspRiskDecisionsTable.tenantId, tenantScope.tenantId),
            ),
          )
          .groupBy(mspRiskDecisionsTable.status);
        for (const row of rbdCounts) {
          if (row.status === "pending_signature") rbdWaiting = row.n;
          else if (row.status === "active") rbdActive = row.n;
        }

        // Microsoft Changes requiring action — #4066: this used to be a pure
        // date-window count over the whole corpus, which both missed a
        // requiring-action post whose deadline falls outside the next 7 days
        // and wrongly counted a no-action post whose unrelated date field
        // landed this week. `kindForPost()` is portal-message-center.ts's own
        // real classification (same one `buildStats()`'s "decisions"/"hits"
        // counters use): "b" (breaks something) or "d" (needs a decision) are
        // the two kinds that actually require action; "v"/"s" do not. Counted
        // over the whole corpus, same `customerId` + `mspId` scoping that
        // route's own read uses.
        const mcRows = await db
          .select({
            category: mspMessageCenterItemsTable.category,
            tags: mspMessageCenterItemsTable.tags,
            isMajorChange: mspMessageCenterItemsTable.isMajorChange,
            actionRequiredByDateTime: mspMessageCenterItemsTable.actionRequiredByDateTime,
          })
          .from(mspMessageCenterItemsTable)
          .where(
            and(
              eq(mspMessageCenterItemsTable.customerId, tenantScope.customerId),
              eq(mspMessageCenterItemsTable.mspId, tenantScope.mspId),
            ),
          );
        microsoftChangesThisWeek = mcRows.filter((r) => {
          const kind = kindForPost({ ...r, tags: Array.isArray(r.tags) ? r.tags : [] });
          return kind === "d" || kind === "b";
        }).length;

        // Change schedule for the week — the maintenance calendar
        // (portal-change-control.ts's own `/change-control/maintenance-windows`
        // read), gated on the same purchased add-on that route requires: an
        // unentitled tenant has no maintenance calendar to count, same as it
        // gets a 402 hitting that route directly. `windowOverlapsRange` walks a
        // recurring window's own cadence forward so a "every Saturday" rule
        // created months ago still counts if a Saturday falls in this window.
        if (await hasAddOnEntitlement(tenantScope.customerId, CHANGE_CONTROL_FEATURE_KEY)) {
          const windowRows = await db
            .select()
            .from(changeMaintenanceWindowsTable)
            .where(
              and(
                eq(changeMaintenanceWindowsTable.mspId, tenantScope.mspId),
                eq(changeMaintenanceWindowsTable.active, true),
                or(
                  eq(changeMaintenanceWindowsTable.scope, "global"),
                  and(eq(changeMaintenanceWindowsTable.scope, "tenant"), eq(changeMaintenanceWindowsTable.tenantId, tenantScope.tenantId)),
                  eq(changeMaintenanceWindowsTable.scope, "workload"),
                ),
              ),
            );
          // Scope matching is already done by the WHERE clause above (identical
          // to portal-change-control.ts's own maintenance-windows read, which
          // includes every workload-scoped window unfiltered by workload — a
          // combined calendar, not one workload's view) — only the recurrence
          // overlap check is left to do here.
          changeScheduleThisWeek = windowRows
            .map(toMaintenanceCandidate)
            .filter((w) => windowOverlapsRange(w, now, weekFromNow)).length;

          // #4065 — the two things #1943 actually asked for on this bullet:
          // requests genuinely awaiting the customer's approval (not the
          // maintenance schedule above, which is expected-work timing, a
          // different concept), and whether a freeze is active right now.
          // Same `change_control` entitlement gate as the maintenance-window
          // read just above — both routes this rolls up require it, so an
          // unentitled tenant reads a real 0/false, not an error.
          const crRows = await db
            .select({
              status: mspChangeRequestsTable.status,
              approvedBy: mspChangeRequestsTable.approvedBy,
            })
            .from(mspChangeRequestsTable)
            .where(
              and(
                eq(mspChangeRequestsTable.mspId, tenantScope.mspId),
                eq(mspChangeRequestsTable.tenantId, tenantScope.tenantId),
              ),
            );
          changeRequestsAwaitingApproval = crRows.filter(
            (r) => changeRequestDisplayStatus(r.status, r.approvedBy) === "Pending approval",
          ).length;

          const freezeRows = await db
            .select()
            .from(changeFreezeWindowsTable)
            .where(
              and(
                eq(changeFreezeWindowsTable.mspId, tenantScope.mspId),
                eq(changeFreezeWindowsTable.active, true),
                or(
                  eq(changeFreezeWindowsTable.scope, "global"),
                  and(eq(changeFreezeWindowsTable.scope, "tenant"), eq(changeFreezeWindowsTable.tenantId, tenantScope.tenantId)),
                  eq(changeFreezeWindowsTable.scope, "workload"),
                ),
              ),
            );
          freezeActive = freezeRows.some((row) =>
            isWindowActiveAt(
              {
                startsAt: row.startsAt,
                endsAt: row.endsAt,
                recurrence: row.recurrence as Parameters<typeof isWindowActiveAt>[0]["recurrence"],
                recurrenceUntil: row.recurrenceUntil,
                active: row.active,
              },
              now,
            ),
          );
        }

        // Remediation steps in progress — a customer claim (completed /
        // already_handled / deferred / shane_handles) that has not yet been
        // confirmed by a re-scan and has not exited to the risk register.
        // Reuses remediationTrackerTable's own `remediationTerminalState()` so
        // this count can never disagree with what the tracker page itself shows
        // as "outstanding". Scoped by `customerId` directly — this table has no
        // (mspId, tenantId) shape, unlike the four above.
        const remediationRows = await db
          .select({
            status: remediationTrackerStepsTable.status,
            verificationState: remediationTrackerStepsTable.verificationState,
          })
          .from(remediationTrackerStepsTable)
          .where(eq(remediationTrackerStepsTable.customerId, customerId));
        remediationInProgress = remediationRows.filter(
          (r) => remediationTerminalState(r.status, r.verificationState) === "outstanding",
        ).length;

        // Policies expiring soon — policy_decisions' own review clock
        // (reviewState, #2518), advanced on the same schedule as the register
        // page reads it. `due` is the operational "coming up" lead window
        // (RISK_REVIEW_DUE_LEAD_DAYS, alert-engine.ts) short of its deadline;
        // `overdue` has already passed it. A dependency-based decision (#1526)
        // has a null reviewState and is correctly excluded — there is no
        // "soon" for a condition with no date.
        const policyCounts = await db
          .select({ reviewState: policyDecisionsTable.reviewState, n: count() })
          .from(policyDecisionsTable)
          .where(
            and(
              eq(policyDecisionsTable.mspId, tenantScope.mspId),
              eq(policyDecisionsTable.tenantId, tenantScope.tenantId),
            ),
          )
          .groupBy(policyDecisionsTable.reviewState);
        policiesExpiringSoon = policyCounts
          .filter((row) => row.reviewState === "due" || row.reviewState === "overdue")
          .reduce((sum, row) => sum + row.n, 0);

        // #4062 — POA&Ms overdue + the approaching-expiry ladder. Only a
        // still-`active` plan can be overdue or approaching its date, same as
        // `computeOverdue()`'s own rule in portal-poams.ts — draft/
        // pending_signature isn't live yet, and completed/cancelled/
        // converted_to_risk_acceptance are terminal. The alert catalog's own
        // documented ladder for this (2026-09-04-alert-catalog-risk-policy-
        // poam-1942.sql: "90/60/30 days, 3/2/1 weeks, 3/2/1 days out") is
        // finer-grained than a dashboard tile needs; this buckets to the same
        // real horizon at a size a roll-up count can actually display.
        const todayIso = now.toISOString().slice(0, 10);
        const poamRows = await db
          .select({
            scheduledCompletionDate: mspPoamsTable.scheduledCompletionDate,
          })
          .from(mspPoamsTable)
          .where(
            and(
              eq(mspPoamsTable.mspId, tenantScope.mspId),
              eq(mspPoamsTable.tenantId, tenantScope.tenantId),
              eq(mspPoamsTable.status, "active"),
              isNull(mspPoamsTable.deletedAt),
            ),
          );
        for (const row of poamRows) {
          if (row.scheduledCompletionDate < todayIso) {
            poamsOverdue++;
            continue;
          }
          const daysOut = Math.floor(
            (new Date(`${row.scheduledCompletionDate}T00:00:00Z`).getTime() - now.getTime()) / 86_400_000,
          );
          if (daysOut <= 7) poamsApproachingExpiry.within7++;
          else if (daysOut <= 30) poamsApproachingExpiry.within30++;
          else if (daysOut <= 60) poamsApproachingExpiry.within60++;
          else if (daysOut <= 90) poamsApproachingExpiry.within90++;
        }

        // #4063 — open Risk Register entries, and which have a credible plan
        // behind them. `spawnedByPoamId`/`convertedToPoamId` on
        // msp_risk_decisions are one-time CONVERSION pointers (a risk that
        // WAS a POA&M, or vice versa) — a different relationship from "this
        // open risk currently has a plan running in parallel", and neither
        // WireRisk nor WirePoam carries a field for that. The real link is
        // the shared `checkKey`/`additionalCheckKeys` the alert engine's own
        // suppression logic already treats as how a risk and a finding relate.
        const riskRows = await db
          .select({
            checkKey: mspRiskDecisionsTable.checkKey,
            additionalCheckKeys: mspRiskDecisionsTable.additionalCheckKeys,
          })
          .from(mspRiskDecisionsTable)
          .where(
            and(
              eq(mspRiskDecisionsTable.mspId, tenantScope.mspId),
              eq(mspRiskDecisionsTable.tenantId, tenantScope.tenantId),
              eq(mspRiskDecisionsTable.riskStatus, "Open"),
            ),
          );
        openRisks = riskRows.length;

        if (openRisks > 0) {
          // A "live" plan — still actually being pursued, not abandoned or
          // folded back into an acceptance.
          const livePoamRows = await db
            .select({
              checkKey: mspPoamsTable.checkKey,
              additionalCheckKeys: mspPoamsTable.additionalCheckKeys,
            })
            .from(mspPoamsTable)
            .where(
              and(
                eq(mspPoamsTable.mspId, tenantScope.mspId),
                eq(mspPoamsTable.tenantId, tenantScope.tenantId),
                inArray(mspPoamsTable.status, ["draft", "pending_signature", "active"]),
                isNull(mspPoamsTable.deletedAt),
              ),
            );
          const poamCheckKeys = new Set<string>();
          for (const p of livePoamRows) {
            if (p.checkKey) poamCheckKeys.add(p.checkKey);
            for (const k of p.additionalCheckKeys ?? []) poamCheckKeys.add(k);
          }
          if (poamCheckKeys.size > 0) {
            openRisksWithPlan = riskRows.filter((r) => {
              const keys = [r.checkKey, ...(r.additionalCheckKeys ?? [])].filter(
                (k): k is string => !!k,
              );
              return keys.some((k) => poamCheckKeys.has(k));
            }).length;
          }
        }

        // #4064 — SOP running/queued roll-up. `queueStateFor()` is
        // portal-sops.ts's own real Running/Queued distinction; the backend
        // has no third "waiting on customer" state to split Queued further
        // into (confirmed while investigating this issue), so this reports
        // the two real states honestly rather than inventing one.
        // `sopsExecsThisMonth` rides along as the aggregate "SOP activity"
        // fallback the issue itself names for when that finer distinction
        // isn't ready.
        const sopRunRows = await db
          .select({ status: mspSopRunsTable.status, startedAt: mspSopRunsTable.startedAt })
          .from(mspSopRunsTable)
          .where(
            and(
              eq(mspSopRunsTable.mspId, tenantScope.mspId),
              eq(mspSopRunsTable.tenantId, tenantScope.tenantId),
            ),
          );
        for (const row of sopRunRows) {
          const state = queueStateFor(row.status);
          if (state === "Running") sopsRunning++;
          else if (state === "Queued") sopsQueued++;
        }
        sopsExecsThisMonth = sopRunRows.filter((r) => isSameUtcMonth(r.startedAt, now)).length;
      }

      // #4067 — the real Copilot Gate (computeCopilotGate(), never throws —
      // degrades to a null score with `evaluation.reason` set). #1943's own
      // body named `/portal/pillars` as already carrying this; it doesn't —
      // buildPillarSummary() has no Gate field. The only routes that do are
      // /portal/diagnostics/status and /portal/remediation-tracker/pillar-scores,
      // neither of which the dashboard roll-up read from until now.
      const copilotGate: CopilotGateResult = await computeCopilotGate(customerId);

      res.json({
        // #4068 — null, not 0, for an engine that has never produced a
        // snapshot for this customer. Same "never-scanned is unavailable, not
        // a bad score" rule `results.summary.compositeScore` already follows
        // two fields over (`compositeCount > 0 ? ... : null`) — this object
        // just didn't use it before.
        scores: {
          security: scores.security ?? null,
          health: scores.health ?? null,
          drift: scores.drift ?? null,
          sla: scores.sla ?? null,
          scope_creep: scores.scope_creep ?? null,
          ...scores
        },
        telemetryStatus,
        type_attributes,
        results: {
          status: telemetryStatus === "in_progress" ? "running" : "complete",
          runId,
          generatedAt,
          summary: {
            compositeScore: compositeCount > 0 ? Math.round(compositeScore / compositeCount) : null,
            priorityItems,
          },
          pillars
        },
        projects: enrichedProjects,
        clientServices: clientServicesResult,
        invoices,
        reports,
        unreadNotifications: unread,
        unreadMessages,
        // `?? null` on all three: the deleted portal-dashboard.ts coalesced them,
        // and a bare `undefined` is DROPPED by JSON.stringify, so a customer with
        // no tenants row would have had the keys vanish from the payload rather
        // than read null. Consumers (app-shell's inactive banner,
        // CustomerDashboardExtras' promo gate) treat absent and null the same, so
        // this is a shape fix, not a behaviour change.
        customerStatus: customer?.status ?? null,
        customerName: customer?.customerName ?? null,
        mspId: req.user!.mspId ?? null,
        mspName: servicingMsp?.name ?? null,
        // #3344 — the one real signal the frontend needs to tell "six counts
        // are a true 0 because nothing is due" apart from "six counts are a
        // true 0 because resolveTenantScope(customerId) came back null"
        // (Design's own `no_tenant_scope` state, added to Overview.dc.html
        // after this page was already wired). No such field existed before
        // this — the six counts alone can't disambiguate a real quiet week
        // from an unresolvable tenant identifier.
        tenantScopeResolved: tenantScope !== null,
        // #4067 — the real Copilot Gate, see the computeCopilotGate() call above.
        copilotGate,
        // #2922 — real cross-Feature roll-up counts, see the block above.
        // raciPendingAcceptance is #3049's addition to the same object.
        overviewCounts: {
          rbdWaiting,
          rbdActive,
          microsoftChangesThisWeek,
          changeScheduleThisWeek,
          remediationInProgress,
          policiesExpiringSoon,
          raciPendingAcceptance,
          // #4062
          poamsOverdue,
          poamsApproachingExpiry,
          // #4063
          openRisks,
          openRisksWithPlan,
          // #4064
          sopsRunning,
          sopsQueued,
          sopsExecsThisMonth,
          // #4065
          changeRequestsAwaitingApproval,
          freezeActive,
        },
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: dashboard failed");
      res.status(500).json({ error: "Unable to load dashboard data." });
    }
  },
);

// ── GET /api/portal/diagnostics/results ────────────────────────────────────────

router.get(
  "/portal/diagnostics/results",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    // #1397: enabled modules come from the customer's purchased services, which
    // may sit under any linked login — scope across the whole account.
    const customerUserIds = await resolveCustomerUserIds(customerId);

    try {
      const activeServices = await db
        .select({ typeAttributes: servicesTable.typeAttributes })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(
          and(
            inArray(clientServicesTable.clientUserId, customerUserIds),
            eq(clientServicesTable.status, "active")
          )
        );

      const enabledModules = new Set<string>();
      for (const service of activeServices) {
        const attrs = service.typeAttributes as Record<string, unknown> | null;
        if (attrs && Array.isArray(attrs.enabledModules)) {
          for (const mod of attrs.enabledModules) {
            if (typeof mod === "string") {
              enabledModules.add(mod);
            }
          }
        }
      }

      res.json({
        enabledModules: Array.from(enabledModules),
      });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: diagnostics results failed");
      res.status(500).json({ error: "Unable to load assessment results." });
    }
  },
);

// ── POST /api/portal/customer/offboard ────────────────────────────────────────
// Deactivate services, cancel subscriptions immediately in Stripe, revoke monitoring assignments, and set status to inactive.

router.post(
  "/portal/customer/offboard",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;
    const mspId = req.user!.mspId;
    const userId = req.user!.id;

    if (!customerId || !mspId) {
      res.status(400).json({ error: "Missing customer or MSP association on session" });
      return;
    }

    if (mspId !== 1) {
      res.status(403).json({ error: "Customer offboarding is only available for Shane McCaw Consulting customers." });
      return;
    }

    // #1397: offboarding is a CUSTOMER-level action (steps 4/5 mark the whole
    // tenant inactive by customerId). Cancel/pause services across every login
    // linked to the account, not just the requesting one — otherwise a sibling
    // login's active services (and their Stripe subscriptions) survive an
    // offboard that has already flipped the tenant to inactive.
    const customerUserIds = await resolveCustomerUserIds(customerId);

    try {
      // 1. Find all active or paused client services across the customer account
      const userServices = await db
        .select()
        .from(clientServicesTable)
        .where(
          and(
            inArray(clientServicesTable.clientUserId, customerUserIds),
            or(eq(clientServicesTable.status, "active"), eq(clientServicesTable.status, "paused"))
          )
        );

      let stripeKey: string | null = null;
      try {
        stripeKey = getStripeKey();
      } catch (err) {
        log.warn({ err }, "Stripe not configured during customer offboarding");
      }

      // 2. Cancel Stripe subscriptions
      if (stripeKey && userServices.length > 0) {
        const { default: Stripe } = await import("stripe");
        const stripe = new Stripe(stripeKey);

        for (const cs of userServices) {
          if (cs.stripeSubscriptionId) {
            try {
              await stripe.subscriptions.cancel(cs.stripeSubscriptionId);
              log.info({ stripeSubscriptionId: cs.stripeSubscriptionId }, "Cancelled stripe subscription during customer offboarding");
            } catch (err) {
              log.error({ err, stripeSubscriptionId: cs.stripeSubscriptionId }, "Failed to cancel Stripe subscription");
            }
          }
        }
      }

      // 3. Mark client services status to "paused"
      if (userServices.length > 0) {
        await db
          .update(clientServicesTable)
          .set({ status: "paused" })
          .where(
            and(
              inArray(clientServicesTable.clientUserId, customerUserIds),
              or(eq(clientServicesTable.status, "active"), eq(clientServicesTable.status, "paused"))
            )
          );
      }

      // 4. Disable all monitoring: revoke assignments
      await db
        .update(mspSalesBundleAssignmentsTable)
        .set({
          status: "revoked",
          revokedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(mspSalesBundleAssignmentsTable.customerId, customerId));

      // 5. Set customer status to inactive
      await db
        .update(tenantsTable)
        .set({
          status: "inactive",
          updatedAt: new Date(),
        })
        .where(eq(tenantsTable.id, customerId));

      // 6. Write Audit logs
      void createAuditLog({
        actorUserId: userId,
        actorName: req.user!.name ?? req.user!.email,
        actorRole: "client",
        actionType: "retainer_cancelled",
        entityType: "customer",
        entityId: customerId,
        entityLabel: String(customerId),
        clientId: userId,
      });

      await db.insert(mspAuditLogsTable).values({
        actorUserId: userId,
        actorRole: LEGACY_ROLE.customer,
        mspId: mspId,
        actionType: "customer.offboarding.deactivate",
        entityType: "customer",
        entityId: String(customerId),
        correlationId: getRequestContext()?.traceId ?? randomUUID(),
        outcome: "success",
        metadata: { deactivatedAt: new Date().toISOString() },
      });

      res.json({ ok: true, customerStatus: "inactive" });
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: offboard failed");
      res.status(500).json({ error: "Failed to complete offboarding process" });
    }
  }
);

// ── GET /api/portal/customer/export ──────────────────────────────────────────
// Customer downloads JSON data export package

router.get(
  "/portal/customer/export",
  requireCapability("ladder.customer-user"),
  async (req: Request, res: Response) => {
    const customerId = req.user!.customerId;

    if (!customerId) {
      res.status(400).json({ error: "No customer account associated with this user" });
      return;
    }

    // #1397: scope the data export across every login linked to the customer
    // account, not just the requesting user, so the export reflects the whole
    // organization's services/projects/reports (see resolveCustomerUserIds note
    // on the /portal/dashboard handler above).
    const customerUserIds = await resolveCustomerUserIds(customerId);

    try {
      const [customer] = await db
        .select()
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const clientServices = await db
        .select({
          id: clientServicesTable.id,
          status: clientServicesTable.status,
          purchasedAt: clientServicesTable.purchasedAt,
          serviceName: servicesTable.name,
          billingType: servicesTable.billingType,
          price: servicesTable.price,
        })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(clientServicesTable.serviceId, servicesTable.id))
        .where(inArray(clientServicesTable.clientUserId, customerUserIds));

      const projects = await db
        .select()
        .from(projectsTable)
        .where(inArray(projectsTable.clientUserId, customerUserIds));

      const reports = await db
        .select()
        .from(reportsTable)
        .where(inArray(reportsTable.clientUserId, customerUserIds));

      const snapshots = await db
        .select({
          engineKey: tenantEngineSnapshotsTable.engineKey,
          score: tenantEngineSnapshotsTable.score,
          breakdown: tenantEngineSnapshotsTable.breakdown,
          capturedAt: tenantEngineSnapshotsTable.capturedAt,
        })
        .from(tenantEngineSnapshotsTable)
        .where(eq(tenantEngineSnapshotsTable.customerId, customerId));

      const exportData = {
        exportedAt: new Date().toISOString(),
        customer: {
          name: customer?.customerName,
          domain: customer?.domain,
          industry: customer?.industry,
          tenantId: customer?.tenantId,
          status: customer?.status,
        },
        services: clientServices,
        projects: projects.map(p => ({
          title: p.title,
          status: p.status,
          progress: p.progress,
          createdAt: p.createdAt,
        })),
        reports: reports.map(r => ({
          title: r.title,
          period: r.period,
          createdAt: r.createdAt,
        })),
        diagnostics: snapshots,
      };

      // Category 3 read-boundary event (#4046, #1946): data export/download.
      await createAuditLog({
        actorUserId: req.user!.id,
        actorName: req.user!.email ?? "customer",
        actorRole: "customer",
        actionType: "customer_data_export_downloaded",
        actionCategory: "access",
        entityType: "customer_export",
        tenantId: customerId,
      });

      res.json(exportData);
    } catch (err) {
      log.error({ err, customerId }, "portal-customer-engines: customer-export failed");
      res.status(500).json({ error: "Failed to generate data export" });
    }
  }
);

export default router;
