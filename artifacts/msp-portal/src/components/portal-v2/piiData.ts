/**
 * piiData.ts — the PII Governance fixture.
 *
 * A faithful transcription of the prototype's own `PII` object
 * ('Customer Portal Shell.dc.html' 7872-7922, with the header comment at
 * 7870-7871): "Personal data across the tenant: where it is, who can reach it,
 * what moved, and what is required of each finding. Findings become risks and
 * changes, never tickets."
 *
 * ── UI-ONLY, and why the numbers still live in ONE place ───────────────────
 * This phase builds the screen, not the wiring — there is no PII discovery
 * endpoint yet, so every value here is the design's own. The fixture is a single
 * module (not inlined in the .tsx) so the later wiring pass has one file to swap
 * for a real `/api/portal/.../pii` read rather than hunting through JSX. Copy is
 * final: every string is the prototype's verbatim.
 *
 * The DERIVATIONS the page shows (the four stat counts, the headline totals, the
 * per-source bar width, the finding filter) are computed in `piiModel.ts` and
 * unit-tested there — this file is data only.
 */

/** Severity of a finding — the prototype's `sevC` keys (shell 20152). */
export type PiiSeverity = "High" | "Medium" | "Low";

/**
 * Reach of a finding — the prototype's `expC` keys (shell 20153). "Public" is an
 * anonymous link; "External" is a named person outside the tenant; "Internal" is
 * inside it.
 */
export type PiiExposure = "Public" | "External" | "Internal";

export interface PiiSource {
  readonly name: string;
  readonly scanned: string;
  readonly hits: number;
  readonly note: string;
}

export interface PiiPattern {
  readonly name: string;
  readonly kind: string;
  readonly hits: number;
  /** A tenant-authored pattern, drawn with a "Yours" tag. */
  readonly custom: boolean;
}

export interface PiiFinding {
  readonly id: string;
  readonly where: string;
  readonly kind: string;
  readonly sev: PiiSeverity;
  readonly exposure: PiiExposure;
  /** No published sensitivity label exists, so every finding is unlabelled. */
  readonly label: boolean;
  readonly files: number;
  readonly detail: string;
  readonly action: string;
  readonly route: string;
  /** The risk this finding opened, if any — empty string when none. */
  readonly risk: string;
}

export interface PiiAccess {
  readonly who: string;
  readonly what: string;
  readonly type: string;
  readonly link: string;
  readonly flag: string;
  /** The flag pill's colour (prototype's own hex). */
  readonly tone: string;
}

export interface PiiDrift {
  readonly when: string;
  readonly what: string;
  readonly who: string;
  /** The change request behind the move, if any — empty string when none. */
  readonly cr: string;
  readonly tone: string;
}

export interface PiiGovernance {
  readonly status: string;
  readonly scanned: string;
  readonly cadence: string;
  readonly level: string;
  readonly sources: readonly PiiSource[];
  readonly patterns: readonly PiiPattern[];
  readonly findings: readonly PiiFinding[];
  readonly access: readonly PiiAccess[];
  readonly drift: readonly PiiDrift[];
}

export const PII_GOVERNANCE: PiiGovernance = {
  status: "At risk",
  scanned: "19 August 2026, 08:04",
  cadence: "Daily",
  level: "High",
  sources: [
    {
      name: "SharePoint sites",
      scanned: "212 sites",
      hits: 2140,
      note: "Every document library, including private-channel sites.",
    },
    {
      name: "OneDrive",
      scanned: "1,240 accounts",
      hits: 780,
      note: "Includes accounts belonging to disabled users.",
    },
    {
      name: "Teams files",
      scanned: "61 teams",
      hits: 361,
      note: "Channel files and the private-channel sites behind them.",
    },
    {
      name: "Exchange attachments",
      scanned: "1,240 mailboxes",
      hits: 131,
      note: "Attachments only. Message bodies are matched but not stored.",
    },
  ],
  patterns: [
    { name: "National insurance and SSN", kind: "Personal", hits: 612, custom: false },
    { name: "Bank and card numbers", kind: "Financial", hits: 1104, custom: false },
    { name: "Date of birth beside a name", kind: "Personal", hits: 843, custom: false },
    { name: "Home address beside a name", kind: "Personal", hits: 402, custom: false },
    { name: "Medical terms and NHS numbers", kind: "Medical", hits: 96, custom: false },
    { name: "Passport and driving licence", kind: "Legal", hits: 214, custom: false },
    { name: "Halden employee number format", kind: "Personal", hits: 141, custom: true },
  ],
  findings: [
    {
      id: "PII-01",
      where: "HR / Personnel Files / Contracts 2024",
      kind: "Personal",
      sev: "High",
      exposure: "Public",
      label: false,
      files: 214,
      detail:
        "Employment contracts with national insurance numbers and home addresses. The library carries an anonymous link created 18 days ago that has been opened 41 times from outside the tenant.",
      action: "Remediate",
      route: "Change request required",
      risk: "RSK-014",
    },
    {
      id: "PII-02",
      where: "Finance / Payroll / 2026 runs",
      kind: "Financial",
      sev: "High",
      exposure: "External",
      label: false,
      files: 96,
      detail:
        "Payroll exports with bank details for 1,104 rows. Two external accountants hold direct access rather than access through a group, so removing the group changes nothing.",
      action: "Remediate",
      route: "Change request required",
      risk: "RSK-015",
    },
    {
      id: "PII-03",
      where: "Teams / Ops Leadership / private channel",
      kind: "Medical",
      sev: "High",
      exposure: "Internal",
      label: false,
      files: 11,
      detail:
        "Occupational health reports in a private channel with six members, four of whom are not in the parent team. No retention covers the channel site.",
      action: "Remediate",
      route: "Change request required",
      risk: "RSK-016",
    },
    {
      id: "PII-04",
      where: "OneDrive / k.osei (disabled account)",
      kind: "Personal",
      sev: "Medium",
      exposure: "Internal",
      label: false,
      files: 340,
      detail:
        "A leaver's drive still holds recruitment files with candidate addresses. The account has been disabled 142 days; the licence and the content both remain.",
      action: "Remediate",
      route: "Standard change",
      risk: "",
    },
    {
      id: "PII-05",
      where: "Sales / Tenders / Client submissions",
      kind: "Legal",
      sev: "Medium",
      exposure: "External",
      label: false,
      files: 88,
      detail:
        "Passport scans supplied by client staff for site access. Shared with two partner tenants through B2B direct connect, which creates no guest accounts.",
      action: "Review",
      route: "Review with the owner",
      risk: "",
    },
    {
      id: "PII-06",
      where: "Archive / Legacy imports 2019",
      kind: "Personal",
      sev: "Low",
      exposure: "Internal",
      label: false,
      files: 1240,
      detail:
        "Bulk import from the old file server. Matches are mostly historical staff records already outside their retention period.",
      action: "Accept risk",
      route: "Policy decision",
      risk: "",
    },
  ],
  access: [
    {
      who: "2 external accountants",
      what: "Finance / Payroll",
      type: "Direct",
      link: "Specific people",
      flag: "External",
      tone: "#f87171",
    },
    {
      who: "Anyone with the link",
      what: "HR / Personnel Files",
      type: "Link-based",
      link: "Anyone",
      flag: "Public",
      tone: "#f87171",
    },
    {
      who: "SG-Ops-All (240 people)",
      what: "Teams / Ops Leadership",
      type: "Inherited",
      link: "Org",
      flag: "Too broad",
      tone: "#fbbf24",
    },
    {
      who: "4 private-channel members",
      what: "Occupational health",
      type: "Direct",
      link: "Specific people",
      flag: "Not in parent team",
      tone: "#fbbf24",
    },
    {
      who: "j.diaz",
      what: "All four locations",
      type: "Direct",
      link: "Specific people",
      flag: "Admin, expected",
      tone: "#94a3b8",
    },
  ],
  drift: [
    {
      when: "18 days ago",
      what: "Anonymous link created on HR / Personnel Files",
      who: "d.cho@tenant.com",
      cr: "",
      tone: "#f87171",
    },
    {
      when: "6 weeks ago",
      what: "SG-Ops-All added to the Ops Leadership site",
      who: "a.reyes@tenant.com",
      cr: "",
      tone: "#fbbf24",
    },
    {
      when: "8 months ago",
      what: "Retention scope stopped matching the payroll library",
      who: "Nobody — the scope is static",
      cr: "",
      tone: "#f87171",
    },
    {
      when: "2 months ago",
      what: "External sharing enabled on Sales / Tenders",
      who: "r.delgado@tenant.com",
      cr: "CR-0087",
      tone: "#34d399",
    },
  ],
};

/**
 * The owner chip — the prototype resolves it with `raciChip('compliance', 26)`
 * (shell 20103), which reads the Compliance pillar's Responsible person from
 * `RACI_OWN.compliance.r` ('ab' → Aisha Bello, tone #34d399). Materialised here
 * rather than reaching into a RACI store this page does not otherwise use.
 */
export const PII_OWNER = {
  name: "Aisha Bello",
  initials: "AB",
  tone: "#34d399",
} as const;

/**
 * What a finding is wired into — the five cross-module links (shell 20190-20196).
 * `to` is the portal-v2 route each opens.
 */
export interface PiiLink {
  readonly label: string;
  readonly note: string;
  readonly to: string;
}

export const PII_LINKS: readonly PiiLink[] = [
  {
    label: "Risk Register",
    note: "Every high finding opens a risk automatically, with severity proposed and a person confirming.",
    to: "/portal-v2/risk-register",
  },
  {
    label: "Change Control",
    note: "A PII fix cannot run without a change request. The pre-change permission state is the rollback point.",
    to: "/portal-v2/change-control",
  },
  {
    label: "Policy Decisions",
    note: "Where a finding is accepted rather than fixed, it needs an owner, a compensating control and a review date.",
    to: "/portal-v2/policy-decisions",
  },
  {
    label: "SOPs & Runbooks",
    note: "Three procedures cover PII: link revocation, permission reset, and leaver drive handling.",
    to: "/portal-v2/sop-hub",
  },
  {
    label: "Security Plan",
    note: "Section 06 states what is required of personal data in this tenant.",
    to: "/portal-v2/security-plan",
  },
];
