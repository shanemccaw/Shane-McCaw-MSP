/**
 * previewDocumentBodies.ts — the three report bodies the Document Viewer design
 * writes out in full, as data.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `Design/Document Viewer.dc.html` hand-writes three of the nine reports —
 * Executive Summary, Security Posture and Governance Maturity — as sample prose
 * for the fictional stand-in tenant. On live data the viewer renders the
 * platform's own `htmlContent`, so this copy is reachable *only* behind
 * `?preview=design`, which paints a persistent `<PreviewBadge />`.
 *
 * It is a `.ts` and not inlined into `DocumentBody.tsx` for the platform's
 * no-hardcoding rule: the sample prose names dollar figures and seat counts, and
 * those may not appear in a `.tsx`. Same discipline, same reason, as
 * `journeyPreviewFixture.ts` — which owns the scores, the tenant and the scope,
 * and which this file deliberately does not duplicate. Every number that is
 * *derivable* (a pillar score, a projected score, the readiness figure, the
 * scan date) is read from that fixture at render time rather than restated here.
 *
 * Copy is final and in Shane's voice. Do not rewrite it.
 */

import type { PillarKey, Severity } from "./journeyTokens.ts";

/** One row of a pillar report's Findings list. */
export interface PreviewFindingRow {
  /** Drives the severity tag only — the row's left border is the pillar's identity colour. */
  readonly severity: Severity;
  /** The bolded claim that opens the row. */
  readonly lead: string;
  /** The sentence that qualifies it. */
  readonly rest: string;
}

export interface PreviewExecutiveReport {
  readonly kind: "executive";
  readonly headline: string;
  readonly standfirst: string;
  /** Sits beside the today/after pair. Takes the gain so the number stays derived. */
  readonly gapNote: (gain: number, scannedOn: string) => string;
  readonly costHeading: string;
  readonly costParagraphs: readonly string[];
  readonly sequenceHeading: string;
  readonly sequence: readonly { readonly when: string; readonly text: string }[];
  /** The provenance line that closes the report. */
  readonly provenance: (scannedOn: string, signalCount: number) => string;
}

export interface PreviewPillarReport {
  readonly kind: "pillar";
  readonly pillar: PillarKey;
  readonly headline: string;
  readonly standfirst: string;
  readonly findings: readonly PreviewFindingRow[];
  readonly remediation: string;
}

export type PreviewDocumentBody = PreviewExecutiveReport | PreviewPillarReport;

/**
 * The Executive Summary's pillar table reads shorter than the pillar scenes'
 * headlines — one line per pillar, sized for a table cell rather than a display
 * heading — so the design's own table copy is kept here rather than reusing
 * `PREVIEW_PILLARS[].headline` and losing it.
 */
export const PREVIEW_MATERIAL_FINDINGS: Readonly<Record<PillarKey, string>> = {
  governance: "212 of 1,847 SharePoint sites are shared with your whole tenant",
  security: "14 accounts have no MFA; four hold Global Administrator",
  compliance: "No DLP policy covers Teams chat; 61% of files carry no label",
  licensing: "$18,400 a year in unassigned seats; 96 users need E5",
  adoption: "412 users have not opened Teams in 30 days; OneDrive at 31%",
  health: "37 tenant configuration changes in 90 days, none reviewed",
};

const EXECUTIVE_SUMMARY: PreviewExecutiveReport = {
  kind: "executive",
  headline: "Halden Materials is not flight-ready for Microsoft 365 Copilot",
  standfirst:
    "Your tenant scored 41 out of 100 across six readiness pillars. Nothing in that number is unfixable, and none of it is unusual for a 1,240-seat estate that grew faster than its governance. What matters is the order you fix it in — Copilot inherits your permissions, your labels and your licence posture on day one, and it will surface every gap in all three.",
  gapNote: (gain, scannedOn) =>
    `Every point of that ${gain}-point gain maps to a specific, named finding in the reports listed to the left. No estimates, no benchmarks — your tenant, read directly through the Graph API on ${scannedOn}.`,
  costHeading: "What the gap costs you",
  costParagraphs: [
    "Copilot does not respect intent, only permissions. On the current configuration, a licensed user in Field Services can ask a plain-language question and receive content from 212 org-wide sites, including the four HR and finance sites we found among them. Unlabelled files are quoted and exported without restriction, and four unprotected Global Administrator accounts mean one phished credential reads the whole estate conversationally rather than mailbox by mailbox.",
    "The licensing finding pays for a meaningful share of the work: $18,400 a year is currently spent on seats nobody uses, against a $27,600 E5 uplift for the 96 users who need the controls above.",
  ],
  sequenceHeading: "The sequence",
  sequence: [
    {
      when: "Week 1",
      text: "Enforce Conditional Access on the four privileged accounts and disable legacy authentication. Highest risk, lowest effort, no user impact.",
    },
    {
      when: "Week 2–4",
      text: "Revoke org-wide sharing on the 212 exposed sites, starting with the HR and finance four, and publish the baseline sensitivity label set.",
    },
    {
      when: "Month 2",
      text: "Extend DLP to Teams and OneDrive, reclaim the dormant seats, and fund the E5 uplift from the recovered spend.",
    },
    {
      when: "Ongoing",
      text: "Hourly drift telemetry on the tenant. The score you earn is only ever the score you keep — 37 unreviewed changes in 90 days is how remediation quietly undoes itself.",
    },
  ],
  provenance: (scannedOn, signalCount) =>
    `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions. ${signalCount} signal derivation checks across six pillars. No configuration was altered during assessment.`,
};

const SECURITY_POSTURE: PreviewPillarReport = {
  kind: "pillar",
  pillar: "security",
  headline: "Identity is the first thing Copilot inherits",
  standfirst:
    "Fourteen of 1,240 accounts complete sign-in without a second factor. Four of those hold Global Administrator. Copilot changes the consequence of that gap rather than the gap itself: a compromised account no longer reads one mailbox, it queries the estate in plain language.",
  findings: [
    {
      severity: "critical",
      lead: "4 Global Administrators without MFA.",
      rest: "Two have not signed in for 60 days and are candidates for removal rather than remediation.",
    },
    {
      severity: "critical",
      lead: "Legacy authentication remains enabled tenant-wide.",
      rest: "1,106 legacy protocol sign-ins in the last 30 days, concentrated in two line-of-business mail clients.",
    },
    {
      severity: "attention",
      lead: "No Conditional Access policy scoped to privileged roles.",
      rest: "Three policies exist; all target the same all-users group with device compliance in report-only mode.",
    },
    {
      severity: "attention",
      lead: "31 guest accounts with no sign-in activity in 180 days.",
      rest: "Nine retain access to sites that also appear in the Governance oversharing findings.",
    },
  ],
  remediation:
    "Register MFA for the four privileged accounts, then enforce a Conditional Access policy scoped to privileged roles before enabling Copilot for anyone. Disable legacy authentication after moving the two line-of-business clients to modern auth — expect one week of coordination, not a change window. Remove the dormant guests alongside the Governance sharing work so the same sites are only touched once.",
};

const GOVERNANCE_MATURITY: PreviewPillarReport = {
  kind: "pillar",
  pillar: "governance",
  headline: "Oversharing stops being a filing problem",
  standfirst:
    "1,847 SharePoint sites are in scope. 212 are shared with everyone in the tenant, and 34 of those were created in the last 90 days — the exposure is still growing. Copilot inherits every permission you have ever granted, which turns each of those sites into an answer waiting for the wrong question.",
  findings: [
    {
      severity: "critical",
      lead: "212 sites shared org-wide.",
      rest: "Four hold HR or finance content: Compensation Review 2026, Redundancy Planning, Board Pack Q2, and Payroll Reconciliation.",
    },
    {
      severity: "critical",
      lead: "No site lifecycle policy.",
      rest: "148 sites have had no content activity for 12 months and no owner has been asked to confirm them.",
    },
    {
      severity: "attention",
      lead: "Anonymous links never expire.",
      rest: "2,940 active anonymous links, the oldest created in 2021.",
    },
    {
      severity: "attention",
      lead: "Unrestricted Teams creation.",
      rest: "61 teams created in 90 days, 22 with a single member and no described purpose.",
    },
  ],
  remediation:
    "Revoke org-wide sharing on the four sensitive sites today; the remaining 208 can be worked through by owner over three weeks with an attestation request rather than a blanket removal. Set anonymous link expiry to 30 days, apply a 12-month inactivity lifecycle policy with owner confirmation, and put Teams creation behind a request that captures purpose and owner.",
};

/**
 * Keyed by the document's own title, so the map lines up with
 * `JOURNEY_DESIGN_DOCUMENTS` without a second index to keep in step. A title
 * with no entry renders the still-generating state — which is exactly what the
 * design does for the other six reports.
 *
 * Title, not `docType`, on purpose: `JOURNEY_DESIGN_DOCUMENTS` is the design's
 * own list of report names and has no catalogue keys behind it (three of the
 * nine name deliverables `document_types` cannot produce). The live path joins
 * on `docType` and never reaches this map — it is only read behind
 * `?preview=design`.
 */
export const PREVIEW_DOCUMENT_BODIES: Readonly<Record<string, PreviewDocumentBody>> = {
  "Executive Summary": EXECUTIVE_SUMMARY,
  "Security Posture Report": SECURITY_POSTURE,
  "Governance Maturity Report": GOVERNANCE_MATURITY,
};
