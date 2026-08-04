/**
 * previewDocumentBodies.ts — the seven report bodies the Document Viewer design
 * writes out in full, as data.
 *
 * WHY THIS FILE EXISTS AT ALL
 * ---------------------------
 * `Design/Document Viewer.dc.html` hand-writes seven of the eight reports — the
 * roll-up Copilot Readiness report and one per pillar — as sample prose for the
 * fictional stand-in tenant. On live data the viewer renders the platform's own
 * `htmlContent`, so this copy is reachable *only* behind `?preview=design`,
 * which paints a persistent `<PreviewBadge />`.
 *
 * It is a `.ts` and not inlined into `DocumentBody.tsx` for the platform's
 * no-hardcoding rule: the sample prose names dollar figures and seat counts, and
 * those may not appear in a `.tsx`. Same discipline, same reason, as
 * `journeyPreviewFixture.ts` — which owns the scores, the tenant and the scope,
 * and which this file deliberately does not duplicate. Every number the
 * *chrome* derives (a pillar score in an eyebrow, the projected-score line, the
 * big before/after numerals, the scan date, the signal count) is read from that
 * fixture at render time rather than restated here; numbers inside a sentence
 * stay verbatim, which is the same line the previous revision drew.
 *
 * Copy is final and in Shane's voice. Do not rewrite it.
 *
 * SECTION SHAPE — ORDERED BLOCKS, NOT ONE KIND PER SECTION
 * --------------------------------------------------------
 * The previous revision gave each section a single `kind`. This one cannot: the
 * design's third revision mixes shapes inside one heading — Security's "Posture
 * Summary" is a trend sparkline, then a paragraph, then a five-row table, and
 * Governance's "Exposure & Oversharing Risks" is a heat map followed by five
 * findings. So a section is now a `heading` plus an ordered `blocks` list, and
 * `DocumentBody.tsx` renders whichever block it finds in whatever order the
 * design put them.
 *
 * The dominant new shape is `keyValues` — a bordered label/value table where the
 * value carries a severity tone. It replaces most of what used to be prose.
 *
 * INCOMPLETE: THE HEALTH REPORT'S LAST TWO SECTIONS
 * -------------------------------------------------
 * `Document Viewer.dc.html` is larger than the 256 KiB the design MCP's
 * `get_file` will return, and the read is truncated inside the Health report's
 * "Self-Resolution Actions". Its six preceding sections are complete and
 * verbatim; that section and its closing Executive Summary paragraphs are absent
 * rather than invented. Everything after them in the source (the still-
 * generating state, the ShaneBot dock, the mobile sheet) was already
 * implemented from the previous import and is unaffected.
 */

import type { PillarKey, Severity } from "./journeyTokens.ts";

/** One row of a findings-shaped block. The left border is the severity colour. */
export interface PreviewFindingRow {
  readonly severity: Severity;
  /** The bolded claim that opens the row. */
  readonly lead: string;
  /** The sentence that qualifies it. */
  readonly rest: string;
}

/** One row of the bordered label/value table the design leans on most. */
export interface PreviewKeyValueRow {
  readonly label: string;
  /** Colours the value, never the label — severity, not pillar identity. */
  readonly tone: Severity;
  readonly value: string;
}

export interface PreviewStep {
  readonly when: string;
  readonly text: string;
}

/**
 * The data visuals, by name. Each one's numbers live in `PREVIEW_FIGURES`
 * below (or are derived from `journeyPreviewFixture.ts`); the block itself only
 * says *which* figure belongs at that point in the report.
 */
export type ReportFigure =
  | "readinessRadar"
  | "scoreSummary"
  | "pillarTable"
  | "secureScoreTrend"
  | "blastRadius"
  | "exposureHeatmap"
  | "monthlyWaste"
  | "usageTrend"
  | "personaSplit"
  | "departmentUsage";

export type ReportBlock =
  | { readonly kind: "prose"; readonly text: string }
  | { readonly kind: "findings"; readonly rows: readonly PreviewFindingRow[] }
  | { readonly kind: "keyValues"; readonly rows: readonly PreviewKeyValueRow[] }
  | { readonly kind: "bullets"; readonly items: readonly string[] }
  | { readonly kind: "steps"; readonly steps: readonly PreviewStep[] }
  | { readonly kind: "figure"; readonly figure: ReportFigure };

export interface ReportSection {
  readonly heading: string;
  readonly blocks: readonly ReportBlock[];
}

/** The hero card under every report's header: an eyebrow, a claim, a consequence. */
export interface PreviewVerdictCard {
  readonly eyebrow: string;
  readonly headline: string;
  readonly sub: string;
}

/** The provenance line every report closes with — identical text, one function. */
export type ReportProvenance = (scannedOn: string, signalCount: number) => string;

const PROVENANCE: ReportProvenance = (scannedOn, signalCount) =>
  `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions. ${signalCount} signal derivation checks across six pillars. No configuration was altered during assessment.`;

interface PreviewReportBase {
  /** The eyebrow ahead of the derived "· pillar score N" or "· {scan date}". */
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: PreviewVerdictCard;
  readonly sections: readonly ReportSection[];
  /** The closing "Executive Summary" paragraphs, ahead of the projected-score line. */
  readonly closing: readonly string[];
  readonly provenance: ReportProvenance;
}

export interface PreviewExecutiveReport extends PreviewReportBase {
  readonly kind: "executive";
}

export interface PreviewPillarReport extends PreviewReportBase {
  readonly kind: "pillar";
  readonly pillar: PillarKey;
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

/* ------------------------------------------------------------------ *
 * Figure data
 *
 * Kept beside the copy rather than in the renderer for the same reason as
 * everything else in this file: these are dollar figures, seat counts and
 * department names, which may not appear in a `.tsx`. The renderer in
 * `ReportFigures.tsx` reads them and owns only geometry.
 * ------------------------------------------------------------------ */

/** A sparkline: values 0–1 where 1 is the top of the plot, oldest reading first. */
export interface PreviewTrendFigure {
  readonly series: readonly number[];
  /** "−8 pts" — the movement across the window, already signed. */
  readonly delta: string;
  /** Severity of the movement, not of the level. */
  readonly deltaTone: Severity;
  readonly caption: string;
  readonly note: string;
}

/** One ring of the blast-radius diagram, outermost last. */
export interface PreviewBlastRing {
  /** 0–1, share of the outermost radius. */
  readonly radius: number;
  readonly colour: string;
  readonly label: string;
  readonly value: string;
  /** Which side the leader line runs to. */
  readonly side: "left" | "right";
  /** Solid ring for the two innermost, dashed for the reach beyond them. */
  readonly dashed: boolean;
}

export interface PreviewHeatmapFigure {
  readonly caption: string;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly label: string; readonly cells: readonly { readonly text: string; readonly intensity: number }[] }[];
  readonly lowLabel: string;
  readonly highLabel: string;
  readonly note: string;
}

/** A horizontal bar list — the licensing waste table and the Teams usage table. */
export interface PreviewBarFigure {
  readonly caption: string;
  readonly rows: readonly { readonly label: string; readonly fill: number; readonly value: string; readonly tone: Severity }[];
  /** The bordered summary row beneath, where the design draws one. */
  readonly total?: { readonly label: string; readonly value: string; readonly detail: string };
  readonly note?: string;
}

/** The single stacked bar splitting the estate three ways. */
export interface PreviewSplitFigure {
  readonly caption: string;
  readonly segments: readonly { readonly label: string; readonly count: number; readonly share: number; readonly tone: Severity }[];
}

export const PREVIEW_FIGURES = {
  readinessRadarNote:
    "Readiness contribution by pillar, read on {date}. The shape is the argument: Licensing is closest to ready, Compliance furthest from it.",

  secureScoreTrend: {
    // Microsoft's own Secure Score history: six readings, falling.
    series: [1, 0.75, 0.873, 0.373, 0.25, 0],
    delta: "−8 pts",
    deltaTone: "critical",
    caption: "Secure Score · 180 days",
    note: "Microsoft's own Secure Score history for this tenant. The trend is downward, not static — the gap has been widening for two quarters.",
  } satisfies PreviewTrendFigure,

  usageTrend: {
    series: [0, 0.373, 0.623, 1, 0.873, 0.873],
    delta: "+7 pts",
    deltaTone: "attention",
    caption: "Usage · D7–D180",
    note: "Graph usage reports for this tenant. Adoption is improving slowly and has been flat for two periods.",
  } satisfies PreviewTrendFigure,

  blastRadius: {
    caption: "Blast radius of one compromised identity",
    note: "Each ring is what that one account actually reaches, not what it was meant to reach. A standard licensed user stops at the third ring; any of the four unprotected Global Administrators reaches the fifth.",
    legend: [
      { label: "Standard user · 212 sites", colour: "#a78bfa" },
      { label: "Global Admin · 1,847 sites", colour: "#6d28d9" },
    ],
    rings: [
      { radius: 0.247, colour: "#f87171", label: "Compromised identity", value: "1 account", side: "right", dashed: false },
      { radius: 0.419, colour: "#fb923c", label: "Own mailbox and files", value: "Immediate", side: "left", dashed: false },
      { radius: 0.602, colour: "#a78bfa", label: "Org-wide sites", value: "212 reachable", side: "right", dashed: true },
      { radius: 0.796, colour: "#8B5CF6", label: "Regulated clusters", value: "690 PII · 412 fin · 84 PHI", side: "left", dashed: true },
      { radius: 1, colour: "#6d28d9", label: "Whole tenant", value: "1,847 sites · every mailbox", side: "right", dashed: true },
    ] satisfies readonly PreviewBlastRing[],
  },

  exposureHeatmap: {
    caption: "Exposure by content category",
    columns: ["Org-wide links", "Anonymous links", "Public Teams", "Unlabelled"],
    rows: [
      {
        label: "Financial",
        cells: [
          { text: "38", intensity: 0.317 },
          { text: "412", intensity: 0.251 },
          { text: "6", intensity: 0.144 },
          { text: "71%", intensity: 0.48 },
        ],
      },
      {
        label: "Personal data (PII)",
        cells: [
          { text: "54", intensity: 0.426 },
          { text: "690", intensity: 0.379 },
          { text: "9", intensity: 0.186 },
          { text: "63%", intensity: 0.433 },
        ],
      },
      {
        label: "HR & health (PHI)",
        cells: [
          { text: "11", intensity: 0.135 },
          { text: "84", intensity: 0.099 },
          { text: "2", intensity: 0.088 },
          { text: "58%", intensity: 0.403 },
        ],
      },
      {
        label: "Commercial",
        cells: [
          { text: "47", intensity: 0.378 },
          { text: "908", intensity: 0.48 },
          { text: "14", intensity: 0.256 },
          { text: "66%", intensity: 0.45 },
        ],
      },
      {
        label: "General",
        cells: [
          { text: "62", intensity: 0.48 },
          { text: "846", intensity: 0.451 },
          { text: "30", intensity: 0.48 },
          { text: "54%", intensity: 0.379 },
        ],
      },
    ],
    lowLabel: "Lower",
    highLabel: "Higher exposure",
    note: "Financial and HR content is the smallest share of exposure by volume and the largest by consequence. The final column is the proportion of that category carrying no sensitivity label — what Copilot can ground on unrestricted.",
  } satisfies PreviewHeatmapFigure,

  monthlyWaste: {
    caption: "Monthly waste by category",
    rows: [
      { label: "Unused Copilot seats", fill: 1, value: "$660", tone: "critical" },
      { label: "E5 assigned to ineligible users", fill: 0.75, value: "$495", tone: "attention" },
      { label: "Duplicate service plans", fill: 0.38, value: "$248", tone: "attention" },
      { label: "Unassigned base licences", fill: 0.2, value: "$130", tone: "attention" },
    ],
    total: { label: "Total monthly waste", value: "$1,533", detail: " · $18,400 a year" },
  } satisfies PreviewBarFigure,

  departmentUsage: {
    caption: "Weekly Teams usage by department",
    rows: [
      { label: "Finance", fill: 0.91, value: "91%", tone: "healthy" },
      { label: "Legal", fill: 0.88, value: "88%", tone: "healthy" },
      { label: "Engineering", fill: 0.74, value: "74%", tone: "attention" },
      { label: "Sales", fill: 0.69, value: "69%", tone: "attention" },
      { label: "Operations", fill: 0.38, value: "38%", tone: "critical" },
      { label: "Field Services", fill: 0.26, value: "26%", tone: "critical" },
    ],
  } satisfies PreviewBarFigure,

  personaSplit: {
    caption: "Persona readiness · 1,240 users",
    segments: [
      { label: "Ready", count: 312, share: 0.252, tone: "healthy" },
      { label: "Needs training", count: 516, share: 0.416, tone: "attention" },
      { label: "Not ready", count: 412, share: 0.332, tone: "critical" },
    ],
  } satisfies PreviewSplitFigure,
} as const;


const COPILOT_READINESS_REPORT: PreviewExecutiveReport = {
  kind: "executive",
  kicker: "Copilot readiness, safety & enablement",
  headline: "It is not yet safe to turn Copilot on at Halden Materials",
  standfirst: "This report evaluates your tenant's readiness to safely deploy Microsoft Copilot. It measures governance, security, compliance, adoption, licensing and health signals that directly affect Copilot's accuracy, safety and value. Every finding traces to telemetry surfaced in your assessment and directly impacts the Copilot Gate.",
  verdict: {
    eyebrow: "The verdict",
    headline: "41 — not flight-ready for Copilot",
    sub: "Six pillars, 41 points, and a gate that needs 82. Every point of the gap is a named, fixable finding.",
  },
  sections: [
    {
      heading: "Copilot Readiness Summary",
      blocks: [
        { kind: "figure", figure: "readinessRadar" },
        { kind: "figure", figure: "scoreSummary" },
        { kind: "figure", figure: "pillarTable" },
        {
          kind: "keyValues",
          rows: [
            { label: "Copilot blast radius", tone: "critical", value: "1,847 sites reachable by a Global Administrator · 212 by any licensed user" },
            { label: "Personas ready today", tone: "attention", value: "3 of 9 — Finance Analyst, Legal Counsel, Executive Assistant" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Safety & Exposure",
      blocks: [
        { kind: "prose", text: "Copilot does not respect intent, only permissions. A licensed user in Field Services can ask a plain-language question today and receive content from 212 org-wide sites, including the four HR and finance sites found among them." },
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "Sensitive content Copilot can ground on.", rest: "Nine sites carrying HR, health or financial data are reachable by every licensed user." },
            { severity: "critical", lead: "61% of content carries no sensitivity label.", rest: "Unlabelled files are summarised, quoted and exported without restriction." },
            { severity: "critical", lead: "Regulated categories in scope.", rest: "PII in 690 anonymous-linked items, PHI in 84, financial in 412 — none label-protected." },
            { severity: "attention", lead: "External exposure affecting grounding.", rest: "2,940 anonymous links across 14 external domains remain live and unexpiring." },
            { severity: "critical", lead: "Permission sprawl expands the blast radius.", rest: "11 standing Global Administrators, four without MFA, no PIM in use." },
          ],
        },
      ],
    },
    {
      heading: "Workflow Enablement & Value",
      blocks: [
        { kind: "prose", text: "Value concentrates where the work already happens. 828 of 1,240 users are active in Teams weekly and would see returns immediately; the remaining 412 have not opened Teams in 30 days." },
        {
          kind: "keyValues",
          rows: [
            { label: "Improvable immediately", tone: "healthy", value: "Meeting recap, mail triage, document drafting — Finance, Legal, Executive" },
            { label: "Not safe yet by gaps", tone: "critical", value: "Contract review and HR case handling — blocked by unlabelled regulated content" },
            { label: "High-value personas", tone: "healthy", value: "Finance Analyst, Legal Counsel, Executive Assistant, Bid Manager" },
            { label: "Low readiness by workflow", tone: "attention", value: "Operations and Field Services — document-heavy, collaboration-light" },
            { label: "Cross-department inconsistency", tone: "attention", value: "Four different approval patterns for the same procurement workflow" },
          ],
        },
      ],
    },
    {
      heading: "Technical Prerequisites & Platform Alignment",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Licensing prerequisites", tone: "attention", value: "96 users require an E5 uplift to carry the controls Copilot depends on" },
            { label: "Conditional Access", tone: "critical", value: "No policy scoped to privileged roles — required before activation" },
            { label: "Authentication & identity", tone: "critical", value: "Legacy authentication enabled tenant-wide · 1,106 legacy sign-ins in 30 days" },
            { label: "Device compliance", tone: "attention", value: "Report-only mode · 88 devices currently failing the baseline" },
            { label: "Workload stability", tone: "attention", value: "OneDrive activated for 31% of the estate against a near-full prerequisite" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Drift & Violations",
      blocks: [
        { kind: "prose", text: "37 tenant configuration changes were made in the last 90 days with no recorded review. Drift is why the score you earn is not the score you keep." },
        {
          kind: "keyValues",
          rows: [
            { label: "Governance drift", tone: "attention", value: "Two sharing-scope changes widened access; neither reviewed" },
            { label: "Security drift", tone: "critical", value: "A Safe Links policy scoped to Finance was disabled on 14 June, not reinstated" },
            { label: "Compliance drift", tone: "critical", value: "Labels removed or downgraded on 148 sites with no approval trail" },
            { label: "Adoption drift", tone: "attention", value: "Teams weekly actives fell 6% over two quarters" },
            { label: "Health drift", tone: "attention", value: "No configuration baseline on record to measure against" },
          ],
        },
      ],
    },
    {
      heading: "Gate Blockers & Remediation Path",
      blocks: [
        { kind: "prose", text: "Three findings block the Copilot Gate outright and must clear before enablement for any user: the four unprotected Global Administrators, the four org-wide HR and finance sites, and the absence of DLP coverage on Teams chat." },
        {
          kind: "keyValues",
          rows: [
            { label: "Required governance", tone: "critical", value: "Close the four sensitive sites · expire anonymous links · publish enforced labels" },
            { label: "Required security", tone: "critical", value: "MFA on four privileged accounts · Conditional Access scoped to privileged roles · retire legacy auth" },
            { label: "Required compliance", tone: "critical", value: "Extend DLP to Teams chat and OneDrive · auto-label regulated content" },
            { label: "Required adoption", tone: "attention", value: "Targeted enablement in Operations and Field Services before licences are issued" },
            { label: "Required licensing", tone: "attention", value: "E5 uplift for 96 users · reclaim $18,400 a year in unassigned seats" },
            { label: "Required health", tone: "attention", value: "Capture a signed configuration baseline and put drift telemetry on the tenant" },
          ],
        },
        {
          kind: "steps",
          steps: [
            { when: "WEEK 1", text: "Privileged identity: MFA, Conditional Access, legacy auth retired. Highest risk, lowest effort, no user impact." },
            { when: "WEEK 2–4", text: "Sharing exposure and the baseline label set, starting with the four sensitive sites." },
            { when: "MONTH 2", text: "DLP extension, licence rationalisation, and targeted adoption enablement." },
            { when: "GATE", text: "Re-scan and validate. Copilot activation clears at 68 with all three blockers closed." },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Reduce the blast radius safely: revoke org-wide sharing on the four sensitive sites first, then attest the remaining 208 by owner rather than removing access in bulk.",
            "Label and protect Copilot-visible content: publish a mandatory baseline label, then auto-label regulated categories before any manual review.",
            "Modernise workflows for alignment: standardise the four competing procurement approval patterns onto one before enabling Copilot on that workflow.",
            "Correct licensing for eligibility: reclaim the dormant seats and fund the 96-user E5 uplift from the recovered spend.",
            "Enforce Conditional Access for Copilot workloads: scope a policy to privileged roles, then extend device compliance out of report-only.",
            "Run monthly readiness reviews: re-scan on a schedule so the 27-point gain holds rather than drifting back.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Copilot is only safe and effective when your environment is ready. Governance, security, compliance, adoption, licensing and health must be aligned before Copilot can be deployed.",
    "Halden Materials scored 41, which is below the safe-to-deploy threshold of 82. The gap is 27 points and every point maps to a named, fixable finding. Three blockers stand between the tenant and activation; none require new technology, and the licensing waste already identified funds a meaningful share of the work.",
  ],
  provenance: PROVENANCE,
};

const SECURITY_POSTURE: PreviewPillarReport = {
  kind: "pillar",
  pillar: "security",
  kicker: "Security posture & blast radius",
  headline: "Identity is the first thing Copilot inherits",
  standfirst: "This report evaluates your tenant's security posture across identity, access, data protection, device compliance and Conditional Access. Every finding traces to security telemetry surfaced in your assessment and directly affects Copilot readiness.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "4 unprotected Global Administrator accounts",
    sub: "One phished credential reads the whole estate conversationally, not mailbox by mailbox.",
  },
  sections: [
    {
      heading: "Security Posture Summary",
      blocks: [
        { kind: "figure", figure: "secureScoreTrend" },
        { kind: "prose", text: "Security maturity scores 38 of 100. Fourteen of 1,240 accounts complete sign-in without a second factor, and four of those hold Global Administrator. Copilot changes the consequence of that gap rather than the gap itself: a compromised account no longer reads one mailbox, it queries the estate in plain language." },
        {
          kind: "keyValues",
          rows: [
            { label: "Security maturity", tone: "critical", value: "38 / 100 · Microsoft Secure Score 38%, down 8 points in 180 days" },
            { label: "Identity hygiene", tone: "critical", value: "11 standing Global Administrators · 4 without MFA · no PIM in use" },
            { label: "Conditional Access baseline", tone: "critical", value: "3 policies, all scoped to all-users · none scoped to privileged roles" },
            { label: "Device compliance coverage", tone: "attention", value: "1,240 devices enrolled, evaluated in report-only · 88 failing" },
            { label: "Security drift", tone: "attention", value: "6 security-relevant changes in 90 days, none reviewed" },
          ],
        },
      ],
    },
    {
      heading: "Identity & Access Risks",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "11 permanent admin accounts for 1,240 seats.", rest: "All standing, none just-in-time. Two have not signed in for 60 days." },
            { severity: "critical", lead: "Admin role over-assignment.", rest: "Six accounts hold Global Administrator where Exchange or SharePoint Administrator would suffice." },
            { severity: "critical", lead: "MFA gaps: 14 users, 4 of them admins.", rest: "No registration campaign is in force and no policy requires it." },
            { severity: "critical", lead: "Legacy authentication enabled tenant-wide.", rest: "1,106 legacy protocol sign-ins in 30 days, concentrated in two line-of-business mail clients." },
            { severity: "attention", lead: "CA01 disabled; baseline violations on two policies.", rest: "One policy excludes a 44-member group added on 14 June with no recorded justification." },
          ],
        },
      ],
    },
    {
      heading: "Data Exposure & Blast Radius",
      blocks: [
        { kind: "figure", figure: "blastRadius" },
        { kind: "prose", text: "Blast radius is what a compromised identity can reach, not what it is meant to reach. One of the four unprotected Global Administrators reaches all 1,847 sites, every mailbox, and the 2,940 live anonymous links issued against them." },
        {
          kind: "keyValues",
          rows: [
            { label: "Sensitive data overshared", tone: "critical", value: "9 sites carrying HR, health or financial data reachable by every licensed user" },
            { label: "Regulated clusters uncontrolled", tone: "critical", value: "PII in 690 anonymous-linked items · PHI in 84 · financial in 412" },
            { label: "Unlabelled sensitive content", tone: "critical", value: "61% of all content · 58% of HR and health content specifically" },
            { label: "Broken inheritance", tone: "attention", value: "74 libraries with broken permission inheritance, 12 in Finance" },
            { label: "Radius expansion from security gaps", tone: "critical", value: "Admin radius 1,847 sites · standard user radius 212" },
          ],
        },
      ],
    },
    {
      heading: "Device & Endpoint Compliance",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "attention", lead: "88 non-compliant devices reach cloud workloads.", rest: "Compliance is evaluated but not enforced, so access is never blocked." },
            { severity: "attention", lead: "Devices missing required baselines.", rest: "61 lack disk encryption, 34 lack a current OS patch level." },
            { severity: "attention", lead: "Compliance policy drift.", rest: "Two policies were relaxed in the last 90 days with no approval trail." },
            { severity: "critical", lead: "No Conditional Access enforcement on device state.", rest: "Device compliance is not a grant control on any of the three policies." },
            { severity: "attention", lead: "Endpoint posture affects Copilot safety.", rest: "Copilot output reaches unmanaged endpoints where no app protection policy applies." },
          ],
        },
      ],
    },
    {
      heading: "Security Drift & Violations",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Conditional Access drift", tone: "critical", value: "CA01 disabled · device compliance never promoted out of report-only" },
            { label: "Identity drift", tone: "attention", value: "3 role escalations in 90 days, none with a recorded approver" },
            { label: "Authentication drift", tone: "critical", value: "Legacy protocols remain enabled despite a 2024 decommission decision" },
            { label: "DLP drift", tone: "critical", value: "A Safe Links policy scoped to Finance was disabled on 14 June, not reinstated" },
            { label: "Security Engine drift signals", tone: "attention", value: "6 signals raised over 90 days · none triaged · no baseline to compare against" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Security is one of three findings blocking the Copilot Gate outright. Until Conditional Access is scoped to privileged roles and legacy authentication is retired, enabling Copilot extends an identity gap into a conversational interface across the whole tenant." },
        {
          kind: "keyValues",
          rows: [
            { label: "Not safe yets", tone: "critical", value: "Four unprotected Global Administrators · no privileged-role Conditional Access" },
            { label: "Groundable due to security gaps", tone: "critical", value: "9 regulated sites reachable without label or DLP protection" },
            { label: "Identity gaps affecting safety", tone: "critical", value: "One phished credential reads the estate conversationally, not mailbox by mailbox" },
            { label: "Readiness score impact", tone: "attention", value: "Security contributes the largest single remediable gain: 38 to 72" },
            { label: "Required to clear the gate", tone: "healthy", value: "MFA on four accounts · privileged-role CA policy · legacy auth retired" },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Correct admin role assignments: reduce 11 standing Global Administrators to 2 break-glass accounts, and move the other nine to the least-privileged role that covers their actual work.",
            "Enforce MFA across all identities: register the four privileged accounts first, then run a tenant-wide registration campaign before making it a grant control.",
            "Re-align the Conditional Access baseline: remove the 14 June group exclusion, re-enable CA01, then add a policy scoped to privileged roles specifically.",
            "Eliminate privilege creep: enable PIM with just-in-time elevation and expire the three unapproved escalations from the last 90 days.",
            "Restore device compliance coverage: triage the 88 failing devices, then promote compliance out of report-only and make it a grant control.",
            "Run monthly security posture reviews: re-scan on a schedule so Secure Score is watched rather than discovered eight points down.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Security determines whether Copilot can operate safely. Identity, access, device compliance and Conditional Access must be aligned before Copilot can be deployed.",
    "Security scores 38 and is a gate blocker. The remediation is a week of coordination rather than a change programme: four MFA registrations, one scoped Conditional Access policy, and retiring legacy auth once two line-of-business clients move to modern auth. It is also the largest single readiness gain available.",
  ],
  provenance: PROVENANCE,
};

const GOVERNANCE_POSTURE: PreviewPillarReport = {
  kind: "pillar",
  pillar: "governance",
  kicker: "Governance posture",
  headline: "Oversharing stops being a filing problem",
  standfirst: "This report defines your tenant's governance posture, identifies every governance gap blocking Copilot readiness, and traces each finding to telemetry already surfaced in your assessment.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "212 sites shared with everyone in your tenant",
    sub: "Four of them hold HR and finance content. Copilot inherits every permission you have ever granted.",
  },
  sections: [
    {
      heading: "Governance Posture Summary",
      blocks: [
        { kind: "prose", text: "Governance maturity scores 34 of 100. Policy coverage is the weakest dimension: sensitivity labels are published but unenforced, DLP covers Exchange only, retention is applied to 3 of 9 workloads, and no lifecycle policy exists for Teams, SharePoint or OneDrive." },
        {
          kind: "keyValues",
          rows: [
            { label: "Governance maturity", tone: "critical", value: "34 / 100 — 4 of 11 framework controls met" },
            { label: "Policy coverage", tone: "critical", value: "Labels published, not enforced · DLP on Exchange only · retention on 3 of 9 workloads" },
            { label: "Admin role discipline", tone: "critical", value: "11 Global Administrators for 1,240 seats · 4 without MFA · no PIM in use" },
            { label: "Conditional Access baseline", tone: "attention", value: "3 policies, all scoped to all-users · device compliance report-only" },
            { label: "Governance drift", tone: "attention", value: "37 configuration changes in 90 days, none reviewed" },
          ],
        },
      ],
    },
    {
      heading: "Exposure & Oversharing Risks",
      blocks: [
        { kind: "figure", figure: "exposureHeatmap" },
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "212 of 1,847 sites shared org-wide.", rest: "Four hold HR or finance content: Compensation Review 2026, Redundancy Planning, Board Pack Q2, Payroll Reconciliation." },
            { severity: "critical", lead: "2,940 active anonymous links, none expiring.", rest: "The oldest was created in 2021 and remains reachable by anyone holding the URL." },
            { severity: "critical", lead: "61% of content carries no sensitivity label.", rest: "Unlabelled content is content Copilot grounds on without restriction." },
            { severity: "attention", lead: "61 public Teams channels, 22 with a single member.", rest: "Public channels are indexed for every licensed user regardless of purpose." },
            { severity: "attention", lead: "31 unmanaged guest identities across 14 external domains.", rest: "Nine retain access to sites that also appear in the oversharing findings above." },
          ],
        },
      ],
    },
    {
      heading: "Governance Framework Alignment",
      blocks: [
        { kind: "prose", text: "Measured against the M365 governance framework Shane McCaw wrote at NASA and distributed agency-wide: 4 of 11 controls met." },
        {
          kind: "keyValues",
          rows: [
            { label: "Naming & taxonomy", tone: "attention", value: "Documented, not enforced at creation — 340 sites deviate" },
            { label: "Sensitivity label strategy", tone: "critical", value: "Five labels published; no auto-labelling, no mandatory application" },
            { label: "Retention & records", tone: "critical", value: "Exchange and SharePoint only — Teams chat, OneDrive, Planner uncovered" },
            { label: "Lifecycle policies", tone: "critical", value: "None for Teams, SharePoint or OneDrive" },
            { label: "Privileged access / RBAC", tone: "critical", value: "No PIM, no just-in-time elevation, 11 standing Global Admins" },
          ],
        },
      ],
    },
    {
      heading: "Drift & Violations",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "attention", lead: "Two sharing-scope changes widened access in 90 days.", rest: "Neither was reviewed; both affected sites now in the oversharing findings." },
            { severity: "attention", lead: "Label and DLP compliance drift on 148 sites.", rest: "Applied labels were removed or downgraded with no approval trail." },
            { severity: "attention", lead: "Conditional Access baseline deviation.", rest: "One policy excludes a 44-member group added on 14 June with no recorded justification." },
            { severity: "attention", lead: "Lifecycle violations: 148 inactive sites, 19 orphaned channels.", rest: "No owner has been asked to confirm any of them." },
            { severity: "attention", lead: "340 naming convention violations across workloads.", rest: "Concentrated in Teams created outside the request process." },
          ],
        },
      ],
    },
    {
      heading: "Governance Automation Readiness",
      blocks: [
        { kind: "prose", text: "Most of this is automatable on your existing licensing and none of it is automated today. Provisioning runs through manual admin requests, attestation has never run, and no lifecycle job is scheduled." },
        {
          kind: "keyValues",
          rows: [
            { label: "Eligible for automated remediation", tone: "healthy", value: "Anonymous link expiry, lifecycle policy, naming enforcement, guest review" },
            { label: "Requires change control approval", tone: "attention", value: "Conditional Access baseline re-alignment, DLP scope extension" },
            { label: "SIA dependencies", tone: "attention", value: "Label enforcement and retention changes require Security Impact Assessment" },
            { label: "RBD conflicts", tone: "critical", value: "One: standing Global Admin access accepted as a Risk-Based Decision in 2024, now expired" },
            { label: "Governance owner sign-off", tone: "critical", value: "No named governance owner on record — assign before automation begins" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Governance is a Copilot Not safe yet. Copilot grounds on whatever a user is permitted to reach, and 212 org-wide sites plus 61% unlabelled content means the practical grounding surface is close to the whole tenant." },
        {
          kind: "keyValues",
          rows: [
            { label: "Not safe yets", tone: "critical", value: "Four org-wide sites holding HR and finance content must be closed" },
            { label: "Groundable but unprotected", tone: "critical", value: "61% of content unlabelled · 2,940 live anonymous links" },
            { label: "Safety & accuracy risk", tone: "attention", value: "Stale content in 148 inactive sites returns as current in answers" },
            { label: "Readiness score impact", tone: "critical", value: "Governance contributes the second-largest deficit: 34 against a target of 61" },
            { label: "Required to clear the gate", tone: "healthy", value: "Close the four sensitive sites, expire anonymous links, publish enforced labels" },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Enforce naming conventions safely: apply at creation through a provisioning request, and leave the 340 existing deviations in place rather than renaming live sites.",
            "Apply sensitivity labels at scale: publish a mandatory baseline label, then auto-label by content type before touching anything manually.",
            "Correct admin role assignments: reduce 11 standing Global Administrators to 2 break-glass accounts and move the rest to PIM-elevated roles.",
            "Re-align the Conditional Access baseline: remove the 14 June group exclusion, then scope a policy to privileged roles specifically.",
            "Clean up oversharing: revoke the four sensitive sites today, then run owner attestation across the remaining 208 rather than a blanket removal.",
            "Implement lifecycle policies consistently: 12-month inactivity with owner confirmation, applied to Teams, SharePoint and OneDrive together, not one workload at a time.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Your governance posture is the backbone of your Microsoft 365 environment. It determines how safely Copilot can operate, how predictably your data behaves, and how effectively your security and compliance controls function.",
    "Governance scores 34, the second-lowest reading in the assessment. The four sensitive sites close today. The remaining 208 are three weeks of owner attestation, not a blanket removal. Automating provisioning and lifecycle is what stops the exposure regrowing — without it, 212 becomes 260 next quarter.",
  ],
  provenance: PROVENANCE,
};

const COMPLIANCE_ALIGNMENT: PreviewPillarReport = {
  kind: "pillar",
  pillar: "compliance",
  kicker: "Compliance & regulatory alignment",
  headline: "Labels are the only instruction Copilot obeys",
  standfirst: "This report evaluates your tenant's compliance posture across regulatory, retention, labeling, auditing and lifecycle controls. Every finding traces to compliance telemetry surfaced in your assessment and directly affects Copilot readiness.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "0 DLP policies cover Teams chat",
    sub: "Regulated data moves through chat every day with nothing watching it and nothing to stop it.",
  },
  sections: [
    {
      heading: "Compliance Posture Summary",
      blocks: [
        { kind: "prose", text: "Compliance maturity scores 29 of 100 — the lowest reading in the assessment. No DLP policy covers Teams chat, 61% of content carries no sensitivity label, and retention is applied to 3 of 9 workloads. Unlabelled data is data Copilot will summarise, quote and export without restriction." },
        {
          kind: "keyValues",
          rows: [
            { label: "Compliance maturity", tone: "critical", value: "29 / 100 · lowest of the six pillars" },
            { label: "Regulatory coverage", tone: "critical", value: "GDPR partial · SOX partial · HIPAA not addressed · FINRA not applicable" },
            { label: "Retention alignment", tone: "critical", value: "Applied to Exchange, SharePoint and Groups · absent on Teams chat, OneDrive, Planner" },
            { label: "Records management", tone: "critical", value: "No records label published · no disposition review configured" },
            { label: "Compliance drift", tone: "critical", value: "Labels removed or downgraded on 148 sites with no approval trail" },
          ],
        },
      ],
    },
    {
      heading: "Regulatory Alignment Assessment",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "GDPR", tone: "critical", value: "Lawful-basis records absent · no DSR workflow · retention on personal data incomplete" },
            { label: "SOX", tone: "attention", value: "Financial content retained but not immutable · no records declaration on Board Pack sites" },
            { label: "HIPAA", tone: "critical", value: "84 items with health data carry no label, no DLP, no retention" },
            { label: "FINRA", tone: "healthy", value: "Not applicable to this tenant — confirmed, no controls required" },
            { label: "Audit log coverage", tone: "critical", value: "Enabled tenant-wide · 90-day retention only, below every framework requirement" },
            { label: "Copilot regulatory blockers", tone: "critical", value: "Copilot cannot operate over the HR and health content until labelled and DLP-covered" },
          ],
        },
      ],
    },
    {
      heading: "Data Lifecycle & Records Management",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "Retention applied to 3 of 9 workloads.", rest: "Teams chat, OneDrive, Planner, Forms, Stream and Yammer have no policy at all." },
            { severity: "critical", lead: "148 inactive sites and 19 orphaned channels violate lifecycle rules.", rest: "No owner has been asked to confirm or dispose of any of them." },
            { severity: "attention", lead: "Records management coverage is uneven by department.", rest: "Finance and Legal have declared records; Operations, HR and Field Services have none." },
            { severity: "critical", lead: "No auto-classification for regulated content.", rest: "Every label application is manual, which is why 61% carry none." },
            { severity: "attention", lead: "Lifecycle inconsistency affects Copilot grounding.", rest: "Stale content in the 148 inactive sites returns as current in answers." },
          ],
        },
      ],
    },
    {
      heading: "Sensitivity & Labeling Compliance",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Sensitive data without labels", tone: "critical", value: "58% of HR and health content · 71% of financial content" },
            { label: "Regulated categories outside DLP", tone: "critical", value: "PII, PHI and financial data in Teams chat and OneDrive — no policy applies" },
            { label: "Label inheritance gaps", tone: "attention", value: "74 libraries with broken inheritance · 12 in Finance" },
            { label: "Label drift", tone: "critical", value: "Five labels published, applied inconsistently — 148 sites show removal or downgrade" },
            { label: "Copilot exposure", tone: "critical", value: "61% of all groundable content is unlabelled and therefore unrestricted" },
          ],
        },
      ],
    },
    {
      heading: "Compliance Drift & Violations",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "Retention drift: six workloads uncovered.", rest: "Coverage has not been extended since the original 2024 deployment." },
            { severity: "critical", lead: "Labeling drift across workloads.", rest: "Labels applied in SharePoint are not enforced in Teams or OneDrive equivalents." },
            { severity: "critical", lead: "DLP drift.", rest: "No policy scoped to Teams chat; a Safe Links policy on Finance was disabled on 14 June and not reinstated." },
            { severity: "critical", lead: "Audit log retention at 90 days.", rest: "Below GDPR, SOX and HIPAA requirements — investigations beyond 90 days are not possible." },
            { severity: "attention", lead: "Lifecycle violations: 148 inactive containers, 19 orphaned channels.", rest: "No disposition review has ever run." },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Compliance is one of three findings blocking the Copilot Gate. Unlabelled regulated data is the single largest exposure in this assessment: Copilot will quote it, summarise it and export it with nothing instructing it otherwise." },
        {
          kind: "keyValues",
          rows: [
            { label: "Not safe yets", tone: "critical", value: "No DLP on Teams chat · 61% of content unlabelled" },
            { label: "Cannot ground safely", tone: "critical", value: "84 PHI items · 412 financial items · 690 PII items, all unprotected" },
            { label: "Accuracy & safety risk", tone: "attention", value: "Stale content from 148 inactive sites is returned as current" },
            { label: "Readiness score impact", tone: "critical", value: "Compliance is the largest deficit: 29 against a target of 58" },
            { label: "Required to clear the gate", tone: "healthy", value: "Publish a baseline label set, auto-label regulated content, extend DLP to Teams and OneDrive" },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Align retention with regulatory requirements: extend policy to Teams chat, OneDrive and Planner first — the three workloads carrying regulated content today.",
            "Apply sensitivity labels consistently: publish a mandatory baseline label, then auto-label by content type across all workloads at once rather than workload by workload.",
            "Correct DLP coverage: scope a policy to Teams chat and OneDrive, and reinstate the Safe Links policy disabled on 14 June.",
            "Restore audit log completeness: raise retention from 90 days to the longest requirement across your frameworks before you need it for an investigation.",
            "Enforce lifecycle policies for regulated content: 12-month inactivity with owner confirmation, plus a disposition review on declared records.",
            "Run quarterly compliance posture reviews: label and DLP coverage drift silently, and 148 sites is what one undetected year looks like.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Compliance determines whether Copilot can legally operate in your environment. Retention, labeling, DLP and lifecycle controls must be aligned before Copilot can be deployed safely.",
    "Compliance scores 29, the lowest reading in the assessment, and it is a gate blocker. The work is a baseline label set, auto-labelling on regulated categories, and DLP extended to the two workloads where regulated content actually lives. None of it requires new licensing beyond the E5 uplift already identified.",
  ],
  provenance: PROVENANCE,
};

const LICENSING_ALIGNMENT: PreviewPillarReport = {
  kind: "pillar",
  pillar: "licensing",
  kicker: "Copilot licensing alignment",
  headline: "The rollout stalls in procurement, not in technology",
  standfirst: "This report identifies every licensing misalignment preventing Copilot from being deployed safely, consistently and cost-effectively. All findings trace directly to your tenant telemetry.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "$18,400 a year in seats nobody uses",
    sub: "Recoverable without a single purchase — and it funds two thirds of the E5 uplift the controls require.",
  },
  sections: [
    {
      heading: "Licensing Posture Summary",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Incorrect SKUs", tone: "attention", value: "47 users — 19 on E5 who need E3, 28 on E3 who need E5" },
            { label: "Copilot assigned, not needed", tone: "critical", value: "22 of 60 assigned seats unused for 30 days" },
            { label: "Needs Copilot, unlicensed", tone: "attention", value: "84 users in high-value personas with no Copilot seat" },
            { label: "Seat drift", tone: "attention", value: "Operations +31 over pattern · Field Services −19 under · Finance aligned" },
            { label: "Monthly cost waste", tone: "critical", value: "$1,533 a month · $18,400 a year" },
          ],
        },
      ],
    },
    {
      heading: "Eligibility & Coverage Gaps",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "attention", lead: "96 Copilot-eligible users lack the required base licence.", rest: "All 96 need an E5 uplift to carry the Conditional Access and Purview controls Copilot depends on." },
            { severity: "critical", lead: "19 Copilot-ineligible users hold premium SKUs.", rest: "E5 assigned by legacy group membership, not by role or need." },
            { severity: "attention", lead: "Workloads blocked by missing prerequisites.", rest: "OneDrive is activated for 31% of the estate; Copilot grounding on personal files is unavailable for the rest." },
            { severity: "attention", lead: "84 users in high-value personas are unlicensed.", rest: "Finance Analyst, Legal Counsel and Bid Manager personas — the three with the clearest return." },
          ],
        },
      ],
    },
    {
      heading: "Seat Drift Analysis",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Outside role-based patterns", tone: "attention", value: "47 assignments do not match any defined role template" },
            { label: "Inherited from legacy groups", tone: "attention", value: "31 licences from three groups last reviewed in 2024" },
            { label: "Over-provisioning from group drift", tone: "critical", value: "Operations: 31 seats above its role pattern" },
            { label: "Under-provisioning from manual error", tone: "attention", value: "Field Services: 19 seats below, all assigned by hand" },
          ],
        },
      ],
    },
    {
      heading: "Cost Waste Summary",
      blocks: [
        { kind: "figure", figure: "monthlyWaste" },
        {
          kind: "keyValues",
          rows: [
            { label: "Unused Copilot seats", tone: "critical", value: "$660 a month · 22 seats" },
            { label: "Premium SKUs assigned incorrectly", tone: "attention", value: "$495 a month · 19 E5 seats" },
            { label: "Savings through normalisation", tone: "healthy", value: "$18,400 a year, recoverable without any new purchase" },
            { label: "Net year-one impact", tone: "healthy", value: "$18,400 recovered against a $27,600 E5 uplift — $9,200 net for the controls" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Licensing is not a gate blocker, but it is what decides whether the rollout is funded. The waste already in the tenant covers two thirds of the uplift the controls require." },
        {
          kind: "keyValues",
          rows: [
            { label: "Licensing blockers", tone: "attention", value: "None blocking activation — 96 users need E5 before controls can be enforced" },
            { label: "Personas blocked by SKU gaps", tone: "attention", value: "Bid Manager and Legal Counsel — 84 users, no Copilot seat" },
            { label: "Workflows waiting on licensing", tone: "attention", value: "Contract review and bid assembly, both E5-dependent" },
            { label: "Readiness score impact", tone: "healthy", value: "Licensing is the strongest pillar at 57, with 22 points available" },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Normalise SKUs across departments: define one role template per function, then reconcile the 47 mismatched assignments against it rather than case by case.",
            "Remove unused Copilot licences safely: reclaim the 22 dormant seats after a 14-day notice, so reclamation is never a surprise.",
            "Assign Copilot by persona readiness: license the 84 users in the three high-value personas first, not the whole estate at once.",
            "Prevent seat drift: retire the three legacy groups and move all assignment to group-based licensing driven by HR attributes.",
            "Implement role-based licensing at scale: dynamic groups on department and job title, so new starters land on the right SKU without a manual step.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Your licensing posture directly affects Copilot readiness, monthly cost efficiency and workflow enablement.",
    "Licensing scores 57, the strongest pillar in the assessment. $18,400 a year is currently spent on seats nobody uses, against a $27,600 uplift for the 96 users who need the controls the other pillars require. Correcting this funds most of the work rather than adding to it.",
  ],
  provenance: PROVENANCE,
};

const ADOPTION_READINESS: PreviewPillarReport = {
  kind: "pillar",
  pillar: "adoption",
  kicker: "Copilot adoption & workflow readiness",
  headline: "Copilot returns value only where the work already happens",
  standfirst: "This report evaluates how ready your people, workflows and collaboration patterns are to benefit from Copilot. Every finding traces to persona telemetry, workflow alignment signals and Teams usage data surfaced in your assessment.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "412 users have not opened Teams in 30 days",
    sub: "A third of the tenant. Copilot licences issued to them return nothing until enablement lands.",
  },
  sections: [
    {
      heading: "Adoption Posture Summary",
      blocks: [
        { kind: "figure", figure: "usageTrend" },
        { kind: "figure", figure: "personaSplit" },
        {
          kind: "keyValues",
          rows: [
            { label: "Adoption readiness", tone: "attention", value: "46 / 100" },
            { label: "Workflow alignment", tone: "attention", value: "52 / 100 across six departments — four competing procurement patterns" },
            { label: "Teams usage maturity", tone: "attention", value: "Meetings mature · chat mature · channels weak · files weak" },
            { label: "Collaboration patterns", tone: "critical", value: "412 users on email-only workflows, 31% OneDrive activation" },
          ],
        },
      ],
    },
    {
      heading: "Persona Readiness Analysis",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "healthy", lead: "3 personas fully ready.", rest: "Finance Analyst, Legal Counsel and Executive Assistant — high Teams usage, modern document workflows." },
            { severity: "attention", lead: "4 personas partially ready, blocked by workflow gaps.", rest: "Bid Manager, Project Lead, Procurement Officer and Account Manager — ready people, unmodernised processes." },
            { severity: "critical", lead: "2 personas not ready.", rest: "Field Technician and Plant Supervisor — 26% weekly Teams usage, paper-and-email processes." },
            { severity: "attention", lead: "Training gaps by persona.", rest: "Fundamentals needed for 516 users; workflow modernisation for the four partially-ready personas." },
            { severity: "healthy", lead: "Highest-value unlicensed personas.", rest: "Bid Manager and Legal Counsel — 84 users where Copilot pays back fastest." },
          ],
        },
      ],
    },
    {
      heading: "Workflow Alignment Assessment",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Improvable immediately", tone: "healthy", value: "Meeting recap, mail triage, document drafting, contract summarisation" },
            { label: "Not safe yet until modernised", tone: "critical", value: "Bid assembly and site reporting — still email and spreadsheet driven" },
            { label: "Needs training or process update", tone: "attention", value: "Procurement approval, expense review, onboarding" },
            { label: "Cross-department inconsistency", tone: "attention", value: "Four different approval patterns for the same procurement workflow" },
            { label: "Automation-eligible but blocked", tone: "critical", value: "Site reporting — automatable, but no one is in Teams to receive it" },
          ],
        },
      ],
    },
    {
      heading: "Collaboration & Teams Usage",
      blocks: [
        { kind: "figure", figure: "departmentUsage" },
        {
          kind: "keyValues",
          rows: [
            { label: "Channels vs chats vs meetings", tone: "attention", value: "Meetings 84% · chat 71% · channel posts 22% — collaboration is not in the open" },
            { label: "File collaboration maturity", tone: "critical", value: "OneDrive activated for 31% · 44% of documents still emailed as attachments" },
            { label: "Shadow collaboration", tone: "critical", value: "412 users operate email-only, entirely outside Teams" },
            { label: "Blockers to Copilot value", tone: "critical", value: "Copilot cannot ground on work that never enters a Microsoft 365 workload" },
          ],
        },
      ],
    },
    {
      heading: "Training & Enablement Gaps",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Copilot fundamentals needed", tone: "attention", value: "516 users across four partially-ready personas" },
            { label: "Workflow modernisation needed", tone: "attention", value: "Procurement, bid assembly, site reporting — process first, training second" },
            { label: "Departments with no enablement", tone: "critical", value: "Operations and Field Services — 638 users, no training delivered to date" },
            { label: "Recommended sequence", tone: "healthy", value: "Finance and Legal first as proof, then Operations, then Field Services" },
            { label: "Training impact on readiness", tone: "healthy", value: "Enablement alone moves Adoption from 46 to an estimated 61" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Adoption is not a gate blocker, but it decides whether the licences you buy return anything. A third of the tenant is not where Copilot works." },
        {
          kind: "keyValues",
          rows: [
            { label: "Adoption blockers", tone: "attention", value: "None blocking activation — 412 dormant users would return nothing if licensed" },
            { label: "Personas unable to benefit", tone: "critical", value: "Field Technician and Plant Supervisor until processes move into Teams" },
            { label: "Cannot ground on low usage", tone: "critical", value: "Site reporting and bid assembly produce no Microsoft 365 content to ground on" },
            { label: "Readiness score impact", tone: "attention", value: "Adoption contributes 22 points of available gain" },
            { label: "Required to clear the gate", tone: "healthy", value: "Targeted enablement in Operations and Field Services before licences are issued" },
          ],
        },
      ],
    },
    {
      heading: "Self-Resolution Actions",
      blocks: [
        {
          kind: "bullets",
          items: [
            "Increase Teams usage safely: move one real recurring workflow per department into a channel rather than mandating Teams adoption in the abstract.",
            "Modernise workflows for alignment: standardise the four procurement approval patterns onto one before enabling Copilot on that workflow.",
            "Train personas on fundamentals: start with the three ready personas so the first internal examples are successful ones.",
            "Eliminate shadow collaboration: stop attaching documents to email by default — 44% of document traffic is invisible to Copilot because of it.",
            "Run monthly adoption reviews: usage has been flat for two periods, which is only visible if someone is looking.",
          ],
        },
      ],
    },
  ],
  closing: [
    "Copilot only delivers value when people use it. Adoption determines whether Copilot succeeds or fails. Modern workflows, consistent Teams usage and persona readiness are essential prerequisites.",
    "Adoption scores 46. Three personas are ready today and would show returns immediately; 412 users are not in Teams at all and licences issued to them return nothing. Sequence enablement behind the departments that are already there, and the proof arrives before the cost does.",
  ],
  provenance: PROVENANCE,
};

const OPERATIONAL_HEALTH: PreviewPillarReport = {
  kind: "pillar",
  pillar: "health",
  kicker: "Operational health & service integrity",
  headline: "The score you earn is only ever the score you keep",
  standfirst: "This report evaluates the operational health of your tenant across service availability, configuration correctness, workload stability and platform hygiene. Every finding traces to Health Engine telemetry surfaced in your assessment.",
  verdict: {
    eyebrow: "Worst finding",
    headline: "37 configuration changes. None reviewed.",
    sub: "No baseline exists to compare against, which is how remediation quietly undoes itself.",
  },
  sections: [
    {
      heading: "Health Posture Summary",
      blocks: [
        { kind: "prose", text: "Operational health scores 44 of 100. Services themselves are stable; the deficit is configuration and hygiene. 37 tenant configuration changes were made in the last 90 days with no recorded review and no baseline to compare against." },
        {
          kind: "keyValues",
          rows: [
            { label: "Operational health", tone: "attention", value: "44 / 100" },
            { label: "Workload stability", tone: "attention", value: "Exchange stable · SharePoint stable · Teams stable · OneDrive degraded (sync errors)" },
            { label: "Service availability, 30 days", tone: "healthy", value: "99.94% · two Microsoft-side degradation events, both resolved" },
            { label: "Configuration correctness", tone: "critical", value: "11 misconfigurations across four workloads · no baseline on record" },
            { label: "Health trend", tone: "critical", value: "Degrading — 37 unreviewed changes in 90 days, none rolled back" },
          ],
        },
      ],
    },
    {
      heading: "Service Availability & Reliability",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Exchange Online", tone: "healthy", value: "Healthy · no incidents in 30 days" },
            { label: "SharePoint Online", tone: "healthy", value: "Healthy · one Microsoft-side degradation on 11 July, resolved in 4 hours" },
            { label: "Teams", tone: "healthy", value: "Healthy across meetings, chat and channels" },
            { label: "OneDrive", tone: "attention", value: "Degraded · 214 clients reporting sync errors, 31% activation" },
            { label: "Outage history", tone: "healthy", value: "Two degradation events in 30 days, both Microsoft-side, neither tenant-caused" },
            { label: "Impact on Copilot readiness", tone: "attention", value: "OneDrive sync errors mean personal-file grounding is unreliable for 214 users" },
          ],
        },
      ],
    },
    {
      heading: "Configuration Correctness",
      blocks: [
        {
          kind: "findings",
          rows: [
            { severity: "critical", lead: "11 misconfigurations across four workloads.", rest: "Five in SharePoint sharing scope, three in Exchange transport, two in Teams policy, one in Intune." },
            { severity: "critical", lead: "No baseline settings on record.", rest: "There is nothing to compare current configuration against, so drift cannot be detected automatically." },
            { severity: "attention", lead: "Conditional Access misalignment affects service health.", rest: "One policy excludes a 44-member group added 14 June, creating inconsistent access behaviour." },
            { severity: "critical", lead: "Authentication configuration gaps.", rest: "Legacy protocols remain enabled despite a 2024 decommission decision." },
            { severity: "attention", lead: "Configuration drift across workloads.", rest: "37 changes in 90 days · 6 security-relevant · none reviewed or approved." },
          ],
        },
      ],
    },
    {
      heading: "Tenant Hygiene & Operational Cleanliness",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Orphaned resources", tone: "attention", value: "19 orphaned channels · 12 groups with no owner · 148 inactive sites" },
            { label: "Inactive containers", tone: "attention", value: "148 sites with no content activity for 12 months" },
            { label: "Storage & quota", tone: "healthy", value: "68% of tenant SharePoint quota used · no site approaching its own limit" },
            { label: "Sync errors & client health", tone: "attention", value: "214 OneDrive clients with sync errors · 34 devices on out-of-date builds" },
            { label: "Hygiene impact on grounding", tone: "critical", value: "Stale content in 148 inactive sites is returned by Copilot as current" },
          ],
        },
      ],
    },
    {
      heading: "Health Drift & Violations",
      blocks: [
        {
          kind: "keyValues",
          rows: [
            { label: "Workload configuration drift", tone: "attention", value: "SharePoint sharing scope (2) · Exchange transport (3) · Teams policy (2)" },
            { label: "Policy drift", tone: "attention", value: "Two device compliance policies relaxed in 90 days with no approval trail" },
            { label: "Service-level violations", tone: "healthy", value: "None — no workload disabled, no feature broken" },
            { label: "Authentication drift", tone: "critical", value: "Legacy protocols re-enabled after the 2024 decommission decision" },
            { label: "Health Engine drift signals", tone: "critical", value: "37 signals over 90 days · none triaged · no baseline to measure against" },
          ],
        },
      ],
    },
    {
      heading: "Copilot Readiness Impact",
      blocks: [
        { kind: "prose", text: "Health is not a gate blocker. It is what determines whether clearing the gate holds. Unmanaged drift undoes remediation inside two quarters." },
        {
          kind: "keyValues",
          rows: [
            { label: "Health blockers", tone: "healthy", value: "None blocking activation" },
            { label: "Workloads Copilot cannot rely on", tone: "attention", value: "OneDrive — 214 clients with sync errors, 31% activation" },
            { label: "Configuration gaps affecting accuracy", tone: "critical", value: "Stale content in 148 inactive sites returned as current" },
            { label: "Readiness score impact", tone: "attention", value: "Health contributes 26 points of available gain" },
            { label: "Required to clear the gate", tone: "healthy", value: "Capture a signed configuration baseline and enable drift telemetry" },
          ],
        },
      ],
    },
    // Self-Resolution Actions — copy not recoverable, see file header.
  ],
  closing: [
  ],
  provenance: PROVENANCE,
};

/**
 * Keyed by the document's own title, so the map lines up with
 * `JOURNEY_DESIGN_DOCUMENTS` without a second index to keep in step. A title
 * with no entry renders the still-generating state — which is exactly what the
 * design does for the eighth report, the Full Remediation Guide.
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
  "Microsoft 365 Compliance & Regulatory Alignment Report": COMPLIANCE_ALIGNMENT,
  "Copilot Licensing Alignment Report": LICENSING_ALIGNMENT,
  "Copilot Adoption & Workflow Readiness Report": ADOPTION_READINESS,
  "Microsoft 365 Operational Health & Service Integrity Report": OPERATIONAL_HEALTH,
};
