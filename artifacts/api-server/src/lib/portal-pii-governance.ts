/**
 * portal-pii-governance.ts — the real PII / data-governance signals a customer's
 * PII Governance page is built from, and the pure transform that turns collected
 * monitor-check rows into that page's model.
 *
 * ── What is real here, and what the design fixture claimed that is NOT ───────
 * The prototype's `piiData.ts` fixture (PII_GOVERNANCE) describes a per-document
 * PII DISCOVERY scan: named SharePoint/OneDrive/Teams/Exchange sources with hit
 * counts, matched patterns (national-insurance numbers, card numbers, dates of
 * birth), per-location findings with a file count and an "anyone with the link"
 * exposure, an access matrix and a drift feed. NONE of that exists as collected
 * data. The platform runs no content-inspection / DLP-discovery scan that
 * enumerates documents, so there is nothing real to put in those five sections
 * and this module does not invent it (see the route header for how the page
 * renders that gap honestly rather than showing the fixture as if it were real).
 *
 * ── What DOES exist: four aggregate Purview compliance checks ────────────────
 * The real backing is the same four monitor-checks copilot-readiness.ts already
 * reads via latestCheckProps — org-level COUNTS with a matched-severity sentence,
 * not per-document detail:
 *
 *   compliance:missing-labels    — sensitivity labels defined but Disabled
 *   compliance:label-errors      — label policies whose distribution failed
 *   compliance:weak-dlp-policies — DLP policies not actively enforcing
 *   compliance:dlp-incidents     — DLP-related Activity Explorer events (30 days)
 *
 * Each collected run carries: `status` (ok / error / license_gap), an
 * `item_count`, a `severity_matched` band, an already-interpolated
 * `severity_label` sentence (Git #418/#549 — run-specific and honest, e.g.
 * "One or more sensitivity labels are defined but disabled"), the mapping's named
 * arrays inside `extracted_properties` (disabledLabelNames, weakPolicyNames …),
 * and an `error_message` when the run could not complete.
 *
 * ── NULL / not-collected / licence-gap are real answers, served as themselves ─
 * A check that has never been collected, errored, or is blocked by a licence gap
 * is NOT a finding and is NOT scored as zero exposure. It is reported in
 * `coverage[]` with its real status and reason so the page can say WHY a section
 * is empty ("the compliance scan could not establish a Security & Compliance
 * session for this tenant") rather than showing a fabricated clean bill of
 * health. A finding is only emitted for a check that genuinely ran (`ok`) and
 * genuinely found something (`item_count > 0`).
 */

/**
 * ── This module imports no database ─────────────────────────────────────────
 * The transform below is pure so it can be unit-tested without a live DB (the
 * testbed tenant has no ok-status rows, so the finding branches are only
 * reachable through those tests). The scoped SELECT that feeds it lives in
 * `portal-pii-governance-query.ts`, which is the one that imports `@workspace/db`.
 */

/** Severity in the page's own vocabulary — the fixture's `PiiSeverity`. */
export type PiiSignalSeverity = "High" | "Medium" | "Low";

/** The real status of a backing check's most-recent collection for a tenant. */
export type PiiCoverageStatus = "ok" | "error" | "license_gap" | "not_collected";

/**
 * One backing check's static description. The `namesField` is the mapping
 * targetField (see 2026-07-31-dlp-label-monitor-checks-212.sql) that carries the
 * human-readable names of the offending items inside extractedProperties.
 */
export interface PiiCheckDef {
  readonly key: string;
  /** The finding/coverage headline — what the count is OF. */
  readonly label: string;
  /** The governance domain, used to group the signal. */
  readonly kind: string;
  /** The unit a nonzero count is measured in ("labels disabled"). */
  readonly unit: string;
  /** extractedProperties field holding the named items, or null if none. */
  readonly namesField: string | null;
  /** Static fallback sentence when a run carries no interpolated severity_label. */
  readonly fallbackDetail: string;
}

/**
 * The four real checks, in the order the page lists them. Deliberately the SAME
 * keys copilot-readiness.ts scores, so the two surfaces cannot disagree about
 * what "the tenant's label/DLP posture" is.
 */
export const PII_GOVERNANCE_CHECKS: readonly PiiCheckDef[] = [
  {
    key: "compliance:missing-labels",
    label: "Sensitivity labels defined but disabled",
    kind: "Sensitivity labels",
    unit: "labels disabled",
    namesField: "disabledLabelNames",
    fallbackDetail:
      "Sensitivity labels exist in the tenant's taxonomy but are currently disabled, so they are not classifying or protecting anything right now.",
  },
  {
    key: "compliance:label-errors",
    label: "Sensitivity label policies failed to distribute",
    kind: "Sensitivity labels",
    unit: "policies failed",
    namesField: "labelErrorPolicyNames",
    fallbackDetail:
      "One or more sensitivity label policies did not distribute successfully, so the labels they publish may not be reaching users.",
  },
  {
    key: "compliance:weak-dlp-policies",
    label: "DLP policies not actively enforcing",
    kind: "Data loss prevention",
    unit: "policies not enforcing",
    namesField: "weakPolicyNames",
    fallbackDetail:
      "Data Loss Prevention policies exist but are not in an enforcing mode, so they are not blocking anything.",
  },
  {
    key: "compliance:dlp-incidents",
    label: "DLP-related activity in the last 30 days",
    kind: "Data loss prevention",
    unit: "events",
    namesField: "dlpIncidentPolicyNames",
    fallbackDetail:
      "DLP-related Activity Explorer events observed in the last 30 days. Context on how often personal-data policies are being triggered.",
  },
];

/** One real finding — a check that genuinely ran and genuinely found something. */
export interface PiiSignalFinding {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly sev: PiiSignalSeverity;
  readonly count: number;
  readonly unit: string;
  /** The run-specific interpolated sentence, or the check's static fallback. */
  readonly detail: string;
  /** Named offending items from extractedProperties (may be empty). */
  readonly names: readonly string[];
  /** ISO 8601, UTC — when this signal was collected. */
  readonly collectedAt: string | null;
}

/** Every backing check's real collection status, so the page can explain gaps. */
export interface PiiCoverageEntry {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly status: PiiCoverageStatus;
  /** The error message, licence-gap feature, or null when ok / not collected. */
  readonly reason: string | null;
  /** The item count when the run was ok, else null. */
  readonly count: number | null;
  readonly collectedAt: string | null;
}

export interface PiiGovernancePayload {
  /** "At risk" (a High signal), "Monitored" (ok, nothing high), or "Not collected". */
  readonly status: "At risk" | "Monitored" | "Not collected";
  /** Latest ok collection time across the backing checks, or null. */
  readonly scanned: string | null;
  /** The collection cadence of the backing checks. */
  readonly cadence: string;
  readonly findings: readonly PiiSignalFinding[];
  readonly coverage: readonly PiiCoverageEntry[];
}

/** The subset of a tenant_monitor_profiles row this transform reads. */
export interface PiiCheckRow {
  readonly checkKey: string;
  readonly status: string;
  readonly itemCount: number | null;
  readonly severityMatched: string | null;
  readonly severityLabel: string | null;
  readonly extractedProperties: Record<string, unknown> | null;
  readonly errorMessage: string | null;
  readonly collectedAt: Date | string | null;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

/**
 * The matched-severity band → the page's severity vocabulary. `critical` is the
 * only High: a warning ("one or more …") is a real but lesser exposure, and info
 * ("activity observed") is context. An ok run with no band matched (nothing
 * found) is not a finding at all, so it never reaches this map.
 */
export function severityFromBand(band: string | null): PiiSignalSeverity {
  switch ((band ?? "").trim().toLowerCase()) {
    case "critical":
      return "High";
    case "warning":
      return "Medium";
    default:
      return "Low";
  }
}

/** The named offending items for a check, defensively parsed from the jsonb. */
function namesFor(def: PiiCheckDef, props: Record<string, unknown> | null): string[] {
  if (!def.namesField || !props) return [];
  const raw = props[def.namesField];
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => (typeof v === "string" ? v.trim() : String(v)))
    .filter((v) => v !== "");
}

/**
 * The honest reason a check produced no finding. A licence gap is reported with
 * the feature name Microsoft's own catalogue gives it (extractedProperties
 * `_licenseGapFeature`), an error with its message, so the page never has to
 * guess why a section is empty.
 */
function reasonFor(row: PiiCheckRow): string | null {
  if (row.status === "license_gap") {
    const feature = row.extractedProperties?.["_licenseGapFeature"];
    return typeof feature === "string" && feature.trim() !== ""
      ? `Requires a licence: ${feature.trim()}`
      : "Requires a Microsoft licence this tenant does not have.";
  }
  if (row.status === "error") {
    const msg = (row.errorMessage ?? "").trim();
    return msg !== "" ? msg : "The compliance scan could not complete for this tenant.";
  }
  return null;
}

function coverageStatus(rawStatus: string): PiiCoverageStatus {
  const s = rawStatus.trim().toLowerCase();
  if (s === "ok") return "ok";
  if (s === "license_gap") return "license_gap";
  return "error";
}

/**
 * PURE: given the latest collected row for each backing check (or none), build
 * the page payload. Split from the query so it can be unit-tested against
 * synthetic rows without a database — the live tenant currently has NO ok rows,
 * so the "live findings" branches are only reachable through these tests.
 */
export function buildPiiGovernance(rowsByKey: ReadonlyMap<string, PiiCheckRow>): PiiGovernancePayload {
  const findings: PiiSignalFinding[] = [];
  const coverage: PiiCoverageEntry[] = [];
  let latestOk: string | null = null;
  let anyHigh = false;
  let anyOk = false;

  for (const def of PII_GOVERNANCE_CHECKS) {
    const row = rowsByKey.get(def.key) ?? null;

    if (!row) {
      coverage.push({
        key: def.key,
        label: def.label,
        kind: def.kind,
        status: "not_collected",
        reason: "This check has not been collected for this tenant yet.",
        count: null,
        collectedAt: null,
      });
      continue;
    }

    const status = coverageStatus(row.status);
    const collectedAt = iso(row.collectedAt);

    coverage.push({
      key: def.key,
      label: def.label,
      kind: def.kind,
      status,
      reason: reasonFor(row),
      count: status === "ok" ? row.itemCount ?? 0 : null,
      collectedAt,
    });

    if (status !== "ok") continue;
    anyOk = true;
    if (collectedAt && (!latestOk || collectedAt > latestOk)) latestOk = collectedAt;

    const count = row.itemCount ?? 0;
    // An ok run that found nothing is a clean result, not a finding.
    if (count <= 0) continue;

    const sev = severityFromBand(row.severityMatched);
    if (sev === "High") anyHigh = true;
    const detail = (row.severityLabel ?? "").trim() || def.fallbackDetail;

    findings.push({
      id: def.key,
      label: def.label,
      kind: def.kind,
      sev,
      count,
      unit: def.unit,
      detail,
      names: namesFor(def, row.extractedProperties),
      collectedAt,
    });
  }

  const status: PiiGovernancePayload["status"] = anyHigh
    ? "At risk"
    : anyOk
      ? "Monitored"
      : "Not collected";

  return { status, scanned: latestOk, cadence: "Daily", findings, coverage };
}
