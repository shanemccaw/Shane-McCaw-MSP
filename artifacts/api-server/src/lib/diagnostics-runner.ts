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
 * will update customer_id once the purchase creates the tenants row.
 */

import { db } from "@workspace/db";
import {
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  tenantsTable,
  mspDocumentsTable,
  portalWfRunsTable,
  portalWfOperatorTasksTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { executeMonitoringPackage, type CheckResult } from "./monitor-executor";
import { emitWorkflowEvent } from "./workflow-executor";
import { capturePillarDisplaySnapshots } from "./pillar-snapshot";
import { generateCioNarrative } from "./cio-narrative-generator";
import { evaluateDocGateCoverage } from "./doc-gate-coverage";
import { resolveSeatFigures, type SeatFigures } from "./pillar-summary-stats";
import { DEFAULT_LICENSE_WASTE_CHECK_KEY } from "./license-waste-source";
import { reverifyRemediationTrackerSteps } from "./remediation-tracker-verification";
import {
  broadcastDiagnosticsRunProgress,
  broadcastDiagnosticsRunComplete,
  broadcastDiagnosticsRunError,
  clearDiagnosticsRunSSEState,
} from "./sse-channels";
import { logger } from "./logger";
const log = logger.child({ channel: "tenant.portal" });

// ── Finding severity classification ──────────────────────────────────────────

export type FindingSeverity = "ok" | "info" | "warning" | "critical";

/** Exported for the #1540 pointed-verify workflow node — the SAME classification a full rescan applies, so a one-check on-demand re-scan can never disagree with what a full scan would have said about that check. */
export function classifyCheckSeverity(result: CheckResult): FindingSeverity {
  if (result.status === "consent_revoked") return "critical";
  // A check-execution error is a technical failure, not a real security finding
  // (#522) — never a warning-severity row the customer reads as genuine signal.
  // `checkStatus` on the persisted row still records "error" for MSP-side triage.
  if (result.status === "error") return "info";
  if (result.status === "requires_script") return "info";
  // A license gap is not a security finding — it's a known SKU limitation. Surface
  // it as informational, never as a red/critical item the customer must "fix".
  if (result.status === "license_gap") return "info";
  // #1847 — the Microsoft service behind the check is not stood up on this tenant.
  // Informational, exactly like a licence gap: it is a real fact about the tenant,
  // not a security finding the customer must "fix", and never red.
  if (result.status === "service_not_configured") return "info";
  // Neither Azure no-data state is a security finding (#1871). "No Azure at all"
  // is a complete, clean answer for an M365 governance customer; "we hold no
  // Azure RBAC here" is an onboarding gap on OUR side, not something wrong with
  // the customer's tenant. Both are informational, never red.
  if (result.status === "azure_no_subscriptions") return "ok";
  if (result.status === "azure_no_rbac") return "info";
  if (result.severityMatched) {
    const s = result.severityMatched.toLowerCase();
    if (s === "critical" || s === "high") return "critical";
    if (s === "warning" || s === "medium") return "warning";
    if (s === "low") return "info";
  }
  // A fan-out check that ran but couldn't cover every item (status "partial")
  // produced real data and may have matched a real severity above; if it didn't,
  // surface the incomplete coverage as info rather than a silent clean "ok".
  if (result.status === "partial") return "info";
  return "ok";
}

function licenseGapFeatureOf(result: CheckResult): string {
  const f = (result.extractedProperties as Record<string, unknown> | undefined)?._licenseGapFeature;
  return typeof f === "string" && f.trim() ? f : "a required Microsoft 365 add-on";
}

/** The real Microsoft product name monitor-executor stamped on a #1847 result. */
function serviceNameOf(result: CheckResult): string {
  const n = (result.extractedProperties as Record<string, unknown> | undefined)?._serviceName;
  return typeof n === "string" && n.trim() ? n : "the Microsoft service behind this check";
}

/** Which of the real service states it is, so "not set up" and "not licensed" are
 *  never collapsed into one sentence — they are different customer conversations. */
function serviceStateOf(result: CheckResult): string | null {
  const s = (result.extractedProperties as Record<string, unknown> | undefined)?._serviceState;
  return typeof s === "string" && s.trim() ? s : null;
}

/**
 * The finding's headline — what the customer actually reads on the Reveal's
 * pillar satellites, the report, and every findings list.
 *
 * Exported for its own test: this function is the entire visible payoff of the
 * severity_rules work, and #408 went unnoticed by a green suite because nothing
 * exercised the real one — the pre-existing coverage reimplements its branches
 * inline and asserts against that copy.
 */
export function buildFindingTitle(result: CheckResult): string {
  if (result.status === "consent_revoked") return "Consent Revoked — Check could not run";
  // Never surface the raw internal check key to a customer (#1147). The
  // finding's description already carries a humanized, customer-safe reason
  // (buildFindingDescription -> humanizeGraphError).
  if (result.status === "error") return "This check couldn't complete";
  if (result.status === "requires_script") return "Requires customer-side script";
  if (result.status === "license_gap") return `Not checked — requires ${licenseGapFeatureOf(result)}`;
  if (result.status === "service_not_configured") {
    return serviceStateOf(result) === "not_licensed"
      ? `Not checked — ${serviceNameOf(result)} isn't licensed on this tenant`
      : `Not checked — ${serviceNameOf(result)} isn't set up on this tenant`;
  }
  if (result.status === "azure_no_subscriptions") return "No Azure subscriptions in this tenant";
  if (result.status === "azure_no_rbac") return "Not checked — Azure access has not been granted";
  // The matched rule's OWN sentence, whenever it has one (#408). Everything
  // below it is a fallback for a rule that genuinely carries no label — the
  // generic band text is the last resort, not the normal case it used to be.
  const label = result.severityLabel?.trim();
  if (label) return label;
  if (result.severityMatched) return `${result.severityMatched} finding detected`;
  if (result.status === "partial") return "Partial coverage — some items could not be scanned";
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

// ── Customer-facing check-key humaniser ───────────────────────────────────────

/** Turn a raw internal check key (e.g. "compliance:eeeu-site-sharing") into a
 *  plain, customer-safe label ("Compliance — EEEU Site Sharing"). This is only a
 *  FALLBACK for the rare case a check has no human `label` threaded through from
 *  its definition; the raw key itself must never reach a customer (#1147). */
function humanizeCheckKey(checkKey: string): string {
  const [rawCat, rawName] = checkKey.includes(":")
    ? [checkKey.slice(0, checkKey.indexOf(":")), checkKey.slice(checkKey.indexOf(":") + 1)]
    : ["", checkKey];
  const titleCase = (s: string) =>
    s
      .replace(/[-_]+/g, " ")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      // Keep short all-caps tokens (acronyms like EEEU/MFA/SSO/DNS) uppercased.
      .map((w) => (w.length <= 4 && /^[a-z]+$/.test(w) && !COMMON_WORDS.has(w)
        ? w.toUpperCase()
        : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  const cat = rawCat ? titleCase(rawCat) : "";
  const name = titleCase(rawName) || "Check";
  return cat ? `${cat} — ${name}` : name;
}
const COMMON_WORDS = new Set(["site", "user", "team", "link", "role", "data", "risk", "scan", "auto"]);

// ── Per-check customer-facing description templates (#1147) ────────────────────
//
// The old generic "dump whatever properties exist" builder leaked raw camelCase
// property names, unstringified `[object Object]` values, and raw Graph/Teams
// identifiers straight to the customer. That anti-pattern is gone: a check's
// finding description now comes from a real, per-check human template, or — when
// a check has no template yet — an honest "summary not available" fallback.
// A generic property dump is NEVER customer-reachable.

type DescriptionTemplate = (props: Record<string, unknown>) => string | null;

/** Safe numeric read — returns null for objects, strings, arrays, NaN, etc.,
 *  so a template can never accidentally stringify a nested object or identifier. */
function asFiniteNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const CHECK_DESCRIPTION_TEMPLATES: Record<string, DescriptionTemplate> = {
  // SharePoint over-sharing scan — the exact check that produced #1147's leak.
  "compliance:eeeu-site-sharing": (props) => {
    const scanned = asFiniteNumber(props.sitesScanned);
    const overshared = asFiniteNumber(props.oversharedSiteCount) ?? 0;
    const eeeu = asFiniteNumber(props.eeeuSiteCount) ?? 0;
    const everyone = asFiniteNumber(props.everyoneSiteCount) ?? 0;
    const anon = asFiniteNumber(props.anonymousLinkSiteCount) ?? 0;
    const orgLink = asFiniteNumber(props.organizationLinkSiteCount) ?? 0;

    const scannedPhrase =
      scanned != null ? `We reviewed ${scanned} SharePoint site${scanned === 1 ? "" : "s"}. ` : "";
    if (overshared <= 0) {
      return `${scannedPhrase}None are shared more broadly than recommended.`;
    }
    const breakdown: string[] = [];
    if (eeeu > 0) breakdown.push(`${eeeu} shared with everyone in your organisation except external guests`);
    if (everyone > 0) breakdown.push(`${everyone} shared with everyone, including guests`);
    if (anon > 0) breakdown.push(`${anon} reachable through anonymous "anyone" links`);
    if (orgLink > 0) breakdown.push(`${orgLink} shared through organisation-wide links`);
    const detail = breakdown.length ? ` — ${breakdown.join("; ")}` : "";
    return `${scannedPhrase}${overshared} site${overshared === 1 ? " is" : "s are"} shared more broadly than recommended${detail}. Review these sites' sharing settings to reduce overexposure.`;
  },
};

/** Honest, customer-safe fallback for a check that has extracted data but no
 *  per-check template yet. Never renders raw property values — that was the
 *  whole #1147 defect. Better an honest "not available yet" than a raw dump. */
function honestUntemplatedDescription(result: CheckResult): string {
  if (result.status === "partial") {
    return "Some items in this area couldn't be fully scanned. A readable summary for this check isn't available yet — this doesn't indicate a confirmed problem.";
  }
  return "This check flagged items that need review. A readable summary for this check isn't available yet.";
}

// ── Main description builder ──────────────────────────────────────────────────

export function buildFindingDescription(result: CheckResult): string {
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
  // #1847 — the executor already resolved the tenant-level fact and stamped its
  // real sentence on `errorMessage` (from tenant_service_availability.reason). Use
  // that verbatim: there is ONE authored wording of this fact per tenant, and it is
  // the one backed by the recorded evidence. Only fall back if it is missing.
  if (result.status === "service_not_configured") {
    if (result.errorMessage?.trim()) return result.errorMessage.trim();
    const service = serviceNameOf(result);
    return serviceStateOf(result) === "not_licensed"
      ? `We couldn't evaluate this because ${service} isn't licensed on your Microsoft 365 tenant. This isn't a security problem, and it isn't a measurement of zero — the service isn't there to read.`
      : `We couldn't evaluate this because ${service} isn't set up on your Microsoft 365 tenant. This isn't a security problem, and it isn't a measurement of zero — the service isn't there to read.`;
  }
  if (result.status === "azure_no_subscriptions") {
    return "This tenant has no Azure subscriptions, so there is no Azure configuration to review. That isn't a problem — plenty of Microsoft 365 organisations run no Azure resources at all.";
  }
  if (result.status === "azure_no_rbac") {
    // Deliberately does NOT say "you have no Azure". An Azure listing only ever
    // shows what the caller has been granted a role on, so this state cannot
    // tell the two apart — and claiming otherwise would state a fact we did not
    // observe (#1871).
    return "We couldn't review your Azure configuration because we haven't been granted access to it. Azure access is separate from the Microsoft 365 permissions you've already approved, and has to be granted on the Azure side before we can see anything there.";
  }
  const props = result.extractedProperties;
  if (props && Object.keys(props).length > 0) {
    const template = CHECK_DESCRIPTION_TEMPLATES[result.checkKey];
    if (template) {
      const text = template(props);
      if (text && text.trim()) return text.trim();
    }
    // No per-check template (or it declined) — honest fallback, NEVER a raw
    // property dump (#1147). Logged so we can see which checks still need a
    // real template written for them.
    log.debug(
      { checkKey: result.checkKey, status: result.status },
      "diagnostics: no customer-facing description template for check — using honest fallback",
    );
    return honestUntemplatedDescription(result);
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
  } else if (result.status === "service_not_configured") {
    // #1847 — the action genuinely differs by state, and getting it backwards is
    // the confidently-wrong reporting this issue exists to stop. "Set up Intune" is
    // useless advice to a tenant that doesn't own it; "buy Intune" is wrong for a
    // tenant that already has it and never enrolled.
    const service = serviceNameOf(result);
    if (serviceStateOf(result) === "not_licensed") {
      rec.action = `Consider licensing ${service} to enable device management monitoring`;
      rec.priority = 4;
      rec.category = "license_upsell";
      rec.feature = service;
    } else {
      rec.action = `Set up ${service} on the tenant (enrol it and set an MDM authority) to enable device management monitoring`;
      rec.priority = 3;
      rec.category = "service_enablement";
      rec.feature = service;
    }
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

// ── Real license-waste finding (#639) ──────────────────────────────────────────
//
// `resolveSeatFigures`'s arithmetic (paid seats provisioned/unassigned, priced-
// estate-only per #333) already renders correctly in the Licensing Alignment
// document — but nothing ever turned it into a finding row, so a tenant with
// severe real waste still scored a clean, green Licensing pillar next to a
// document narrating the dollar figure directly. The registry's declared
// `cost:license-waste-estimate` check was never backed by a real monitor_checks
// row (see license-waste-source.ts's header), so no severity_rules-driven finding
// could ever fire for it — this is the missing link, not a new computation.
//
// Reuses `DEFAULT_LICENSE_WASTE_CHECK_KEY` as the finding's `checkKey` rather
// than the real `/subscribedSkus` check the arithmetic happened to read from
// this run (`seats.checkKey`, kept in `extractedProperties.sourceCheckKey` for
// traceability): that constant is already the platform's one declared identity
// for this cross-check-derived figure (the dashboard registry's own
// `licensing.wasteEstimateBreakdown` metric names the same key), and its `cost:`
// domain prefix already resolves to the Licensing/War Room pillar via
// `PILLAR_CHECK_DOMAINS` with no new mapping required.

/**
 * Severe vs. merely present waste. Half or more of a tenant's paid, priced seats
 * sitting unassigned is a real, severe result (the confirmed #639 tenant was
 * 24 of 25 — 96%); any smaller nonzero amount is still real spend, just not the
 * "pillar should never have read green" case the issue reported. A policy
 * threshold, not something derived from the data — revisit if Shane's definition
 * of "severe" differs.
 */
export function classifyLicenseWasteSeverity(
  unassigned: number,
  provisioned: number,
): "critical" | "warning" {
  if (provisioned > 0 && unassigned / provisioned >= 0.5) return "critical";
  return "warning";
}

/**
 * Pure: turn one tenant's real seat figures into a finding row, or null when
 * there is genuinely nothing to report — zero unassigned paid seats is a real
 * clean result, not a gap, and must render as one rather than a fabricated
 * finding. Exported for its own test, same reasoning as `buildFindingTitle`.
 */
export function buildLicenseWasteFinding(
  seats: SeatFigures,
): Pick<
  typeof mspDiagnosticFindingsTable.$inferInsert,
  "checkKey" | "checkLabel" | "severity" | "title" | "description" | "recommendation" | "extractedProperties"
> | null {
  if (seats.unassigned <= 0) return null;

  const severity = classifyLicenseWasteSeverity(seats.unassigned, seats.provisioned);
  const dollars = seats.annualWasteDollars;
  const title =
    dollars != null
      ? `${seats.unassigned} of ${seats.provisioned} paid license seats unassigned — ~$${dollars.toLocaleString("en-US")}/year in recoverable spend`
      : `${seats.unassigned} of ${seats.provisioned} paid license seats unassigned`;
  const description =
    dollars != null
      ? `This tenant's own subscription data shows ${seats.unassigned} paid, priced license seat(s) out of ${seats.provisioned} provisioned that nobody is assigned to — an estimated $${dollars.toLocaleString("en-US")} a year at list price. Free and trial SKUs are excluded; only seats with a real price on file are counted.`
      : `This tenant's own subscription data shows ${seats.unassigned} paid license seat(s) out of ${seats.provisioned} provisioned that nobody is assigned to. Free and trial SKUs are excluded; only seats with a real price on file are counted. No dollar figure could be priced for these seats.`;

  return {
    checkKey: DEFAULT_LICENSE_WASTE_CHECK_KEY,
    // Human, customer-safe label — never the raw internal key (#1147).
    checkLabel: "License Utilization",
    severity,
    title,
    description,
    recommendation: {
      action: "Reassign or reclaim unused paid license seats",
      priority: severity === "critical" ? 1 : 2,
      category: "licensing",
      signalKey: DEFAULT_LICENSE_WASTE_CHECK_KEY,
    },
    extractedProperties: {
      unassignedPaidSeats: seats.unassigned,
      provisionedPaidSeats: seats.provisioned,
      annualWasteDollars: seats.annualWasteDollars,
      sourceCheckKey: seats.checkKey,
    },
  };
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
          <strong style="font-size:14px;">${f.checkLabel || humanizeCheckKey(f.checkKey)}</strong>
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
        id: tenantsTable.id,
        name: tenantsTable.customerName,
        mspId: tenantsTable.mspId,
        tenantId: tenantsTable.tenantId,
      })
      .from(tenantsTable)
      .where(eq(tenantsTable.id, opts.customerId))
      .limit(1);

    if (!customer) throw new Error(`Customer ${opts.customerId} not found`);
    // mspId comes from tenants.mspId — the tenant owns the MSP linkage.
    mspId = customer.mspId;
    customerId = customer.id;
    // No fallback to opts.customerId here — a bare customer-id string is not a
    // real tenant GUID and would reach Graph's OAuth endpoint as garbage (see
    // the null-tenantId pre-flight check below, which fails the run instead).
    // The old `?? opts.tenantId ?? null` chain covered msp_customers' nullable
    // tenant GUID; tenants.tenant_id is NOT NULL, so it is now unreachable.
    resolvedTenantId = customer.tenantId;
    customerName = customer.name;
  } else {
    // Consent / self-serve path — look up by tenantId
    const [customer] = await db
      .select({
        id: tenantsTable.id,
        name: tenantsTable.customerName,
        mspId: tenantsTable.mspId,
        tenantId: tenantsTable.tenantId,
      })
      .from(tenantsTable)
      // tenants.tenant_id is UNIQUE, so this GUID lookup can match at most one row.
      .where(eq(tenantsTable.tenantId, opts.tenantId!))
      .limit(1);

    if (customer) {
      // Customer exists (re-consent, or race-condition where purchase completed first)
      mspId = customer.mspId;
      customerId = customer.id;
      resolvedTenantId = customer.tenantId;
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

    // The check DEFINITION's human `label` (customer-safe) only reaches us via
    // the progress events — the returned CheckResult carries only the raw key.
    // Capture it here so a finding's customer-facing `checkLabel` is the real
    // label, never the raw internal key (#1147).
    const checkLabelByKey = new Map<string, string>();

    const pkgResult = await executeMonitoringPackage({
      packageKey,
      tenantId: resolvedTenantId,
      triggerId,
      onProgress: (evt) => {
        if (evt.checkLabel && evt.checkLabel.trim()) {
          checkLabelByKey.set(evt.checkKey, evt.checkLabel.trim());
        }
        broadcastDiagnosticsRunProgress(runId, {
          checkKey: evt.checkKey,
          checkLabel: evt.checkLabel,
          status: evt.status,
          index: evt.index,
          total: evt.total,
          requiresCustomerScript: evt.requiresCustomerScript,
          errorMessage: evt.errorMessage,
          severityMatched: evt.severityMatched,
          severityLabel: evt.severityLabel,
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
        // Real human label from the check definition (via progress events);
        // humanised key as an honest fallback — never the raw key (#1147).
        checkLabel: checkLabelByKey.get(checkResult.checkKey) ?? humanizeCheckKey(checkResult.checkKey),
        severity,
        title,
        description,
        recommendation: recommendation as Record<string, unknown> | null | undefined,
        extractedProperties: {
          ...(checkResult.extractedProperties as Record<string, unknown>),
          ...(checkResult.errorMessage ? { _rawGraphError: checkResult.errorMessage } : {}),
        },
        checkStatus: checkResult.status,
      });
    }

    // #639 — the real per-tenant license-waste figure, from the same resolver
    // the Licensing Alignment document itself reads its numbers from (never a
    // second, independently-computed figure that could disagree with it).
    // Best-effort: a failure here must not fail the whole run, and an unpriceable
    // or genuinely clean estate is a real result — null/empty, not guessed.
    try {
      const seatFigures = await resolveSeatFigures(resolvedTenantId);
      const wasteFinding = seatFigures ? buildLicenseWasteFinding(seatFigures) : null;
      if (wasteFinding) {
        findingRows.push({
          runId,
          mspId,
          customerId,
          checkStatus: null,
          ...wasteFinding,
        });
      }
    } catch (err) {
      log.warn(
        { err, runId, resolvedTenantId },
        "diagnostics-runner: license-waste finding computation failed — omitted, not guessed",
      );
    }

    let findingsCount = 0;
    if (findingRows.length > 0) {
      const inserted = await db
        .insert(mspDiagnosticFindingsTable)
        .values(findingRows)
        .returning({ findingId: mspDiagnosticFindingsTable.findingId });
      findingsCount = inserted.length;
    }

    // Remediation Tracker re-verification (#732) — every rescan, not only
    // assessment-tier ones: a customer's claimed step is exactly as real as
    // the LAST scan that actually looked at it, and routine monitoring
    // re-checks are real scans too. Reconciles against the findings just
    // computed above rather than re-querying them. Best-effort and already
    // internally non-fatal — must never fail the run it is riding on.
    if (customerId != null) {
      await reverifyRemediationTrackerSteps({
        customerId,
        runId,
        findings: findingRows.map((f) => ({ checkKey: f.checkKey, severity: f.severity ?? "info" })),
      });
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
    // Success path leaves the sse-hub replay cache entry behind unless cleared
    // here too — only the catch-block error path below cleared it before,
    // meaning every successful run left a permanent Map entry (Git #130).
    clearDiagnosticsRunSSEState(runId);

    // Graded evaluable-check coverage for this run (see doc-gate-coverage.ts) —
    // the single decision shared by the CIO narrative trigger below AND the
    // diagnostics.run_completed event payload, so every downstream consumer
    // (the seeded Sales Offer workflow's branch condition in particular) grades
    // the run on real coverage instead of the literal finalStatus string.
    const runCoverage = evaluateDocGateCoverage({ checksOk, checksLicenseGap, checksError, checksTotal });

    // CIO-Report Narrative — fire as soon as the scan itself completes, well
    // before documents finish generating, so the wait between "scan done" and
    // "documents done" becomes the narrative's value-delivery moment. Gated on
    // isAssessmentScan (same opts.isAssessmentTriggered flag as the document
    // gate above — see the block comment at its declaration) so this AI call
    // fires only for genuine Assessment-flow runs, never on routine monitoring
    // re-scans (5-min Live Activity Monitor ticks, manual MSPOperator re-checks,
    // SOW-expiry sweep rescans, testbed debug-trigger scans), plus the SAME
    // graded evaluable-check coverage as assessment_doc_gate (see
    // doc-gate-coverage.ts), so a partial-status run with real majority signal
    // still gets its narrative — and a near-dark scan does not get a narrative
    // written over mostly-absent data. Needs a known customer (benchmark/cost
    // lookups need customerId). Fire-and-forget — a narrative failure must never
    // fail or slow down the diagnostics run itself.
    if (isAssessmentScan && runCoverage.proceed && customerId != null) {
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
      isAssessmentTriggered: opts.isAssessmentTriggered === true,
    });

    // Historize the customer-facing 0-100 pillar DISPLAY scores (Git #1106) at
    // this same run-completed moment. Nobody was persisting these over time —
    // only the raw per-engine scores (tenant_engine_snapshots) were — so a
    // customer's real first-scan-to-today pillar trend was uncomputable.
    // Fire-and-forget (same discipline as generateCioNarrative above and
    // writeEngineSnapshot elsewhere): a snapshot failure must never fail or slow
    // the run. Gated internally on coverageSufficient — a dark/partial run writes
    // no fabricated history.
    void capturePillarDisplaySnapshots({
      runId,
      customerId,
      mspId,
      packageKey,
      coverageSufficient: runCoverage.proceed,
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
      isAssessmentTriggered: opts.isAssessmentTriggered === true,
    });

    throw err;
  }
}
