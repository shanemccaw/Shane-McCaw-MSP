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
  type CmpEvidence,
  type CmpFinding,
  type CmpObligationTone,
  type CmpSeverity,
} from "./cmpDrilldownData";
import type { PortalV2Finding } from "./portalV2Model";

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

/**
 * Real evidence field names #1255's `CHECK_EVIDENCE_NAME_FIELDS` sends, mapped
 * to the human label the row shows. A `checkKey` outside this catalogue (or an
 * evidence key this catalogue doesn't recognise) still renders — humanised
 * from the field name — rather than being dropped.
 */
const CMP_EVIDENCE_LABELS: Readonly<Record<string, string>> = {
  disabledLabelNames: "Disabled labels",
  labelErrorPolicyNames: "Policies with label errors",
  weakPolicyNames: "Policies in audit-only mode",
  dlpIncidentPolicyNames: "Unreviewed DLP incident policies",
};

/** camelCase field name -> "Field name", for an evidence key not in the catalogue above. */
function humanizeEvidenceKey(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The evidence rows a live finding's `evidence` object produces — the curated
 * name-list subset #1255 forwards (never the raw `extractedProperties` blob,
 * #1147). Empty when the finding carries no evidence, e.g. a checkKey outside
 * the current `CHECK_EVIDENCE_NAME_FIELDS` catalogue.
 */
function cmpLiveEvidenceRows(evidence: Record<string, unknown> | null | undefined): CmpEvidence[] {
  if (!evidence) return [];
  const rows: CmpEvidence[] = [];
  for (const [key, value] of Object.entries(evidence)) {
    const names = Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
    if (names.length === 0) continue;
    rows.push({ k: CMP_EVIDENCE_LABELS[key] ?? humanizeEvidenceKey(key), v: names.join(", ") });
  }
  return rows;
}

/**
 * Map one real `war-room-pillars` compliance finding (#1255's widened
 * `PortalV2Finding`) into the same `CmpFinding` shape the page already renders,
 * so `portal-v2-compliance-gaps.tsx` needs no separate rendering path for live
 * vs fixture rows.
 *
 * Honest-gap fields: `obligation`/`whyItMatters` are `null` for any checkKey
 * outside #1255's `CHECK_OBLIGATION_COPY` catalogue (the compliance:* checks
 * that check has not yet been authored for) — rendered as a plain statement
 * that the narrative is not yet authored, never a fabricated sentence. Same for
 * `fixLabel`/`fixSub`: absent a bespoke fix mapping for this checkKey, `fixKey`
 * is the checkKey itself, which `playbookFor` resolves to the generic
 * "Apply the recommended change" flow rather than a dead end.
 */
export function cmpFindingRowFromLive(f: PortalV2Finding): CmpFinding {
  const obligation = f.obligation ?? null;
  const whyItMatters = f.whyItMatters ?? null;
  return {
    id: f.checkKey,
    title: f.title,
    sev: f.severity === "critical" ? "high" : "medium",
    obligation: obligation ?? "No obligation citation authored for this check yet",
    obligationText:
      obligation ??
      "No obligation narrative has been authored for this check yet — the finding is real, the narrative is a documented gap.",
    why:
      whyItMatters ??
      f.description ??
      "No further narrative is available for this finding yet.",
    evidence:
      cmpLiveEvidenceRows(f.evidence).length > 0
        ? cmpLiveEvidenceRows(f.evidence)
        : [
            {
              k: "Where this comes from",
              v: f.description ?? "Detected by the last scan; no further detail captured.",
            },
          ],
    fixKey: f.checkKey,
    fixLabel: f.recommendation?.action ?? "Apply the recommended change",
    fixSub: f.recommendation?.estimatedEffort
      ? `Estimated effort: ${f.recommendation.estimatedEffort}`
      : "Opens the fix flow for this finding",
  };
}

/** Map every real compliance finding into the Open gaps row shape, worst first (server order preserved). */
export function cmpFindingRowsFromLive(findings: readonly PortalV2Finding[]): CmpFinding[] {
  return findings.map(cmpFindingRowFromLive);
}
