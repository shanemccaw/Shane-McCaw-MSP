/**
 * diagnostics-runner.ts
 *
 * Core diagnostics pipeline. Triggered by MSP operators (manual) or
 * automatically at consent (fire-and-forget, pre-customer).
 *
 * Sequence:
 *   1. Resolve customer from tenantId or customerId
 *   2. Create msp_diagnostic_runs row (status = pending)
 *   3. Load monitoring package + checks
 *   4. Execute each check via executeMonitoringPackage (onProgress → SSE)
 *   5. Map check results → msp_diagnostic_findings rows
 *   6. Generate HTML report → msp_documents + doc pipeline
 *   7. Update run status = completed | failed | partial
 *   8. On failure + known customer: create portal_wf_runs stub + operator task
 *
 * When customerId is null (pre-customer / orphaned run), findings and the
 * report document are still persisted. The portal backfill in portal.ts
 * will update customer_id once the purchase creates the msp_customers row.
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
import { emitWorkflowEvent } from "./workflow-executor";
import { generateCioNarrative } from "./cio-narrative-generator";
import { evaluateDocGateCoverage } from "./doc-gate-coverage";
import {
  broadcastDiagnosticsRunProgress,
  broadcastDiagnosticsRunComplete,
  broadcastDiagnosticsRunError,
  clearDiagnosticsRunSSEState,
} from "./sse-channels";
import { logger } from "./logger";
const log = logger.child({ channel: "tenant.portal" });

// ── Finding severity classification ──────────────────────────────────────────

type FindingSeverity = "ok" | "info" | "warning" | "critical";

function classifyCheckSeverity(result: CheckResult): FindingSeverity {
  if (result.status === "consent_revoked") return "critical";
  if (result.status === "error") return "warning";
  if (result.status === "requires_script") return "info";
  // A license gap is not a security finding — it's a known SKU limitation. Surface
  // it as informational, never as a red/critical item the customer must "fix".
  if (result.status === "license_gap") return "info";
  if (result.severityMatched) {
    const s = result.severityMatched.toLowerCase();
    if (s === "critical" || s === "high") return "critical";
    if (s === "warning" || s === "medium") return "warning";
    if (s === "low") return "info";
  }
  return "ok";
}

function licenseGapFeatureOf(result: CheckResult): string {
  const f = (result.extractedProperties as Record<string, unknown> | undefined)?._licenseGapFeature;
  return typeof f === "string" && f.trim() ? f : "a required Microsoft 365 add-on";
}

function buildFindingTitle(result: CheckResult): string {
  if (result.status === "consent_revoked") return "Consent Revoked — Check could not run";
  if (result.status === "error") return `Check error: ${result.checkKey}`;
  if (result.status === "requires_script") return "Requires customer-side script";
  if (result.status === "license_gap") return `Not checked — requires ${licenseGapFeatureOf(result)}`;
  if (result.severityMatched) return `${result.severityMatched} finding detected`;
  return "Check passed";
}

// ── Error-message helpers ─────────────────────────────────────────────────────

/** Pull the Graph API error code out of a raw error string, e.g.
 *  "Graph API error 403: {\"error\":{\"code\":\"Authentication_RequestFrom…\"}}"
 */
function extractGraphErrorCode(msg: string): string {
  const m = msg.match(/"code"\s*:\s*"([^"]+)"/);
  return m?.[1] ?? "";
}

const PREMIUM_LICENSE_CODES = new Set([
  "Authentication_RequestFromNonPremiumTenantOrB2CTenant",
  "RequestFromNonPremiumTenantOrB2CTenant",
]);

/** Convert a raw Graph API error message into a clean, customer-safe sentence. */
function humanizeGraphError(raw: string | null | undefined): string {
  if (!raw) return "An unexpected error occurred executing this check.";

  const code = extractGraphErrorCode(raw);
  const lower = raw.toLowerCase();

  // Premium licensing
  if (
    PREMIUM_LICENSE_CODES.has(code) ||
    lower.includes("doesn't have premium license") ||
    lower.includes("nonpremiumtenant") ||
    lower.includes("non premium tenant") ||
    lower.includes("b2ctenant")
  ) {
    return "This check requires Azure AD Premium (P1/P2) licensing, which isn't present on this tenant.";
  }

  // Forbidden — check if it's a licensing gate first
  if (lower.includes("forbidden") || lower.includes("403")) {
    if (lower.includes("license") || lower.includes("premium") || lower.includes("subscription")) {
      return "This check requires Azure AD Premium (P1/P2) licensing, which isn't present on this tenant.";
    }
    return "This check couldn't complete — a required permission is missing. Contact support if this persists.";
  }

  // Explicit "not licensed" phrasing
  if (lower.includes("not licensed for this feature") || lower.includes("licens")) {
    return "This check requires Azure AD Premium (P1/P2) licensing, which isn't present on this tenant.";
  }

  // Permission / authorization denied
  if (
    code === "Authorization_RequestDenied" ||
    lower.includes("authorization_requestdenied") ||
    lower.includes("insufficient privileges") ||
    lower.includes("access denied") ||
    lower.includes("accessdenied")
  ) {
    return "This check couldn't complete — a required permission is missing. Contact support if this persists.";
  }

  // Bad request / invalid input
  if (lower.includes("badrequest") || lower.includes("bad request") || lower.includes("400")) {
    return "This check couldn't complete — the request format needs adjustment. Contact support if this persists.";
  }

  // Rate limiting / throttling
  if (lower.includes("throttl") || lower.includes("toomanyrequests") || lower.includes("429")) {
    return "This check couldn't complete — the service is temporarily rate-limited. It will retry automatically.";
  }

  // Upstream service unavailable
  if (lower.includes("serviceunavailable") || lower.includes("service unavailable") || lower.includes("503")) {
    return "This check couldn't complete — the service was temporarily unavailable. It will retry automatically.";
  }

  // Generic safe fallback — never expose the raw error string to the customer
  return "This check couldn't complete — an unexpected error occurred. Contact support if this persists.";
}

// ── Extracted-property description builder ────────────────────────────────────

/** Render extractedProperties as clean prose.
 *  Rules:
 *  - Array values → summarised as "N <label> found requiring review" using
 *    the sibling _count field (e.g. id_count) or the array's own length.
 *    The raw contents (GUIDs, URLs, IDs) are never rendered.
 *  - _count / _values suffix keys that back an array are skipped as raw values.
 *  - Booleans, numbers, short strings are rendered with a human-friendly label.
 */
function describeExtractedProperties(props: Record<string, unknown>): string {
  const parts: string[] = [];
  // Keys whose value is an array — so we can suppress the sibling _count key
  const arrayBases = new Set(
    Object.entries(props)
      .filter(([, v]) => Array.isArray(v))
      .map(([k]) => k.replace(/_values?$/i, ""))
  );

  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith("_")) continue; // internal metadata

    if (Array.isArray(v)) {
      // Summarise instead of dumping contents
      const base = k.replace(/_values?$/i, "");
      const count =
        (props[`${base}_count`] as number | undefined) ??
        (props[`_count`] as number | undefined) ??
        v.length;
      const label = base.replace(/_/g, " ").trim() || "item";
      const noun = count === 1 ? label : label;
      parts.push(`${count} ${noun}${count === 1 ? "" : "s"} found requiring review`);
      continue;
    }

    // Skip _count keys that correspond to a rendered array
    if (k.endsWith("_count")) {
      const base = k.slice(0, -"_count".length);
      if (arrayBases.has(base)) continue;
    }

    // Scalar value — render cleanly
    const label = k.replace(/_/g, " ").trim();
    if (typeof v === "boolean") {
      parts.push(`${label}: ${v ? "Yes" : "No"}`);
    } else if (v !== null && v !== undefined) {
      parts.push(`${label}: ${String(v)}`);
    }
  }

  return parts.length > 0 ? parts.join(". ") : "No notable properties extracted.";
}

// ── Main description builder ──────────────────────────────────────────────────

function buildFindingDescription(result: CheckResult): string {
  if (result.status === "consent_revoked") {
    return "Application consent has been revoked. No Graph API checks can run for this tenant until consent is re-established.";
  }
  if (result.status === "error") {
    // humanizeGraphError returns clean customer-safe prose — never raw JSON
    return humanizeGraphError(result.errorMessage);
  }
  if (result.status === "requires_script") {
    return "This check requires a PowerShell runbook to run in the customer's environment. Results will appear after the script is executed.";
  }
  if (result.status === "license_gap") {
    const feature = licenseGapFeatureOf(result);
    return `We couldn't evaluate this because your Microsoft 365 tenant doesn't have ${feature}. This isn't a security problem — it means the capability isn't licensed on your tenant. Adding ${feature} would let us monitor and report on it.`;
  }
  const props = result.extractedProperties;
  if (props && Object.keys(props).length > 0) {
    return describeExtractedProperties(props);
  }
  return "No issues detected for this check.";
}

/** Map a missing-feature name to a stable upsell signal key (see the Sales Offer
 *  Engine wiring follow-up). Only definitive mappings return a key. */
function licenseUpsellSignalKey(feature: string): string | null {
  const f = feature.toLowerCase();
  if (f.includes("entra") || f.includes("premium") || f.includes("azure ad")) return "security:lacks_entra_premium";
  if (f.includes("defender")) return "security:lacks_defender";
  return null;
}

function buildRecommendation(result: CheckResult): Record<string, unknown> | null {
  if (result.status === "ok" && !result.severityMatched) return null;

  const rec: Record<string, unknown> = {};
  const severity = classifyCheckSeverity(result);

  if (result.status === "license_gap") {
    // Not a remediation — a genuine upsell opportunity. Capture the missing
    // feature + a stable signalKey so a future Sales Offer Engine rule group can
    // key an add-on offer off it (the engine reads tenant profile/monitor tables,
    // where the license-gap flags are also written — see monitor-executor.ts).
    const feature = licenseGapFeatureOf(result);
    rec.action = `Consider adding ${feature} to enable this monitoring capability`;
    rec.priority = 4;
    rec.category = "license_upsell";
    rec.feature = feature;
    const signalKey = licenseUpsellSignalKey(feature);
    if (signalKey) rec.signalKey = signalKey;
    return rec;
  } else if (result.status === "consent_revoked") {
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
  licenseGap: number;
  licenseGapFeatures: string[];
  generatedAt: string;
}): string {
  const { customerName, runId, packageKey, findings, checksTotal, checksOk, checksError, requiresScript, licenseGap, licenseGapFeatures, generatedAt } = opts;

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
    ${licenseGap > 0 ? `<tr style="background:#f9fafb;">
      <td style="padding:8px 12px;border:1px solid #e5e7eb;font-weight:600;">Not Available (license)</td>
      <td style="padding:8px 12px;border:1px solid #e5e7eb;color:#2563eb;">${licenseGap}${licenseGapFeatures.length > 0 ? ` &middot; ${licenseGapFeatures.join(", ")}` : ""}</td>
    </tr>` : ""}
  </table>
  ${licenseGap > 0 ? `<p style="font-size:12px;color:#6b7280;margin:-20px 0 32px;">${licenseGap} check${licenseGap === 1 ? "" : "s"} could not be evaluated because your tenant doesn't have ${licenseGapFeatures.length > 0 ? licenseGapFeatures.join(" or ") : "certain Microsoft 365 add-ons"}. These are not security problems &mdash; adding the licensing would let us monitor these areas.</p>` : ""}

  <h2 style="font-size:16px;font-weight:600;border-bottom:1px solid #e5e7eb;padding-bottom:8px;margin-bottom:16px;">Findings</h2>
  ${findingsHtml}

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:32px 0 16px;">
  <p style="font-size:11px;color:#9ca3af;">Report generated by Shane McCaw Consulting MSP Platform &middot; Confidential</p>
</body>
</html>`;
}

// ── Operator task creation on failure ─────────────────────────────────────────
// Skipped when customerId is null (pre-customer / orphaned run — no customer
// record to surface the task against). A warning is logged instead.

async function createFailureOperatorTask(opts: {
  runId: string;
  mspId: number;
  customerId: number | null;
  customerName: string;
  errorMessage: string;
}): Promise<void> {
  if (opts.customerId == null) {
    log.warn(
      { runId: opts.runId, mspId: opts.mspId },
      "diagnostics-runner: skipping operator task — customerId null (orphaned run)",
    );
    return;
  }

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
    log.warn({ err, runId: opts.runId }, "diagnostics-runner: failed to create operator task (non-fatal)");
  }
}

// ── Main runner ───────────────────────────────────────────────────────────────

/**
 * Options for runDiagnostics.
 *
 * Provide at least one of `tenantId` or `customerId`:
 * - `customerId` (manual trigger): runner looks up the customer → resolves mspId + tenantId
 * - `tenantId` only (consent-triggered): runner looks up customer by tenantId; if not found,
 *   creates an orphaned run (customerId = null) that the portal backfill will resolve later
 */
export interface DiagnosticsRunOpts {
  tenantId?: string;
  customerId?: number;
  packageKey?: string;
  triggeredByUserId?: number;
  /**
   * When provided by the trigger endpoint (which already inserted the pending
   * row with correct mspId / packageKey / tenantId), skip the INSERT here and
   * just UPDATE that row to "running".  Eliminates the duplicate-row bug.
   */
  existingRunId?: string;
  /**
   * Explicit trigger-context flag: true only for scans genuinely fired by the
   * Assessment flow (post-consent initial scan, Free→Paid upgrade rescan).
   * Every caller must state this — it must NEVER be inferred from whether the
   * customer merely *holds* an assessment-type client_services row, since a
   * customer can hold both an old Assessment purchase and a current Monitoring
   * subscription, and every routine monitoring re-scan for them would
   * otherwise misread as an assessment scan. Defaults to false (routine scan)
   * so callers that omit it never accidentally trigger document generation.
   */
  isAssessmentTriggered?: boolean;
}

export interface DiagnosticsRunResult {
  runId: string;
  status: "completed" | "failed" | "partial";
  checksTotal: number;
  checksOk: number;
  checksError: number;
  requiresScript: number;
  checksLicenseGap: number;
  findingsCount: number;
  documentId?: string;
}

export async function runDiagnostics(opts: DiagnosticsRunOpts): Promise<DiagnosticsRunResult> {
  const { packageKey = "core:security-baseline", triggeredByUserId } = opts;

  if (opts.customerId == null && opts.tenantId == null) {
    throw new Error("runDiagnostics requires at least one of tenantId or customerId");
  }

  // 1. Resolve mspId, customerId, tenantId, and customerName
  let mspId: number;
  let customerId: number | null;
  let resolvedTenantId: string | null;
  let customerName: string;

  if (opts.customerId != null) {
    // Manual trigger path — customer record already exists
    const [customer] = await db
      .select({
        id: mspCustomersTable.id,
        name: mspCustomersTable.name,
        mspId: mspCustomersTable.mspId,
        tenantId: mspCustomersTable.tenantId,
      })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.id, opts.customerId))
      .limit(1);

    if (!customer) throw new Error(`Customer ${opts.customerId} not found`);
    mspId = customer.mspId;
    customerId = customer.id;
    // No fallback to opts.customerId here — a bare customer-id string is not a
    // real tenant GUID and would reach Graph's OAuth endpoint as garbage (see
    // the null-tenantId pre-flight check below, which fails the run instead).
    resolvedTenantId = customer.tenantId ?? opts.tenantId ?? null;
    customerName = customer.name;
  } else {
    // Consent / self-serve path — look up by tenantId
    const [customer] = await db
      .select({
        id: mspCustomersTable.id,
        name: mspCustomersTable.name,
        mspId: mspCustomersTable.mspId,
        tenantId: mspCustomersTable.tenantId,
      })
      .from(mspCustomersTable)
      .where(eq(mspCustomersTable.tenantId, opts.tenantId!))
      .limit(1);

    if (customer) {
      // Customer exists (re-consent, or race-condition where purchase completed first)
      mspId = customer.mspId;
      customerId = customer.id;
      resolvedTenantId = customer.tenantId!;
      customerName = customer.name;
    } else {
      // Brand-new self-serve tenant — orphaned run until purchase backfill runs
      mspId = 1;
      customerId = null;
      resolvedTenantId = opts.tenantId!;
      customerName = `Tenant ${opts.tenantId!.slice(0, 8)}`;
    }
  }

  // 2. Create (or reuse) run record
  // When the trigger endpoint pre-created the row with correct values, skip the
  // INSERT — just use the provided runId.  This eliminates the duplicate-row bug
  // where the endpoint stub had mspId=0 / packageKey="default".
  let runId: string;
  if (opts.existingRunId) {
    runId = opts.existingRunId;
  } else {
    const [runRow] = await db
      .insert(mspDiagnosticRunsTable)
      .values({
        mspId,
        customerId,
        tenantId: resolvedTenantId,
        packageKey,
        status: "pending",
        triggeredByUserId: triggeredByUserId ?? null,
      })
      .returning({ runId: mspDiagnosticRunsTable.runId });
    runId = runRow!.runId;
  }

  log.info({ runId, mspId, customerId, resolvedTenantId, packageKey }, "diagnostics-runner: run started");

  // Update to running
  await db
    .update(mspDiagnosticRunsTable)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(mspDiagnosticRunsTable.runId, runId));

  try {
    // Pre-flight: a missing tenantId is a known, resolvable-in-advance state
    // (consent never completed), not a per-check failure. Fail the whole run
    // now with one clear message instead of letting every check independently
    // send this bogus value to Microsoft's OAuth endpoint as a tenant GUID.
    if (!resolvedTenantId) {
      throw new Error(
        "No M365 tenant connected for this customer — consent has not been completed"
      );
    }

    // 3. Execute monitoring package
    const triggerId = `diag-run-${runId}`;

    const pkgResult = await executeMonitoringPackage({
      packageKey,
      tenantId: resolvedTenantId,
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
    // checksError counts only genuinely-unresolved problems (technical errors +
    // consent revocations). License gaps are a known SKU limitation, tracked
    // separately in checksLicenseGap so they never inflate the "needs attention"
    // count or block the run from completing.
    const checksError = pkgResult.checks.filter(c => c.status === "error" || c.status === "consent_revoked").length;
    const requiresScript = pkgResult.checks.filter(c => c.status === "requires_script").length;
    const checksLicenseGap = pkgResult.licenseGapCount;
    const licenseGapFeatures = pkgResult.licenseGapFeatures;

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
    // Gated to genuine Assessment-flow RUNS only, keyed off what triggered THIS
    // specific run (opts.isAssessmentTriggered, stated explicitly by each real
    // caller) — NOT off whether the customer merely holds an assessment-type
    // client_services row. A customer can legitimately hold both an old
    // Assessment purchase and a current Monitoring subscription (e.g. Mark
    // Perry, customerId 4); a service-history check reads "assessment access"
    // as true for every one of that customer's routine monitoring re-scans
    // too, spuriously generating a document (and burning AI credits) on every
    // 5-min Live Activity Monitor tick, manual MSPOperator re-check, SOW-expiry
    // sweep rescan, and testbed debug-trigger scan. Findings/check-writing
    // above this gate are unaffected either way.
    const isAssessmentScan = opts.isAssessmentTriggered === true;

    let documentId: string | undefined;
    if (!isAssessmentScan) {
      log.info({ runId, mspId, customerId }, "diagnostics-runner: skipping document generation — not an assessment-tier scan");
    } else try {
      const reportHtml = buildReportHtml({
        customerName,
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
        licenseGap: checksLicenseGap,
        licenseGapFeatures,
        generatedAt: new Date().toUTCString(),
      });

      const docTitle = `Diagnostics Report — ${customerName} — ${new Date().toISOString().split("T")[0]}`;
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

        log.info({ runId, documentId, mspId, customerId }, "diagnostics-runner: report document created");

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
            log.warn({ err: pipelineErr, runId, documentId }, "diagnostics-runner: doc pipeline fire failed (non-fatal)");
          }
        })();
      }
    } catch (docErr) {
      log.warn({ err: docErr, runId }, "diagnostics-runner: document creation failed (non-fatal)");
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
        checksLicenseGap,
        runStatus: pkgResult.runStatus,
        summary: {
          findingsCount,
          criticalCount: findingRows.filter(f => f.severity === "critical").length,
          warningCount: findingRows.filter(f => f.severity === "warning").length,
          licenseGapCount: checksLicenseGap,
          licenseGapFeatures,
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

    // Graded evaluable-check coverage for this run (see doc-gate-coverage.ts) —
    // the single decision shared by the CIO narrative trigger below AND the
    // diagnostics.run_completed event payload, so every downstream consumer
    // (the seeded Sales Offer workflow's branch condition in particular) grades
    // the run on real coverage instead of the literal finalStatus string.
    const runCoverage = evaluateDocGateCoverage({ checksOk, checksLicenseGap, checksError, checksTotal });

    // CIO-Report Narrative — fire as soon as the scan itself completes, well
    // before documents finish generating, so the wait between "scan done" and
    // "documents done" becomes the narrative's value-delivery moment. Gated on
    // the SAME graded evaluable-check coverage as assessment_doc_gate (see
    // doc-gate-coverage.ts), so a partial-status run with real majority signal
    // still gets its narrative — and a near-dark scan does not get a narrative
    // written over mostly-absent data. Needs a known customer (benchmark/cost
    // lookups need customerId). Fire-and-forget — a narrative failure must never
    // fail or slow down the diagnostics run itself.
    if (runCoverage.proceed && customerId != null) {
      void generateCioNarrative({
        runId,
        customerId,
        tenantId: resolvedTenantId,
        findings: findingRows.map((f) => ({
          checkKey: f.checkKey,
          checkLabel: f.checkLabel,
          severity: f.severity as FindingSeverity,
          title: f.title,
          description: f.description ?? null,
          checkStatus: f.checkStatus ?? null,
        })),
      }).catch((err) => log.warn({ err, runId }, "diagnostics-runner: CIO narrative fire failed (non-fatal)"));
    }

    log.info({ runId, finalStatus, checksTotal, checksOk, checksError, findingsCount }, "diagnostics-runner: run completed");

    // Diagnostics-completion event. This is the diagnostics/scan side of the
    // Assessment document-generation "wait for both" gate: the seeded workflow
    // "__system__: Assessment Document Generation — Service-Mapped, Sequenced SOW"
    // triggers on this event and re-checks (via its assessment_doc_gate node)
    // whether the customer has also logged in before generating. Paid monitoring
    // subs are unaffected — the gate no-ops for non-assessment orders. The sibling
    // sales-offer workflow also listens here (independent fan-out). No direct
    // function call here anymore — the old hidden assessment-doc-trigger path is
    // retired in favor of this visible workflow.
    //
    // coverageSufficient/coverageBand/coveragePct carry the graded coverage
    // decision (evaluateDocGateCoverage) into the event so workflow branch
    // conditions can gate on real coverage — a permanently-"partial" tenant
    // (e.g. two known unrunnable checks) with majority real signal still fires
    // downstream engines, while a near-dark run still correctly does not.
    await emitWorkflowEvent("diagnostics.run_completed", {
      runId,
      customerId,
      mspId,
      tenantId: resolvedTenantId,
      packageKey,
      findingsCount,
      finalStatus,
      coverageSufficient: runCoverage.proceed,
      coverageBand: runCoverage.band,
      coveragePct: runCoverage.coveragePct,
    });

    return { runId, status: finalStatus, checksTotal, checksOk, checksError, requiresScript, checksLicenseGap, findingsCount, documentId };

  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    log.error({ err, runId, mspId, customerId }, "diagnostics-runner: run failed");

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
      customerName,
      errorMessage,
    });

    await emitWorkflowEvent("diagnostics.run_completed", {
      runId,
      customerId,
      mspId,
      tenantId: resolvedTenantId,
      packageKey,
      findingsCount: 0,
      finalStatus: "failed",
      // A run that died mid-flight has no reliable check counts — grade it as
      // no-coverage so graded downstream gates (sales offers, etc.) skip it.
      coverageSufficient: false,
      coverageBand: "no_data",
      coveragePct: 0,
    });

    throw err;
  }
}
