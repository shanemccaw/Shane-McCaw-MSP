/**
 * diagnostics-runner.ts
 *
 * Core diagnostics pipeline. Triggered by MSP operators (or event-driven).
 * Executes Monitoring Package checks for a customer tenant, structures results
 * as findings, generates an HTML report routed through the Document Pipeline,
 * and surfaces failures as operator tasks.
 *
 * Sequence:
 *   1. Create msp_diagnostic_runs row (status = pending)
 *   2. Load monitoring package + checks
 *   3. Execute each check via executeMonitoringPackage (onProgress → SSE)
 *   4. Map check results → msp_diagnostic_findings rows
 *   5. Generate HTML report → msp_documents + doc pipeline
 *   6. Update run status = completed | failed | partial
 *   7. On failure: create portal_wf_runs stub + operator task
 */

import { db } from "@workspace/db";
import {
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  mspCustomersTable,
  mspDocumentsTable,
  portalWfRunsTable,
  portalWfOperatorTasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { executeMonitoringPackage, type CheckResult } from "./monitor-executor";
import {
  broadcastDiagnosticsRunProgress,
  broadcastDiagnosticsRunComplete,
  broadcastDiagnosticsRunError,
  clearDiagnosticsRunSSEState,
} from "./sse-broadcast";
import { logger } from "./logger";

// ── Finding severity classification ──────────────────────────────────────────

type FindingSeverity = "ok" | "info" | "warning" | "critical";

function classifyCheckSeverity(result: CheckResult): FindingSeverity {
  if (result.status === "consent_revoked") return "critical";
  if (result.status === "error") return "warning";
  if (result.status === "requires_script") return "info";
  if (result.severityMatched) {
    const s = result.severityMatched.toLowerCase();
    if (s === "critical" || s === "high") return "critical";
    if (s === "warning" || s === "medium") return "warning";
    if (s === "low") return "info";
  }
  return "ok";
}

function buildFindingTitle(result: CheckResult): string {
  if (result.status === "consent_revoked") return "Consent Revoked — Check could not run";
  if (result.status === "error") return `Check error: ${result.checkKey}`;
  if (result.status === "requires_script") return "Requires customer-side script";
  if (result.severityMatched) return `${result.severityMatched} finding detected`;
  return "Check passed";
}

function buildFindingDescription(result: CheckResult): string {
  if (result.status === "consent_revoked") {
    return "Application consent has been revoked. No Graph API checks can run for this tenant until consent is re-established.";
  }
  if (result.status === "error") {
    return result.errorMessage ?? "An unexpected error occurred executing this check.";
  }
  if (result.status === "requires_script") {
    return "This check requires a PowerShell runbook to run in the customer's environment. Results will appear after the script is executed.";
  }
  const props = result.extractedProperties;
  if (props && Object.keys(props).length > 0) {
    const items = Object.entries(props)
      .filter(([k]) => !k.startsWith("_"))
      .slice(0, 5)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("; ");
    return items || "No notable properties extracted.";
  }
  return "No issues detected for this check.";
}

function buildRecommendation(result: CheckResult): Record<string, unknown> | null {
  if (result.status === "ok" && !result.severityMatched) return null;

  const rec: Record<string, unknown> = {};
  const severity = classifyCheckSeverity(result);

  if (result.status === "consent_revoked") {
    rec.action = "Re-establish application consent for the customer tenant";
    rec.priority = 1;
    rec.category = "consent";
  } else if (result.status === "error") {
    rec.action = "Investigate and resolve the check execution error";
    rec.priority = 2;
    rec.category = "reliability";
  } else if (result.status === "requires_script") {
    rec.action = "Execute the required PowerShell runbook for this check";
    rec.priority = 3;
    rec.category = "script";
  } else if (severity === "critical") {
    rec.action = "Immediate remediation required — critical finding";
    rec.priority = 1;
    rec.category = "security";
    rec.signalKey = result.checkKey;
  } else if (severity === "warning") {
    rec.action = "Review and remediate this finding";
    rec.priority = 2;
    rec.category = "governance";
    rec.signalKey = result.checkKey;
  }

  return Object.keys(rec).length > 0 ? rec : null;
}

// ── HTML report generator ─────────────────────────────────────────────────────

function buildReportHtml(opts: {
  customerName: string;
  runId: string;
  packageKey: string;
  findings: Array<{
    checkKey: string;
    checkLabel: string;
    severity: FindingSeverity;
    title: string;
    description: string;
  }>;
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  generatedAt: string;
}): string {
  const { customerName, runId, packageKey, findings, checksTotal, checksOk, checksError, requiresScript, generatedAt } = opts;

  const severityBadge = (s: FindingSeverity) => {
    const map: Record<FindingSeverity, string> = {
      critical: "background:#dc2626;color:#fff",
      warning: "background:#d97706;color:#fff",
      info: "background:#2563eb;color:#fff",
      ok: "background:#16a34a;color:#fff",
    };
    return `<span style="padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600;${map[s]}">${s.toUpperCase()}</span>`;
  };

  const findingsHtml = findings.length === 0
    ? "<p>No findings were generated for this run.</p>"
    : findings.map(f => `
      <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px;">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;">
          ${severityBadge(f.severity)}
          <strong style="font-size:14px;">${f.checkLabel || f.checkKey}</strong>
        </div>
        <p style="font-size:13px;color:#374151;margin:4px 0 8px;">${f.title}</p>
        <p style="font-size:12px;color:#6b7280;margin:0;">${f.description}</p>
      </div>`).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Diagnostics Report — ${customerName}</title></head>
<body style="font-family:Helvetica,Arial,sans-serif;max-width:800px;margin:0 auto;padding:40px 24px;color:#111;">
  <h1 style="font-size:22px;font-weight:700;margin-bottom:4px;">Microsoft 365 Diagnostics Report</h1>
  <p style="font-size:14px;color:#6b7280;margin:0 0 24px;">Customer: <strong>${customerName}</strong> &middot; Run ID: ${runId.slice(0, 8)} &middot; Package: ${packageKey}</p>
  <p style="font-size:12px;color:#9ca3af;margin:0 0 32px;">Generated: ${generatedAt}</p>

  <h2 style="font-size:16px;font-weight:600;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:16px;">Summary</h2>
  <table style="border-collapse:collapse;width:100%;font-size:13px;margin-bottom:32px;">
    <tr style="background:#f9fafb;">
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Total Checks</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;">${checksTotal}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Passed</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#16a34a;">${checksOk}</td>
    </tr>
    <tr style="background:#f9fafb;">
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Errors</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#dc2626;">${checksError}</td>
    </tr>
    <tr>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Requires Script</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#d97706;">${requiresScript}</td>
    </tr>
  </table>

  <h2 style="font-size:16px;font-weight:600;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:16px;">Findings</h2>
  ${findingsHtml}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="font-size:11px;color:#9ca3af;">Report generated by Shane McCaw Consulting MSP Platform &middot; Confidential</p>
</body>
</html>`;
}

// ── Operator task creation on failure ─────────────────────────────────────────

async function createFailureOperatorTask(opts: {
  runId: string;
  mspId: number;
  customerId: number;
  customerName: string;
  errorMessage: string;
}): Promise<void> {
  try {
    const stubRunId = randomUUID();
    await db.insert(portalWfRunsTable).values({
      runId: stubRunId,
      workflowKey: "diagnostics.run",
      tenantContext: { mspId: opts.mspId, customerId: opts.customerId },
      status: "failed",
      inputPayload: { diagnosticRunId: opts.runId },
      errorMessage: opts.errorMessage,
      mspId: opts.mspId,
      customerId: opts.customerId,
      startedAt: new Date(),
      completedAt: new Date(),
    });

    await db.insert(portalWfOperatorTasksTable).values({
      runId: stubRunId,
      workflowKey: "diagnostics.run",
      severity: "error",
      title: `Diagnostics run failed for ${opts.customerName}`,
      description: opts.errorMessage.slice(0, 500),
      deepLink: `/customers/${opts.customerId}/diagnostics`,
      mspId: opts.mspId,
      customerId: opts.customerId,
    });
  } catch (err) {
    logger.warn({ err, runId: opts.runId }, "diagnostics-runner: failed to create operator task (non-fatal)");
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

export interface DiagnosticsRunOpts {
  mspId: number;
  customerId: number;
  packageKey?: string;
  triggeredByUserId?: number;
}

export interface DiagnosticsRunResult {
  runId: string;
  status: "completed" | "failed" | "partial";
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  findingsCount: number;
  documentId?: string;
}

export async function runDiagnostics(opts: DiagnosticsRunOpts): Promise<DiagnosticsRunResult> {
  const { mspId, customerId, packageKey = "default", triggeredByUserId } = opts;

  // 1. Resolve customer
  const [customer] = await db
    .select({ id: mspCustomersTable.id, name: mspCustomersTable.name, tenantId: mspCustomersTable.tenantId })
    .from(mspCustomersTable)
    .where(eq(mspCustomersTable.id, customerId))
    .limit(1);

  if (!customer) throw new Error(`Customer ${customerId} not found`);
  const tenantId = customer.tenantId ?? String(customerId);

  // 2. Create run record
  const [runRow] = await db
    .insert(mspDiagnosticRunsTable)
    .values({
      mspId,
      customerId,
      packageKey,
      status: "pending",
      triggeredByUserId: triggeredByUserId ?? null,
    })
    .returning({ runId: mspDiagnosticRunsTable.runId });

  const runId = runRow!.runId;

  logger.info({ runId, mspId, customerId, packageKey }, "diagnostics-runner: run started");

  // Update to running
  await db
    .update(mspDiagnosticRunsTable)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(mspDiagnosticRunsTable.runId, runId));

  try {
    // 3. Execute monitoring package
    const triggerId = `diag-run-${runId}`;

    const pkgResult = await executeMonitoringPackage({
      packageKey,
      tenantId,
      triggerId,
      onProgress: (evt) => {
        broadcastDiagnosticsRunProgress(runId, {
          checkKey: evt.checkKey,
          checkLabel: evt.checkLabel,
          status: evt.status,
          index: evt.index,
          total: evt.total,
          requiresCustomerScript: evt.requiresCustomerScript,
          errorMessage: evt.errorMessage,
        });
      },
    });

    const checksTotal = pkgResult.checks.length;
    const checksOk = pkgResult.checks.filter(c => c.status === "ok").length;
    const checksError = pkgResult.checks.filter(c => c.status === "error" || c.status === "consent_revoked").length;
    const requiresScript = pkgResult.checks.filter(c => c.status === "requires_script").length;

    // 4. Persist structured findings
    const findingRows: Array<typeof mspDiagnosticFindingsTable.$inferInsert> = [];

    for (const checkResult of pkgResult.checks) {
      const severity = classifyCheckSeverity(checkResult);
      const title = buildFindingTitle(checkResult);
      const description = buildFindingDescription(checkResult);
      const recommendation = buildRecommendation(checkResult);

      findingRows.push({
        runId,
        mspId,
        customerId,
        checkKey: checkResult.checkKey,
        checkLabel: checkResult.checkKey,
        severity,
        title,
        description,
        recommendation: recommendation as Record<string, unknown> | null | undefined,
        extractedProperties: checkResult.extractedProperties as Record<string, unknown>,
        checkStatus: checkResult.status,
      });
    }

    let findingsCount = 0;
    if (findingRows.length > 0) {
      const inserted = await db
        .insert(mspDiagnosticFindingsTable)
        .values(findingRows)
        .returning({ findingId: mspDiagnosticFindingsTable.findingId });
      findingsCount = inserted.length;
    }

    // 5. Generate HTML report → Document Pipeline
    let documentId: string | undefined;
    try {
      const reportHtml = buildReportHtml({
        customerName: customer.name,
        runId,
        packageKey,
        findings: findingRows.map(f => ({
          checkKey: f.checkKey,
          checkLabel: f.checkLabel,
          severity: f.severity as FindingSeverity,
          title: f.title,
          description: f.description ?? "",
        })),
        checksTotal,
        checksOk,
        checksError,
        requiresScript,
        generatedAt: new Date().toUTCString(),
      });

      const docTitle = `Diagnostics Report — ${customer.name} — ${new Date().toISOString().split("T")[0]}`;
      const [docRow] = await db
        .insert(mspDocumentsTable)
        .values({
          title: docTitle,
          documentType: "report",
          status: "draft",
          pipelineStatus: "html_stored",
          mspId,
          customerId,
          connectorMode: "platform",
          createdByUserId: triggeredByUserId ?? 0,
        })
        .returning({ documentId: mspDocumentsTable.documentId });

      if (docRow) {
        documentId = docRow.documentId;

        await db
          .update(mspDiagnosticRunsTable)
          .set({ documentId, updatedAt: new Date() })
          .where(eq(mspDiagnosticRunsTable.runId, runId));

        logger.info({ runId, documentId, mspId, customerId }, "diagnostics-runner: report document created");

        // Kick off Document Pipeline (fire-and-forget — errors are non-fatal)
        void (async () => {
          try {
            const { createRun, executeRun } = await import("./portal-workflow-engine");
            const { DEFAULT_DOC_PIPELINE_GRAPH } = await import("./doc-pipeline-nodes");
            const { portalWfWorkflowsTable } = await import("@workspace/db");
            const { eq: eqFn } = await import("drizzle-orm");

            const [existing] = await db
              .select({ workflowKey: portalWfWorkflowsTable.workflowKey })
              .from(portalWfWorkflowsTable)
              .where(eqFn(portalWfWorkflowsTable.workflowKey, "doc.pipeline.default"))
              .limit(1);

            if (!existing) {
              await db.insert(portalWfWorkflowsTable).values({
                workflowKey: "doc.pipeline.default",
                label: "Document Pipeline (Default)",
                description: "HTML → PDF → SharePoint → publish",
                graph: DEFAULT_DOC_PIPELINE_GRAPH as unknown as Record<string, unknown>,
                isActive: true,
              });
            }

            const { mspDocumentVersionsTable } = await import("@workspace/db");
            const { createHash } = await import("crypto");
            const contentHash = createHash("sha256").update(reportHtml).digest("hex");
            const [versionRow] = await db
              .insert(mspDocumentVersionsTable)
              .values({
                documentId,
                versionNumber: 1,
                content: reportHtml,
                contentHash,
                mimeType: "text/html",
                sizeBytes: Buffer.byteLength(reportHtml, "utf8"),
                pipelineStatus: "html_stored",
                authorUserId: triggeredByUserId ?? 0,
              })
              .returning({ versionId: mspDocumentVersionsTable.versionId });

            if (versionRow) {
              const portalRunId = await createRun({
                workflowKey: "doc.pipeline.default",
                tenantContext: { mspId, customerId },
                inputPayload: {
                  documentId,
                  versionId: versionRow.versionId,
                  contentHash,
                  htmlContent: reportHtml,
                },
              });
              await executeRun(portalRunId);
            }
          } catch (pipelineErr) {
            logger.warn({ err: pipelineErr, runId, documentId }, "diagnostics-runner: doc pipeline fire failed (non-fatal)");
          }
        })();
      }
    } catch (docErr) {
      logger.warn({ err: docErr, runId }, "diagnostics-runner: document creation failed (non-fatal)");
    }

    // 6. Determine final status
    const finalStatus: "completed" | "partial" = pkgResult.runStatus === "completed" ? "completed" : "partial";

    await db
      .update(mspDiagnosticRunsTable)
      .set({
        status: finalStatus,
        completedAt: new Date(),
        checksTotal,
        checksOk,
        checksError,
        checksRequiresScript: requiresScript,
        runStatus: pkgResult.runStatus,
        summary: {
          findingsCount,
          criticalCount: findingRows.filter(f => f.severity === "critical").length,
          warningCount: findingRows.filter(f => f.severity === "warning").length,
          enginesRecomputed: pkgResult.enginesRecomputed,
        },
        updatedAt: new Date(),
      })
      .where(eq(mspDiagnosticRunsTable.runId, runId));

    broadcastDiagnosticsRunComplete(runId, {
      status: finalStatus,
      checksTotal,
      checksOk,
      checksError,
      requiresScript,
      findings: findingsCount,
    });

    logger.info({ runId, finalStatus, checksTotal, checksOk, checksError, findingsCount }, "diagnostics-runner: run completed");

    return { runId, status: finalStatus, checksTotal, checksOk, checksError, requiresScript, findingsCount, documentId };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err, runId, mspId, customerId }, "diagnostics-runner: run failed");

    await db
      .update(mspDiagnosticRunsTable)
      .set({
        status: "failed",
        completedAt: new Date(),
        errorMessage: errorMessage.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(eq(mspDiagnosticRunsTable.runId, runId));

    broadcastDiagnosticsRunError(runId, errorMessage);
    clearDiagnosticsRunSSEState(runId);

    await createFailureOperatorTask({
      runId,
      mspId,
      customerId,
      customerName: customer.name,
      errorMessage,
    });

    throw err;
  }
}
