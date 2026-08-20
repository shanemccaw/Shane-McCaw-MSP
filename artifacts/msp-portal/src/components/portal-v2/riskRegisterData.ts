/**
 * riskRegisterData.ts — the Risk Register fixture.
 *
 * EXTRACTED MECHANICALLY from the prototype's own `RR_RISKS`
 * ('Customer Portal Shell.dc.html' line 15152) by scripts-scratch/extract-risks.js,
 * not retyped. Every transcription error caught earlier in this build was in a
 * value that had been retyped by hand, and this fixture carries three numeric
 * fields per risk (`weight`, `likelihood`, `impact`) that the page's stat cards
 * sum over — so a single mistyped weight would put a wrong total on screen with
 * nothing else on the page to contradict it.
 *
 * The extractor asserts every required field is present on every risk, that the
 * `accepted` sub-object is complete wherever it appears, and that the ids are
 * unique, before it emits anything.
 *
 * ── Two severities, and they are NOT the same ──────────────────────────────
 * Each risk carries BOTH `inherent` and `residual` severity, and they genuinely
 * differ: RSK-003 is inherent High / residual Low. Which of the two the table
 * shows, and which the filter compares against, is load-bearing — see
 * riskRegisterModel.ts, which reproduces the prototype's own choice rather than
 * tidying it.
 *
 * ── Design content, not tenant data ─────────────────────────────────────────
 * The prototype's fictional Halden Materials risk register.
 */

export interface RiskAcceptance {
  by: string;
  on: string;
  until: string;
  /** The register entry number the acceptance was recorded under. */
  register: string;
  why: string;
  compensating: string;
}

export interface RiskEntry {
  id: string;
  title: string;
  pillar: string;
  /** Severity BEFORE controls. This is the one the prototype's filter uses. */
  inherent: string;
  /** Severity AFTER controls. Differs from `inherent` on several risks. */
  residual: string;
  status: string;
  owner: string;
  review: string;
  /** Scoring weight. The stat cards sum these. */
  weight: number;
  likelihood: number;
  impact: number;
  what: string;
  outcome: string;
  evidence: string;
  controls: string[];
  plan: string;
  /** Present only on risks whose status is Accepted or Expired. */
  accepted?: RiskAcceptance;
}

export const RR_RISKS: readonly RiskEntry[] = [
  {
    "id": "RSK-001",
    "title": "Legacy authentication remains enabled tenant-wide",
    "pillar": "Security",
    "inherent": "Critical",
    "residual": "Critical",
    "status": "Mitigating",
    "owner": "Head of Infrastructure",
    "review": "27 Aug 2026",
    "weight": 9,
    "likelihood": 4,
    "impact": 5,
    "what": "IMAP and SMTP AUTH are reachable, and legacy protocols cannot present an MFA prompt. 1,106 sign-ins in the last 30 days bypassed multifactor entirely.",
    "outcome": "A single valid password reaches a mailbox with no second factor. 37 failed attempts from six countries in the last month show the protocol is already being probed.",
    "evidence": "Sign-in logs filtered on clientAppUsed · 4 accounts, 1,106 sign-ins · Security pillar",
    "controls": [
      "Password spray alerting is on",
      "Two of the four accounts already migrated"
    ],
    "plan": "CR-2026-0183 and CR-2026-0181 are approved for the 27 August window. Closes on verification."
  },
  {
    "id": "RSK-002",
    "title": "No Conditional Access enforcement on device state",
    "pillar": "Security",
    "inherent": "High",
    "residual": "High",
    "status": "Open",
    "owner": "Unassigned",
    "review": "Not set",
    "weight": 7,
    "likelihood": 3,
    "impact": 5,
    "what": "CA202 does not exist, so Microsoft 365 is reachable from any device — managed, personal, or unknown.",
    "outcome": "Corporate data reaches devices with no compliance posture, no encryption guarantee and no wipe capability. It is also one of three findings holding the Copilot gate closed.",
    "evidence": "Conditional Access policy inventory · 0 device-state policies · Security pillar",
    "controls": [
      "Intune enrolment covers 187 of 212 devices, which limits but does not enforce"
    ],
    "plan": "Needs an owner before it can be scheduled. Requires Intune coverage confirmation first."
  },
  {
    "id": "RSK-003",
    "title": "Retention coverage gap on 12 mailboxes",
    "pillar": "Compliance",
    "inherent": "High",
    "residual": "Low",
    "status": "Closed",
    "owner": "Controller",
    "review": "Closed 14 Aug 2026",
    "weight": 6,
    "likelihood": 2,
    "impact": 4,
    "what": "Twelve mailboxes sat outside every retention policy, two of them in SOX scope.",
    "outcome": "Records that must be retained for seven years could be permanently deleted by any user.",
    "evidence": "Policy lookup · 1,240 of 1,240 mailboxes now covered · Compliance pillar",
    "controls": [
      "Adaptive scope applied, so onboarding cannot reopen the gap"
    ],
    "plan": "Closed. Effective date recorded in the audit file."
  },
  {
    "id": "RSK-004",
    "title": "Audit log retention capped at 180 days",
    "pillar": "Compliance",
    "inherent": "High",
    "residual": "High",
    "status": "Accepted",
    "owner": "Controller",
    "review": "1 Mar 2027",
    "weight": 6,
    "likelihood": 3,
    "impact": 4,
    "what": "Audit Standard retains 180 days and cannot be extended. HIPAA expects six years of documentation.",
    "outcome": "The records needed to reconstruct an incident expire before most intrusions are discovered.",
    "evidence": "Audit configuration · Standard tier, not configurable · Compliance pillar",
    "controls": [
      "Monthly export of administrator activity to the evidence pack",
      "Sign-in log export retained separately for 2 years"
    ],
    "plan": "Accepted until the E5 licence review at renewal. Audit Premium is a licence change, not a setting.",
    "accepted": {
      "by": "Controller",
      "on": "12 August 2026",
      "until": "1 March 2027",
      "register": "RR-2026-014",
      "why": "Extending retention requires Audit Premium, which means an E5 uplift on 41 seats. The decision is deliberately deferred to the March renewal rather than taken mid-term.",
      "compensating": "Administrator activity and sign-in logs are exported monthly and held for two years outside the tenant, which covers the reconstruction need for the highest-risk activity."
    }
  },
  {
    "id": "RSK-005",
    "title": "Guest population growing without review",
    "pillar": "Governance",
    "inherent": "Medium",
    "residual": "Medium",
    "status": "Accepted",
    "owner": "IT Administrator",
    "review": "30 Nov 2026",
    "weight": 4,
    "likelihood": 4,
    "impact": 3,
    "what": "34 guest accounts, up from 21 last quarter, with no recurring access review and no expiry.",
    "outcome": "External access accumulates quietly. Eleven guests have never signed in and seven never accepted their invitation.",
    "evidence": "Guest inventory with signInActivity · Governance pillar",
    "controls": [
      "Invitations now restricted to a named inviter group",
      "Never-accepted invitations older than 30 days are removed automatically"
    ],
    "plan": "Accepted for one quarter while the access review licensing is confirmed. Reopens automatically if the count exceeds 40.",
    "accepted": {
      "by": "Jordan Diaz · IT Administrator",
      "on": "13 August 2026",
      "until": "30 November 2026",
      "register": "RR-2026-016",
      "why": "Access reviews need Entra ID P1 on every reviewer, and the review cadence is being introduced alongside the Q4 governance programme rather than as a one-off.",
      "compensating": "Invitation restriction is live, guest MFA is enforced through CA301, and the guest count is monitored with a trigger at 40 that reopens this risk."
    }
  },
  {
    "id": "RSK-006",
    "title": "AD FS retained alongside cloud authentication",
    "pillar": "Health",
    "inherent": "Medium",
    "residual": "Low",
    "status": "Accepted",
    "owner": "Head of Infrastructure",
    "review": "30 Apr 2027",
    "weight": 4,
    "likelihood": 2,
    "impact": 4,
    "what": "Two line-of-business applications authenticate against AD FS, which cannot be retired before their 2027 releases.",
    "outcome": "An additional on-premises authentication surface to patch, monitor and certificate-manage.",
    "evidence": "Hybrid configuration · 2 relying party trusts · Health pillar",
    "controls": [
      "Monthly patching",
      "Certificate expiry alerting at 60 days",
      "Extranet lockout enabled",
      "Password hash sync retained so cloud sign-in survives an AD FS outage"
    ],
    "plan": "Accepted against the vendor roadmap rather than a calendar date. Review moves if their release slips.",
    "accepted": {
      "by": "Head of Infrastructure",
      "on": "11 January 2026",
      "until": "30 April 2027",
      "register": "RR-2026-002",
      "why": "Neither vendor supports modern authentication before their 2027 release. Removing AD FS would break both applications, which is a larger operational risk than retaining it with controls.",
      "compensating": "Patched monthly, certificate expiry alerted at 60 days, extranet lockout enabled, and password hash sync kept on so an AD FS failure does not stop cloud sign-in."
    }
  },
  {
    "id": "RSK-007",
    "title": "Teams chat retained for 1 year rather than 7",
    "pillar": "Compliance",
    "inherent": "Medium",
    "residual": "Low",
    "status": "Accepted",
    "owner": "General Counsel",
    "review": "14 Mar 2027",
    "weight": 3,
    "likelihood": 2,
    "impact": 3,
    "what": "The records schedule classifies Teams chat as transitory communication and retains it for one year.",
    "outcome": "If a decision exists only in chat and is needed after a year, it is gone.",
    "evidence": "Retention policy scope · Teams chat 1 year · Compliance pillar",
    "controls": [
      "Email and SharePoint retain the record copy for 7 years",
      "The two regulated Teams are excluded and retained for 7 years"
    ],
    "plan": "A documented policy position rather than a gap. Reviewed annually with Legal.",
    "accepted": {
      "by": "General Counsel",
      "on": "14 March 2026",
      "until": "14 March 2027",
      "register": "RR-2026-011",
      "why": "Chat is classified as transitory under the records schedule §4.2. The record copy of any decision lives in email or the SharePoint document set, both retained for seven years.",
      "compensating": "Email and SharePoint retention at 7 years with disposition review, and the two regulated Teams excluded from the shorter period."
    }
  },
  {
    "id": "RSK-008",
    "title": "Exchange hybrid server past end of support",
    "pillar": "Health",
    "inherent": "High",
    "residual": "High",
    "status": "Open",
    "owner": "Head of Infrastructure",
    "review": "10 Sep 2026",
    "weight": 7,
    "likelihood": 3,
    "impact": 5,
    "what": "Exchange 2019 has been out of support since 14 October 2025 — no security updates, no support coverage.",
    "outcome": "An internet-adjacent, unpatched server carrying hybrid mail flow and the migration endpoint.",
    "evidence": "Get-ExchangeServer · build 15.2.1544.4 · Health pillar",
    "controls": [
      "No mailboxes remain on-premises",
      "Server is not published for external OWA"
    ],
    "plan": "Decommission scoped, window held for 10 September pending the decision between decommission and Subscription Edition."
  },
  {
    "id": "RSK-009",
    "title": "61 app registrations with no owner",
    "pillar": "Governance",
    "inherent": "Medium",
    "residual": "Medium",
    "status": "Mitigating",
    "owner": "IT Administrator",
    "review": "30 Sep 2026",
    "weight": 4,
    "likelihood": 4,
    "impact": 3,
    "what": "Sixty-one registrations have nobody to notify when a credential expires or a permission needs review.",
    "outcome": "A credential expired eight days ago and its job has been failing 44 times a day unnoticed.",
    "evidence": "Application inventory with owners expanded · Governance and Health pillars",
    "controls": [
      "Credential expiry notification now routed to the IT mailbox as an interim"
    ],
    "plan": "Owners proposed from usage data; app management policy capping credential lifetime enforcing in 14 days."
  },
  {
    "id": "RSK-010",
    "title": "Self-service purchase enabled for three products",
    "pillar": "Licensing",
    "inherent": "Low",
    "residual": "Low",
    "status": "Accepted",
    "owner": "Controller",
    "review": "31 Dec 2026",
    "weight": 2,
    "likelihood": 3,
    "impact": 2,
    "what": "Users can buy Power BI, Visio and Project licences on a card, outside procurement.",
    "outcome": "Duplicate spend and unattributed cost. Twelve duplicate Power BI seats appeared this way.",
    "evidence": "MSCommerce policy · 3 products enabled · Licensing pillar",
    "controls": [
      "Monthly licence reconciliation catches duplicates within 30 days"
    ],
    "plan": "Accepted to the end of the year while the procurement route is rebuilt. Cost exposure is bounded and visible.",
    "accepted": {
      "by": "Controller",
      "on": "2 August 2026",
      "until": "31 December 2026",
      "register": "RR-2026-013",
      "why": "Turning self-service off before there is a one-day licence request route pushes people to unmanaged tools, which is a worse outcome than the duplicate spend it prevents.",
      "compensating": "Monthly licence reconciliation, and a $500 monthly threshold that reopens this risk if duplicate spend exceeds it."
    }
  },
  {
    "id": "RSK-011",
    "title": "27 Copilot seats assigned and idle",
    "pillar": "Adoption",
    "inherent": "Low",
    "residual": "Low",
    "status": "Open",
    "owner": "CIO",
    "review": "30 Sep 2026",
    "weight": 2,
    "likelihood": 5,
    "impact": 1,
    "what": "Twenty-seven of sixty-eight assigned Copilot seats show no activity in thirty days while thirty-four people are waiting for one.",
    "outcome": "Committed spend producing nothing. No security exposure — this is a value risk, not a threat.",
    "evidence": "Copilot usage report · 41 of 68 active · Adoption and Licensing pillars",
    "controls": [
      "Waiting list maintained so reassignment is immediate"
    ],
    "plan": "Enablement play scheduled with a 30-day idle-reclaim rule to follow."
  },
  {
    "id": "RSK-012",
    "title": "Break-glass account had no sign-in alert",
    "pillar": "Security",
    "inherent": "High",
    "residual": "Low",
    "status": "Expired",
    "owner": "Head of Infrastructure",
    "review": "Acceptance expired 4 Jul 2026",
    "weight": 5,
    "likelihood": 2,
    "impact": 5,
    "what": "One of the two emergency accounts had no alerting on use, and the acceptance covering that has expired.",
    "outcome": "Use of an emergency account could go unnoticed. The expired acceptance means this is back in scoring at full weight.",
    "evidence": "Break-glass test 4 July 2026 · alert rule created and retested · Security pillar",
    "controls": [
      "Alert rule now exists and was verified during the July test"
    ],
    "plan": "Re-verify at the next quarterly test, then close rather than re-accept."
  }
];
