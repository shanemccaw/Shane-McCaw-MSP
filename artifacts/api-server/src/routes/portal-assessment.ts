/**
 * ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
 * This file's POST /portal/assessment/debug-trigger-scan route (below) exists
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
 *   GET /api/portal/assessment/status
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
  clientServicesTable,
  servicesTable,
  usersTable,
  couponsTable,
  assessmentSowAgreementsTable,
  wfRunsTable,
  wfDefinitionsTable,
  presentationDocViewsTable,
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
import { eq, ne, and, desc, inArray, isNull, sql } from "drizzle-orm";
import { requireRole } from "../middlewares/requireAuth";
import jwt from "jsonwebtoken";
import { registerWorkflowRunSSEClient } from "../lib/sse-channels";
import { logger } from "../lib/logger";
import { type OmgCard } from "../lib/omg-card-generator-v2";
import { runDiagnostics } from "../lib/diagnostics-runner";
import { generateSowDocument } from "../lib/document-engine-sow.ts";
import { getStripeKey } from "../lib/stripe";
import { verifyCaptchaToken } from "../lib/captcha";
import { getMspPortalBaseUrl } from "../lib/portal-url";
import { randomUUID } from "crypto";
import { getPillarCoverage } from "../lib/pillar-coverage";
// The executor's OWN package→ordered-checks resolver, reused verbatim so the
// scan plan below can never disagree with what the run actually executes (#340).
import { loadOrderedPackageChecks } from "../lib/monitor-executor";
import { buildTelemetryComparison } from "../lib/telemetry-comparison";
import { buildWarRoomPillarStats } from "../lib/war-room-pillar-stats";
import { resolveLicenseWasteCounts } from "../lib/license-waste-source";
import { computeSkuCostBreakdown, type SkuCostBreakdown } from "../lib/cost-engine";
import { evaluateDocGateCoverage, DOC_GATE_MIN_COVERAGE_PCT } from "../lib/doc-gate-coverage";
import { computeCopilotReadiness, type CopilotReadinessResult } from "../lib/copilot-readiness";
import { computeCopilotGate, copilotGate, type CopilotGateResult } from "../lib/copilot-gate";
import { generateCopilotReadinessNarrative } from "../lib/copilot-readiness-narrative-generator.ts";
import { generateSecurityPostureNarrative } from "../lib/security-posture-narrative-generator.ts";
// #292 — the four pillar reports' prose sections. Each is the same shape as the
// two above: real data in, up to three attributed Anthropic calls, HTML out.
import { generateGovernancePostureNarrative } from "../lib/governance-posture-narrative-generator.ts";
import { generateComplianceAlignmentNarrative } from "../lib/compliance-alignment-narrative-generator.ts";
import { generateLicensingAlignmentNarrative } from "../lib/licensing-alignment-narrative-generator.ts";
import { generateOperationalHealthNarrative } from "../lib/operational-health-narrative-generator.ts";
import type { PillarReportAttribution, PillarReportNarrativeResult } from "../lib/pillar-report-narrative.ts";
import { resolveMspId } from "../lib/resolve-msp-id";
import { resolveBillingMspId } from "../lib/ai-billing";
import { runSalesOfferEngineForTenant } from "../lib/sales-offer-engine";
import { fetchSignalRulesAndGroups } from "../lib/priority-engine";
import { resolveCustomerIdForPortalUser, resolveSiblingUserIds } from "../lib/tenant-signals";
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

router.get(
  "/portal/assessment/status",
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
      // /portal/assessment/war-room-pillars serves for its copilot card — one
      // engine, one computation, so the Reveal's headline verdict and its six
      // pillar scenes can no longer disagree about the tenant in front of them.
      // Keyed by customerId (the engine's own id space), not tenantId, and so
      // it is available even for a customer whose last run carries no tenantId.
      let copilotGateResult: CopilotGateResult = copilotGate(null);

      if (lastCompleted) {
        const runSummary = (lastCompleted.summary as Record<string, unknown> | null | undefined) ?? null;
        genuineFindings =
          runSummary != null
            ? Number(runSummary.criticalCount ?? 0) + Number(runSummary.warningCount ?? 0)
            : null;

        if (coverageRun) {
          pillarCoverage = await getPillarCoverage(coverageRun.packageKey, customerId).catch((err) => {
            log.warn({ err, customerId }, "GET /portal/assessment/status: pillar coverage computation failed");
            return [];
          });
        }

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
            log.warn({ err, customerId }, "GET /portal/assessment/status: license waste computation failed");
          }

          copilotReadiness = await computeCopilotReadiness(coverageRun.tenantId).catch((err) => {
            log.warn({ err, customerId }, "GET /portal/assessment/status: copilot readiness computation failed");
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
        },
        // Real tenant-health radar — only pillars this customer's actual scanned
        // package genuinely covers (see pillar-coverage.ts). Empty until a
        // package has real monitoring_package_checks rows curated for it; never
        // padded with fabricated axes.
        radar: {
          packageKey: coverageRun?.packageKey ?? null,
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
        copilotGate: copilotGateResult,
        // ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️ (see note above)
        isTestbed: customerRow?.isTestbed === true,
      });
    } catch (err) {
      log.error({ err, customerId, userId }, "GET /portal/assessment/status failed");
      res.status(500).json({ error: "Failed to load assessment status" });
    }
  },
);

// ── Telemetry right-panel comparison (#245) ──────────────────────────────────
//
//   GET /api/portal/assessment/telemetry-comparison
//
// The four right-panel elements of the Copilot Assessment telemetry page —
// Score gauges, Multi-Dimension Radar, Dimension Gap Analysis, Top
// Discrepancies — computed from the REAL health engine and the customer's REAL
// diagnostic findings. See lib/telemetry-comparison.ts for the full provenance
// note (no new scoring formula; why it is genuinely live mid-scan; and why
// `selfAssessment` is null pending Shane's design decision).
//
// Deliberately a separate route from /portal/assessment/status rather than more
// fields on it: this one is re-fetched repeatedly WHILE a scan runs (the panel
// updates as checks land), and status already carries the wizard's whole
// heavyweight payload — documents, cost engine, copilot readiness, SOW state —
// none of which changes per check.
router.get(
  "/portal/assessment/telemetry-comparison",
  // Same floor as /portal/assessment/status — the assessment wizard's own role.
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
      log.error({ err, customerId }, "GET /portal/assessment/telemetry-comparison failed");
      res.status(500).json({ error: "Failed to compute telemetry comparison" });
    }
  },
);

// ── War Room pillar summary cards (#320, epic #302) ──────────────────────────
//
//   GET /api/portal/assessment/war-room-pillars
//
// The seven completed-scan pillar cards in the War Room — each card's SCORE and
// its four STAT CALLOUTS — computed from the REAL health engine (the same
// `computePillarDisplayScore` path #245 already uses, no new formula) and the
// customer's REAL `tenant_monitor_profiles` / `msp_diagnostic_findings` rows.
// See lib/war-room-pillar-stats.ts for the per-stat provenance table, including
// which of the original fictional callouts had no real producer at all.
//
// A separate route from telemetry-comparison for the same reason that one is
// separate from /status: it resolves ~20 distinct monitor metrics plus the seat
// arithmetic, which the telemetry panel neither needs nor should pay for.
router.get(
  "/portal/assessment/war-room-pillars",
  // Same floor as the telemetry panel — the assessment/War Room role.
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      res.json(await buildWarRoomPillarStats(customerId));
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/assessment/war-room-pillars failed");
      res.status(500).json({ error: "Failed to compute War Room pillar stats" });
    }
  },
);

// ── Copilot Readiness report — the three AI-written prose sections (#409) ─────
//
//   GET /api/portal/assessment/copilot-readiness-narrative
//
// The Copilot Readiness, Safety & Enablement Report's three prose sections —
// Copilot Safety & Exposure, Workflow Enablement & Value, Gate Blockers &
// Remediation Path. The report's OTHER sections (the readiness summary, the
// pillar table, the technical prerequisites and the blast-radius row) are pure
// data and are rendered client-side straight from `war-room-pillars`; nothing
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
  "/portal/assessment/copilot-readiness-narrative",
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
      log.error({ err, customerId }, "GET /portal/assessment/copilot-readiness-narrative failed");
      res.status(500).json({ error: "Failed to generate the Copilot readiness narrative" });
    }
  },
);

// ── Security Posture report — prose sections + Secure Score (#343) ────────────
//
//   GET /api/portal/assessment/security-posture-narrative
//
// The Microsoft 365 Security Posture & Blast Radius Report's three prose
// sections — the Summary's opening paragraph, the Blast Radius section's causal
// explanation, and the Copilot Readiness Impact section's connection to the
// Gate score — plus the one real metric the report needs that
// `war-room-pillars` does not carry (Microsoft Secure Score; see the
// generator's header for why it is resolved here rather than added to the War
// Room spec list).
//
// Every OTHER row in that report — the identity and endpoint figures, the
// findings, the blast-radius row, the Upgrade Opportunity category — is pure
// data rendered client-side straight from `war-room-pillars`, and goes nowhere
// near an AI call.
//
// Deliberately its OWN route rather than a field on /status, and GET despite
// the metered side effect, for the same two reasons as its Copilot sibling
// above: /status is polled every 4s, and the caller supplies nothing — every
// number the prose is grounded in is recomputed server-side from this
// customer's own real data.
router.get(
  "/portal/assessment/security-posture-narrative",
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
      log.error({ err, customerId }, "GET /portal/assessment/security-posture-narrative failed");
      res.status(500).json({ error: "Failed to generate the security posture narrative" });
    }
  },
);

// ── The four pillar reports' prose sections (#292) ────────────────────────────
//
//   GET /api/portal/assessment/governance-posture-narrative
//   GET /api/portal/assessment/compliance-alignment-narrative
//   GET /api/portal/assessment/licensing-alignment-narrative
//   GET /api/portal/assessment/operational-health-narrative
//
// Four routes with one body, registered by the helper below rather than written
// out four times. They differ ONLY in which generator they call and what the log
// line says: every one of them resolves the same customer identity from the same
// JWT claim, reads the same `tenants.customer_name`, attributes to the same
// billing msp, and fails the same way. Four copies of that would be four places
// for the 403 guard or the error handling to drift.
//
// Each report's OTHER content — every metric row, every finding, every declared
// gap, the whole Upgrade Opportunity category — is pure data rendered
// client-side straight from `war-room-pillars`, and goes nowhere near an AI
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
  "/portal/assessment/governance-posture-narrative",
  "governance-posture-report",
  generateGovernancePostureNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/assessment/compliance-alignment-narrative",
  "compliance-alignment-report",
  generateComplianceAlignmentNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/assessment/licensing-alignment-narrative",
  "licensing-alignment-report",
  generateLicensingAlignmentNarrative,
);
registerPillarReportNarrativeRoute(
  "/portal/assessment/operational-health-narrative",
  "operational-health-report",
  generateOperationalHealthNarrative,
);

// ── Shell-wide scan status (lightweight, poll every 30-60s from app-shell.tsx) ─
//
//   GET /api/portal/scan-status
//
// Deliberately minimal sibling of /portal/assessment/status above — that route
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
      // Deliberately the SAME query shape /portal/assessment/status already uses
      // for `docWfRun` (see the block above it) — same workflow name, same
      // three-legged trigger-payload predicate, same "most recent run" ordering.
      // Not a second lookup shape and not a new stream: it exists so the Copilot
      // Assessment telemetry page can subscribe to the ALREADY-LIVE run-scoped
      // stream (GET /portal/assessment/doc-workflow/:runId/sse) the old wizard
      // subscribes to today, without having to poll the heavyweight
      // /portal/assessment/status payload from a page that only needs the run id.
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
// Why this exists: the War Room's pillar row/stack marks a pillar "done" off the
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
// given run never changes, so the War Room reads this once per runId instead.
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

// ── Assessment document-generation live progress SSE ───────────────────────────
//
//   GET /api/portal/assessment/doc-workflow/:runId/sse?jwt=<accessToken>
//
// Run-ID-scoped Server-Sent Events for the seeded Assessment Document Generation
// workflow. Keyed on the WORKFLOW run ID (wf_runs.id) — the only stable handle
// from the very first node, since client_presentations doesn't exist until the
// end. Mirrors the diagnostics-run SSE pattern exactly (query-JWT auth because
// EventSource can't set headers, 25s heartbeat, replay-on-connect from the hub).
// Emits { type: "workflow_run_progress" | "workflow_run_complete" | "workflow_run_error", ... }.
// A customer may subscribe only to a run whose trigger payload references their
// own customerId/userId. Completion/failure remain authoritatively detected via
// the status endpoint's workflowStatus; this stream is a live-UX enhancement.
router.get(
  "/portal/assessment/doc-workflow/:runId/sse",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const runIdNum = parseInt(String(req.params["runId"] ?? ""), 10);
      if (isNaN(runIdNum)) { res.status(400).json({ error: "Invalid run id" }); return; }

      // Authenticate via query JWT (EventSource cannot set an Authorization header).
      const token = String((req.query as Record<string, unknown>).jwt ?? "");
      if (!token) { res.status(401).json({ error: "JWT required" }); return; }
      const jwtSecret = process.env.JWT_SECRET ?? "dev-secret";
      let decoded: Record<string, unknown>;
      try {
        decoded = jwt.verify(token, jwtSecret) as Record<string, unknown>;
      } catch {
        res.status(401).json({ error: "Invalid or expired JWT" }); return;
      }
      const tokenUserId = decoded.id as number | undefined;
      const tokenCustomerId = decoded.customerId as number | undefined;
      if (tokenUserId == null && tokenCustomerId == null) {
        res.status(403).json({ error: "No customer identity on token" }); return;
      }

      // Ownership: the run must be an Assessment doc-gen run whose trigger payload
      // references this customer/user. Prevents cross-tenant subscription.
      const [ownedRun] = await db
        .select({ id: wfRunsTable.id })
        .from(wfRunsTable)
        .innerJoin(wfDefinitionsTable, eq(wfDefinitionsTable.id, wfRunsTable.definitionId))
        .where(
          and(
            eq(wfRunsTable.id, runIdNum),
            eq(wfDefinitionsTable.name, ASSESSMENT_DOC_WORKFLOW_NAME),
            sql`(${wfRunsTable.payload}->>'customerId' = ${String(tokenCustomerId ?? "")} OR ${wfRunsTable.payload}->>'userId' = ${String(tokenUserId ?? "")} OR ${wfRunsTable.payload}->>'clientUserId' = ${String(tokenUserId ?? "")})`,
          ),
        )
        .limit(1);
      if (!ownedRun) { res.status(404).json({ error: "Run not found" }); return; }

      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders();

      registerWorkflowRunSSEClient(String(runIdNum), res, () => {
        log.info({ runId: runIdNum }, "assessment doc-workflow SSE client disconnected");
      });

      const heartbeat = setInterval(() => {
        try { res.write(": heartbeat\n\n"); } catch { clearInterval(heartbeat); }
      }, 25_000);
      res.on("close", () => clearInterval(heartbeat));
    } catch (err) {
      log.error({ err }, "GET /portal/assessment/doc-workflow/:runId/sse error");
      if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
    }
  },
);

// ── Single document — content + OMG cards for the Results Viewer ───────────────
//
// Returns one of the customer's own generated assessment documents: its rendered
// HTML (for the iframe viewer, same pattern as customer-sow.tsx) plus its
// AI-extracted "OMG cards".
//
// OMG cards are extracted LAZILY here, on the customer's first open of the
// document, then persisted to insights_generated_documents.omg_cards. This avoids
// spending an AI call on any document the customer never opens (assessments always
// run a fresh scan and AI credits cost money). Every later view reads the stored
// cards. Extraction failure never blocks the document — the HTML is always
// returned; cards simply come back empty.
router.get(
  "/portal/assessment/documents/:id",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const documentId = Number(req.params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }

    try {
      // Scope to the caller's CUSTOMER's documents: the doc row's customerId is
      // a users.id-shaped FK, and any linked login of the same customer may
      // read the customer's own assessment documents (never another customer's
      // — the sibling set is derived server-side from msp_users).
      const viewerScopeUserIds = await resolveSiblingUserIds(userId);
      const [doc] = await db
        .select({
          id: insightsGeneratedDocumentsTable.id,
          customerId: insightsGeneratedDocumentsTable.customerId,
          docType: insightsGeneratedDocumentsTable.docType,
          category: insightsGeneratedDocumentsTable.category,
          title: insightsGeneratedDocumentsTable.title,
          status: insightsGeneratedDocumentsTable.status,
          htmlContent: insightsGeneratedDocumentsTable.htmlContent,
          omgCards: insightsGeneratedDocumentsTable.omgCards,
        })
        .from(insightsGeneratedDocumentsTable)
        .where(
          and(
            eq(insightsGeneratedDocumentsTable.id, documentId),
            inArray(insightsGeneratedDocumentsTable.customerId, viewerScopeUserIds),
          ),
        )
        .limit(1);

      if (!doc || doc.status === "archived") {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      // Only expose documents that have finished generating and are ready to read.
      const isReady = (READY_DOC_STATUSES as readonly string[]).includes(doc.status);
      if (!isReady) {
        res.status(409).json({ error: "Document is not ready yet", status: doc.status });
        return;
      }

      const omgCards: OmgCard[] = (doc.omgCards as OmgCard[] | null) ?? [];

      res.json({
        id: doc.id,
        docType: doc.docType,
        category: doc.category,
        title: doc.title,
        status: doc.status,
        htmlContent: doc.htmlContent,
        omgCards,
      });
    } catch (err) {
      log.error({ err, userId, documentId }, "GET /portal/assessment/documents/:id failed");
      res.status(500).json({ error: "Failed to load document" });
    }
  },
);

// ── Document view tracking ──────────────────────────────────────────────────
//
// Reuses presentation_doc_views (presentationId: null is the documented
// non-presentation case — see the /public/documents/:shareToken/doc-views and
// /portal/documents/:id/share routes in portal.ts, which record the same
// non-presentation event shape for share-link views) rather than inventing a
// second, pipeline-only tracking table. Fired once per real document open;
// the modal's per-session "read" checkmarks are a client-side derivation on
// top of this, not a separate source of truth.
router.post(
  "/portal/assessment/documents/:id/view",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const documentId = Number(req.params.id);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      res.status(400).json({ error: "Invalid document id" });
      return;
    }

    try {
      // Same customer-scoped ownership check as the document read above.
      const viewScopeUserIds = await resolveSiblingUserIds(userId);
      const [doc] = await db
        .select({ id: insightsGeneratedDocumentsTable.id, title: insightsGeneratedDocumentsTable.title })
        .from(insightsGeneratedDocumentsTable)
        .where(
          and(
            eq(insightsGeneratedDocumentsTable.id, documentId),
            inArray(insightsGeneratedDocumentsTable.customerId, viewScopeUserIds),
          ),
        )
        .limit(1);

      if (!doc) {
        res.status(404).json({ error: "Document not found" });
        return;
      }

      await db.insert(presentationDocViewsTable).values({
        presentationId: null,
        documentId: doc.id,
        documentTitle: doc.title,
        eventType: "view",
      });

      res.status(204).end();
    } catch (err) {
      log.error({ err, userId, documentId }, "POST /portal/assessment/documents/:id/view failed");
      res.status(500).json({ error: "Failed to record view" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// POST /portal/assessment/debug-trigger-scan
// Exists only so scan progress can be watched live during development. Real
// customers never get a self-serve scan trigger (prevents AI-credit spam) —
// this is a narrow, hard-gated exception: testbed customers only, enforced
// server-side (not just by hiding the button client-side). Reuses the exact
// packageKey resolution + runDiagnostics call from msp-diagnostics.ts's
// POST /msp/customers/:customerId/diagnostics/run — do not reimplement that
// logic elsewhere. Remove this route entirely before production. See
// backlog: [Shane to add ticket].
router.post(
  "/portal/assessment/debug-trigger-scan",
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

      // Resolve packageKey off the customer's active Copilot entitlement
      // (copilot-readiness-snapshot FREE / copilot-readiness-assessment PAID —
      // the same client_services row #240's entitlement gate checks), not the
      // unrelated monitoring_subscription join. Both slugs carry the same
      // real packageKey ("assess:copilot-readiness" — confirmed live, see
      // admin-simulator-assessments.test.ts's REAL_ASSESSMENT_SERVICES), so no
      // FREE vs PAID branching is needed here.
      const [pkgRow] = await db
        .select({ packageKey: sql<string | null>`${servicesTable.typeAttributes}->>'packageKey'` })
        .from(usersTable)
        .innerJoin(clientServicesTable, eq(clientServicesTable.clientUserId, usersTable.id))
        .innerJoin(servicesTable, eq(servicesTable.id, clientServicesTable.serviceId))
        .where(
          and(
            eq(usersTable.tenantId, customerId),
            inArray(servicesTable.slug, ["copilot-readiness-snapshot", "copilot-readiness-assessment"]),
            eq(clientServicesTable.status, "active"),
          )
        )
        // Deterministic: most recent active entitlement wins when a customer
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
      log.error({ err, customerId }, "POST /portal/assessment/debug-trigger-scan failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to trigger scan" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// GET /portal/assessment/testbed-status
// Exists only so QuizScreen.tsx's [DEBUG] auto-fill button can gate itself off
// the real server-side isTestbed flag instead of a client-only heuristic —
// same discipline, and the same tenantsTable.isTestbed lookup, as
// debug-trigger-scan just above. Remove this route (and the button that calls
// it) entirely before production. See backlog: [Shane to add ticket].
router.get(
  "/portal/assessment/testbed-status",
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
      authLog.error({ err, customerId }, "GET /portal/assessment/testbed-status failed");
      res.status(500).json({ error: "Failed to resolve testbed status" });
    }
  },
);

// ⚠️ TEMPORARY DEBUG CODE — DELETE BEFORE PRODUCTION ⚠️
// POST /portal/assessment/debug-reset-session
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
//      predicate GET /portal/assessment/status uses to find the run.
//   4. Delete insights_generated_documents for this customer (users.id
//      space, customer-scoped via resolveSiblingUserIds — the same helper
//      every other document read/write in this file uses).
// Deliberately NOT touched: client_services — that's the real Copilot
// entitlement; wiping it would immediately lock the account back out of the
// flow. Remove this route entirely before production. See backlog: [Shane to
// add ticket].
router.post(
  "/portal/assessment/debug-reset-session",
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
      log.error({ err, customerId }, "POST /portal/assessment/debug-reset-session failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to reset session" });
    }
  },
);

// ── Recommended offers for assessment findings ────────────────────────────────
//
//   GET /api/portal/assessment/recommended-offers
//
// Runs the REAL Sales Offer Engine (sales-offer-engine.ts — the platform's one
// offer mechanism: fired tenant signals × configured rule groups × Product
// Catalog pricing) in pure-compute mode for the caller's own tenant, and maps
// each candidate to a customer-safe shape. Nothing is persisted and no offer
// state machine is touched — this is a read-only recommendation surface for
// the assessment page's telemetry findings, deliberately NOT a second offer
// mechanism (same engine, same catalog prices, same rationale text the
// customer-facing /portal/offers surface shows).
//
// Each candidate additionally carries the health pillars of the signals that
// fired it (from the same signal_derivation_rules rows the engine evaluated),
// so the client can attach the right offer to the right finding category
// without ever seeing raw internal signal keys beyond the rationale the offer
// engine itself already writes for customers.
//
// Fetched once per page load (NOT polled — the engine walks the full tenant
// profile, which is far too heavy for the 4s status poll).
router.get(
  "/portal/assessment/recommended-offers",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const customerId = resolveCustomerId(req);
    if (customerId === null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    try {
      const [customer] = await db
        .select({ mspId: tenantsTable.mspId })
        .from(tenantsTable)
        .where(eq(tenantsTable.id, customerId))
        .limit(1);

      const [engineOutput, { rules }] = await Promise.all([
        runSalesOfferEngineForTenant(customerId, customer?.mspId ?? null),
        fetchSignalRulesAndGroups(customer?.mspId ?? null),
      ]);

      const pillarsBySignal = new Map<string, string>();
      for (const rule of rules) {
        if (rule.pillar) pillarsBySignal.set(rule.signalKey, rule.pillar);
      }

      res.json({
        offers: engineOutput.candidates.map((c) => ({
          serviceId: c.serviceId,
          serviceName: c.serviceName,
          title: c.title,
          rationale: c.rationale,
          // The engine's real adjusted catalog price — the same figure a
          // persisted offer would carry into /portal/offers.
          priceCents: c.adjustedPriceCents,
          pillars: [...new Set(c.firedSignalKeys.map((k) => pillarsBySignal.get(k)).filter(Boolean))],
          // Real destination: the existing customer offers page.
          link: "/customer-offers",
        })),
      });
    } catch (err) {
      log.error({ err, customerId }, "GET /portal/assessment/recommended-offers failed");
      res.status(500).json({ error: "Failed to compute recommended offers" });
    }
  },
);

// ── Interactive SOW scope selector (Assessment wizard, task 4) ─────────────────
//
// The consolidated SOW is the last document in the wizard sequence. Unlike the
// read-only findings reports, the customer can toggle optional workstream phases
// on/off here. Two price surfaces:
//   • Instant, free preview — the client sums the already-stored per-phase
//     sowPricingLines on every checkbox click. No AI call, no round-trip.
//   • Deliberate regeneration — POST .../sow/select produces a real, updated,
//     telemetry-grounded SOW for the narrower scope (a genuine AI cost), UNLESS
//     the requested scope exactly matches a version already in storage (e.g.
//     "reset to full scope" restores the original document), in which case that
//     stored version is simply re-activated for free.
//
// Versioning: exactly one consolidated_sow row is "approved" (active) at a time;
// every superseded version is "archived" (hidden by the reader filters but still
// retrievable by exact-scope match). The generator writes those transitions in
// supersedeMode: "archive"; this route owns the free re-activation path.
//
// Pricing window (30-day / 72-hour rule): the SOW and its price are valid for 30
// days from the first generation; a 72-hour pay-in-full discount window opens at
// that same anchor. There is no dedicated timestamp column — the anchor is the
// earliest non-failed consolidated_sow row's createdAt, which is preserved across
// regenerations (superseded rows are archived, not deleted), so re-scoping never
// resets the clock. The actual pay-in-full vs phased choice is task 5; this route
// only surfaces where the customer sits in the window.

const SOW_DOC_TYPE = "sow";
const DISCOUNT_WINDOW_MS = 72 * 60 * 60 * 1000; // 72 hours
const VALIDITY_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Statuses that represent a real, persisted SOW (anchor-eligible); excludes
// "generating" (not yet a document) and "failed" (never became one).
const SOW_REAL_STATUSES = ["approved", "delivered", "archived"] as const;
const SOW_ACTIVE_STATUSES = ["approved", "delivered"] as const;

type SowPricingLineRow = {
  title: string;
  scope: string;
  priceUsd: number;
  notes?: string;
  line_type?: "workstream" | "adjustment";
  weeks?: number;
  deliveryDate?: string;
};

interface SowDocRow {
  id: number;
  projectId: number | null;
  title: string;
  status: string;
  htmlContent: string;
  sowPricingLines: SowPricingLineRow[] | null;
  sowTotalPrice: string | null;
  createdAt: Date;
}

async function loadSowDocs(userId: number): Promise<SowDocRow[]> {
  // CUSTOMER-scoped: the SOW belongs to the customer; a version generated
  // under any sibling login of the same customer is part of the same set.
  const sowScopeUserIds = await resolveSiblingUserIds(userId);
  return db
    .select({
      id: insightsGeneratedDocumentsTable.id,
      projectId: insightsGeneratedDocumentsTable.projectId,
      title: insightsGeneratedDocumentsTable.title,
      status: insightsGeneratedDocumentsTable.status,
      htmlContent: insightsGeneratedDocumentsTable.htmlContent,
      sowPricingLines: insightsGeneratedDocumentsTable.sowPricingLines,
      sowTotalPrice: insightsGeneratedDocumentsTable.sowTotalPrice,
      createdAt: insightsGeneratedDocumentsTable.createdAt,
    })
    .from(insightsGeneratedDocumentsTable)
    .where(
      and(
        inArray(insightsGeneratedDocumentsTable.customerId, sowScopeUserIds),
        eq(insightsGeneratedDocumentsTable.docType, SOW_DOC_TYPE),
        ne(insightsGeneratedDocumentsTable.status, "failed"),
      ),
    )
    .orderBy(insightsGeneratedDocumentsTable.createdAt) as Promise<SowDocRow[]>;
}

const linesOf = (d: SowDocRow): SowPricingLineRow[] => (d.sowPricingLines ?? []) as SowPricingLineRow[];
// Only an explicit "adjustment" line_type is a mandatory (non-toggleable) adjustment;
// anything else (incl. legacy rows without line_type) is treated as a toggleable workstream.
const workstreamLinesOf = (d: SowDocRow): SowPricingLineRow[] => linesOf(d).filter((l) => l.line_type !== "adjustment");
const adjustmentLinesOf = (d: SowDocRow): SowPricingLineRow[] => linesOf(d).filter((l) => l.line_type === "adjustment");
const workstreamTitlesOf = (d: SowDocRow): string[] => workstreamLinesOf(d).map((l) => l.title);
const normalizeSet = (titles: string[]): string => [...new Set(titles)].sort().join("");

/**
 * The baseline full-scope document = the SOW version containing the most
 * workstream phases (the original generation always includes every fired-signal
 * workstream; a narrowed regeneration has fewer). Ties break to the earliest.
 * Its workstream lines define the complete toggleable set the client renders,
 * even when a narrower version is currently active.
 */
function baselineDoc(docs: SowDocRow[]): SowDocRow | null {
  let best: SowDocRow | null = null;
  let bestCount = -1;
  for (const d of docs) {
    const count = workstreamLinesOf(d).length;
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

function buildSowState(docs: SowDocRow[]) {
  const activeDoc =
    [...docs]
      .filter((d) => (SOW_ACTIVE_STATUSES as readonly string[]).includes(d.status))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
  const regenerating = docs.some((d) => d.status === "generating");

  if (!activeDoc) {
    return { ready: false as const, regenerating };
  }

  const baseline = baselineDoc(docs) ?? activeDoc;
  const allWorkstreams = workstreamLinesOf(baseline).map((l) => ({
    title: l.title,
    scope: l.scope,
    priceUsd: l.priceUsd,
    weeks: l.weeks ?? null,
    deliveryDate: l.deliveryDate ?? null,
  }));
  const adjustments = adjustmentLinesOf(activeDoc).map((l) => ({
    title: l.title,
    scope: l.scope,
    priceUsd: l.priceUsd,
  }));
  const selectedWorkstreamTitles = workstreamTitlesOf(activeDoc);
  const isFullScope = normalizeSet(selectedWorkstreamTitles) === normalizeSet(allWorkstreams.map((w) => w.title));

  // Pricing window anchored to the earliest real SOW row (preserved across regens).
  const anchorRow = docs.find((d) => (SOW_REAL_STATUSES as readonly string[]).includes(d.status)) ?? activeDoc;
  const anchorAt = anchorRow.createdAt;
  const discountWindowEndsAt = new Date(anchorAt.getTime() + DISCOUNT_WINDOW_MS);
  const validUntil = new Date(anchorAt.getTime() + VALIDITY_WINDOW_MS);
  const now = Date.now();
  const windowState: "discount" | "standard" | "expired" =
    now < discountWindowEndsAt.getTime() ? "discount" : now < validUntil.getTime() ? "standard" : "expired";

  return {
    ready: true as const,
    regenerating,
    doc: {
      id: activeDoc.id,
      title: activeDoc.title,
      htmlContent: activeDoc.htmlContent,
      totalPrice: activeDoc.sowTotalPrice != null ? Number(activeDoc.sowTotalPrice) : null,
    },
    allWorkstreams,
    adjustments,
    selectedWorkstreamTitles,
    isFullScope,
    pricing: {
      anchorAt: anchorAt.toISOString(),
      discountWindowEndsAt: discountWindowEndsAt.toISOString(),
      validUntil: validUntil.toISOString(),
      windowState,
    },
  };
}

// GET — current interactive SOW state (active doc, full toggleable phase set,
// current selection, mandatory adjustments, and pricing-window countdown).
router.get(
  "/portal/assessment/sow",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const docs = await loadSowDocs(userId);
      res.json(buildSowState(docs));
    } catch (err) {
      log.error({ err, userId }, "GET /portal/assessment/sow failed");
      res.status(500).json({ error: "Failed to load statement of work" });
    }
  },
);

// POST — apply a scope selection.
//   • Exact match to a stored version (incl. full scope) → re-activate it, free.
//   • Genuinely new subset → regenerate a real, updated SOW (AI cost). Responds
//     202 with the new "generating" docId once the row exists; generation
//     continues in the background and the client polls GET .../sow for completion.
router.post(
  "/portal/assessment/sow/select",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const rawSelected = (req.body as { selectedWorkstreamTitles?: unknown })?.selectedWorkstreamTitles;
    if (!Array.isArray(rawSelected) || !rawSelected.every((t) => typeof t === "string")) {
      res.status(400).json({ error: "selectedWorkstreamTitles must be an array of strings" });
      return;
    }

    try {
      const docs = await loadSowDocs(userId);
      const state = buildSowState(docs);
      if (!state.ready) {
        res.status(409).json({ error: "No active statement of work to update yet" });
        return;
      }
      if (state.regenerating) {
        res.status(409).json({ error: "A scope update is already in progress" });
        return;
      }

      const activeDoc =
        [...docs]
          .filter((d) => (SOW_ACTIVE_STATUSES as readonly string[]).includes(d.status))
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]!;
      const projectId = activeDoc.projectId;

      // Constrain the request to real, toggleable workstream titles from the baseline.
      const allTitles = new Set(state.allWorkstreams.map((w) => w.title));
      const requested = [...new Set(rawSelected)].filter((t) => allTitles.has(t));
      if (requested.length === 0) {
        res.status(400).json({ error: "Select at least one workstream phase" });
        return;
      }
      const requestedKey = normalizeSet(requested);

      // Free path — a stored version already has exactly this workstream set.
      // Re-activate it and archive every other version. Covers "reset to full
      // scope" and re-selecting any previously-generated subset.
      const match = docs.find((d) => normalizeSet(workstreamTitlesOf(d)) === requestedKey);
      if (match) {
        if (match.status !== "approved") {
          await db
            .update(insightsGeneratedDocumentsTable)
            .set({ status: "approved", approvedAt: new Date(), updatedAt: new Date() })
            .where(eq(insightsGeneratedDocumentsTable.id, match.id));
        }
        // Customer-scoped archival — a superseded version generated under a
        // sibling login of the same customer must not stay live.
        const archiveScopeUserIds = await resolveSiblingUserIds(userId);
        await db
          .update(insightsGeneratedDocumentsTable)
          .set({ status: "archived", updatedAt: new Date() })
          .where(
            and(
              inArray(insightsGeneratedDocumentsTable.customerId, archiveScopeUserIds),
              projectId != null
                ? eq(insightsGeneratedDocumentsTable.projectId, projectId)
                : isNull(insightsGeneratedDocumentsTable.projectId),
              eq(insightsGeneratedDocumentsTable.docType, SOW_DOC_TYPE),
              ne(insightsGeneratedDocumentsTable.id, match.id),
              inArray(insightsGeneratedDocumentsTable.status, ["draft", "approved", "delivered"]),
            ),
          );
        log.info(
          { userId, docId: match.id, requestedCount: requested.length },
          "portal/assessment/sow/select: re-activated stored scope version (no regeneration)",
        );
        res.json({ regenerated: false, docId: match.id });
        return;
      }

      // Regeneration path — a genuinely new, narrower subset. Kick off a real
      // generation and respond as soon as the "generating" row exists so the
      // client can show its progress state; the AI step continues in the background.
      log.info(
        { userId, projectId, requestedCount: requested.length, selectedTitles: requested },
        "portal/assessment/sow/select: regenerating SOW for new customer scope selection",
      );

      // This is the "logged-in customer requests their own document" case: the
      // route only ever knows the portal user on the token, so the users.id →
      // msp_customers.id translation the SOW engine used to do internally now
      // happens here, before the call. A customer with no engine tenant can't
      // have a SOW regenerated at all, so it's a real 409, not a silent
      // empty-scope generation.
      const mspCustomerId = await resolveCustomerIdForPortalUser(userId);
      if (mspCustomerId == null) {
        log.error({ userId }, "portal/assessment/sow/select: no MSP customer linked to this portal user");
        res.status(409).json({ error: "Your account isn't linked to a tenant yet, so the statement of work can't be updated." });
        return;
      }

      let responded = false;
      let onRow: (docId: number) => void = () => {};
      const rowReady = new Promise<number>((resolve, reject) => {
        onRow = (docId: number) => resolve(docId);
        void generateSowDocument({
          mspCustomerId,
          // Keeps the regenerated SOW owned by the same login that owned the
          // one it supersedes — unchanged from before the signature flip.
          documentOwnerUserId: userId,
          projectId: projectId ?? 0,
          docTypeKey: SOW_DOC_TYPE,
          selectedWorkstreamTitles: requested,
          // The customer changed their own scope selection — that is the entire
          // reason this branch runs, and it is an input the document drift gate
          // structurally cannot see (it compares tenant DATA timestamps only).
          // Without this, an unchanged tenant would get the OLD, wider SOW back
          // and be told it was regenerated: wrong scope and wrong price on a
          // document they sign. Non-empty selectedWorkstreamTitles suppresses
          // reuse inside the engine too, but this states the intent at the
          // caller and holds even when `requested` is empty.
          forceRegenerate: true,
          supersedeMode: "archive",
          onRowCreated: (docId) => onRow(docId),
        })
          .then((result) => resolve(result.documentId))
          .catch((genErr) => {
            if (responded) {
              log.error({ genErr, userId }, "portal/assessment/sow/select: background SOW regeneration failed");
            } else {
              reject(genErr);
            }
          });
      });

      const newDocId = await rowReady;
      responded = true;
      res.status(202).json({ regenerated: true, docId: newDocId, status: "generating" });
    } catch (err) {
      log.error({ err, userId }, "POST /portal/assessment/sow/select failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to update statement of work scope" });
    }
  },
);

// ── Comparison mode — side-by-side SOW scope versions ──────────────────────────
//
// Non-obvious feature from the original product spec: let the customer compare
// their SOW scope/pricing across versions (e.g. full scope vs. a narrower
// re-scope). Real historical versions already exist in storage — every
// superseded regeneration is archived, not deleted (see the versioning note
// above `loadSowDocs`) — so this is a read-only view over data already produced
// by the scope selector (task 4); it does not generate anything new.
//
// Only scope-vs-scope (SOW version vs. SOW version) is genuinely comparable
// today: every version shares the same sowPricingLines shape. A second
// "free assessment result vs. paid upgrade" comparison was investigated and
// found NOT buildable from real data — msp_diagnostic_findings (discrete
// per-check severity rows) and insights_generated_documents.sowPricingLines
// (priced workstream phases) share no common key or joinable field, so that
// comparison is not implemented here rather than fabricated.
router.get(
  "/portal/assessment/sow/versions",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const docs = await loadSowDocs(userId);
      const real = docs.filter((d) => (SOW_REAL_STATUSES as readonly string[]).includes(d.status));
      const versions = [...real]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((d) => ({
          id: d.id,
          title: d.title,
          status: d.status,
          createdAt: d.createdAt.toISOString(),
          isActive: (SOW_ACTIVE_STATUSES as readonly string[]).includes(d.status),
          totalPrice: d.sowTotalPrice != null ? Number(d.sowTotalPrice) : null,
          workstreams: workstreamLinesOf(d).map((l) => ({
            title: l.title,
            scope: l.scope,
            priceUsd: l.priceUsd,
            weeks: l.weeks ?? null,
            deliveryDate: l.deliveryDate ?? null,
          })),
          adjustments: adjustmentLinesOf(d).map((l) => ({
            title: l.title,
            scope: l.scope,
            priceUsd: l.priceUsd,
          })),
        }));
      res.json({ versions });
    } catch (err) {
      log.error({ err, userId }, "GET /portal/assessment/sow/versions failed");
      res.status(500).json({ error: "Failed to load statement of work versions" });
    }
  },
);

// ════════════════════════════════════════════════════════════════════════════
// Task 5 — Assessment payment plan: choice, signature, checkout
// ════════════════════════════════════════════════════════════════════════════
//
// After the customer settles a scope in the interactive selector (Task 4), they
// pick a payment plan, sign, and pay. Everything here reads the SAME active
// consolidated_sow + pricing-window state built above — it never re-derives
// pricing or re-opens the scope selector.
//
// Deliverable map:
//   • Pay-in-full  — REAL, end-to-end. Discount applied via the live PAY-TODAY
//     coupon (the platform's real coupon system, same one the CRM presentation
//     flow uses) as an ephemeral Stripe coupon on a hosted Checkout Session,
//     mirroring portal.ts's proven `discounts: [{ coupon }]` pattern. $0 scopes
//     skip Stripe. CAPTCHA gated. Marked paid by the dedicated webhook below.
//   • Phased       — presented with a real per-phase breakdown, but its
//     "proceed" does NOT create a Stripe charge. See the blocker note below.
//   • Signature    — drawn-signature PNG (same contract as customer-sow.tsx),
//     tied to the exact doc + scope + price via assessment_sow_agreements.
//
// ── PHASED-PAYMENT BLOCKER (investigated, reported, NOT worked around) ─────────
// The platform's automatic per-phase invoicing is genuinely unavailable to the
// Assessment SOW:
//   • create_phased_invoices (the ENABLED node that creates the per-phase Stripe
//     invoices) sources its schedule EXCLUSIVELY from
//     quick_win_presentations.paymentSchedule (workflow-executor.ts ~7159-7176),
//     erroring "no phased payment schedule found for project" otherwise.
//   • That paymentSchedule is written ONLY by the CRM presentation checkout
//     (portal.ts ~13097) — a CustomerUser-gated flow in the presentation/project
//     entity space. The Assessment consolidated_sow lives in
//     insights_generated_documents (users.id space) and never populates it.
//   • edit_stripe_invoice (the due-date sync node) sits in a triggerEnabled:false
//     workflow and resolves invoices via projects.clientUserId → Stripe customer
//     → draft invoice tagged metadata.projectId — drafts that only exist once
//     create_phased_invoices has run, which it can't here.
// Wiring real phased auto-collection would require either bridging every
// Assessment SOW into the CRM quick_win_presentations/projects space (touching
// the known-fragile projectId→mspId/customerId linkage) or inventing a new
// recurring-charge mechanism — both out of scope for "mirror the proven pattern".
// So per the task's stop-and-report rule, phased is captured as a SIGNED
// agreement handed to the provider (status awaiting_provider_setup), never a
// Stripe deposit that silently can't invoice the remainder.

// The real, live coupon that carries the pay-in-full discount (shared with the
// CRM presentation flow, so both surfaces show the same discounted number for
// the same coupon). Assessment has no separate hardcoded discount.
const PAY_IN_FULL_COUPON_CODE = "PAY-TODAY";

type ReadySowState = Extract<ReturnType<typeof buildSowState>, { ready: true }>;

/** Sum the currently-selected workstream phases + mandatory adjustments (USD). */
function effectiveSowTotals(state: ReadySowState): {
  workstreamTotal: number;
  adjustmentsTotal: number;
  total: number;
} {
  const selected = new Set(state.selectedWorkstreamTitles);
  const workstreamTotal = state.allWorkstreams
    .filter((w) => selected.has(w.title))
    .reduce((s, w) => s + w.priceUsd, 0);
  const adjustmentsTotal = state.adjustments.reduce((s, a) => s + a.priceUsd, 0);
  return { workstreamTotal, adjustmentsTotal, total: workstreamTotal + adjustmentsTotal };
}

type CouponRow = typeof couponsTable.$inferSelect;

interface PayInFullOffer {
  active: boolean;
  originalCents: number;
  discountedCents: number;
  savingsCents: number;
  variant: "adjustments_waived" | "percentage_off" | null;
  discountPct: number | null;
}

/**
 * Pay-in-full discount, computed exactly as the CRM presentation offer does
 * (portal.ts ~12190-12212) so the two flows agree to the cent: within the 72h
 * discount window, adjustments-waived when there are positive adjustment lines,
 * otherwise percentage-off from the coupon's discountValue.
 */
function computePayInFullOffer(
  totalDollars: number,
  adjustmentsDollars: number,
  windowState: "discount" | "standard" | "expired",
  coupon: CouponRow | null,
): PayInFullOffer {
  const originalCents = Math.round(totalDollars * 100);
  const inactive: PayInFullOffer = {
    active: false, originalCents, discountedCents: originalCents, savingsCents: 0, variant: null, discountPct: null,
  };
  if (windowState !== "discount" || !coupon || !coupon.active) return inactive;
  if (coupon.expiresAt && coupon.expiresAt < new Date()) return inactive;
  if (originalCents <= 0) return inactive;

  const adjustmentsCents = Math.round(adjustmentsDollars * 100);
  if (adjustmentsCents > 0) {
    const discountedCents = originalCents - adjustmentsCents;
    return { active: true, originalCents, discountedCents, savingsCents: adjustmentsCents, variant: "adjustments_waived", discountPct: null };
  }
  const rawPct = parseFloat(String(coupon.discountValue));
  const pct = rawPct / 100;
  const discountedCents = Math.round(originalCents * (1 - pct));
  return { active: true, originalCents, discountedCents, savingsCents: originalCents - discountedCents, variant: "percentage_off", discountPct: rawPct };
}

async function loadPayInFullCoupon(): Promise<CouponRow | null> {
  const [coupon] = await db
    .select()
    .from(couponsTable)
    .where(and(eq(couponsTable.code, PAY_IN_FULL_COUPON_CODE), eq(couponsTable.active, true)))
    .limit(1);
  return coupon ?? null;
}

/** Minimal Stripe-customer resolver (email match, else create) for a users.id. */
async function resolveStripeCustomerForUser(
  stripe: import("stripe").Stripe,
  userId: number,
): Promise<{ customerId: string | undefined; email: string | null }> {
  const [profile] = await db
    .select({
      email: usersTable.email, name: usersTable.name, address: usersTable.address,
      addressCity: usersTable.addressCity, addressState: usersTable.addressState, addressZip: usersTable.addressZip,
    })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);
  if (!profile?.email) return { customerId: undefined, email: null };
  try {
    const existing = await stripe.customers.search({ query: `email:"${profile.email}"`, limit: 1 });
    if (existing.data.length > 0 && existing.data[0]) return { customerId: existing.data[0].id, email: profile.email };
    const hasAddress = !!(profile.address || profile.addressCity || profile.addressState || profile.addressZip);
    const created = await stripe.customers.create({
      email: profile.email,
      name: profile.name ?? undefined,
      ...(hasAddress
        ? { address: { line1: profile.address ?? undefined, city: profile.addressCity ?? undefined, state: profile.addressState ?? undefined, postal_code: profile.addressZip ?? undefined, country: "US" } }
        : {}),
    });
    return { customerId: created.id, email: profile.email };
  } catch (err) {
    billingLog.warn({ err, userId }, "assessment-checkout: stripe customer resolution failed (non-fatal)");
    return { customerId: undefined, email: profile.email };
  }
}

/** Resolve tenants.id + msp_id for tenant scoping on the agreement row. */
async function resolveTenantForCustomer(customerId: number | null): Promise<{ customerId: number | null; mspId: number | null }> {
  if (customerId === null) return { customerId: null, mspId: null };
  const [row] = await db
    .select({ mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);
  return { customerId, mspId: row?.mspId ?? null };
}

// ── GET /portal/assessment/sow/payment-options ────────────────────────────────
//
// Everything the payment step needs: the effective total for the active scope,
// the live pay-in-full discount (if inside the 72h window), the per-phase
// breakdown for the phased option, and any existing agreement so a returning
// customer sees their confirmed/paid state instead of re-paying.
router.get(
  "/portal/assessment/sow/payment-options",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }
    try {
      const docs = await loadSowDocs(userId);
      const state = buildSowState(docs);
      if (!state.ready) {
        res.json({ ready: false, regenerating: state.regenerating });
        return;
      }

      const totals = effectiveSowTotals(state);
      const coupon = await loadPayInFullCoupon();
      const offer = computePayInFullOffer(totals.total, totals.adjustmentsTotal, state.pricing.windowState, coupon);

      // Per-phase breakdown for the phased option — each selected workstream is a
      // milestone (same sowPricingLines the selector uses); adjustments are billed
      // with the first milestone.
      const selected = new Set(state.selectedWorkstreamTitles);
      const phases = state.allWorkstreams
        .filter((w) => selected.has(w.title))
        .map((w) => ({ title: w.title, amount: w.priceUsd, deliveryDate: w.deliveryDate }));

      // Existing agreement (most recent) so the UI can show a terminal state.
      const [existing] = await db
        .select({
          status: assessmentSowAgreementsTable.status,
          paymentPlan: assessmentSowAgreementsTable.paymentPlan,
          signerName: assessmentSowAgreementsTable.signerName,
          signedAt: assessmentSowAgreementsTable.signedAt,
        })
        .from(assessmentSowAgreementsTable)
        .where(and(eq(assessmentSowAgreementsTable.docId, state.doc.id), eq(assessmentSowAgreementsTable.clientUserId, userId)))
        .orderBy(desc(assessmentSowAgreementsTable.createdAt))
        .limit(1);

      res.json({
        ready: true,
        docId: state.doc.id,
        currency: "usd",
        total: totals.total,
        adjustmentsTotal: totals.adjustmentsTotal,
        selectedWorkstreamTitles: state.selectedWorkstreamTitles,
        pricing: state.pricing,
        payInFull: {
          active: offer.active,
          discountedTotal: offer.active ? offer.discountedCents / 100 : null,
          savings: offer.active ? offer.savingsCents / 100 : null,
          variant: offer.variant,
          discountPct: offer.discountPct,
          couponCode: offer.active ? PAY_IN_FULL_COUPON_CODE : null,
        },
        phased: {
          // Milestone billing is provider-arranged for Assessment (see blocker note) —
          // the breakdown is informational; there is no self-serve deposit charge.
          selfServe: false,
          phases,
          total: totals.total,
        },
        existingAgreement: existing
          ? { status: existing.status, paymentPlan: existing.paymentPlan, signerName: existing.signerName, signedAt: existing.signedAt }
          : null,
      });
    } catch (err) {
      billingLog.error({ err, userId }, "GET /portal/assessment/sow/payment-options failed");
      res.status(500).json({ error: "Failed to load payment options" });
    }
  },
);

// ── POST /portal/assessment/sow/checkout ──────────────────────────────────────
//
// CAPTCHA-gated. Records the signed agreement (tied to the exact active scope +
// price) and branches:
//   • $0 scope         → free_activated, no Stripe.
//   • paymentPlan full → hosted Stripe Checkout (real coupon discount in-window);
//                        marked paid by the webhook below.
//   • paymentPlan phased → awaiting_provider_setup, no Stripe (blocker above).
router.post(
  "/portal/assessment/sow/checkout",
  requireRole("Assessment"),
  async (req: Request, res: Response): Promise<void> => {
    const userId = req.user?.id;
    const claimCustomerId = resolveCustomerId(req);
    if (userId == null) {
      res.status(403).json({ error: "No customer identity on token" });
      return;
    }

    const body = (req.body ?? {}) as {
      captchaToken?: string;
      paymentPlan?: string;
      applyPayInFull?: boolean;
      signatureData?: string;
      signerName?: string;
      selectedWorkstreamTitles?: unknown;
    };

    // CAPTCHA — same required-token → verify → 403 gate as portal-checkout.ts.
    if (!body.captchaToken) {
      res.status(400).json({ error: "CAPTCHA token is required" });
      return;
    }
    const captcha = await verifyCaptchaToken(body.captchaToken);
    if (!captcha.success) {
      res.status(403).json({ error: "CAPTCHA verification failed" });
      return;
    }

    const paymentPlan = body.paymentPlan;
    if (paymentPlan !== "full" && paymentPlan !== "phased") {
      res.status(400).json({ error: "paymentPlan must be 'full' or 'phased'" });
      return;
    }

    // Signature — drawn PNG data URL + typed legal name (same contract enforced
    // by the CRM sign route: data:image/ prefix, non-trivial length).
    const signatureData = typeof body.signatureData === "string" ? body.signatureData : "";
    const signerName = typeof body.signerName === "string" ? body.signerName.trim() : "";
    if (!signatureData.startsWith("data:image/") || signatureData.length < 100) {
      res.status(400).json({ error: "A drawn signature is required" });
      return;
    }
    if (!signerName) {
      res.status(400).json({ error: "Your full legal name is required to sign" });
      return;
    }

    try {
      const docs = await loadSowDocs(userId);
      const state = buildSowState(docs);
      if (!state.ready) {
        res.status(409).json({ error: "No active statement of work to pay for yet" });
        return;
      }
      if (state.regenerating) {
        res.status(409).json({ error: "Your scope is still updating — please wait for it to finish before paying" });
        return;
      }
      if (state.pricing.windowState === "expired") {
        res.status(409).json({ error: "This statement of work has expired. A fresh scan is needed for current pricing." });
        return;
      }

      // Integrity: the signature must bind to the exact scope the customer is
      // looking at. Reject if the submitted scope no longer matches the active
      // document (e.g. a concurrent re-scope), so no one signs a stale price.
      const submitted = body.selectedWorkstreamTitles;
      if (!Array.isArray(submitted) || !submitted.every((t) => typeof t === "string")) {
        res.status(400).json({ error: "selectedWorkstreamTitles must be an array of strings" });
        return;
      }
      const submittedKey = normalizeSet(submitted as string[]);
      const activeKey = normalizeSet(state.selectedWorkstreamTitles);
      if (submittedKey !== activeKey) {
        res.status(409).json({ code: "scope_changed", error: "Your scope changed since you reviewed it. Please re-check your selection and sign again." });
        return;
      }

      // Don't let a customer pay twice for the same signed document.
      const [alreadyPaid] = await db
        .select({ id: assessmentSowAgreementsTable.id })
        .from(assessmentSowAgreementsTable)
        .where(and(
          eq(assessmentSowAgreementsTable.docId, state.doc.id),
          eq(assessmentSowAgreementsTable.clientUserId, userId),
          inArray(assessmentSowAgreementsTable.status, ["paid", "free_activated"]),
        ))
        .limit(1);
      if (alreadyPaid) {
        res.status(409).json({ error: "This statement of work has already been settled." });
        return;
      }

      const totals = effectiveSowTotals(state);
      const coupon = await loadPayInFullCoupon();
      const offer = computePayInFullOffer(totals.total, totals.adjustmentsTotal, state.pricing.windowState, coupon);
      const tenant = await resolveTenantForCustomer(claimCustomerId);
      const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ?? req.socket.remoteAddress ?? null;

      // Common agreement fields.
      const baseAgreement = {
        docId: state.doc.id,
        clientUserId: userId,
        customerId: tenant.customerId ?? undefined,
        mspId: tenant.mspId ?? undefined,
        selectedWorkstreamTitles: state.selectedWorkstreamTitles,
        scopeKey: activeKey,
        agreedTotalCents: offer.originalCents,
        windowStateAtSigning: state.pricing.windowState,
        signatureData,
        signerName,
        signatureIp: ip ?? undefined,
      } as const;

      // ── Branch: $0 scope → activate without Stripe ──────────────────────────
      if (offer.originalCents <= 0) {
        await db.insert(assessmentSowAgreementsTable).values({
          ...baseAgreement,
          paymentPlan,
          status: "free_activated",
          paidAt: new Date(),
        });
        billingLog.info({ userId, docId: state.doc.id }, "assessment-checkout: $0 scope activated without Stripe");
        res.json({ outcome: "free_activated", message: "Your statement of work has been activated." });
        return;
      }

      // ── Branch: phased → capture signed agreement, hand to provider ─────────
      // No Stripe charge (see blocker note). Honest: we record the signed SOW and
      // the plan preference; the provider arranges milestone billing.
      if (paymentPlan === "phased") {
        const [row] = await db.insert(assessmentSowAgreementsTable).values({
          ...baseAgreement,
          paymentPlan: "phased",
          status: "awaiting_provider_setup",
        }).returning({ id: assessmentSowAgreementsTable.id });
        billingLog.info({ userId, docId: state.doc.id, agreementId: row?.id }, "assessment-checkout: phased plan signed — handed to provider for milestone billing");
        res.json({
          outcome: "provider_setup",
          message: "You're all set. Your statement of work is signed — your provider will reach out to set up milestone billing for each phase.",
        });
        return;
      }

      // ── Branch: pay-in-full → hosted Stripe Checkout ────────────────────────
      let stripeKey: string;
      try {
        stripeKey = getStripeKey();
      } catch {
        res.status(503).json({ error: "Payment service is not configured. Please contact support." });
        return;
      }
      const { default: Stripe } = await import("stripe");
      const stripe = new Stripe(stripeKey);

      const { customerId: stripeCustomerId } = await resolveStripeCustomerForUser(stripe, userId);

      // Apply the discount as a real, traceable Stripe coupon (Pattern B) — only
      // when the customer opted in AND the offer is genuinely live server-side.
      const applyDiscount = body.applyPayInFull === true && offer.active;
      let stripeDiscounts: Array<{ coupon: string }> = [];
      let couponCodeApplied: string | null = null;
      let discountedTotalCents: number | null = null;
      if (applyDiscount) {
        const discountCents = offer.originalCents - offer.discountedCents;
        if (discountCents > 0) {
          const stripeCoupon = await stripe.coupons.create({
            amount_off: discountCents,
            currency: "usd",
            duration: "once",
            name: "Pay-in-Full Discount",
            metadata: { docId: String(state.doc.id), couponCode: PAY_IN_FULL_COUPON_CODE, flow: "assessment" },
          });
          stripeDiscounts = [{ coupon: stripeCoupon.id }];
          couponCodeApplied = PAY_IN_FULL_COUPON_CODE;
          discountedTotalCents = offer.discountedCents;
        }
      }

      // Insert the agreement first so the session metadata can reference it, and
      // so an abandoned checkout still leaves a pending_payment audit trail.
      const [agreement] = await db.insert(assessmentSowAgreementsTable).values({
        ...baseAgreement,
        paymentPlan: "full",
        status: "pending_payment",
        couponCode: couponCodeApplied ?? undefined,
        discountedTotalCents: discountedTotalCents ?? undefined,
      }).returning({ id: assessmentSowAgreementsTable.id });

      if (!agreement) {
        res.status(500).json({ error: "Failed to record agreement" });
        return;
      }

      const portalBase = getMspPortalBaseUrl(); // ends in /portal
      // Charge the full price and let Stripe apply the coupon on top, so the
      // discount shows as a transparent line item (same as portal.ts:13029-13034).
      const session = await stripe.checkout.sessions.create({
        payment_method_types: ["card"],
        customer: stripeCustomerId,
        billing_address_collection: "required",
        ...(stripeDiscounts.length > 0 && { discounts: stripeDiscounts }),
        line_items: [{
          price_data: {
            currency: "usd",
            product_data: { name: `${state.doc.title} — Full Payment` },
            unit_amount: offer.originalCents,
          },
          quantity: 1,
        }],
        mode: "payment",
        success_url: `${portalBase}/assessment?payment=success`,
        cancel_url: `${portalBase}/assessment?payment=cancelled`,
        metadata: {
          type: "assessment_checkout",
          agreementId: String(agreement.id),
          docId: String(state.doc.id),
          userId: String(userId),
          paymentPlan: "full",
          totalPrice: String(totals.total),
          ...(couponCodeApplied ? { couponCode: couponCodeApplied } : {}),
          ...(discountedTotalCents !== null ? { discountedTotal: String(discountedTotalCents / 100) } : {}),
        },
      });

      await db.update(assessmentSowAgreementsTable)
        .set({ stripeSessionId: session.id, updatedAt: new Date() })
        .where(eq(assessmentSowAgreementsTable.id, agreement.id));

      billingLog.info(
        { userId, docId: state.doc.id, agreementId: agreement.id, sessionId: session.id, discountApplied: couponCodeApplied != null },
        "assessment-checkout: pay-in-full Stripe Checkout session created",
      );
      res.json({ outcome: "checkout", url: session.url });
    } catch (err) {
      billingLog.error({ err, userId }, "POST /portal/assessment/sow/checkout failed");
      if (!res.headersSent) res.status(500).json({ error: "Failed to start checkout" });
    }
  },
);

// ── POST /portal/assessment/stripe/webhook ────────────────────────────────────
//
// Dedicated webhook for the Assessment pay-in-full checkout — separate event set
// and fulfillment from the per-offer portal webhook (portal-checkout.ts). Marks
// the agreement paid and records coupon redemption. It deliberately does NOT emit
// agreement_signed: that event triggers create_phased_invoices, which is bound to
// the CRM presentation/project space and would error for an Assessment SOW.
//
// Raw body for signature verification is registered in app.ts.
router.post("/portal/assessment/stripe/webhook", async (req: Request, res: Response): Promise<void> => {
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    res.status(400).json({ error: "Missing stripe-signature header" });
    return;
  }
  const webhookSecret =
    process.env["PORTAL_STRIPE_WEBHOOK_SECRET"] ??
    process.env["STRIPE_WEBHOOK_SECRET"] ??
    "";

  let stripeKey: string;
  try {
    stripeKey = getStripeKey();
  } catch (err) {
    billingLog.warn({ err }, "assessment-webhook: Stripe not configured, ignoring event");
    res.status(200).json({ received: true });
    return;
  }
  const { default: Stripe } = await import("stripe");
  const stripe = new Stripe(stripeKey);

  let event: import("stripe").Stripe.Event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(req.body as Buffer, sig as string, webhookSecret);
    } else {
      billingLog.warn({}, "assessment-webhook: no webhook secret configured — skipping signature verification");
      event = JSON.parse((req.body as Buffer).toString()) as import("stripe").Stripe.Event;
    }
  } catch (err) {
    billingLog.warn({ err }, "assessment-webhook: signature verification failed");
    res.status(400).json({ error: "Webhook signature verification failed" });
    return;
  }

  // Acknowledge fast; Stripe requires a quick 2xx.
  res.status(200).json({ received: true });

  try {
    if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return;
    const session = event.data.object as import("stripe").Stripe.Checkout.Session;
    if (session.metadata?.["type"] !== "assessment_checkout") return;
    if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") {
      billingLog.info({ sessionId: session.id, paymentStatus: session.payment_status }, "assessment-webhook: session not paid — skipping");
      return;
    }

    const agreementId = parseInt(session.metadata?.["agreementId"] ?? "", 10);
    // Match on agreementId (primary) or stripe_session_id (belt-and-suspenders).
    const [agreement] = await db
      .select({ id: assessmentSowAgreementsTable.id, status: assessmentSowAgreementsTable.status })
      .from(assessmentSowAgreementsTable)
      .where(
        !isNaN(agreementId)
          ? eq(assessmentSowAgreementsTable.id, agreementId)
          : eq(assessmentSowAgreementsTable.stripeSessionId, session.id),
      )
      .limit(1);

    if (!agreement) {
      billingLog.warn({ sessionId: session.id, agreementId }, "assessment-webhook: no matching agreement — skipping");
      return;
    }
    if (agreement.status !== "paid") {
      await db.update(assessmentSowAgreementsTable)
        .set({ status: "paid", paidAt: new Date(), stripeSessionId: session.id, updatedAt: new Date() })
        .where(eq(assessmentSowAgreementsTable.id, agreement.id));
      billingLog.info({ agreementId: agreement.id, sessionId: session.id }, "assessment-webhook: agreement marked paid");
    }

    // Coupon redemption — idempotent by checkout_session_id, exactly as
    // portal.ts:5386-5406.
    const couponCodeUsed = session.metadata?.["couponCode"];
    if (couponCodeUsed) {
      const redemptionUserId = session.metadata?.["userId"] ? (parseInt(session.metadata["userId"], 10) || null) : null;
      const purchaseAmount = session.amount_total != null ? String(session.amount_total / 100) : null;
      const discountAmount = (session.total_details as { amount_discount?: number } | null)?.amount_discount != null
        ? String((session.total_details as { amount_discount: number }).amount_discount / 100)
        : null;
      try {
        const insertResult = await db.execute(
          sql`INSERT INTO coupon_redemptions (coupon_code, checkout_session_id, coupon_id, user_id, purchase_amount, discount_amount)
              VALUES (
                ${couponCodeUsed},
                ${session.id},
                (SELECT id FROM coupons WHERE code = ${couponCodeUsed}),
                ${redemptionUserId},
                ${purchaseAmount},
                ${discountAmount}
              )
              ON CONFLICT (checkout_session_id) DO NOTHING`,
        );
        if (((insertResult as { rowCount?: number }).rowCount ?? 0) > 0) {
          await db.update(couponsTable)
            .set({
              usesCount: sql`${couponsTable.usesCount} + 1`,
              active: sql`CASE WHEN ${couponsTable.maxUses} IS NOT NULL AND ${couponsTable.usesCount} + 1 >= ${couponsTable.maxUses} THEN false ELSE ${couponsTable.active} END`,
            })
            .where(eq(couponsTable.code, couponCodeUsed));
        }
      } catch (err) {
        billingLog.warn({ err, couponCode: couponCodeUsed, sessionId: session.id }, "assessment-webhook: failed to record coupon redemption (non-fatal)");
      }
    }
  } catch (err) {
    billingLog.error({ err, eventType: event.type, eventId: event.id }, "assessment-webhook: handler failed");
  }
});

export default router;
