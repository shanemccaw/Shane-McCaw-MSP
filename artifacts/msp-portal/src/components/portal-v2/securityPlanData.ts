/**
 * securityPlanData.ts — the Security Plan design reference.
 *
 * A faithful transcription of the prototype's `SECPLAN` object
 * ('Customer Portal Shell.dc.html' 7792-7869): the authoritative record of how
 * this tenant must be configured, monitored, governed and changed, as ten
 * numbered sections of requirements plus a version history.
 *
 * ── Design reference / unit-test content only (Git #1439) ───────────────────
 * `GET /api/portal/security-plan` (`portal-security-plan.ts`) is real and
 * wired now, backed by the manual migration
 * `2026-08-21-portal-v2-security-plan.sql`, which seeded this exact content
 * verbatim for the one testbed tenant (`customer_id = 1`). No runtime code path
 * renders `SECURITY_PLAN`/`SECURITY_PLAN_OWNER` for a real customer any more —
 * `securityPlanLive.ts` resolves an honest "no plan authored yet" or "error"
 * state instead of ever falling back to this module. It is kept for
 * `securityPlanWire.test.ts`/`securityPlanModel.test.ts` fixtures and as the
 * one place documenting the design's original copy. Copy is final — every
 * requirement, detail and history note is the prototype's verbatim.
 *
 * The header verdict, the section gap counts and the progress percentage are all
 * DERIVED from these rows (a plan must not be able to disagree with itself) and
 * live in `securityPlanModel.ts`, unit-tested there.
 */

/** Whether a requirement is met, partly met, or not met. Prototype `r.state`. */
export type SecPlanState = "met" | "partial" | "gap";

export interface SecPlanRow {
  readonly req: string;
  readonly state: SecPlanState;
  readonly detail: string;
  /** The portal-v2 route this requirement's proof lives in. */
  readonly to: string;
  /** The link's label — the prototype's `r.toLabel`, verbatim. */
  readonly toLabel: string;
}

export interface SecPlanSection {
  /** Stable key for selection and the URL. Prototype `sec.k`. */
  readonly k: string;
  /** The two-digit section number the design shows. Prototype `sec.n`. */
  readonly n: string;
  readonly label: string;
  readonly lead: string;
  readonly rows: readonly SecPlanRow[];
}

export interface SecPlanVersion {
  readonly v: string;
  readonly when: string;
  readonly who: string;
  readonly what: string;
  readonly cr: string;
}

export interface SecurityPlan {
  readonly tenant: string;
  readonly env: string;
  readonly tier: string;
  readonly version: string;
  readonly updated: string;
  readonly approver: string;
  readonly sections: readonly SecPlanSection[];
  readonly history: readonly SecPlanVersion[];
}

export const SECURITY_PLAN: SecurityPlan = {
  tenant: "Halden Materials",
  env: "Production",
  tier: "Enhanced",
  version: "v4.2",
  updated: "19 August 2026",
  approver: "Dan Whitlock, Operations Director",
  sections: [
    {
      k: "governance",
      n: "02",
      label: "Governance framework",
      lead: "What has to exist before anything else is meaningful.",
      rows: [
        {
          req: "Policy decisions recorded with an owner and a review date",
          state: "met",
          detail: "4 recorded, 1 due for review and 1 expired.",
          to: "/portal-v2/policy-decisions",
          toLabel: "Policy Decisions",
        },
        {
          req: "A procedure for every recurring operation",
          state: "met",
          detail: "17 published, 10 ours and 7 yours. 5 can run through Graph.",
          to: "/portal-v2/sop-hub",
          toLabel: "SOPs & Runbooks",
        },
        {
          req: "Four names against every service, change and control",
          state: "gap",
          detail:
            "6 of 24 objects still have a gap, and 3 have the same name as Responsible and Accountable.",
          to: "/portal-v2/ownership",
          toLabel: "Ownership",
        },
        {
          req: "Monitoring across all six pillars, daily",
          state: "met",
          detail: "Daily scan, last run 2 hours ago. 22 read targets.",
          to: "/portal-v2",
          toLabel: "Overview",
        },
        {
          req: "A document set that an auditor can be handed",
          state: "partial",
          detail: "11 owned documents; the retention schedule and the DR test record are missing.",
          to: "/portal-v2/documents",
          toLabel: "Documents",
        },
      ],
    },
    {
      k: "architecture",
      n: "03",
      label: "Architecture baseline",
      lead: "The shape the tenant is required to hold.",
      rows: [
        {
          req: "Identity · Entra ID",
          state: "gap",
          detail:
            "MFA on all admin accounts, no standing Global Admins beyond two, legacy authentication disabled. 11 standing admins and legacy auth still on.",
          to: "/portal-v2/security",
          toLabel: "Security",
        },
        {
          req: "Devices · Intune",
          state: "partial",
          detail:
            "Compliance policy enforced, not report-only. Currently report-only with an 88-device backlog.",
          to: "/portal-v2/health",
          toLabel: "Health",
        },
        {
          req: "Data · SharePoint, OneDrive, Exchange",
          state: "gap",
          detail:
            "Default link type direct, no anonymous links, retention on every mailbox. 2,940 anonymous links and 12 uncovered mailboxes.",
          to: "/portal-v2/governance",
          toLabel: "Governance",
        },
        {
          req: "Network · Conditional Access",
          state: "partial",
          detail: "22 named policies required, 18 exist, CA301 has been report-only for 94 days.",
          to: "/portal-v2/security/ca",
          toLabel: "Conditional Access",
        },
        {
          req: "App governance",
          state: "gap",
          detail:
            "Owner on every registration and no credential older than 12 months. 61 registrations, 4 credentials overdue.",
          to: "/portal-v2/health",
          toLabel: "Health",
        },
      ],
    },
    {
      k: "risk",
      n: "04",
      label: "Risk and impact",
      lead: "What is accepted, what is open, and what must be mitigated.",
      rows: [
        {
          req: "A live risk register with severity and residual severity",
          state: "met",
          detail: "12 risks, 4 accepted with review dates, 1 acceptance expired.",
          to: "/portal-v2/risk-register",
          toLabel: "Risk Register",
        },
        {
          req: "No high-impact risk left without a mitigation or a decision",
          state: "gap",
          detail: "2 critical risks are open with neither.",
          to: "/portal-v2/risk-register",
          toLabel: "Risk Register",
        },
        {
          req: "Security and change impact assessment on every normal change",
          state: "met",
          detail:
            "Enforced by the completeness gate — a change with no assessment cannot be approved.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
      ],
    },
    {
      k: "change",
      n: "05",
      label: "Change control requirements",
      lead: "What every change must carry before it runs.",
      rows: [
        {
          req: "Two approvals from two different people",
          state: "met",
          detail: "Enforced. The raiser cannot approve.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
        {
          req: "Impact assessment and rollback point on every normal change",
          state: "met",
          detail: "Both required by the gate.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
        {
          req: "A test result, or a written reason there is none",
          state: "partial",
          detail:
            "No test tenant exists, so 6 of 9 open changes carry a compensating control instead.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
        {
          req: "Separation of duties on privileged changes",
          state: "gap",
          detail: "3 objects have the same name as Responsible and Accountable.",
          to: "/portal-v2/ownership",
          toLabel: "Ownership",
        },
        {
          req: "Audit logging retained for the required period",
          state: "gap",
          detail: "180 days on Audit Standard. The plan requires one year.",
          to: "/portal-v2/compliance",
          toLabel: "Compliance",
        },
        {
          req: "A recorded decision where a gap is accepted rather than fixed",
          state: "met",
          detail: "4 recorded. Anything past review reads as neglect.",
          to: "/portal-v2/policy-decisions",
          toLabel: "Policy Decisions",
        },
      ],
    },
    {
      k: "pii",
      n: "06",
      label: "PII governance",
      lead: "Where personal data lives and what is required of it.",
      rows: [
        {
          req: "Continuous discovery across sites, drives, Teams and mail",
          state: "met",
          detail: "Daily. 3,412 documents match a PII pattern.",
          to: "/portal-v2/pii",
          toLabel: "PII Governance",
        },
        {
          req: "No PII reachable by an anonymous link",
          state: "gap",
          detail: "3 locations are publicly reachable right now.",
          to: "/portal-v2/pii",
          toLabel: "PII Governance",
        },
        {
          req: "A sensitivity label on every high-severity finding",
          state: "gap",
          detail: "No label is published, so nothing can be labelled.",
          to: "/portal-v2/compliance/sensitivity-labels",
          toLabel: "Sensitivity Labels",
        },
        {
          req: "PII findings raise a risk and a change, not a ticket",
          state: "met",
          detail: "Wired: finding to risk register, and a change request for any fix.",
          to: "/portal-v2/pii",
          toLabel: "PII Governance",
        },
      ],
    },
    {
      k: "ops",
      n: "07",
      label: "Remediation and operations",
      lead: "How things actually get fixed, and how fast.",
      rows: [
        {
          req: "A runbook behind every recurring fix",
          state: "met",
          detail: "17 procedures, 5 executable through Graph.",
          to: "/portal-v2/sop-hub",
          toLabel: "SOPs & Runbooks",
        },
        {
          req: "Critical findings actioned within 5 working days",
          state: "gap",
          detail: "27 items still to do, 2 critical past the window.",
          to: "/portal-v2/remediation",
          toLabel: "Remediation",
        },
        {
          req: "A named escalation path when an owner goes quiet",
          state: "met",
          detail: "Five days, then it goes to the accountable name.",
          to: "/portal-v2/settings",
          toLabel: "Settings",
        },
      ],
    },
    {
      k: "release",
      n: "08",
      label: "Message Center and releases",
      lead: "How Microsoft changes are handled before they land.",
      rows: [
        {
          req: "Standard release channel, not targeted",
          state: "met",
          detail: "Standard. Targeted release is off for the whole tenant.",
          to: "/portal-v2/ms-changes",
          toLabel: "Microsoft Changes",
        },
        {
          req: "Every notice reviewed within 5 working days of posting",
          state: "partial",
          detail: "452 notices, 38 unread beyond the window.",
          to: "/portal-v2/ms-changes",
          toLabel: "Microsoft Changes",
        },
        {
          req: "A decision recorded before each wave lands",
          state: "gap",
          detail: "4 decisions expire before their wave.",
          to: "/portal-v2/ms-changes",
          toLabel: "Microsoft Changes",
        },
        {
          req: "People told before anything user-visible changes",
          state: "gap",
          detail: "3 announcements drafted and never sent.",
          to: "/portal-v2/ms-changes",
          toLabel: "Microsoft Changes",
        },
      ],
    },
    {
      k: "audit",
      n: "09",
      label: "Compliance and audit",
      lead: "What has to be produceable on demand.",
      rows: [
        {
          req: "Evidence pack per finding, timestamped",
          state: "met",
          detail: "Produced on every verified fix.",
          to: "/portal-v2",
          toLabel: "Overview",
        },
        {
          req: "Annual review of this plan, signed",
          state: "met",
          detail: "Last signed 19 August 2026 by Dan Whitlock.",
          to: "/portal-v2/security-plan",
          toLabel: "This plan",
        },
        {
          req: "Quarterly review of ownership and acceptances",
          state: "partial",
          detail: "Ownership reviewed 12 August. Two acceptances are past their date.",
          to: "/portal-v2/ownership",
          toLabel: "Ownership",
        },
        {
          req: "Every incident written up with a cause and follow-up",
          state: "met",
          detail: "2 incidents this year, both written up.",
          to: "/portal-v2/risk-register",
          toLabel: "Risk Register",
        },
      ],
    },
    {
      k: "ai",
      n: "10",
      label: "AI-assisted governance",
      lead: "What the model is allowed to do, and what it may not.",
      rows: [
        {
          req: "Portal exposed to the agent through MCP tools",
          state: "met",
          detail: "Read across all six pillars, write only through a change request.",
          to: "/portal-v2/webhooks",
          toLabel: "Integrations",
        },
        {
          req: "Automated risk scoring on new findings",
          state: "met",
          detail: "Severity and residual severity proposed, a person confirms.",
          to: "/portal-v2/risk-register",
          toLabel: "Risk Register",
        },
        {
          req: "Impact assessments drafted, never submitted",
          state: "met",
          detail: "Drafted from the object graph; the raiser signs it.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
        {
          req: "Policy gap detection against this plan",
          state: "partial",
          detail: "Runs nightly. Detected 9 of the 14 gaps on this page before a human did.",
          to: "/portal-v2/security-plan",
          toLabel: "This plan",
        },
        {
          req: "No autonomous write to the tenant",
          state: "met",
          detail: "Hard rule. Every write is a change request with two signatures.",
          to: "/portal-v2/change-control",
          toLabel: "Change Control",
        },
      ],
    },
  ],
  history: [
    {
      v: "v4.2",
      when: "19 Aug 2026",
      who: "Dan Whitlock",
      what: "PII governance added as a required section. Audit retention requirement raised to one year.",
      cr: "CR-0131",
    },
    {
      v: "v4.1",
      when: "2 Jul 2026",
      who: "Dan Whitlock",
      what: "Separation of duties made a hard requirement on privileged changes.",
      cr: "CR-0104",
    },
    {
      v: "v4.0",
      when: "11 Mar 2026",
      who: "Priya Raman",
      what: "Security tier raised from Baseline to Enhanced after the insurance review.",
      cr: "CR-0061",
    },
    {
      v: "v3.4",
      when: "9 Nov 2025",
      who: "Shane McCaw",
      what: "Conditional Access baseline expanded from 14 to 22 named policies.",
      cr: "CR-0022",
    },
  ],
};

/**
 * The signing owner's chip — the prototype resolves it with
 * `personChip('dw', 26)` (shell 20207), which reads `RACI_PEOPLE.dw`
 * (Dan Whitlock, tone #fbbf24). Materialised here rather than reaching into a
 * RACI store this page does not otherwise use. The header shows `approver` as
 * the name; the chip shows these initials.
 */
export const SECURITY_PLAN_OWNER = {
  initials: "DW",
  tone: "#fbbf24",
} as const;
