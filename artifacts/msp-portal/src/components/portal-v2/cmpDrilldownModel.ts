/**
 * cmpDrilldownModel.ts — pure derivations behind the Compliance drill-downs.
 *
 * Mirrors the prototype's `cmpAcceptedRows` (shell 13852) and `cmpObligations`
 * (13871) mappers, and the `cmpOpenCount` / `cmpAcceptedCount` header counts.
 * Kept out of the page so the tone→colour and meta-pair logic is unit-testable.
 */

import {
  CMP_ACCEPTED,
  CMP_FINDINGS,
  CMP_OBLIGATIONS,
  CMP_SEV_META,
  type CmpAcceptedDecision,
  type CmpObligationTone,
  type CmpSeverity,
} from "./cmpDrilldownData";

/** Header count on the Open gaps page (`cmpOpenCount`, 4672). */
export const CMP_OPEN_COUNT = CMP_FINDINGS.length;
/** Header count on the Documented decisions page (`cmpAcceptedCount`, 4745). */
export const CMP_ACCEPTED_COUNT = CMP_ACCEPTED.length;

export function cmpSevMeta(sev: CmpSeverity): { c: string; label: string } {
  return CMP_SEV_META[sev];
}

/** The four meta pairs under each decision card (`a.meta`, 13855-13860). */
export function cmpAcceptedMeta(a: CmpAcceptedDecision): { k: string; v: string }[] {
  return [
    { k: "Approved by", v: a.owner },
    { k: "Approved", v: a.approved },
    { k: "Next review", v: a.review },
    { k: "Risk register", v: a.register },
  ];
}

/** `c = {...}[o.tone]` for the obligation state text (13872). */
const OBLIGATION_TONE_C: Readonly<Record<CmpObligationTone, string>> = {
  red: "#f87171",
  amber: "#c2a63d",
  green: "#34d399",
  slate: "#64748b",
};

export function cmpObligationColor(tone: CmpObligationTone): string {
  return OBLIGATION_TONE_C[tone];
}

/**
 * Whether an obligation's scope pill is the muted "out of scope" style — the
 * prototype branches the scope-chip border/colour on `o.tone === 'slate'`
 * (13875), which is exactly the PCI-DSS out-of-scope row.
 */
export function cmpObligationScopeMuted(tone: CmpObligationTone): boolean {
  return tone === "slate";
}

export { CMP_OBLIGATIONS };
