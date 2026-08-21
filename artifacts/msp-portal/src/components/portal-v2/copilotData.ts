/**
 * copilotData.ts — the Copilot readiness fixture.
 *
 * Extracted verbatim from the prototype's own logic class, `Customer Portal
 * Shell.dc.html`:
 *   • CP_PILLARS      13081-13106
 *   • the gate figures + the standalone-offer copy   6093-6199
 *   • cpDeliverables  20625-20631
 *
 * ── Why this page matters right now ────────────────────────────────────────
 * The Overview was rebuilt to the current design, and the current design's
 * Overview has NO Copilot gate band — so until this page existed the Copilot
 * gate had no surface anywhere in the portal. This page is where the verdict
 * ("41 of the gate, not safe to deploy") now lives.
 *
 * ── The gate denominator is NOT here ───────────────────────────────────────
 * The "of 82" number is the real Copilot Gate target, `COPILOT_GATE_TARGET`
 * in `components/copilot-journey/journeyTokens.ts` (mirrored server-side in
 * `copilot-gate.ts`, each side asserted by its own test). The page reads that
 * constant — this module deliberately does NOT restate 82, so the two cannot
 * drift. Everything else here (the current 41, the remediated 68, the "+27
 * points") is the design's own fixture, reproduced verbatim; note the design
 * itself calls 68 "clears the gate" while the ultimate Go target is 82 — that
 * is the prototype's copy (its DOC-01 report says "gate clears at 68" too) and
 * copy is FINAL, so it is kept as written rather than reconciled.
 *
 * UI ONLY: no data source is wired. Derivations live in `copilotModel.ts`.
 */

/** lucide-react icon keys, resolved to components on the page. */
export type CopilotPillarIcon = "shield-check" | "lock" | "scale" | "layers" | "trending-up" | "activity";

export type CopilotPillarState = "Critical" | "Attention required";

export interface CopilotPillar {
  /** The pillar's route key — `go` navigates to `/portal-v2/<key>`. */
  readonly key: string;
  readonly label: string;
  /** Identity colour — the prototype's inline value (13082-13102). */
  readonly color: string;
  readonly icon: CopilotPillarIcon;
  readonly now: number;
  readonly target: number;
  readonly state: CopilotPillarState;
  readonly finding: string;
  readonly why: string;
  readonly fix: string;
}

/** CP_PILLARS — what each pillar is worth once remediated. Prototype 13081-13106. */
export const CP_PILLARS: readonly CopilotPillar[] = [
  {
    key: "governance",
    label: "Governance",
    color: "#3B82F6",
    icon: "shield-check",
    now: 34,
    target: 61,
    state: "Critical",
    finding: "1,847 SharePoint sites. 212 of them are open to everyone in your tenant.",
    why: "Copilot inherits every permission you have ever granted. Oversharing stops being a filing problem the day it becomes an answer Copilot gives to the wrong person.",
    fix: "Revoke org-wide sharing links and put a lifecycle policy on every site.",
  },
  {
    key: "security",
    label: "Security",
    color: "#8B5CF6",
    icon: "lock",
    now: 38,
    target: 72,
    state: "Critical",
    finding: "14 accounts have no MFA. Four of them are Global Admins.",
    why: "Every identity gap is a Copilot access gap. A compromised account no longer just reads mail — it queries the whole tenant in plain language. Four Global Admins without MFA is the one I would fix first, today, before anything else on this page.",
    fix: "Enforce Conditional Access on privileged roles and switch off legacy auth.",
  },
  {
    key: "compliance",
    label: "Compliance",
    color: "#F3F4F6",
    icon: "scale",
    now: 29,
    target: 58,
    state: "Critical",
    finding: "No DLP policy covers Teams chat. 61% of your files carry no sensitivity label.",
    why: "Unlabelled data is data Copilot will summarise, quote and export without restriction. Labels are the only instruction it obeys.",
    fix: "Publish a baseline label set and extend DLP to Teams and OneDrive.",
  },
  {
    key: "licensing",
    label: "Licensing",
    color: "#14B8A6",
    icon: "layers",
    now: 57,
    target: 79,
    state: "Attention required",
    finding: "$18,400 a year sits in unassigned seats. 96 users need E5 for the controls above.",
    why: "Copilot sits on top of your base SKUs. Until those are right, the rollout stalls in procurement, not in technology.",
    fix: "Reclaim the dormant seats and fund the E5 uplift out of the waste.",
  },
  {
    key: "adoption",
    label: "Adoption",
    color: "#F97316",
    icon: "trending-up",
    now: 46,
    target: 68,
    state: "Attention required",
    finding: "412 of your 1,240 users have not opened Teams in 30 days.",
    why: "Copilot returns value only where the work already happens. A third of your tenant is not there yet, and licences for them return nothing.",
    fix: "Run targeted enablement in Operations and Field Services first.",
  },
  {
    key: "health",
    label: "Health",
    color: "#22C55E",
    icon: "activity",
    now: 44,
    target: 70,
    state: "Attention required",
    finding: "37 tenant configuration changes in 90 days. None recorded. None reviewed.",
    why: "Unmanaged drift undoes remediation inside two quarters. The score you earn is only ever the score you keep.",
    fix: "Put hourly drift telemetry on the tenant so nothing changes unseen.",
  },
];

/**
 * The gate figures — the design's own fixture. The DENOMINATOR is deliberately
 * absent: it is `COPILOT_GATE_TARGET`, read from journeyTokens. Prototype
 * 6109-6126.
 */
export const CP_GATE = {
  now: 41,
  remediated: 68,
  nowVerdict: "not safe to deploy",
  remediatedNote: "clears the gate · +27 points",
  summary:
    "Six findings, one number. Halden Materials is 27 points from safe to deploy, and every point is a known, fixable gap with a named owner and a price.",
  assessed: "Assessed 3 August 2026 · 150+ signals via Microsoft Graph, read-only",
} as const;

export interface CopilotDeliverable {
  readonly num: string;
  readonly title: string;
}

/** cpDeliverables — the assessment's document pack. Prototype 20625-20631. */
export const CP_DELIVERABLES: readonly CopilotDeliverable[] = [
  { num: "DOC-01", title: "Copilot Readiness, Safety & Enablement Report" },
  { num: "DOC-02", title: "Microsoft 365 Security Posture & Blast Radius Report" },
  { num: "DOC-03", title: "Microsoft 365 Governance Posture Report" },
  { num: "DOC-04", title: "Microsoft 365 Compliance & Regulatory Alignment Report" },
  { num: "DOC-08", title: "Full Remediation Guide — Copilot Gate Clearance Plan" },
];

/* ── Static copy — prototype 6100-6199. Verbatim, copy is FINAL. ──────────── */
export const CP_COPY = {
  eyebrow: "Copilot readiness · standalone offer",
  heading: "It is not yet safe to turn Copilot on at Halden Materials",
  subhead:
    "Copilot inherits every permission, label and retention rule you already have. This page is the assessment verdict: where the tenant stands, what each pillar is worth once remediated, and what the work costs.",
  gateTodayLabel: "Copilot gate today",
  remediatedLabel: "Remediated",
  pillarsHeading: "What each pillar is worth once remediated",
  addonEyebrow: "The add-on",
  addonTitle: "White-Glove Copilot Adoption",
  addonBody:
    "Remediation fixes your tenant. This is how your people actually use it: a pilot cohort, plain-language change comms written from your own findings, a daily prompt drip in Teams, and live enablement sessions — measured on the same usage data that found the gap.",
  addonAdd: "Add this to the plan",
  addonAsk: "Ask ShaneBot what it covers",
  producedLabel: "What the assessment produced",
  producedNote: "Nine documents, all issued. Every number traces to the telemetry behind it.",
  ready: "Ready",
  docPack: "Open the document pack",
  discussTitle: "Discuss your results with Shane McCaw",
  discussBody:
    "Thirty minutes, direct with the architect. Assessed against the M365 governance framework he wrote at NASA and distributed agency-wide. Thirty years in the Microsoft ecosystem.",
  discussBook: "Book the 30 minutes",
  discussPlan: "See the remediation plan",
} as const;
