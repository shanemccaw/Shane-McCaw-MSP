/**
 * piiGovernanceWire.ts — the shapes `GET /api/portal/pii-governance` serves, and
 * the pure normalisation of those into the PII Governance page's own view model.
 *
 * Split from the fetching hook (`piiGovernanceLive.ts`) so it imports nothing but
 * a date formatter and can be unit-tested as plain functions.
 *
 * ── This is NOT `piiData.ts` ────────────────────────────────────────────────
 * `piiData.ts` (PII_GOVERNANCE) is the design fixture: a fictional per-document
 * PII discovery scan with named sources, matched patterns, an access matrix and a
 * drift feed. None of that is collected data, so this module does not reproduce
 * it. The real page is built from the four aggregate Purview compliance signals
 * the server returns — see `artifacts/api-server/src/lib/portal-pii-governance.ts`
 * for the full accounting of what is real and what the fixture only imagined.
 *
 * ── Empty and errored are real answers ──────────────────────────────────────
 * A signal is only shown when a check genuinely ran and genuinely found
 * something. Everything else — a licence gap, a scan error, a check never
 * collected — is carried in `coverage[]` with its real reason, so the page can
 * explain WHY it is empty instead of showing a fabricated clean result.
 */

import { formatLongDate } from "./riskRegisterWire";

export type PiiSignalSeverity = "High" | "Medium" | "Low";
export type PiiCoverageStatus = "ok" | "error" | "license_gap" | "not_collected";

/* ── Wire shapes, exactly as the route serves them ────────────────────────── */

export interface WirePiiFinding {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly sev: PiiSignalSeverity;
  readonly count: number;
  readonly unit: string;
  readonly detail: string;
  readonly names: readonly string[];
  readonly collectedAt: string | null;
}

export interface WirePiiCoverage {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly status: PiiCoverageStatus;
  readonly reason: string | null;
  readonly count: number | null;
  readonly collectedAt: string | null;
}

export interface WirePiiGovernance {
  readonly status: "At risk" | "Monitored" | "Not collected";
  readonly scanned: string | null;
  readonly cadence: string;
  readonly findings: readonly WirePiiFinding[];
  readonly coverage: readonly WirePiiCoverage[];
}

/* ── The page view model ──────────────────────────────────────────────────── */

export interface PiiFindingView {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly sev: PiiSignalSeverity;
  readonly count: number;
  readonly unit: string;
  readonly detail: string;
  readonly names: readonly string[];
  /** "19 August 2026", or null when the run carried no timestamp. */
  readonly collected: string | null;
}

export interface PiiCoverageView {
  readonly key: string;
  readonly label: string;
  readonly kind: string;
  readonly status: PiiCoverageStatus;
  readonly reason: string | null;
  readonly count: number | null;
  readonly collected: string | null;
}

export interface PiiGovernanceView {
  readonly status: "At risk" | "Monitored" | "Not collected";
  /** "19 August 2026", or null. */
  readonly scanned: string | null;
  readonly cadence: string;
  readonly findings: readonly PiiFindingView[];
  readonly coverage: readonly PiiCoverageView[];
}

/** Severity → colour, matching the fixture's `PII_SEV_COLOR` so the two agree. */
export const PII_SIGNAL_SEV_COLOR: Record<PiiSignalSeverity, string> = {
  High: "#f87171",
  Medium: "#fbbf24",
  Low: "#94a3b8",
};

/** Coverage status → the label + tone the page shows for it. */
export const PII_COVERAGE_META: Record<PiiCoverageStatus, { readonly label: string; readonly tone: string }> = {
  ok: { label: "Collected", tone: "#34d399" },
  error: { label: "Scan error", tone: "#f87171" },
  license_gap: { label: "Licence required", tone: "#fbbf24" },
  not_collected: { label: "Not collected", tone: "#94a3b8" },
};

function toFinding(w: WirePiiFinding): PiiFindingView {
  return {
    id: w.id,
    label: w.label,
    kind: w.kind,
    sev: w.sev,
    count: w.count,
    unit: w.unit,
    detail: w.detail,
    names: [...w.names],
    collected: w.collectedAt ? formatLongDate(w.collectedAt) : null,
  };
}

function toCoverage(w: WirePiiCoverage): PiiCoverageView {
  return {
    key: w.key,
    label: w.label,
    kind: w.kind,
    status: w.status,
    reason: w.reason,
    count: w.count,
    collected: w.collectedAt ? formatLongDate(w.collectedAt) : null,
  };
}

export function toPiiGovernanceView(w: WirePiiGovernance): PiiGovernanceView {
  return {
    status: w.status,
    scanned: w.scanned ? formatLongDate(w.scanned) : null,
    cadence: w.cadence,
    findings: (w.findings ?? []).map(toFinding),
    coverage: (w.coverage ?? []).map(toCoverage),
  };
}

/* ── Derived headline / stats — computed once, so the page cannot disagree ── */

/** The one-line headline. States the true count and the true "why empty" reason. */
export function piiSignalHeadline(view: PiiGovernanceView): string {
  const n = view.findings.length;
  if (n > 0) {
    const high = view.findings.filter((f) => f.sev === "High").length;
    return high > 0
      ? `${n} data-governance signal${n === 1 ? "" : "s"} need attention, ${high} of them high.`
      : `${n} data-governance signal${n === 1 ? "" : "s"} are being monitored.`;
  }
  const anyOk = view.coverage.some((c) => c.status === "ok");
  return anyOk
    ? "No personal-data governance signals are firing on this tenant right now."
    : "No personal-data governance signals have been collected for this tenant yet.";
}

/** The sub-line under the headline. */
export function piiSignalHeadSub(view: PiiGovernanceView): string {
  return `Discovery runs ${view.cadence.toLowerCase()} over sensitivity labels and Data Loss Prevention. A finding here becomes a risk on the register and a change request to fix — never a ticket that closes without proof.`;
}

export interface PiiSignalStat {
  readonly key: string;
  readonly label: string;
  readonly sub: string;
  readonly value: string;
  readonly color: string;
}

/**
 * The four stat tiles. Real, honest counts derived from the findings and the
 * coverage — no exposure/file dimensions the fixture had but the real data does
 * not.
 */
export function piiSignalStats(view: PiiGovernanceView): readonly PiiSignalStat[] {
  const high = view.findings.filter((f) => f.sev === "High").length;
  const medium = view.findings.filter((f) => f.sev === "Medium").length;
  const unavailable = view.coverage.filter((c) => c.status !== "ok").length;
  return [
    { key: "high", label: "High severity", sub: "personal-data exposure to act on", value: String(high), color: "#f87171" },
    { key: "medium", label: "Needs attention", sub: "a real but lesser exposure", value: String(medium), color: "#fbbf24" },
    { key: "signals", label: "Signals in total", sub: "collected and currently firing", value: String(view.findings.length), color: "#60a5fa" },
    { key: "unavailable", label: "Checks unavailable", sub: "errored, licence-gapped or not collected", value: String(unavailable), color: "#94a3b8" },
  ];
}
