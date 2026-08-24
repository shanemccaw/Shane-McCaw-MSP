/**
 * copilotData.ts — the STATIC copy for the Copilot readiness verdict page.
 *
 * ── What used to live here, and why it is gone (Git #1213) ─────────────────
 * This module used to carry `CP_PILLARS` (six hardcoded before/after pillar
 * scores), `CP_GATE` (a "41 → 68, +27 points" gate fixture) and a headline that
 * named the prototype's fictional tenant, "Halden Materials". `portal-v2-copilot.tsx`
 * rendered them verbatim, so every real paying customer saw another company's
 * fabricated findings under that company's name. That was the whole of #1213.
 *
 * Every FIGURE and the tenant NAME now come from the live Copilot assessment
 * engine, through `useCopilotJourney()` → `JourneyView` (the same source the four
 * Copilot Readiness screens already render from) — pillar scores, findings, the
 * gate score and the tenant name are all real and tenant-specific. See
 * `portal-v2-copilot.tsx` and the derivations in `copilotModel.ts`.
 *
 * What remains here is only what is genuinely static:
 *   • the per-pillar ADVISORY copy — why each pillar matters for Copilot and the
 *     shape of the remediation — which is general Microsoft-365 guidance, not a
 *     claim about any one tenant. The two sentences that used to embed Halden's
 *     own numbers ("Four Global Admins…", "A third of your tenant…") are
 *     generalised so no fabricated figure survives.
 *   • the document pack titles (`CP_DELIVERABLES`) — the real deliverable names.
 *   • the fixed UI copy (`CP_COPY`) — eyebrows, labels, the add-on and the
 *     book-a-call band. None of it names a tenant or quotes a number.
 *
 * ── The gate denominator is still the constant, not a literal ──────────────
 * The "of 82" denominator is `COPILOT_GATE_TARGET` from journeyTokens, read via
 * `copilotModel`'s `gateDenominatorLabel()` — never hardcoded. See `copilotModel.ts`.
 */

/** lucide-react icon keys, resolved to components on the page. */
export type CopilotPillarIcon = "shield-check" | "lock" | "scale" | "layers" | "trending-up" | "activity";

/**
 * A pillar's live severity band, as the row's state chip. Derived from the real
 * score in `copilotModel.pillarState`, never authored here — the three map onto
 * `severityForScore`'s critical / attention / healthy bands.
 */
export type CopilotPillarState = "Critical" | "Attention required" | "Healthy";

/**
 * The STATIC advisory for one pillar — its identity (label/colour/icon) and the
 * general guidance that never depends on a tenant's own numbers.
 *
 * The live score, target, state and finding are NOT here — they arrive from the
 * engine and are merged onto this in `copilotModel.copilotPillarRow`.
 */
export interface CopilotPillarAdvice {
  /** The pillar's route key — `Open <pillar>` navigates to `/portal-v2/<key>`. */
  readonly key: string;
  readonly label: string;
  /** Identity colour — the prototype's inline value (13082-13102). */
  readonly color: string;
  readonly icon: CopilotPillarIcon;
  /** Why this pillar matters for Copilot. General guidance, tenant-agnostic. */
  readonly why: string;
  /** The shape of the remediation. General guidance, tenant-agnostic. */
  readonly fix: string;
}

/**
 * CP_PILLAR_ADVICE — the six pillars' identity and advisory copy, in the
 * design's order. Colours/labels/icons and the `fix` lines are verbatim from the
 * prototype; the two `why` lines that embedded Halden Materials' own fabricated
 * figures are generalised (see the header) so the guidance stays true for any
 * tenant.
 */
export const CP_PILLAR_ADVICE: readonly CopilotPillarAdvice[] = [
  {
    key: "governance",
    label: "Governance",
    color: "#3B82F6",
    icon: "shield-check",
    why: "Copilot inherits every permission you have ever granted. Oversharing stops being a filing problem the day it becomes an answer Copilot gives to the wrong person.",
    fix: "Revoke org-wide sharing links and put a lifecycle policy on every site.",
  },
  {
    key: "security",
    label: "Security",
    color: "#8B5CF6",
    icon: "lock",
    // Generalised for #1213: the prototype's version ended "Four Global Admins
    // without MFA is the one I would fix first, today" — a Halden figure. The
    // guidance is kept, the fabricated count removed.
    why: "Every identity gap is a Copilot access gap. A compromised account no longer just reads mail — it queries the whole tenant in plain language. Privileged accounts without MFA are the ones to fix first, before anything else on this page.",
    fix: "Enforce Conditional Access on privileged roles and switch off legacy auth.",
  },
  {
    key: "compliance",
    label: "Compliance",
    color: "#F3F4F6",
    icon: "scale",
    why: "Unlabelled data is data Copilot will summarise, quote and export without restriction. Labels are the only instruction it obeys.",
    fix: "Publish a baseline label set and extend DLP to Teams and OneDrive.",
  },
  {
    key: "licensing",
    label: "Licensing",
    color: "#14B8A6",
    icon: "layers",
    why: "Copilot sits on top of your base SKUs. Until those are right, the rollout stalls in procurement, not in technology.",
    fix: "Reclaim the dormant seats and fund the E5 uplift out of the waste.",
  },
  {
    key: "adoption",
    label: "Adoption",
    color: "#F97316",
    icon: "trending-up",
    // Generalised for #1213: the prototype's version read "A third of your tenant
    // is not there yet" — a Halden figure. The guidance is kept, the fabricated
    // fraction removed.
    why: "Copilot returns value only where the work already happens. Users who are not active there yet return nothing on their licences until they are.",
    fix: "Run targeted enablement in Operations and Field Services first.",
  },
  {
    key: "health",
    label: "Health",
    color: "#22C55E",
    icon: "activity",
    why: "Unmanaged drift undoes remediation inside two quarters. The score you earn is only ever the score you keep.",
    fix: "Put hourly drift telemetry on the tenant so nothing changes unseen.",
  },
];

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

/* ── Static copy — prototype 6100-6199. Verbatim, minus the fabricated
 *    heading/summary/assessed lines, which are now built from live data in
 *    `copilotModel.ts`. Copy is FINAL. ─────────────────────────────────────── */
export const CP_COPY = {
  eyebrow: "Copilot readiness · standalone offer",
  subhead:
    "Copilot inherits every permission, label and retention rule you already have. This page is the assessment verdict: where the tenant stands, what each pillar is worth once remediated, and what the work costs.",
  gateTodayLabel: "Copilot gate today",
  remediatedLabel: "Remediated",
  pillarsHeading: "What each pillar is worth once remediated",
  /** Shown in the pillars eyebrow when no post-remediation projection is quoted. */
  pillarsHeadingNoProjection: "Where each pillar stands today",
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
