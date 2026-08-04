/**
 * previewDocumentBodies.ts — the three report bodies the Document Viewer design
 * writes out in full, as data.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `Design/Document Viewer.dc.html` hand-writes three of the eight reports —
 * the roll-up Copilot Readiness report, the Security pillar report and the
 * Governance pillar report — as sample prose for the fictional stand-in
 * tenant. On live data the viewer renders the platform's own `htmlContent`,
 * so this copy is reachable *only* behind `?preview=design`, which paints a
 * persistent `<PreviewBadge />`.
 *
 * It is a `.ts` and not inlined into `DocumentBody.tsx` for the platform's
 * no-hardcoding rule: the sample prose names dollar figures and seat counts, and
 * those may not appear in a `.tsx`. Same discipline, same reason, as
 * `journeyPreviewFixture.ts` — which owns the scores, the tenant and the scope,
 * and which this file deliberately does not duplicate. Every number that is
 * *derivable* (a pillar score, a projected score, the readiness figure, the
 * scan date, the signal count) is read from that fixture at render time rather
 * than restated here.
 *
 * Copy is final and in Shane's voice. Do not rewrite it.
 *
 * SECTION SHAPE
 * -------------
 * Both report kinds are now built from the same generic `ReportSection` list
 * rather than a fixed set of named fields — the design's second revision gave
 * each report 6-8 headed sections of varying shape (plain prose, a findings
 * list, a labelled remediation sequence, or a bullet list), which a
 * fixed-field interface can't hold without a field per section. A section
 * carries only what its own `kind` needs; `DocumentBody.tsx`'s `ReportSections`
 * renders whichever shape it finds.
 */

import type { PillarKey, Severity } from "./journeyTokens.ts";

/** One row of a findings-shaped section. */
export interface PreviewFindingRow {
  /** Drives the severity tag only — the row's left border is the pillar's identity colour. */
  readonly severity: Severity;
  /** The bolded claim that opens the row. */
  readonly lead: string;
  /** The sentence that qualifies it. */
  readonly rest: string;
}

export type ReportSection =
  | { readonly kind: "prose"; readonly heading: string; readonly paragraphs: readonly string[] }
  | { readonly kind: "findings"; readonly heading: string; readonly rows: readonly PreviewFindingRow[] }
  | {
      readonly kind: "sequence";
      readonly heading: string;
      /** The paragraph ahead of the labelled steps — e.g. naming the gate blockers before the timeline. */
      readonly intro?: string;
      readonly steps: readonly { readonly when: string; readonly text: string }[];
    }
  | { readonly kind: "bullets"; readonly heading: string; readonly items: readonly string[] };

/** The provenance line every report closes with — identical text, one function. */
export type ReportProvenance = (scannedOn: string, signalCount: number) => string;

const PROVENANCE: ReportProvenance = (scannedOn, signalCount) =>
  `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions. ${signalCount} signal derivation checks across six pillars. No configuration was altered during assessment.`;

export interface PreviewExecutiveReport {
  readonly kind: "executive";
  readonly headline: string;
  readonly standfirst: string;
  /** Sits beside the today/after pair. Takes the gain so the number stays derived. */
  readonly gapNote: (gain: number, scannedOn: string) => string;
  readonly sections: readonly ReportSection[];
  readonly provenance: ReportProvenance;
}

export interface PreviewPillarReport {
  readonly kind: "pillar";
  readonly pillar: PillarKey;
  /** The report-specific eyebrow ahead of "· pillar score N" — e.g. "Security posture & blast radius". */
  readonly kicker: string;
  readonly headline: string;
  /**
   * No header-level standfirst, deliberately — unlike the executive report,
   * a pillar report's header is eyebrow + h1 only. The equivalent summary
   * copy lives as `sections[0]` (a `prose` section, "… Posture Summary"),
   * which is what makes it askable — the design marks those two paragraphs
   * `data-ask`, which a header-level field never was.
   */
  readonly sections: readonly ReportSection[];
  /** The closing "Executive Summary" paragraph every pillar report ends with, ahead of the projected-score line. */
  readonly closingNote: string;
  readonly provenance: ReportProvenance;
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

const COPILOT_READINESS_REPORT: PreviewExecutiveReport = {
  kind: "executive",
  headline: "Halden Materials is not cleared through the Copilot Gate",
  standfirst:
    "Your tenant scored 41 out of 100 across six readiness pillars. Nothing in that number is unfixable, and none of it is unusual for a 1,240-seat estate that grew faster than its governance. What matters is the order you fix it in — Copilot inherits your permissions, your labels and your licence posture on day one, and it will surface every gap in all three. This report rolls up all six pillars; each has its own report alongside it.",
  gapNote: (gain, scannedOn) =>
    `Every point of that ${gain}-point gain maps to a specific, named finding in the reports listed to the left. No estimates, no benchmarks — your tenant, read directly through the Graph API on ${scannedOn}.`,
  sections: [
    {
      kind: "prose",
      heading: "Copilot Safety & Exposure",
      paragraphs: [
        "Copilot does not respect intent, only permissions. On the current configuration a licensed user in Field Services can ask a plain-language question and receive content from 212 org-wide sites, including the four HR and finance sites found among them. Unlabelled files are quoted and exported without restriction.",
        "The blast radius of a single compromised identity changes shape entirely. Four unprotected Global Administrator accounts mean one phished credential reads the whole estate conversationally rather than mailbox by mailbox.",
      ],
    },
    {
      kind: "prose",
      heading: "Workflow Enablement & Value",
      paragraphs: [
        "Value concentrates where the work already happens. 828 of 1,240 users are active in Teams weekly and are ready to see returns immediately. The remaining 412 have not opened Teams in 30 days; licences issued to them return nothing until enablement lands.",
        "Operations and Field Services show the widest gap between document volume and collaboration activity — the two functions where Copilot summarisation would pay back fastest, and the two furthest from being ready to use it.",
      ],
    },
    {
      kind: "prose",
      heading: "Technical Prerequisites & Platform Alignment",
      paragraphs: [
        "96 users require an E5 uplift to carry the Conditional Access and Purview controls Copilot depends on. OneDrive is activated for 31% of the estate against a practical prerequisite of near-full activation. Sensitivity labels are published but not enforced, and no auto-labelling rule is in effect.",
      ],
    },
    {
      kind: "prose",
      heading: "Copilot Drift & Violations",
      paragraphs: [
        "37 tenant configuration changes were made in the last 90 days with no recorded review. Two of those changes widened sharing scope on sites that now appear in the exposure findings. Without drift telemetry the readiness score you earn is not the score you keep.",
      ],
    },
    {
      kind: "sequence",
      heading: "Gate Blockers & Remediation Path",
      intro:
        "Three findings block the Copilot Gate outright and must clear before enablement for any user: the four unprotected Global Administrators, the four org-wide HR and finance sites, and the absence of DLP coverage on Teams chat.",
      steps: [
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
          when: "Gate",
          text: "Re-scan and validate. Copilot enablement is cleared at a readiness score of 68 with all three blockers closed.",
        },
      ],
    },
    {
      kind: "bullets",
      heading: "Self-Resolution Actions",
      items: [
        "Register MFA for the four Global Administrator accounts today — Entra admin centre, no licence change required.",
        "Remove the two privileged accounts with no sign-in in 60 days rather than remediating them.",
        "Revoke the org-wide sharing link on Compensation Review 2026, Redundancy Planning, Board Pack Q2 and Payroll Reconciliation.",
        "Set anonymous link expiry to 30 days tenant-wide.",
      ],
    },
    {
      kind: "prose",
      heading: "Executive Summary",
      paragraphs: [
        "Halden Materials scored 41 out of 100 and is not cleared for Copilot. The gap is 27 points and every point maps to a named, fixable finding. Three blockers stand between the tenant and the gate; none require new technology, and the licensing waste already identified funds a meaningful share of the work.",
      ],
    },
  ],
  provenance: PROVENANCE,
};

const SECURITY_POSTURE: PreviewPillarReport = {
  kind: "pillar",
  pillar: "security",
  kicker: "Security posture & blast radius",
  headline: "Identity is the first thing Copilot inherits",
  sections: [
    {
      kind: "prose",
      heading: "Security Posture Summary",
      paragraphs: [
        "Fourteen of 1,240 accounts complete sign-in without a second factor. Four of those hold Global Administrator. Copilot changes the consequence of that gap rather than the gap itself: a compromised account no longer reads one mailbox, it queries the estate in plain language.",
        "The pillar scores 38 against a projected 72 after remediation. Two of its four material findings are gate blockers.",
      ],
    },
    {
      kind: "findings",
      heading: "Identity & Access Risks",
      rows: [
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
    },
    {
      kind: "prose",
      heading: "Data Exposure & Blast Radius",
      paragraphs: [
        "Blast radius is what a single compromised identity can reach, not what it is meant to reach. On the current configuration one of the four unprotected Global Administrator accounts reaches all 1,847 SharePoint sites, every mailbox, and the 2,940 live anonymous links issued against them.",
        "For a standard licensed user the radius is smaller but still material: 212 org-wide sites, four of which hold HR and finance content. Copilot widens the practical radius further, because reaching content no longer requires knowing it exists.",
      ],
    },
    {
      kind: "findings",
      heading: "Device & Endpoint Compliance",
      rows: [
        {
          severity: "attention",
          lead: "Device compliance policy is in report-only mode.",
          rest: "1,240 enrolled devices are evaluated but nothing is enforced; 88 currently fail the baseline.",
        },
        {
          severity: "attention",
          lead: "No app protection policy on unmanaged devices.",
          rest: "Corporate data can be copied out of Office apps on personal devices with no restriction.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Security Drift & Violations",
      paragraphs: [
        "Six security-relevant configuration changes in 90 days, none reviewed. One disabled a Safe Links policy scoped to the finance group on 14 June and has not been reinstated.",
      ],
    },
    {
      kind: "prose",
      heading: "Copilot Readiness Impact",
      paragraphs: [
        "Security is one of three findings blocking the Copilot Gate outright. Until Conditional Access is scoped to privileged roles and legacy authentication is retired, Copilot cannot be enabled for any user without extending an identity gap into a conversational interface across the whole tenant.",
      ],
    },
    {
      kind: "bullets",
      heading: "Self-Resolution Actions",
      items: [
        "Register MFA for the four Global Administrator accounts — Entra admin centre, no licence change required.",
        "Remove the two privileged accounts dormant for 60 days rather than remediating them.",
        "Move device compliance out of report-only once the 88 failing devices are triaged.",
        "Reinstate the Safe Links policy disabled on 14 June.",
      ],
    },
  ],
  closingNote:
    "Security scores 38 and is a gate blocker. The remediation is a week of coordination rather than a change programme: four MFA registrations, one scoped Conditional Access policy, and retiring legacy auth after two line-of-business clients move to modern auth.",
  provenance: PROVENANCE,
};

const GOVERNANCE_POSTURE: PreviewPillarReport = {
  kind: "pillar",
  pillar: "governance",
  kicker: "Governance posture",
  headline: "Oversharing stops being a filing problem",
  sections: [
    {
      kind: "prose",
      heading: "Governance Posture Summary",
      paragraphs: [
        "1,847 SharePoint sites are in scope. 212 are shared with everyone in the tenant, and 34 of those were created in the last 90 days — the exposure is still growing. Copilot inherits every permission you have ever granted, which turns each of those sites into an answer waiting for the wrong question.",
        "The pillar scores 34 against a projected 61 after remediation — the second-lowest reading in the assessment.",
      ],
    },
    {
      kind: "findings",
      heading: "Exposure & Oversharing Risks",
      rows: [
        {
          severity: "critical",
          lead: "212 sites shared org-wide.",
          rest: "Four hold HR or finance content: Compensation Review 2026, Redundancy Planning, Board Pack Q2, and Payroll Reconciliation.",
        },
        {
          severity: "critical",
          lead: "2,940 active anonymous links, none expiring.",
          rest: "The oldest was created in 2021 and remains reachable by anyone holding the URL.",
        },
        {
          severity: "attention",
          lead: "Unrestricted Teams creation.",
          rest: "61 teams created in 90 days, 22 with a single member and no described purpose.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Governance Framework Alignment",
      paragraphs: [
        "Measured against the M365 governance framework Shane McCaw wrote at NASA: 4 of 11 controls are met. Site provisioning, ownership attestation, external sharing policy and lifecycle management are all unimplemented. Naming and classification standards exist as documentation but are not enforced at creation.",
      ],
    },
    {
      kind: "findings",
      heading: "Drift & Violations",
      rows: [
        {
          severity: "attention",
          lead: "Two sharing-scope changes in 90 days widened access.",
          rest: "Neither was reviewed; both affected sites that now appear in the oversharing findings above.",
        },
        {
          severity: "attention",
          lead: "No site lifecycle policy.",
          rest: "148 sites have had no content activity for 12 months and no owner has been asked to confirm them.",
        },
      ],
    },
    {
      kind: "prose",
      heading: "Governance Automation Readiness",
      paragraphs: [
        "The tenant has the platform capability to automate most of this and uses none of it. Site provisioning runs through manual admin requests, ownership attestation has never been run, and no retention or lifecycle policy is scheduled. Automating provisioning and attestation is what keeps the 212 from becoming 260 next quarter.",
      ],
    },
    {
      kind: "prose",
      heading: "Copilot Readiness Impact",
      paragraphs: [
        "Governance is a gate blocker. The four org-wide HR and finance sites must be closed before enablement. Copilot does not distinguish between content a user is permitted to reach and content they were ever meant to see — every one of the 212 is reachable in a plain-language answer.",
      ],
    },
    {
      kind: "bullets",
      heading: "Self-Resolution Actions",
      items: [
        "Revoke the org-wide link on the four HR and finance sites — SharePoint admin centre, immediate.",
        "Set anonymous link expiry to 30 days tenant-wide.",
        "Put Teams creation behind a request that captures purpose and owner.",
        "Run an owner attestation on the 148 dormant sites before deleting anything.",
      ],
    },
  ],
  closingNote:
    "Governance scores 34, the second-lowest pillar. The four sensitive sites close today; the remaining 208 are three weeks of owner attestation rather than a blanket removal. Automating provisioning and lifecycle is what stops the exposure regrowing.",
  provenance: PROVENANCE,
};

/**
 * Keyed by the document's own title, so the map lines up with
 * `JOURNEY_DESIGN_DOCUMENTS` without a second index to keep in step. A title
 * with no entry renders the still-generating state — which is exactly what the
 * design does for the other five reports.
 *
 * Title, not `docType`, on purpose: `JOURNEY_DESIGN_DOCUMENTS` is the design's
 * own list of report names and has no catalogue keys behind it. The live path
 * joins on `docType` and never reaches this map — it is only read behind
 * `?preview=design`.
 */
export const PREVIEW_DOCUMENT_BODIES: Readonly<Record<string, PreviewDocumentBody>> = {
  "Copilot Readiness, Safety & Enablement Report": COPILOT_READINESS_REPORT,
  "Microsoft 365 Security Posture & Blast Radius Report": SECURITY_POSTURE,
  "Microsoft 365 Governance Posture Report": GOVERNANCE_POSTURE,
};
