/**
 * ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
 * This file's POST /portal/diagnostics/debug-trigger-scan route (below) exists
 * only so scan progress can be watched live during development. It is hard-gated
 * to isTestbed=true customers, but must be fully removed before this flow reaches
 * real customers. See backlog: [Shane to add ticket].
 *
 * portal-assessment.ts
 *
 * Customer-facing flow-control endpoint for the Assessment wizard (the shell
 * built in assessment-shell.tsx). This is the *container* backend — it reports
 * where a customer is in the funnel so the wizard can gate its locked,
 * sequential steps. It does NOT generate or return document *content* (that is
 * a later task); it only reports generation status so the wizard knows when to
 * unlock a step.
 *
 * Single route:
 *   GET /api/portal/diagnostics/status
 *     — Everything the wizard polls for:
 *         • scan     : the customer's latest diagnostics run (active or last
 *                      completed) so the wizard can drive the live scan step and
 *                      open the existing diagnostics SSE stream by runId.
 *         • documents: the customer's generated assessment documents with their
 *                      lifecycle status (generating → approved/delivered/failed),
 *                      the established polling signal (insights docs have no
 *                      per-document SSE channel), so the wizard can show the
 *                      "reports generating" wait state and unlock review when done.
 *                      Also carries `expected` — the real titles of every document
 *                      the assessment service will generate (from the service's
 *                      associated-documents mapping), so the wizard can render its
 *                      full generation checklist before any document row exists.
 *         • mfa       : whether the customer has enrolled portal-login MFA, so the
 *                      wizard can enforce the mandatory first-login MFA gate.
 *
 * ID-space note (see the platform's users.id vs msp_customers.id split):
 *   - diagnostics runs are keyed by msp_customers.id  → req.user.customerId claim
 *   - insights documents are keyed by users.id        → req.user.id
 * Both are resolved here from the JWT, server-side, so the client never has to
 * reason about the two id spaces.
 */

import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  mspDiagnosticRunsTable,
  insightsGeneratedDocumentsTable,
  mfaEnrollmentsTable,
  webauthnCredentialsTable,
  tenantsTable,
  tenantMonitorProfilesTable,
  clientServicesTable,
  servicesTable,
  usersTable,
  wfRunsTable,
  wfDefinitionsTable,
  tenantPillarSnapshotsTable,
  type CopilotAssessmentStateMap,
} from "@workspace/db";

/**
 * Name of the seeded Assessment document-generation workflow (see
 * seed-system-workflows.ts). Used to look up the customer's current doc-gen run
 * so the wizard can subscribe to its run-ID progress stream and detect
 * completion/failure via polling (the reliable source of truth).
 */
const ASSESSMENT_DOC_WORKFLOW_NAME =
  "__system__: Assessment Document Generation — Service-Mapped, Sequenced SOW";
import { eq, and, desc, asc, gte, inArray, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";
import { runDiagnostics } from "../lib/diagnostics-runner";
import { isProductionEnvironment } from "../lib/env.ts";
import { randomUUID } from "crypto";
import { getPillarCoverage, PILLAR_LABELS, RADAR_PILLARS, type RadarPillar } from "../lib/pillar-coverage";
// The executor's OWN package→ordered-checks resolver, reused verbatim so the
// scan plan below can never disagree with what the run actually executes (#340).
import { loadOrderedPackageChecks } from "../lib/monitor-executor";
import { buildTelemetryComparison } from "../lib/telemetry-comparison";
import { buildPillarSummary } from "../lib/pillar-summary-stats";
import { resolveLicenseWasteCounts } from "../lib/license-waste-source";
import { computeSkuCostBreakdown, type SkuCostBreakdown } from "../lib/cost-engine";
import { evaluateDocGateCoverage, DOC_GATE_MIN_COVERAGE_PCT } from "../lib/doc-gate-coverage";
import { computeCopilotReadiness, type CopilotReadinessResult } from "../lib/copilot-readiness";
import { computeCopilotGate, copilotGateNotEvaluated, type CopilotGateResult } from "../lib/copilot-gate";
import { generateCopilotReadinessNarrative } from "../lib/copilot-readiness-narrative-generator.ts";
import { generateSecurityPostureNarrative } from "../lib/security-posture-narrative-generator.ts";
// #292 — the four pillar reports' prose sections. Each is the same shape as the
// two above: real data in, up to three attributed Anthropic calls, HTML out.
import { generateGovernancePostureNarrative } from "../lib/governance-posture-narrative-generator.ts";
import { generateComplianceAlignmentNarrative } from "../lib/compliance-alignment-narrative-generator.ts";
import { generateLicensingAlignmentNarrative } from "../lib/licensing-alignment-narrative-generator.ts";
import { generateOperationalHealthNarrative } from "../lib/operational-health-narrative-generator.ts";
import { generateAdoptionNarrative } from "../lib/adoption-narrative-generator.ts";
import type { PillarReportAttribution, PillarReportNarrativeResult } from "../lib/pillar-report-narrative.ts";
import { resolveMspId } from "../lib/resolve-msp-id";
import { resolveBillingMspId } from "../lib/ai-billing";
import { resolveSiblingUserIds } from "../lib/tenant-signals";
import { REQUIRED_MT_SCOPES } from "../lib/graph";
import { REQUIRED_SHAREPOINT_APP_PERMISSIONS } from "../lib/sharepoint-admin";

const log = logger.child({ channel: "engine.dashboard" });
// Payment / checkout for the Assessment SOW belongs on the billing channel per the
// locked logging taxonomy — the SOW flow-control above stays on engine.dashboard.
const billingLog = logger.child({ channel: "billing" });
// isTestbed exposure (below) is an identity/gating check, not flow-control — auth channel.
const authLog = logger.child({ channel: "auth" });

const router: IRouter = Router();

/** Resolve the customer's msp_customers.id from their JWT claim (diagnostics id space). */
function resolveCustomerId(req: Request): number | null {
  const id = (req.user as { customerId?: number } | undefined)?.customerId;
  return typeof id === "number" && !isNaN(id) ? id : null;
}

// Run statuses that mean "a scan is in flight right now" vs "finished with data".
const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;
const COMPLETED_RUN_STATUSES = ["completed", "partial"] as const;

// Document statuses that count as "finished generating, ready to review".
const READY_DOC_STATUSES = ["approved", "delivered"] as const;

// Trailing window /portal/diagnostics/history looks back — 12 weeks, matching
// the weekly Copilot Assessment rescan's own cadence (#1058).
const HISTORY_WINDOW_DAYS = 12 * 7;

router.get(
  "/portal/diagnostics/status",
  // Floor is Assessment (the lowest role); CustomerUser/Free above it also carry
  // a customerId and may read their own status. MSP-side roles have no customerId
  // claim and fall through to the 403 below.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    const userId = req.user?.id;
    if (customerId === null || userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // ── Scan state (msp_customers.id space) ──────────────────────────────
      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const [lastCompleted] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            inArray(mspDiagnosticRunsTable.status, [...COMPLETED_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const scanActive =
        latestRun != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(latestRun.status);

      // ── Document state (users.id space, read CUSTOMER-scoped) ────────────
      // Non-archived docs only; archived rows are superseded regenerations that
      // should not hold the wizard open or count toward readiness.
      // insights_generated_documents.customerId is a users.id-shaped FK, but
      // the documents belong to the CUSTOMER — a customer with multiple linked
      // logins must see the same document set from any of them (and documents
      // that historically landed under an arbitrarily-resolved sibling user
      // must not be invisible to the real primary user).
      const docScopeUserIds = await resolveSiblingUserIds(userId);
      const docRows = await db
        .select({
          id: insightsGeneratedDocumentsTable.id,
          docType: insightsGeneratedDocumentsTable.docType,
          category: insightsGeneratedDocumentsTable.category,
          title: insightsGeneratedDocumentsTable.title,
          status: insightsGeneratedDocumentsTable.status,
          createdAt: insightsGeneratedDocumentsTable.createdAt,
        })
        .from(insightsGeneratedDocumentsTable)
        .where(inArray(insightsGeneratedDocumentsTable.customerId, docScopeUserIds))
        .orderBy(insightsGeneratedDocumentsTable.createdAt);

      const documents = docRows.filter((d) => d.status !== "archived");
      const generatingCount = documents.filter((d) => d.status === "generating").length;
      const readyCount = documents.filter((d) =>
        (READY_DOC_STATUSES as readonly string[]).includes(d.status),
      ).length;
      const failedCount = documents.filter((d) => d.status === "failed").length;

      // ── Expected document set (users.id space) ────────────────────────────
      // The customer's assessment-tier service's associated-documents mapping —
      // the same source `find_object "service"` reads for the generation
      // workflow's `documentsToGenerate` — resolved the same way
      // `assessment_doc_gate` resolves the assessment serviceId (client_services
      // joined to services where deliveryType='assessment'). Exposed so the
      // wizard can render the full generation checklist by real title from the
      // moment the customer lands here, not only once each document row exists.
      // Excludes the SOW type (always generated last, listed separately) and any
      // customerVisible:false entry (internal-only docs the customer never sees —
      // same filter `build_doc_list` uses for the final presentation); those
      // internal docs still count toward `allReady` below since that reads the
      // real doc rows, not this list.
      const [assessmentService] = await db
        .select({ associatedDocuments: servicesTable.associatedDocuments })
        .from(clientServicesTable)
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(and(inArray(clientServicesTable.clientUserId, docScopeUserIds), eq(servicesTable.deliveryType, "assessment")))
        .orderBy(desc(clientServicesTable.id))
        .limit(1);
      const isSowDocType = (dt: string) => dt === "sow" || dt === "consolidated_sow" || dt === "scoped_sow";
      const expectedDocuments = (assessmentService?.associatedDocuments ?? [])
        .filter((d) => d && typeof d.docType === "string" && d.customerVisible !== false && !isSowDocType(d.docType))
        .map((d) => ({ docType: d.docType, title: d.title }));

      // ── Doc-generation workflow run (for live progress + terminal state) ──
      // Match the seeded workflow's most recent run for this customer via the
      // trigger payload: diagnostics.run_completed carries customerId (msp_customers.id),
      // portal.first_login carries userId (users.id). The run ID lets the wizard
      // subscribe to the run-scoped SSE stream (client_presentations doesn't exist
      // until the very end, so the run ID is the only stable early handle). The run
      // status is the reliable, poll-based terminal signal (failed/cancelled →
      // failure screen; completed + allReady → success).
      const [docWfRun] = await db
        .select({ id: wfRunsTable.id, status: wfRunsTable.status })
        .from(wfRunsTable)
        .innerJoin(wfDefinitionsTable, eq(wfDefinitionsTable.id, wfRunsTable.definitionId))
        .where(
          and(
            eq(wfDefinitionsTable.name, ASSESSMENT_DOC_WORKFLOW_NAME),
            sql`(${wfRunsTable.payload}->>'customerId' = ${String(customerId)} OR ${wfRunsTable.payload}->>'userId' = ${String(userId)} OR ${wfRunsTable.payload}->>'clientUserId' = ${String(userId)})`,
          ),
        )
        .orderBy(desc(wfRunsTable.id))
        .limit(1);

      // ── MFA enrollment state (users.id space) ────────────────────────────
      // Only the two customer-offered methods count toward the gate: Authenticator
      // (TOTP) and Passkey. SMS is intentionally excluded (no SMS vendor is wired
      // for this flow). A passkey enrollment writes both a webauthn_credentials
      // row and an mfa_enrollments(method:"passkey") row, so the enrollments table
      // alone is authoritative; the credentials table is checked as a belt-and-
      // suspenders fallback.
      const enrollments = await db
        .select({ method: mfaEnrollmentsTable.method })
        .from(mfaEnrollmentsTable)
        .where(
          and(
            eq(mfaEnrollmentsTable.userId, userId),
            eq(mfaEnrollmentsTable.enabled, true),
            inArray(mfaEnrollmentsTable.method, ["totp", "passkey"]),
          ),
        );
      const [passkey] = await db
        .select({ id: webauthnCredentialsTable.id })
        .from(webauthnCredentialsTable)
        .where(eq(webauthnCredentialsTable.userId, userId))
        .limit(1);
      const mfaEnrolled = enrollments.length > 0 || passkey != null;

      // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
      // isTestbed is exposed here only so the wizard can show the debug scan
      // trigger button to testbed customers. Remove alongside that button.
      const [customerRow] = await db
        .select({ isTestbed: tenantsTable.isTestbed })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      // ── Real pillar coverage (radar) + real stat cards ────────────────────
      // Gated on the SAME graded evaluable-check coverage as assessment_doc_gate
      // and the CIO narrative trigger (see doc-gate-coverage.ts): the most recent
      // completed-or-partial run is graded via evaluateDocGateCoverage, and only
      // a run that clears DOC_GATE_MIN_COVERAGE_PCT is used to compute pillar
      // scores or cost data. Previously this block ran off bare `lastCompleted`
      // (any completed OR partial run, regardless of how little of it was real
      // signal) — inconsistent with the doc gate / CIO narrative, which already
      // require graded "sufficient" coverage. A run below the bar now honestly
      // renders "not covered" / "awaiting scan" instead of surfacing partial
      // pillar data computed off a mostly-dark run.
      let runCoverage: ReturnType<typeof evaluateDocGateCoverage> | null = null;
      if (lastCompleted) {
        runCoverage = evaluateDocGateCoverage({
          checksOk: lastCompleted.checksOk ?? 0,
          checksLicenseGap: lastCompleted.checksLicenseGap ?? 0,
          checksError: lastCompleted.checksError ?? 0,
          checksTotal: lastCompleted.checksTotal ?? 0,
        });
      }
      const coverageRun = runCoverage?.proceed ? lastCompleted : null;

      // #1107: while a first scan is genuinely running, `lastCompleted` (and so
      // `coverageRun`) is null for the run's entire duration — `pillarCoverage`
      // below stayed `[]` the whole time, which is why the customer-facing page
      // showed a static pre-scan empty state instead of pillar scores building
      // as checks land. `getPillarCoverage` itself is NOT completion-gated (it
      // reads `tenant_monitor_profiles` rows that land the instant each check
      // finishes — the same live computation `/portal/pillars` already relies
      // on); only this route's own choice of which run to source it from was.
      // Widen the source to the run currently being scanned whenever there is
      // no completed+sufficient-coverage run yet, so a pillar can appear the
      // moment it clears `evaluatePillarDisplay`'s own honesty floor rather
      // than waiting for the run to finish.
      const pillarSourceRun = coverageRun ?? (scanActive ? latestRun : null);

      let pillarCoverage: Awaited<ReturnType<typeof getPillarCoverage>> = [];
      let genuineFindings: number | null = null;
      let licenseWasteMonthlyCents: number | null = null;
      // Cost-engine breakdown summary behind licenseWasteMonthlyCents — same
      // computation, richer surface (wasted-seat count, per-SKU count, top SKU
      // line) so the page's License Optimization card can show real specifics,
      // not just the total. Null whenever the total is (no real data yet).
      let licenseWaste: {
        monthlyCents: number;
        annualCents: number;
        seatCount: number;
        skuCount: number;
        /** monitor_checks.key the seat counts were actually read from. */
        sourceCheckKey: string;
        topSku: { displayName: string; count: number; monthlyCents: number } | null;
      } | null = null;
      // Real Copilot-readiness sub-indicators (see copilot-readiness.ts for the
      // backing checks, band-scoring rationale, and the 50/30/20 weighting).
      // These are DETAIL only — the overall figure below no longer comes from
      // their weighted mean; see the copilotGate note.
      let copilotReadiness: CopilotReadinessResult | null = null;
      // The real Copilot Gate (#358/#359): the unified health engine's own
      // `copilot` pillar display score, gated at 82. This is the SAME number
      // /portal/pillars serves for its copilot card — one
      // engine, one computation, so the Reveal's headline verdict and its six
      // pillar scenes can no longer disagree about the tenant in front of them.
      // Keyed by customerId (the engine's own id space), not tenantId, and so
      // it is available even for a customer whose last run carries no tenantId.
      // #517: the pre-scan default says WHAT it could not measure, so a customer
      // who has never completed a scan gets copy about that rather than the same
      // shrug a tenant with a broken engine gets.
      let copilotGateResult: CopilotGateResult = copilotGateNotEvaluated(
        "no completed scan for this customer yet — nothing has been measured",
      );

      if (pillarSourceRun) {
        pillarCoverage = await getPillarCoverage(pillarSourceRun.packageKey, customerId).catch((err) => {
          log.warn({ err, customerId }, "GET /portal/diagnostics/status: pillar coverage computation failed");
          return [];
        });
      }

      if (lastCompleted) {
        const runSummary = (lastCompleted.summary as Record<string, unknown> | null | undefined) ?? null;
        genuineFindings =
          runSummary != null
            ? Number(runSummary.criticalCount ?? 0) + Number(runSummary.warningCount ?? 0)
            : null;

        if (coverageRun?.tenantId) {
          try {
            // The wasted-seat counts do NOT necessarily live on
            // "cost:license-waste-estimate" — monitor check keys are DATA, and
            // the live catalog's real waste check may be keyed differently.
            // resolveLicenseWasteCounts finds the check that genuinely holds
            // SKU-keyed seat data (see license-waste-source.ts) and reports
            // which one it used.
            const wasteSource = await resolveLicenseWasteCounts(coverageRun.tenantId);
            if (wasteSource) {
              const breakdown: SkuCostBreakdown = await computeSkuCostBreakdown(wasteSource.counts);
              if (breakdown.totalMonthlyCents > 0) {
                licenseWasteMonthlyCents = breakdown.totalMonthlyCents;
                // Priced lines only — a line with no price on file contributes
                // nothing to the dollar total, so it must not inflate the seat
                // count shown next to that total (cost-engine's own honesty rule).
                const pricedLines = breakdown.lines.filter(
                  (l): l is typeof l & { totalMonthlyPriceCents: number } => l.totalMonthlyPriceCents != null,
                );
                const topLine = [...pricedLines].sort(
                  (a, b) => b.totalMonthlyPriceCents - a.totalMonthlyPriceCents,
                )[0];
                licenseWaste = {
                  monthlyCents: breakdown.totalMonthlyCents,
                  annualCents: breakdown.totalAnnualCents,
                  seatCount: pricedLines.reduce((s, l) => s + l.count, 0),
                  skuCount: pricedLines.length,
                  // Provenance — which real monitor check the seat counts came
                  // from, so a dollar figure is never unattributed.
                  sourceCheckKey: wasteSource.checkKey,
                  topSku: topLine
                    ? {
                        displayName: topLine.displayName,
                        count: topLine.count,
                        monthlyCents: topLine.totalMonthlyPriceCents,
                      }
                    : null,
                };
              }
            }
          } catch (err) {
            log.warn({ err, customerId }, "GET /portal/diagnostics/status: license waste computation failed");
          }

          copilotReadiness = await computeCopilotReadiness(coverageRun.tenantId).catch((err) => {
            log.warn({ err, customerId }, "GET /portal/diagnostics/status: copilot readiness computation failed");
            return null;
          });
        }

        // Deliberately OUTSIDE the `coverageRun?.tenantId` guard above: the
        // engine is keyed by customerId (its own id space), so a completed run
        // that carries no tenantId still has a real Copilot pillar score. It
        // never throws — see computeCopilotGate.
        copilotGateResult = await computeCopilotGate(customerId);
      }

      res.json({
        scan: {
          active: scanActive,
          runId: scanActive ? latestRun.runId : null,
          status: latestRun?.status ?? null,
          startedAt: scanActive ? latestRun.startedAt : null,
          checksTotal: latestRun?.checksTotal ?? null,
          checksOk: latestRun?.checksOk ?? null,
          checksError: latestRun?.checksError ?? null,
          // Checks that couldn't run because the tenant lacks the required M365
          // add-on (Entra Premium, Defender, …). Reported separately so the wizard
          // can honestly distinguish "unavailable — missing license" from real
          // findings, and name the missing feature(s) as an upsell rather than a
          // scary red count. Sourced from the same run row + its summary, not
          // re-derived on the client.
          checksLicenseGap: latestRun?.checksLicenseGap ?? null,
          licenseGapFeatures:
            ((latestRun?.summary as Record<string, unknown> | null | undefined)?.licenseGapFeatures as string[] | undefined) ?? [],
          lastScanAt: lastCompleted ? (lastCompleted.completedAt ?? lastCompleted.createdAt) : null,
          everScanned: latestRun != null,
        },
        // CIO-Report Narrative — the "senior M365 Architect" narrative of this
        // customer's real, already-classified findings, generated by
        // cio-narrative-generator.ts as soon as the scan (lastCompleted) itself
        // finishes, independent of how long document generation still has left.
        // Sourced from lastCompleted (not latestRun) since a still-active rescan
        // must not blank out a real, already-generated narrative from the prior
        // completed run.
        narrative: {
          status: lastCompleted?.cioNarrativeStatus ?? "not_started",
          html: lastCompleted?.cioNarrativeHtml ?? null,
          generatedAt: lastCompleted?.cioNarrativeGeneratedAt ?? null,
        },
        documents: {
          items: documents.map((d) => ({
            id: d.id,
            docType: d.docType,
            category: d.category,
            title: d.title,
            status: d.status,
          })),
          expected: expectedDocuments,
          total: documents.length,
          generating: generatingCount,
          ready: readyCount,
          failed: failedCount,
          // "Reports are done" = at least one finished document and nothing still
          // generating. Zero documents means generation hasn't started yet, so the
          // wizard stays in the wait state.
          allReady: documents.length > 0 && generatingCount === 0 && readyCount > 0,
          // Live doc-generation workflow run — run ID to subscribe to the SSE
          // progress stream, and its status as the reliable terminal signal.
          workflowRunId: docWfRun?.id ?? null,
          workflowStatus: docWfRun?.status ?? null,
        },
        // ── Document-generation coverage decision (honest, never a silent hang) ─
        // Grades the last completed run's real evaluable-check coverage with the
        // SAME helper the doc gate uses. `blocked` is the honest terminal signal
        // that a scan finished but was too dark (below DOC_GATE_MIN_COVERAGE_PCT)
        // to responsibly generate documents — so the wizard can say so plainly
        // instead of waiting forever for documents that will never come. Null
        // until a scan finishes; never `blocked` once real documents exist.
        docGeneration: runCoverage
          ? {
              blocked:
                !runCoverage.proceed && readyCount === 0 && generatingCount === 0,
              band: runCoverage.band,
              coveragePct: runCoverage.coveragePct,
              evaluableChecks: runCoverage.evaluableChecks,
              totalChecks: runCoverage.totalChecks,
              minRequiredPct: DOC_GATE_MIN_COVERAGE_PCT,
            }
          : null,
        mfa: {
          enrolled: mfaEnrolled,
          // Git #439 — real prod/dev signal (REPLIT_DOMAINS, same formula as
          // stripe.ts's getStripeKey) replacing the wizard's old hardcoded
          // SKIP_MFA_GATE_FOR_TESTING bypass constant.
          gateRequired: isProductionEnvironment(),
        },
        // Real tenant-health radar — only pillars this customer's actual scanned
        // package genuinely covers (see pillar-coverage.ts). Empty until a
        // package has real monitoring_package_checks rows curated for it; never
        // padded with fabricated axes.
        radar: {
          packageKey: pillarSourceRun?.packageKey ?? null,
          pillars: pillarCoverage,
        },
        // Real stat cards — every number traces to a completed run's own
        // persisted summary or a live cost-engine query; null means "no real
        // data yet", never a placeholder.
        stats: {
          genuineFindings,
          licenseWasteMonthlyCents,
          licenseWaste,
        },
        // Real Copilot-readiness sub-indicators — every sub-score traces to
        // genuinely-collected checks (or is null); see copilot-readiness.ts.
        // Null until a completed scan with a tenant.
        //
        // `overall.score` is the UNIFIED ENGINE's Copilot pillar score (#358),
        // NOT the 50/30/20 weighted mean of the three sub-indicators. That mean
        // is still returned, as `overall.indicatorScore`, because it is a real
        // figure about a real, narrower thing — but it is no longer the number
        // anything calls "Copilot readiness", because it never covered Security,
        // Licensing, Adoption, Health or Governance ownership, and the Reveal
        // was presenting it as the roll-up of six pillar scores it shared no
        // arithmetic with. `weights` and `coveredIndicators` continue to
        // describe `indicatorScore`, which is the only thing they ever described.
        copilotReadiness: copilotReadiness
          ? {
              ...copilotReadiness,
              overall: {
                ...copilotReadiness.overall,
                score: copilotGateResult.score,
                source: copilotGateResult.source,
                indicatorScore: copilotReadiness.overall.score,
              },
            }
          : null,
        // The real Copilot Gate. `status` is "go" at or above `threshold` (82,
        // confirmed by Shane — 82 itself is a Go), "no_go" below it, and null
        // when there is no score to gate on. Every Gate display across the
        // funnel reads this one verdict rather than re-deriving its own.
        //
        // `evaluation` (#517) is the explicit real-coverage status behind that:
        // "scored" / "insufficient_data" / "not_evaluated", with the real
        // evaluable-signal count and a plain-language reason. The client renders
        // an honest no-score state from it instead of having to guess which kind
        // of nothing a null `score` is — and the server never sends a computed
        // number for a tenant it did not genuinely measure.
        copilotGate: copilotGateResult,
        // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see note above)
        isTestbed: customerRow?.isTestbed === true,
      });
    } catch (err) {
      log.error({ err, customerId, userId }, "GET /portal/diagnostics/status failed");
      res.status(500).json({ error: "Failed to load assessment status" });
    }
  },
);

// ── Pillar display-score history (#1106) ─────────────────────────────────────
//
//   GET /api/portal/pillars/history
//
// The customer's real first-scan-to-today trend of the 0-100 pillar DISPLAY
// scores — the same numbers PillarGrid / HeroHealthScore / the radar show live.
// Served from tenant_pillar_snapshots, which pillar-snapshot.ts writes one row
// per pillar each time a scan completes with sufficient coverage (the honesty
// gate). Read-side only: this issue is the capture mechanism + this endpoint;
// the frontend chart wiring is a separate, later concern.
//
// Deliberately a SEPARATE table/series from the raw-engine "Security Risk Points"
// that /api/dashboard/resolve serves (#1101) — those are unbounded, lower-is-
// better, non-customer-facing. No backfill: a tenant with no snapshots yet gets
// empty `pillars` and renders "not enough history yet" downstream — never a
// fabricated point.
router.get(
  "/portal/pillars/history",
  // Same floor as /portal/diagnostics/status — the assessment wizard's own role.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const snapshots = await db
        .select({
          pillarKey: tenantPillarSnapshotsTable.pillarKey,
          score: tenantPillarSnapshotsTable.score,
          previousScore: tenantPillarSnapshotsTable.previousScore,
          delta: tenantPillarSnapshotsTable.delta,
          trendDirection: tenantPillarSnapshotsTable.trendDirection,
          capturedAt: tenantPillarSnapshotsTable.capturedAt,
        })
        .from(tenantPillarSnapshotsTable)
        .where(eq(tenantPillarSnapshotsTable.customerId, customerId))
        // Oldest → newest so each pillar's points chart left-to-right without
        // client-side re-sorting (matches resolveMetricHistory's contract).
        .orderBy(asc(tenantPillarSnapshotsTable.capturedAt));

      // Group into one series per pillar. Keep the RADAR_PILLARS order and only
      // emit a pillar that genuinely has at least one recorded point — a pillar
      // never scored for this tenant is absent, not a zero-line.
      const byPillar = new Map<
        string,
        { t: string; score: number; previousScore: number | null; delta: number | null; trendDirection: string | null }[]
      >();
      for (const row of snapshots) {
        const points = byPillar.get(row.pillarKey) ?? [];
        points.push({
          t: row.capturedAt.toISOString(),
          score: row.score,
          previousScore: row.previousScore,
          delta: row.delta,
          trendDirection: row.trendDirection,
        });
        byPillar.set(row.pillarKey, points);
      }

      const orderedKeys: string[] = [
        ...RADAR_PILLARS.filter((p) => byPillar.has(p)),
        // Any pillar key present in data but not in the known radar set (future-
        // proofing) is appended after, so it's never silently dropped.
        ...[...byPillar.keys()].filter((k) => !(RADAR_PILLARS as readonly string[]).includes(k)),
      ];

      const pillars = orderedKeys.map((key) => ({
        pillar: key,
        label: PILLAR_LABELS[key as RadarPillar] ?? key,
        points: byPillar.get(key) ?? [],
      }));

      res.json({ pillars });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/pillars/history failed");
      res.status(500).json({ error: "Failed to load pillar history" });
    }
  },
);

// ── Telemetry right-panel comparison (#245) ──────────────────────────────────
//
//   GET /api/portal/diagnostics/telemetry-comparison
//
// The four right-panel elements of the Copilot Assessment telemetry page —
// Score gauges, Multi-Dimension Radar, Dimension Gap Analysis, Top
// Discrepancies — computed from the REAL health engine and the customer's REAL
// diagnostic findings. See lib/telemetry-comparison.ts for the full provenance
// note (no new scoring formula; why it is genuinely live mid-scan; and why
// `selfAssessment` is null pending Shane's design decision).
//
// Deliberately a separate route from /portal/diagnostics/status rather than more
// fields on it: this one is re-fetched repeatedly WHILE a scan runs (the panel
// updates as checks land), and status already carries the wizard's whole
// heavyweight payload — documents, cost engine, copilot readiness, SOW state —
// none of which changes per check.
router.get(
  "/portal/diagnostics/telemetry-comparison",
  // Same floor as /portal/diagnostics/status — the assessment wizard's own role.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      res.json(await buildTelemetryComparison(customerId));
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/diagnostics/telemetry-comparison failed");
      res.status(500).json({ error: "Failed to compute telemetry comparison" });
    }
  },
);

// ── Pillar summary cards (#320, epic #302) ────────────────────────────────────
//
//   GET /api/portal/pillars
//
// The seven completed-scan pillar cards — each card's SCORE and its four STAT
// CALLOUTS — computed from the REAL health engine (the same
// `computePillarDisplayScore` path #245 already uses, no new formula) and the
// customer's REAL `tenant_monitor_profiles` / `msp_diagnostic_findings` rows.
// See lib/pillar-summary-stats.ts for the per-stat provenance table, including
// which of the original fictional callouts had no real producer at all.
//
// A separate route from telemetry-comparison for the same reason that one is
// separate from /status: it resolves ~20 distinct monitor metrics plus the seat
// arithmetic, which the telemetry panel neither needs nor should pay for.
router.get(
  "/portal/pillars",
  // Same floor as the telemetry panel — the assessment/pillar-summary role.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      res.json(await buildPillarSummary(customerId));
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/pillars failed");
      res.status(500).json({ error: "Failed to compute pillar summary" });
    }
  },
);

// ── Copilot Readiness report — the three AI-written prose sections (#409) ─────
//
//   GET /api/portal/diagnostics/copilot-readiness-narrative
//
// The Copilot Readiness, Safety & Enablement Report's three prose sections —
// Copilot Safety & Exposure, Workflow Enablement & Value, Gate Blockers &
// Remediation Path. The report's OTHER sections (the readiness summary, the
// pillar table, the technical prerequisites and the blast-radius row) are pure
// data and are rendered client-side straight from `/portal/pillars`; nothing
// about them needs, or goes anywhere near, an AI call.
//
// Deliberately its OWN route rather than a field on /status: it makes up to
// three real Anthropic calls, and /status is polled every 4s while documents
// generate. Fetched once by the viewer when the report is opened.
//
// GET rather than POST despite the side effect (metered AI usage): the caller
// supplies nothing. Every number the prose is grounded in is recomputed
// server-side from this customer's own real data — see the generator's header
// for why a narrative grounded in request-supplied figures is a narrative
// anyone can dictate.
router.get(
  "/portal/diagnostics/copilot-readiness-narrative",
  // Same floor as the pillar stats it is grounded in.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // The customer's real company name, from the same column the dashboard
      // and the War Room read. Falls back to the generic label the journey
      // already uses rather than inventing an organisation.
      const [tenantRow] = await db
        .select({ customerName: tenantsTable.customerName })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const user = req.user!;
      const result = await generateCopilotReadinessNarrative({
        customerId,
        tenantName: tenantRow?.customerName?.trim() || "this tenant",
        attribution: {
          mspId: resolveBillingMspId(user) ?? (await resolveMspId(req)),
          customerId,
          triggerSource: "copilot-readiness-report",
        },
      });
      res.json(result);
    } catch (err) {
      // Only reached when the REAL data behind the prose could not be read at
      // all. A thin or empty tenant is not an error — the generator returns
      // omitted sections with a machine reason and the viewer says so.
      log.error({ err, customerId }, "GET /portal/diagnostics/copilot-readiness-narrative failed");
      res.status(500).json({ error: "Failed to generate the Copilot readiness narrative" });
    }
  },
);

// ── Security Posture report — prose sections + Secure Score (#343) ────────────
//
//   GET /api/portal/diagnostics/security-posture-narrative
//
// The Microsoft 365 Security Posture & Blast Radius Report's three prose
// sections — the Summary's opening paragraph, the Blast Radius section's causal
// explanation, and the Copilot Readiness Impact section's connection to the
// Gate score — plus the one real metric the report needs that
// `/portal/pillars` does not carry (Microsoft Secure Score; see the
// generator's header for why it is resolved here rather than added to the pillar
// summary spec list).
//
// Every OTHER row in that report — the identity and endpoint figures, the
// findings, the blast-radius row, the Upgrade Opportunity category — is pure
// data rendered client-side straight from `/portal/pillars`, and goes nowhere
// near an AI call.
//
// Deliberately its OWN route rather than a field on /status, and GET despite
// the metered side effect, for the same two reasons as its Copilot sibling
// above: /status is polled every 4s, and the caller supplies nothing — every
// number the prose is grounded in is recomputed server-side from this
// customer's own real data.
router.get(
  "/portal/diagnostics/security-posture-narrative",
  // Same floor as the pillar stats it is grounded in.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [tenantRow] = await db
        .select({ customerName: tenantsTable.customerName })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const user = req.user!;
      const result = await generateSecurityPostureNarrative({
        customerId,
        tenantName: tenantRow?.customerName?.trim() || "this tenant",
        attribution: {
          mspId: resolveBillingMspId(user) ?? (await resolveMspId(req)),
          customerId,
          triggerSource: "security-posture-report",
        },
      });
      res.json(result);
    } catch (err) {
      // Only reached when the REAL data behind the report could not be read at
      // all. A thin or empty tenant is not an error — the generator returns
      // omitted sections with a machine reason and the viewer says so.
      log.error({ err, customerId }, "GET /portal/diagnostics/security-posture-narrative failed");
      res.status(500).json({ error: "Failed to generate the security posture narrative" });
    }
  },
);

// ── The pillar reports' prose sections (#292, extended) ───────────────────────
//
//   GET /api/portal/diagnostics/governance-posture-narrative
//   GET /api/portal/diagnostics/compliance-alignment-narrative
//   GET /api/portal/diagnostics/licensing-alignment-narrative
//   GET /api/portal/diagnostics/operational-health-narrative
//   GET /api/portal/diagnostics/adoption-narrative
//
// Five routes with one body, registered by the helper below rather than written
// out five times. They differ ONLY in which generator they call and what the log
// line says: every one of them resolves the same customer identity from the same
// JWT claim, reads the same `tenants.customer_name`, attributes to the same
// billing msp, and fails the same way. Five copies of that would be five places
// for the 403 guard or the error handling to drift.
//
// Each report's OTHER content — every metric row, every finding, every declared
// gap, the whole Upgrade Opportunity category — is pure data rendered
// client-side straight from `/portal/pillars`, and goes nowhere near an AI
// call.
//
// Deliberately their OWN routes rather than fields on /status, and GET despite
// the metered side effect, for the same two reasons as their two predecessors:
// /status is polled every 4s while documents generate, and the caller supplies
// nothing — every number the prose is grounded in is recomputed server-side from
// this customer's own real data. A narrative grounded in request-supplied
// figures is a narrative anyone can dictate.
function registerPillarReportNarrativeRoute(
  path: string,
  triggerSource: string,
  generate: (params: {
    customerId: number;
    tenantName: string;
    attribution: PillarReportAttribution;
  }) => Promise<PillarReportNarrativeResult>,
): void {
  router.get(
    path,
    // Same floor as the pillar stats it is grounded in.
    requireRole("Assessment"),
    async (req: Request, res: Response): Promise<void> => {
      const customerId = resolveCustomerId(req);
      if (customerId === null) {
        res.status(403).json({ error: "No customer identity on token" });
        return;
      }

      try {
        // The customer's real company name, from the same column the dashboard
        // and the War Room read. Falls back to the generic label the journey
        // already uses rather than inventing an organisation.
        const [tenantRow] = await db
          .select({ customerName: tenantsTable.customerName })
          .from(tenantsTable)
          .where(eq(tenantsTable.id, customerId))
          .limit(1);

        const user = req.user!;
        const result = await generate({
          customerId,
          tenantName: tenantRow?.customerName?.trim() || "this tenant",
          attribution: {
            mspId: resolveBillingMspId(user) ?? (await resolveMspId(req)),
            customerId,
            triggerSource,
          },
        });
        res.json(result);
      } catch (err) {
        // Only reached when the REAL data behind the report could not be read at
        // all. A thin or empty tenant is not an error — the generator returns
        // omitted sections with a machine reason and the viewer says so.
        log.error({ err, customerId }, `GET ${path} failed`);
        res.status(500).json({ error: `Failed to generate the ${triggerSource} narrative` });
      }
    },
  );
}

registerPillarReportNarrativeRoute(
  "/portal/diagnostics/governance-posture-narrative",
  "governance-posture-report",
  generateGovernancePostureNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/diagnostics/compliance-alignment-narrative",
  "compliance-alignment-report",
  generateComplianceAlignmentNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/diagnostics/licensing-alignment-narrative",
  "licensing-alignment-report",
  generateLicensingAlignmentNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/diagnostics/operational-health-narrative",
  "operational-health-report",
  generateOperationalHealthNarrative,
);
// The seventh live-rendered report, and the only one whose pillar card carries
// no measured stats at all — `PILLAR_STAT_SPECS.adoption` is an empty
// array by decision, not by omission. It needs nothing special here: the
// grounding, the fact floor and the omission reasons are the same, and a
// section that reaches the floor on the pillar score and its findings alone is
// exactly the case `MIN_FACTS_FOR_NARRATIVE` was set to 1 for.
registerPillarReportNarrativeRoute(
  "/portal/diagnostics/adoption-narrative",
  "adoption-report",
  generateAdoptionNarrative,
);

// ── Shell-wide scan status (lightweight, poll every 30-60s from app-shell.tsx) ─
//
//   GET /api/portal/scan-status
//
// Deliberately minimal sibling of /portal/diagnostics/status above — that route
// pulls the full assessment-wizard payload (documents, radar, cost engine,
// copilot readiness, etc.) and is too heavy to poll from every page in the
// shell. This route reads only the customer's latest msp_diagnostic_runs row,
// so the persistent shell indicator (last-scan-time / no-scan pill / live
// progress bar) can poll cheaply without re-deriving the whole wizard state.
router.get(
  "/portal/scan-status",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    // users.id — needed only for the doc-workflow run lookup below, whose trigger
    // payload can carry either id space. Absent on a token without it; the OR
    // predicate then simply never matches on the userId legs.
    const userId = req.user?.id ?? null;
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [latestRun] = await db
        .select()
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const [lastCompleted] = await db
        .select({
          completedAt: mspDiagnosticRunsTable.completedAt,
          createdAt: mspDiagnosticRunsTable.createdAt,
        })
        .from(mspDiagnosticRunsTable)
        .where(
          and(
            eq(mspDiagnosticRunsTable.customerId, customerId),
            inArray(mspDiagnosticRunsTable.status, [...COMPLETED_RUN_STATUSES]),
          ),
        )
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      const active =
        latestRun != null && (ACTIVE_RUN_STATUSES as readonly string[]).includes(latestRun.status);

      // ⚠️ TEMPORARY TESTING BYPASS — REMOVE BEFORE PRODUCTION ⚠️
      // isTestbed is exposed here only so the shell-wide scan-trigger button can
      // gate itself to testbed customers. Remove alongside that button.
      // Both consent grants come off this same row — they are two keys of the
      // tenant's `consent` jsonb column since Phase 0 folded the three consent
      // tables into it (#92/#99), so the two extra per-type lookups this used
      // to do are gone.
      const [customerRow] = await db
        .select({ isTestbed: tenantsTable.isTestbed, tenantId: tenantsTable.tenantId, consent: tenantsTable.consent })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      // ── Doc-generation workflow run (id + status) ─────────────────────────
      // Deliberately the SAME query shape /portal/diagnostics/status already uses
      // for `docWfRun` (see the block above it) — same workflow name, same
      // three-legged trigger-payload predicate, same "most recent run" ordering.
      // Not a second lookup shape and not a new stream: it exists so the Copilot
      // Assessment telemetry page can subscribe to the ALREADY-LIVE run-scoped
      // stream (GET /portal/diagnostics/doc-workflow/:runId/sse) the old wizard
      // subscribes to today, without having to poll the heavyweight
      // /portal/diagnostics/status payload from a page that only needs the run id.
      // Additive and optional at the wire boundary, exactly like lastRunSummary.
      const [docWfRun] = await db
        .select({ id: wfRunsTable.id, status: wfRunsTable.status })
        .from(wfRunsTable)
        .innerJoin(wfDefinitionsTable, eq(wfDefinitionsTable.id, wfRunsTable.definitionId))
        .where(
          and(
            eq(wfDefinitionsTable.name, ASSESSMENT_DOC_WORKFLOW_NAME),
            sql`(${wfRunsTable.payload}->>'customerId' = ${String(customerId)} OR ${wfRunsTable.payload}->>'userId' = ${String(userId ?? "")} OR ${wfRunsTable.payload}->>'clientUserId' = ${String(userId ?? "")})`,
          ),
        )
        .orderBy(desc(wfRunsTable.id))
        .limit(1);

      let consentStatus: string | null = null;
      let scopesStale = false;
      // SharePoint Online is a SEPARATE Azure resource from Graph
      // (00000003-0000-0ff1-ce00-000000000000), consented independently and
      // recorded under its own `sharepoint` key. It is deliberately NOT derived
      // from the `graph` key: a granted Graph consent says nothing about whether
      // Sites.FullControl.All was ever approved, so reading it off the Graph
      // grant would report every pre-existing tenant as SharePoint-consented
      // when none of them are.
      // null = key absent (genuinely never consented, a reportable state);
      // undefined = could not be read at all (omitted from the payload → unknown).
      let sharePointConsentStatus: string | null | undefined = null;
      let sharePointPermissionsStale = false;
      if (customerRow?.tenantId) {
        const consent = customerRow.consent ?? {};
        consentStatus = consent.graph?.status ?? null;
        // Only a "granted" tenant can be scope-stale — revoked/declined/pending
        // are already surfaced via consentStatus itself and take priority.
        if (consentStatus === "granted") {
          const granted = new Set(consent.graph?.grants ?? []);
          scopesStale = REQUIRED_MT_SCOPES.some((scope) => !granted.has(scope));
        }

        // No separate try/catch any more: the SharePoint grant is a key of a
        // NOT NULL column on a row already read, so it can no longer fail
        // independently of the payload it belongs to. The "unknown"
        // (undefined → key omitted) branch guarded against
        // tenant_sharepoint_consent not existing yet; that table is gone. An
        // absent key now means exactly one thing — never consented — which is
        // the real state, so the pill nudges instead of staying silent.
        sharePointConsentStatus = consent.sharepoint?.status ?? null;
        if (sharePointConsentStatus === "granted") {
          const grantedPerms = new Set(consent.sharepoint?.grants ?? []);
          sharePointPermissionsStale = REQUIRED_SHAREPOINT_APP_PERMISSIONS.some((p) => !grantedPerms.has(p));
        }
      }

      res.json({
        everScanned: latestRun != null,
        lastScanAt: lastCompleted ? (lastCompleted.completedAt ?? lastCompleted.createdAt) : null,
        active: active
          ? {
              runId: latestRun.runId,
              status: latestRun.status,
              checksOk: latestRun.checksOk ?? 0,
              checksError: latestRun.checksError ?? 0,
              checksLicenseGap: latestRun.checksLicenseGap ?? 0,
              checksTotal: latestRun.checksTotal ?? 0,
              startedAt: latestRun.startedAt ?? latestRun.createdAt,
            }
          : null,
        // Real terminal summary of the customer's most recent run, present
        // whether or not that run is still active. `active` above goes null the
        // instant a run finishes, so a finished run's real check counts would
        // otherwise be unreadable — a surface that reports a scan's outcome (the
        // Copilot Assessment telemetry page's Scan step) needs them after the
        // fact too, e.g. when the page is opened after the scan already ran.
        // Same row already selected above; no extra query.
        lastRunSummary: latestRun
          ? {
              runId: latestRun.runId,
              status: latestRun.status,
              checksTotal: latestRun.checksTotal ?? 0,
              checksOk: latestRun.checksOk ?? 0,
              checksError: latestRun.checksError ?? 0,
              checksLicenseGap: latestRun.checksLicenseGap ?? 0,
              startedAt: latestRun.startedAt ?? latestRun.createdAt,
              completedAt: latestRun.completedAt ?? null,
              // `status` here already carries "failed" (diagnostics-runner.ts's
              // outer catch persists it) — but a run that died mid-flight has no
              // reliable check counts, and until now the client had no way to
              // show WHY it died on a cold page load (only a live SSE watcher of
              // that exact run ever saw the diagnostics_error message; a page
              // opened afterwards got nothing). errorMessage is the same
              // truncated-to-1000-chars column the runner already writes on
              // failure — real gap, additive field, no migration needed.
              errorMessage: latestRun.status === "failed" ? (latestRun.errorMessage ?? null) : null,
            }
          : null,
        // The customer's most recent Assessment document-generation workflow
        // run, or null when one has never fired for them (e.g. the two-sided
        // gate is still waiting on the other condition). Only the run id and
        // status: the id is the subscription handle for the existing run-scoped
        // SSE stream, and the status is the poll-based terminal signal — the
        // same division of labour the wizard already relies on.
        docWorkflow: docWfRun ? { runId: docWfRun.id, status: docWfRun.status } : null,
        isTestbed: customerRow?.isTestbed === true,
        consentStatus,
        scopesStale,
        sharePointConsentStatus,
        sharePointPermissionsStale,
      });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/scan-status failed");
      res.status(500).json({ error: "Failed to load scan status" });
    }
  },
);

// ── The run's real check PLAN (#340) ──────────────────────────────────────────
//
//   GET /api/portal/scan-plan
//
// The check keys the customer's latest diagnostics run really executes, in the
// order it executes them.
//
// Why this exists: the pillar summary's pillar row/stack marks a pillar "done" off the
// per-check SSE stream, but that stream only says which checks HAVE reported —
// never how many a pillar is still owed. #340: the first result mapping to a
// pillar was marking the whole pillar finished, so a pillar with five real
// checks read complete after one, and #331/#334's honest "NO DATA" treatment
// (correct for a pillar that genuinely finished with no score) fired mid-scan on
// pillars that were still being read.
//
// The real source of truth for "how many checks does this pillar have" is the
// same one the executor itself uses: `loadOrderedPackageChecks(packageKey)` —
// the monitoring_package_checks junction rows for the run's package, narrowed to
// monitor_checks that are actually `active`, in sortOrder. That is *literally*
// the list `executeMonitoringPackage` iterates and emits one progress event per
// (see monitor-executor.ts) — not a count derived from it, so the two can't
// drift. It is deliberately NOT the run row's `checksTotal` (a single number
// with no per-check identity) and NOT a hardcoded per-pillar tally.
//
// Its own route rather than more fields on /portal/scan-status: scan-status is
// polled every 3s from the whole shell while a run is live, and the plan for a
// given run never changes, so the pillar summary reads this once per runId instead.
//
// Grouping the keys into pillars is deliberately left to the client: the
// domain→pillar mapping lives in one place (msp-portal's warRoomScan.ts,
// WAR_ROOM_PILLAR_DOMAINS) and a second copy here would be free to drift from
// the one that renders the row.
router.get(
  "/portal/scan-plan",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // The SAME row /portal/scan-status reports on — its `active`, its
      // `lastRunSummary` and this plan are all the customer's latest run, so the
      // runId returned here is the one the caller is already watching. It is
      // returned explicitly regardless, so the client can refuse to apply a plan
      // to a run it doesn't belong to rather than assuming they match.
      const [latestRun] = await db
        .select({
          runId: mspDiagnosticRunsTable.runId,
          packageKey: mspDiagnosticRunsTable.packageKey,
        })
        .from(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .orderBy(desc(mspDiagnosticRunsTable.createdAt))
        .limit(1);

      if (!latestRun) {
        // Never scanned. A real, reportable state — not an error.
        res.json({ runId: null, packageKey: null, checkKeys: [] });
        return;
      }

      const { checks } = await loadOrderedPackageChecks(latestRun.packageKey);
      res.json({
        runId: latestRun.runId,
        packageKey: latestRun.packageKey,
        checkKeys: checks.map((c) => c.key),
      });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/scan-plan failed");
      res.status(500).json({ error: "Failed to load scan plan" });
    }
  },
);

// ── Real weekly-rescan history for drift visualization (#1059, epic #454) ──────
//
//   GET /api/portal/diagnostics/history
//
// The customer's real per-check history off `tenant_monitor_profiles` — one row
// per check per weekly rescan run (#1058, now live) — capped to a trailing
// 12-week window (`HISTORY_WINDOW_DAYS` below; matches the rescan's own weekly
// cadence, giving room for ~12 real points once rescans have been running a
// while — no existing lookback-window convention in this codebase specifically
// covers a weekly-cadence series, `pillar-trend.ts`'s PILLAR_TREND_WINDOW_DAYS
// is 30 days for a DAILY-replay series, too short here to span even 5 weekly
// runs).
//
// Deliberately returns RAW rows, not pillar-grouped or scored data: the
// domain→pillar mapping lives in one place (msp-portal's warRoomScan.ts,
// WAR_ROOM_PILLAR_DOMAINS) and a second copy here would be free to drift from
// the one that renders the row — same discipline /portal/scan-plan above
// already follows. No score is computed here either; the client derives
// whatever it needs (e.g. ok-rate per pillar per run) from the real
// status/severityMatched values.
router.get(
  "/portal/diagnostics/history",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // tenant_monitor_profiles.tenant_id is the Azure AD tenant GUID
      // (tenants.tenantId), NOT msp_customers.id / tenants.id — same resolution
      // pillar-trend.ts's getPillarScoreTrends() uses.
      const [tenantRow] = await db
        .select({ tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const tenantId = tenantRow?.tenantId ?? null;
      if (!tenantId) {
        // No Azure AD tenant resolved for this customer yet — a real,
        // reportable state (e.g. pre-consent), not an error.
        res.json({ points: [] });
        return;
      }

      const windowStart = new Date(Date.now() - HISTORY_WINDOW_DAYS * 24 * 60 * 60 * 1000);

      const points = await db
        .select({
          checkKey: tenantMonitorProfilesTable.checkKey,
          status: tenantMonitorProfilesTable.status,
          severityMatched: tenantMonitorProfilesTable.severityMatched,
          collectedAt: tenantMonitorProfilesTable.collectedAt,
        })
        .from(tenantMonitorProfilesTable)
        .where(
          and(
            eq(tenantMonitorProfilesTable.tenantId, tenantId),
            gte(tenantMonitorProfilesTable.collectedAt, windowStart),
          ),
        )
        .orderBy(asc(tenantMonitorProfilesTable.collectedAt));

      res.json({ points });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/diagnostics/history failed");
      res.status(500).json({ error: "Failed to load assessment history" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// POST /portal/diagnostics/debug-trigger-scan
// Exists only so scan progress can be watched live during development. Real
// customers never get a self-serve scan trigger (prevents AI-credit spam) —
// this is a narrow, hard-gated exception: testbed customers only, enforced
// server-side (not just by hiding the button client-side). Reuses the exact
// packageKey resolution + runDiagnostics call from msp-diagnostics.ts's
// POST /msp/customers/:customerId/diagnostics/run — do not reimplement that
// logic elsewhere. Remove this route entirely before production. See
// backlog: [Shane to add ticket].
router.post(
  "/portal/diagnostics/debug-trigger-scan",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // Hard server-side testbed guard — this check is what actually prevents
      // real customers from triggering scans, not the button's visibility.
      const [customer] = await db
        .select({ isTestbed: tenantsTable.isTestbed, mspId: tenantsTable.mspId, tenantId: tenantsTable.tenantId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!customer || customer.isTestbed !== true) {
        log.warn({ customerId }, "debug-trigger-scan: blocked — customer is not a testbed tenant");
        res.status(403).json({ error: "Scan trigger is not available for this account" });
        return;
      }

      // Resolve packageKey the SAME way msp-diagnostics.ts's real
      // POST /msp/customers/:customerId/diagnostics/run does — off the
      // customer's active monitoring subscription (fulfillmentTypeKey ===
      // "monitoring_subscription"), not a Copilot-specific slug filter.
      //
      // This route's own comment always claimed to reuse "the exact packageKey
      // resolution... from msp-diagnostics.ts", but it had actually forked to a
      // narrower query scoped only to copilot-readiness-snapshot /
      // copilot-readiness-assessment. That drift meant this debug scan button
      // could never resolve any OTHER purchased tier (e.g. a Premier monitoring
      // subscription) — it would keep re-running Copilot Readiness for as long
      // as that old entitlement existed, then silently fall back to
      // core:security-baseline once it didn't, regardless of what the customer
      // actually holds. Fixed to genuinely match msp-diagnostics.ts.
      const [pkgRow] = await db
        .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
        .from(usersTable)
        .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(
          and(
            eq(usersTable.tenantId, customerId),
            eq(servicesTable.fulfillmentTypeKey, "monitoring_subscription"),
            eq(clientServicesTable.status, "active"),
          )
        )
        // Deterministic: most recent active subscription wins when a customer
        // holds more than one (unordered LIMIT 1 was arbitrary).
        .orderBy(desc(clientServicesTable.id))
        .limit(1);
      const packageKey = pkgRow?.packageKey ?? "core:security-baseline";

      const triggeredByUserId = req.user!.id;
      const runId = randomUUID();

      await db
        .insert(mspDiagnosticRunsTable)
        .values({
          runId,
          mspId: customer.mspId,
          customerId,
          tenantId: customer.tenantId ?? undefined,
          packageKey,
          status: "pending",
          triggeredByUserId,
        });

      res.status(202).json({ runId, status: "pending", message: "Debug scan trigger started" });

      // Testbed-only manual debug trigger — routine, not assessment-triggered.
      void runDiagnostics({ customerId, packageKey, existingRunId: runId, triggeredByUserId, isAssessmentTriggered: false }).catch(
        (err: unknown) => {
          log.error({ err, runId }, "debug-trigger-scan: async run failed");
        },
      );
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/diagnostics/debug-trigger-scan failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to trigger scan" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// GET /portal/diagnostics/testbed-status
// Exists only so QuizScreen.tsx's [DEBUG] auto-fill button can gate itself off
// the real server-side isTestbed flag instead of a client-only heuristic —
// same discipline, and the same tenantsTable.isTestbed lookup, as
// debug-trigger-scan just above. Remove this route (and the button that calls
// it) entirely before production. See backlog: [Shane to add ticket].
router.get(
  "/portal/diagnostics/testbed-status",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [customer] = await db
        .select({ isTestbed: tenantsTable.isTestbed })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      res.json({ isTestbed: customer?.isTestbed === true });
    } catch (err) {
      authLog.error({ err, customerId }, "GET /portal/diagnostics/testbed-status failed");
      res.status(500).json({ error: "Failed to resolve testbed status" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// POST /portal/diagnostics/debug-reset-session
// #284, parent epic #183. Resets a testbed customer back to a fresh,
// never-scanned, never-quizzed state so Shane doesn't have to hand-run SQL
// between test passes. Hard server-side isTestbed guard, same discipline as
// debug-trigger-scan above — this check, not the button's client-side
// visibility, is what actually blocks a live customer. Four-part reset,
// confirmed real via manual SQL Shane already ran successfully:
//   1. Clear tenants.copilot_assessment's "quiz" key (other keys under the
//      same jsonb column, if any land there later, are left alone).
//   2. Delete msp_diagnostic_runs for this customer (cascades to
//      msp_diagnostic_findings via the existing FK).
//   3. Delete wf_runs for the Assessment doc-generation workflow whose
//      trigger payload references this customer/user — the same ownership
//      predicate GET /portal/diagnostics/status uses to find the run.
//   4. Delete insights_generated_documents for this customer (users.id
//      space, customer-scoped via resolveSiblingUserIds — the same helper
//      every other document read/write in this file uses).
// Deliberately NOT touched: client_services — that's the real Copilot
// entitlement; wiping it would immediately lock the account back out of the
// flow. Remove this route entirely before production. See backlog: [Shane to
// add ticket].
router.post(
  "/portal/diagnostics/debug-reset-session",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    const userId = req.user?.id;
    if (customerId === null || userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      // Hard server-side testbed guard — this check is what actually
      // prevents a real customer from wiping their own session data, not the
      // button's visibility.
      const [customer] = await db
        .select({ isTestbed: tenantsTable.isTestbed, copilotAssessment: tenantsTable.copilotAssessment })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      if (!customer || customer.isTestbed !== true) {
        log.warn({ customerId }, "debug-reset-session: blocked — customer is not a testbed tenant");
        res.status(403).json({ error: "Session reset is not available for this account" });
        return;
      }

      // 1. Clear the saved quiz profile, leaving any other copilot_assessment key intact.
      const existingAssessment = (customer.copilotAssessment as CopilotAssessmentStateMap | undefined) ?? {};
      const { quiz: _quiz, ...restAssessment } = existingAssessment;
      await db
        .update(tenantsTable)
        .set({ copilotAssessment: restAssessment, updatedAt: new Date() })
        .where(eq(tenantsTable.id, customerId));

      // 2. Delete scan history (cascades to msp_diagnostic_findings via FK).
      const deletedRuns = await db
        .delete(mspDiagnosticRunsTable)
        .where(eq(mspDiagnosticRunsTable.customerId, customerId))
        .returning({ id: mspDiagnosticRunsTable.id });

      // 3. Delete the document-generation workflow runs tied to this customer.
      const ownedWfRuns = await db
        .select({ id: wfRunsTable.id })
        .from(wfRunsTable)
        .innerJoin(wfDefinitionsTable, eq(wfDefinitionsTable.id, wfRunsTable.definitionId))
        .where(
          and(
            eq(wfDefinitionsTable.name, ASSESSMENT_DOC_WORKFLOW_NAME),
            sql`(${wfRunsTable.payload}->>'customerId' = ${String(customerId)} OR ${wfRunsTable.payload}->>'userId' = ${String(userId)} OR ${wfRunsTable.payload}->>'clientUserId' = ${String(userId)})`,
          ),
        );
      let deletedWfRunCount = 0;
      if (ownedWfRuns.length > 0) {
        const deletedWfRuns = await db
          .delete(wfRunsTable)
          .where(inArray(wfRunsTable.id, ownedWfRuns.map((r) => r.id)))
          .returning({ id: wfRunsTable.id });
        deletedWfRunCount = deletedWfRuns.length;
      }

      // 4. Delete generated documents (users.id space, customer-scoped).
      const docScopeUserIds = await resolveSiblingUserIds(userId);
      const deletedDocs = await db
        .delete(insightsGeneratedDocumentsTable)
        .where(inArray(insightsGeneratedDocumentsTable.customerId, docScopeUserIds))
        .returning({ id: insightsGeneratedDocumentsTable.id });

      log.info(
        {
          customerId,
          userId,
          deletedRuns: deletedRuns.length,
          deletedWfRuns: deletedWfRunCount,
          deletedDocs: deletedDocs.length,
        },
        "debug-reset-session: session reset complete",
      );

      res.json({
        reset: true,
        cleared: {
          quiz: true,
          diagnosticRuns: deletedRuns.length,
          workflowRuns: deletedWfRunCount,
          documents: deletedDocs.length,
        },
      });
    } catch (err) {
      log.error({ err, customerId }, "POST /portal/diagnostics/debug-reset-session failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to reset session" });
    }
  },
);

export default router;
