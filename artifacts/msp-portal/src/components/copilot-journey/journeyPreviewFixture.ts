/**
 * journeyPreviewFixture.ts — the design's own worked example, kept in one place
 * and clearly labelled as such.
 *
 * WHAT THIS IS AND IS NOT
 * ----------------------
 * The prototypes use one consistent fictional tenant — Halden Materials, 1,240
 * seats, scanned 3 August 2026, score 41 — as a stand-in, and the handoff is
 * explicit that every number in the mocks is bound to real data in production.
 * So these values exist for exactly two purposes:
 *
 *   1. `node --test` assertions against the pricing and reveal maths.
 *   2. The `?preview=design` flag, which renders the journey pixel-accurately
 *      without a scanned tenant so the composition can be reviewed. That flag
 *      paints a persistent badge on screen; the preview can never be mistaken
 *      for a real tenant's results.
 *
 * Nothing here is reachable on a live customer's journey. The screens bind to
 * `buildJourneyView()` over the real payloads; when those are empty the screens
 * render their unavailable states, never these figures.
 *
 * This is also where the platform's no-hardcoding rule is satisfied: prices,
 * tier names and seat counts live in this `.ts` fixture and on API responses,
 * and a grep for them across the journey's `.tsx` files finds nothing.
 */

import type { JourneyAddon, JourneyPhase, JourneyScopeInput } from "./journeyPricing.ts";
import type { JourneyTenant, JourneyView } from "./journeyModel.ts";
import { JOURNEY_DESIGN_DOCUMENTS, PILLARS } from "./journeyTokens.ts";

export const PREVIEW_TENANT: JourneyTenant = {
  name: "Halden Materials",
  seatCount: 1240,
  scannedOn: "3 August 2026",
};

/**
 * The six pillars as the design writes them. `headline` is the pillar scene's
 * h2, `satelliteFinding` is Scene 1's ring label (a finding, never a score), and
 * `chips` are the curated radar findings — every chip reappears in that pillar's
 * scene, which is what makes the scan read as the same assessment.
 */
export const PREVIEW_PILLARS = [
  {
    key: "governance" as const,
    score: 34,
    projected: 61,
    headline: "1,847 SharePoint sites. 212 of them are open to everyone in your tenant.",
    why: "Copilot inherits every permission you have ever granted. Oversharing stops being a filing problem the day it becomes an answer Copilot gives to the wrong person.",
    fix: "Revoke org-wide sharing links and put a lifecycle policy on every site.",
    satelliteFinding: "212 of 1,847 sites shared org-wide",
    chips: ["212 sites shared org-wide", "1,847 sites in scope", "No lifecycle policy"],
  },
  {
    key: "security" as const,
    score: 38,
    projected: 72,
    headline: "14 accounts have no MFA. Four of them are Global Admins.",
    why: "Every identity gap is a Copilot access gap. A compromised account no longer just reads mail — it queries the whole tenant in plain language.",
    fix: "Enforce Conditional Access on privileged roles and switch off legacy auth.",
    satelliteFinding: "14 accounts with no MFA, 4 are admins",
    chips: ["14 accounts without MFA", "4 Global Admins exposed", "Legacy auth still enabled"],
    /**
     * The one margin note in the whole experience. A second instance anywhere
     * tips it into gimmick, so this is the only entry that carries the field and
     * the component renders it for this pillar alone.
     */
    marginNote:
      "— Four Global Admins without MFA. This is the one I would fix first, today, before anything else on this page.",
  },
  {
    key: "compliance" as const,
    score: 29,
    projected: 58,
    headline: "No DLP policy covers Teams chat. 61% of your files carry no sensitivity label.",
    why: "Unlabelled data is data Copilot will summarise, quote and export without restriction. Labels are the only instruction it obeys.",
    fix: "Publish a baseline label set and extend DLP to Teams and OneDrive.",
    satelliteFinding: "61% of files carry no label",
    chips: ["0 DLP policies on Teams", "61% of files unlabelled", "No retention on chat"],
  },
  {
    key: "licensing" as const,
    score: 57,
    projected: 79,
    headline: "$18,400 a year sits in unassigned seats. 96 users need E5 for the controls above.",
    why: "Copilot sits on top of your base SKUs. Until those are right, the rollout stalls in procurement, not in technology.",
    fix: "Reclaim the dormant seats and fund the E5 uplift out of the waste.",
    satelliteFinding: "$18,400 a year in unassigned seats",
    chips: ["$18,400 unassigned", "96 seats need E5", "31 duplicate service plans"],
  },
  {
    key: "adoption" as const,
    score: 46,
    projected: 68,
    headline: "412 of your 1,240 users have not opened Teams in 30 days.",
    why: "Copilot returns value only where the work already happens. A third of your tenant is not there yet, and licences for them return nothing.",
    fix: "Run targeted enablement in Operations and Field Services first.",
    satelliteFinding: "412 users dormant for 30+ days",
    chips: ["412 users dormant", "OneDrive at 31%", "2 departments inactive"],
  },
  {
    key: "health" as const,
    score: 44,
    projected: 70,
    headline: "37 tenant configuration changes in 90 days. None recorded. None reviewed.",
    why: "Unmanaged drift undoes remediation inside two quarters. The score you earn is only ever the score you keep.",
    fix: "Put hourly drift telemetry on the tenant so nothing changes unseen.",
    satelliteFinding: "37 config changes, none reviewed",
    chips: ["37 unreviewed changes", "No drift baseline", "Audit log at 90 days"],
  },
] as const;

export const PREVIEW_READINESS_SCORE = 41;
export const PREVIEW_REMEDIATED_SCORE = 68;

/** The scan's own signal budget, used for the Scene 0 counter. */
export const PREVIEW_SIGNAL_COUNT = 158;

/**
 * The check names that stream beneath the radar. Ordered so the six pillars fill
 * in a plausible sequence — in production these come from
 * `GET /api/portal/scan-plan`, which is literally the list the package executor
 * iterates.
 */
export const PREVIEW_CHECK_NAMES: readonly string[] = [
  "Reading tenant organisation profile",
  "Enumerating Entra ID directory roles",
  "Reading Conditional Access policies",
  "Evaluating legacy authentication protocols",
  "Reading MFA registration state",
  "Checking privileged role assignments",
  "Reading sign-in risk detections",
  "Enumerating guest accounts",
  "Reading OAuth application consents",
  "Checking service principal credentials",
  "Reading password protection policy",
  "Evaluating self-service password reset",
  "Reading SharePoint sharing exposure",
  "Enumerating site collections",
  "Checking org-wide sharing links",
  "Reading anonymous link expiry",
  "Evaluating external sharing domains",
  "Reading OneDrive activation state",
  "Checking site lifecycle policy",
  "Enumerating orphaned sites",
  "Reading Teams creation policy",
  "Checking Teams guest access",
  "Reading private channel inventory",
  "Evaluating Teams app permissions",
  "Reading meeting recording policy",
  "Checking chat retention settings",
  "Reading DLP policy coverage",
  "Enumerating sensitivity labels",
  "Checking label publishing scope",
  "Reading auto-labelling rules",
  "Evaluating retention policies",
  "Reading eDiscovery holds",
  "Checking audit log retention",
  "Reading insider risk indicators",
  "Evaluating information barriers",
  "Reading communication compliance",
  "Checking Purview connectors",
  "Reading licence assignments",
  "Enumerating unassigned SKUs",
  "Checking duplicate service plans",
  "Evaluating E3 to E5 upgrade paths",
  "Reading Copilot prerequisite SKUs",
  "Checking licence renewal dates",
  "Reading dormant seat activity",
  "Evaluating group-based licensing",
  "Reading Exchange transport rules",
  "Checking mailbox forwarding rules",
  "Reading anti-phishing policies",
  "Evaluating Safe Links coverage",
  "Reading Defender alert history",
  "Checking device compliance policies",
  "Reading Intune enrolment state",
  "Evaluating app protection policies",
  "Reading service health incidents",
  "Checking tenant configuration drift",
  "Reading change audit trail",
  "Evaluating admin activity patterns",
  "Reading usage telemetry",
  "Checking engagement by workload",
  "Compiling readiness signal scores",
];

/* ------------------------------------------------------------------ *
 * Scope — the six remediation phases and the three optional services.
 * ------------------------------------------------------------------ */

export const PREVIEW_PHASES: readonly JourneyPhase[] = [
  {
    id: "identity-access-hardening",
    title: "Identity & Access Hardening",
    pillar: "security",
    scope:
      "MFA for the four exposed Global Administrators, Conditional Access scoped to privileged roles, legacy auth retired, 31 dormant guests removed.",
    priceUsd: 6400,
    weeks: 2,
    scoreFrom: 38,
    scoreTo: 72,
    addresses: "Cannot be removed — Copilot inherits identity on day one.",
    findingCount: 8,
    locked: true,
  },
  {
    id: "sharing-exposure-remediation",
    title: "Sharing Exposure Remediation",
    pillar: "governance",
    scope:
      "Org-wide sharing revoked across 212 sites — the four HR and finance sites first — anonymous links expired, 12-month lifecycle policy with owner attestation.",
    priceUsd: 9800,
    weeks: 3,
    scoreFrom: 34,
    scoreTo: 61,
    addresses: "Addresses: 212 sites shared org-wide, 2,940 non-expiring links.",
    findingCount: 9,
    locked: false,
  },
  {
    id: "data-protection-baseline",
    title: "Data Protection Baseline",
    pillar: "compliance",
    scope:
      "Baseline sensitivity labels published, auto-labelling on the 61% of files carrying none, DLP extended to Teams chat and OneDrive with retention on chat.",
    priceUsd: 8600,
    weeks: 3,
    scoreFrom: 29,
    scoreTo: 58,
    addresses: "Addresses: no DLP on Teams chat, 61% of files unlabelled.",
    findingCount: 7,
    locked: false,
  },
  {
    id: "licence-rationalisation",
    title: "Licence Rationalisation",
    pillar: "licensing",
    scope:
      "Dormant seats reclaimed, 31 duplicate service plans cleared, and the E5 uplift for the 96 users who need Phase 1 and 3 controls modelled and staged.",
    priceUsd: 3200,
    weeks: 1,
    scoreFrom: 57,
    scoreTo: 79,
    addresses: "Recovers $18,400 a year — this phase pays for itself in month one.",
    findingCount: 5,
    locked: false,
  },
  {
    id: "adoption-enablement",
    title: "Adoption Enablement",
    pillar: "adoption",
    scope:
      "Targeted enablement for Operations and Field Services, where the 412 dormant users and 31% OneDrive activation sit, so licences land where work happens.",
    priceUsd: 5400,
    weeks: 2,
    scoreFrom: 46,
    scoreTo: 68,
    addresses: "Addresses: 412 users dormant 30+ days, OneDrive at 31%.",
    findingCount: 6,
    locked: false,
  },
  {
    id: "drift-baseline-handover",
    title: "Drift Baseline & Handover",
    pillar: "health",
    scope:
      "The remediated tenant captured as a signed baseline, a change-review runbook, and handover to your team so the 37-unreviewed-changes pattern does not resume.",
    priceUsd: 2800,
    weeks: 1,
    scoreFrom: 44,
    scoreTo: 70,
    addresses: "Addresses: 37 configuration changes in 90 days, no baseline.",
    findingCount: 6,
    locked: false,
  },
];

export const PREVIEW_ADDONS: readonly JourneyAddon[] = [
  {
    id: "tenant-monitoring",
    title: "Tenant Monitoring",
    blurb:
      "Six signal engines against your tenant every hour. An assessment tells you what is wrong today; monitoring tells you the second it happens again.",
    defaultOn: true,
    defaultTierId: "growth",
    tiers: [
      { id: "essential", label: "Essential", upfrontUsd: 0, monthlyUsd: 890, detail: "Up to 1,000 seats" },
      {
        id: "growth",
        label: "Growth",
        upfrontUsd: 0,
        monthlyUsd: 1480,
        detail: "1,000–2,500 seats",
        emphasis: "seat-match",
      },
      { id: "enterprise", label: "Enterprise", upfrontUsd: 0, monthlyUsd: 2350, detail: "2,500+ seats" },
    ],
  },
  {
    id: "white-glove-adoption",
    title: "White-Glove Copilot Adoption",
    blurb:
      "Remediation fixes your tenant. This is how your people actually use it — prompt coaching in Teams, plain-language change comms, and a pilot cohort measured on the same usage data that found the gap.",
    defaultOn: false,
    defaultTierId: "growth",
    tiers: [
      {
        id: "essential",
        label: "Essential",
        upfrontUsd: 2400,
        monthlyUsd: 0,
        detail: "Self-serve content pack",
      },
      {
        id: "growth",
        label: "Growth",
        upfrontUsd: 6800,
        monthlyUsd: 400,
        detail: "Team-run setup, live sessions",
        // Delivery model, not a seat band — so "recommended", never "your seat count".
        emphasis: "recommended",
      },
      {
        id: "enterprise",
        label: "Enterprise",
        upfrontUsd: 14500,
        monthlyUsd: 900,
        detail: "Full programme, monthly reporting",
      },
    ],
  },
  {
    id: "architect-retainer",
    title: "Architect Retainer · 8 hours a month",
    blurb:
      "Direct access to Shane for design decisions, escalations and change review. $2,200 a month, cancel with 30 days' notice.",
    defaultOn: false,
    defaultTierId: "standard",
    tiers: [
      { id: "standard", label: "Retainer", upfrontUsd: 0, monthlyUsd: 2200, detail: "8 hours a month" },
    ],
  },
];

export const PREVIEW_SCOPE: JourneyScopeInput = {
  phases: PREVIEW_PHASES,
  addons: PREVIEW_ADDONS,
};

/** Default deposit on the phased plan. */
export const PREVIEW_DEPOSIT_PCT = 40;

/** The real 30-day unpaid-SOW expiry. Never a countdown, never fabricated scarcity. */
export const PREVIEW_QUOTE_HOLD_DATE = "2 September 2026";

export const PREVIEW_SIGNER = "J. Okonkwo, IT Director";

export const PREVIEW_PROJECTED_BY_PILLAR = {
  governance: 61,
  security: 72,
  compliance: 58,
  licensing: 79,
  adoption: 68,
  health: 70,
} as const;

/** The whole Reveal view, ready to render, badged as a preview. */
export function previewJourneyView(readyDocuments = 3): JourneyView {
  return {
    tenant: PREVIEW_TENANT,
    readinessScore: PREVIEW_READINESS_SCORE,
    remediatedScore: PREVIEW_REMEDIATED_SCORE,
    pillars: PREVIEW_PILLARS.map((p) => ({
      key: p.key,
      label: PILLARS[p.key].label,
      primary: PILLARS[p.key].primary,
      accent: PILLARS[p.key].accent,
      score: p.score,
      headline: p.headline,
      chips: [...p.chips],
      satelliteFinding: p.satelliteFinding,
      trend: null,
      criticalCount: p.score < 40 ? 2 : 0,
      warningCount: p.score < 40 ? 1 : 2,
    })),
    generation: {
      ready: readyDocuments,
      total: JOURNEY_DESIGN_DOCUMENTS.length,
      allReady: readyDocuments >= JOURNEY_DESIGN_DOCUMENTS.length,
      documents: JOURNEY_DESIGN_DOCUMENTS.map((title, i) => ({
        title,
        // A stable slug per title, so the preview exercises the same
        // docType-keyed join the live path uses rather than a different one.
        docType: title.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
        id: i < readyDocuments ? i + 1 : null,
        status: i < readyDocuments ? ("ready" as const) : ("generating" as const),
      })),
    },
    isPreview: true,
  };
}
