/**
 * piiModel.ts — the PII Governance derivations.
 *
 * Everything on the page that is COMPUTED rather than stored lives here so it can
 * be unit-tested away from the JSX: the four stat counts, the headline totals,
 * the per-source bar width, and the finding filter. The prototype builds all of
 * these inline in its render (shell 20096-20196); each is transcribed with its
 * own reference.
 *
 * The colour maps are the prototype's own `sevC` / `expC` (shell 20152-20153) and
 * `d.tone` values — kept as data because a finding's severity drives a border, a
 * chip and a caret, and they must agree.
 */

import type { PiiExposure, PiiFinding, PiiGovernance, PiiSeverity } from "./piiData";

/** Severity → colour. Prototype `sevC` (shell 20152). */
export const PII_SEV_COLOR: Record<PiiSeverity, string> = {
  High: "#f87171",
  Medium: "#fbbf24",
  Low: "#94a3b8",
};

/** Exposure → colour. Prototype `expC` (shell 20153). */
export const PII_EXP_COLOR: Record<PiiExposure, string> = {
  Public: "#f87171",
  External: "#fb923c",
  Internal: "#94a3b8",
};

/**
 * The stat-card filter. `null` is "show everything"; `'all'` is the explicit
 * "Locations in total" card, which the prototype treats the same as null in the
 * finding filter (shell 20154).
 */
export type PiiFilterKey = "High" | "exposed" | "unlabelled" | "all" | null;

/** Files holding personal data — the prototype's `total` (shell 20100). */
export function piiTotalFiles(pii: PiiGovernance): number {
  return pii.findings.reduce((a, f) => a + f.files, 0);
}

/** Locations reachable from outside — the prototype's `pub` (shell 20099). */
export function piiExposedCount(pii: PiiGovernance): number {
  return pii.findings.filter((f) => f.exposure === "Public" || f.exposure === "External").length;
}

export function piiHighCount(pii: PiiGovernance): number {
  return pii.findings.filter((f) => f.sev === "High").length;
}

export function piiUnlabelledCount(pii: PiiGovernance): number {
  return pii.findings.filter((f) => !f.label).length;
}

/** The headline — prototype shell 20105. */
export function piiHeadline(pii: PiiGovernance): string {
  const total = piiTotalFiles(pii).toLocaleString("en-US");
  const pub = piiExposedCount(pii);
  return `${total} files hold personal data. ${pub} locations can be reached from outside.`;
}

/** The sub-line — prototype shell 20106. */
export function piiHeadSub(pii: PiiGovernance): string {
  return `Discovery runs ${pii.cadence.toLowerCase()} across sites, drives, Teams and mail. A finding here becomes a risk on the register and a change request to fix — never a ticket that closes without proof.`;
}

export interface PiiStat {
  readonly key: Exclude<PiiFilterKey, null>;
  readonly label: string;
  readonly sub: string;
  readonly value: string;
  readonly color: string;
}

/**
 * The four stat cards — prototype's `defs` (shell 20112-20117). Order and copy
 * are the prototype's; the value is computed from the findings so it can never
 * disagree with the list below it.
 */
export function piiStats(pii: PiiGovernance): readonly PiiStat[] {
  return [
    {
      key: "High",
      label: "High severity",
      sub: "personal data with real exposure",
      value: String(piiHighCount(pii)),
      color: "#f87171",
    },
    {
      key: "exposed",
      label: "Reachable outside",
      sub: "public links or external people",
      value: String(piiExposedCount(pii)),
      color: "#fb923c",
    },
    {
      key: "unlabelled",
      label: "No sensitivity label",
      sub: "nothing is published to apply",
      value: String(piiUnlabelledCount(pii)),
      color: "#fbbf24",
    },
    {
      key: "all",
      label: "Locations in total",
      sub: "across four sources",
      value: String(pii.findings.length),
      color: "#60a5fa",
    },
  ];
}

/**
 * Findings under the current filter — prototype shell 20154-20157. A null or
 * 'all' filter shows every finding; otherwise it matches the clicked stat card.
 */
export function piiFilterFindings(
  pii: PiiGovernance,
  filter: PiiFilterKey,
): readonly PiiFinding[] {
  return pii.findings.filter(
    (f) =>
      !filter ||
      filter === "all" ||
      (filter === "High" && f.sev === "High") ||
      (filter === "exposed" && (f.exposure === "Public" || f.exposure === "External")) ||
      (filter === "unlabelled" && !f.label),
  );
}

/** "{n} files" with a thousands separator — prototype shell 20161. */
export function piiFilesText(f: PiiFinding): string {
  return `${f.files.toLocaleString("en-US")} files`;
}

/** "Labelled" / "No label" — prototype shell 20164. */
export function piiLabelText(f: PiiFinding): string {
  return f.label ? "Labelled" : "No label";
}

/**
 * The per-source bar width, as a percentage. The prototype divides every source
 * by a FIXED 2,140 (SharePoint's own hit count, the largest), so the bars are
 * relative to the busiest source rather than to the total — shell 20132.
 */
export const PII_SOURCE_BAR_DENOM = 2140;

export function piiSourceBarPct(hits: number): number {
  return Math.round((hits / PII_SOURCE_BAR_DENOM) * 100);
}

/** "{n}" with a thousands separator, for a source or pattern hit count. */
export function piiHitsText(hits: number): string {
  return hits.toLocaleString("en-US");
}

/** The drift verdict — prototype shell 20185. */
export function piiDriftVerdict(cr: string): string {
  return cr ? "Approved change" : "No change request behind it";
}
