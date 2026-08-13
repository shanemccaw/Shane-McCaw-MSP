/**
 * pillarLicensingAlignment.ts — the real Copilot Licensing Alignment Report, as
 * data (#292).
 *
 * The live counterpart to `previewDocumentBodies.ts`'s `LICENSING_ALIGNMENT`,
 * built from one real tenant's own `war-room-pillars` payload plus
 * `/portal/assessment/licensing-alignment-narrative` instead of from Halden
 * Materials' worked example.
 *
 * A pure `.ts` for the same two reasons as its siblings, and the second one bites
 * hardest here: this is the report full of dollar figures and seat counts, and
 * the platform's no-hardcoding rule keeps every one of them out of `.tsx`. Every
 * number here arrives from the wire; none is written down.
 *
 * ── THE FOUR REAL FIGURES THIS REPORT HAS ────────────────────────────────────
 * `WAR_ROOM_PILLAR_STAT_SPECS.licensing` is four stats. Three come from the real
 * `/subscribedSkus` arithmetic (`resolvePaidSeatFigures` + `computeSkuCostBreakdown`)
 * — paid seats provisioned, paid and unassigned, and the annual waste those
 * unassigned seats represent — and the fourth is `licensing:inactive-user-licenses`.
 *
 * "PAID" IS LOAD-BEARING IN EVERY CAPTION BELOW, not decoration. Those counts
 * are restricted to SKUs with a real price in `sku_price_reference`, which is
 * what keeps Microsoft's free and viral SKUs out of them — #333 is the record of
 * what happens otherwise: a five-user tenant rendering "1,020,000 seats
 * provisioned" because Graph reports a sentinel capacity for POWER_BI_STANDARD.
 * A caption here that dropped the word would silently re-assert the number #333
 * removed.
 *
 * ── WHAT THIS REPORT DROPS FROM THE DESIGN, AND WHY ──────────────────────────
 *   1. "Seat Drift Analysis" is DROPPED entirely, and so is the Summary's "Seat
 *      drift" row. Its four rows are department-level ("Operations: 31 seats
 *      above its role pattern", "Field Services: 19 seats below") and
 *      role-template-level ("47 assignments do not match any defined role
 *      template", "31 licences from three groups last reviewed in 2024"). This
 *      platform holds no department attribution for a licence, no role template
 *      to compare one against, and no group-assignment history. Every row would
 *      be written rather than read.
 *   2. Every PERSONA claim is DROPPED — "84 users in high-value personas with no
 *      Copilot seat", "Finance Analyst, Legal Counsel and Bid Manager", "Personas
 *      blocked by SKU gaps". This is `copilotReadinessReport.ts`'s own documented
 *      precedent applied verbatim: personas are a War Room-era feature out of
 *      scope for this journey, and the platform holds no per-tenant persona
 *      readiness data of any kind.
 *   3. The SKU-eligibility split is DROPPED — "19 on E5 who need E3, 28 on E3 who
 *      need E5", "96 Copilot-eligible users lack the required base licence".
 *      #451 established that the required tier is NOT derivable per check on this
 *      platform: only a licence gap's own `_licenseGapFeature` names a tier, and
 *      only for the check that hit it. Naming an E5 requirement for a count of
 *      users would be inventing exactly the SKU claim the Upgrade Opportunity
 *      category exists to avoid inventing.
 *   4. The `monthlyWaste` FIGURE is not drawn, and neither is the per-category
 *      waste table beneath it. #292's own data-requirement comment says why: the
 *      chart "needs a structured breakdown by category or department, not just
 *      the single total waste figure", and the single total is what
 *      `computeSkuCostBreakdown` produces. The real annual figure is a row
 *      instead.
 *   5. The "Net year-one impact" arithmetic is DROPPED — "$18,400 recovered
 *      against a $27,600 E5 uplift — $9,200 net". Both the uplift cost and the
 *      netting depend on the E5 claim in (3), which has no producer.
 *   6. "Self-Resolution Actions" is DROPPED, on #343's precedent: remediation is
 *      the Full Remediation Guide's job in this journey, not this report's.
 *
 * ── NO PROMOTIONAL FRAMING, ANYWHERE (#451) ──────────────────────────────────
 * This is the one report in the set where a recoverable dollar figure sits next
 * to a licence-gap category, and the temptation to join them is the whole reason
 * #451 wrote its rules down. The Upgrade Opportunity copy names a required tier
 * and a capability and stops; it carries no price, no call to action, and no
 * suggestion that the waste below funds it. The closing paragraphs say the same
 * thing in words rather than implying it in a layout.
 */

import type { JourneyPillarView, JourneyView } from "./journeyModel.ts";
import {
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  buildProvenance,
  buildRows,
  declaredGapBlock,
  findingsBlocks,
  gateRow,
  keyValuesBlock,
  narrativeBlocks,
  pillarVerdictSeverity,
  unavailableBlock,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  verdictEyebrow,
  type LiveReportBlock,
  type LiveReportSection,
  type LiveReportVerdict,
  type StatPick,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections, in render order. */
export type LicensingAlignmentSectionKey = "summary" | "cost" | "copilotImpact";

/**
 * The Licensing Alignment narrative payload. Plain `WireNarrativePayload`:
 * every figure this report shows is already on the `war-room-pillars` wire, so
 * unlike the Security Posture report there is nothing for the route to resolve
 * on the side.
 */
export type WireLicensingAlignmentPayload = WireNarrativePayload;

export type LicensingAlignmentSection = LiveReportSection;
export type LicensingAlignmentBlock = LiveReportBlock;

export interface LicensingAlignmentReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: LiveReportVerdict;
  readonly sections: readonly LicensingAlignmentSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Licensing Posture Summary
 * ------------------------------------------------------------------ */

/**
 * The estate, as it actually is: what was bought, what of it nobody holds, and
 * what is held by someone who no longer uses it.
 *
 * The annual waste figure is deliberately NOT here — it leads the Cost section
 * below, where the prose that explains it lives, and the same dollar figure
 * under two headings reads as two amounts.
 */
const SUMMARY_PICKS: readonly StatPick[] = [
  { statId: "licensing.provisioned", pillar: "licensing", label: "Paid seats provisioned", caption: "paid seats bought across priced SKUs" },
  { statId: "licensing.unassigned", pillar: "licensing", label: "Paid seats unassigned", caption: "paid seats provisioned but held by nobody" },
  { statId: "licensing.inactive", pillar: "licensing", label: "Licences on inactive users", caption: "licences still assigned to users who are no longer active" },
];

/** The one real cost figure this platform computes, in whole dollars a year. */
const COST_PICKS: readonly StatPick[] = [
  { statId: "licensing.annualWaste", pillar: "licensing", label: "Recoverable licence spend", caption: "a year in paid, unassigned seats" },
];

/**
 * The design's per-department, per-persona and per-SKU claims, declared in words
 * because no check produces any of them.
 *
 * ── WHY IT IS PROSE AND NAMES NO CHECK KEY ───────────────────────────────────
 * There is no near-miss to rule out here, which is what separates it from the
 * Security Posture report's Conditional Access gap. `resolvePaidSeatFigures`
 * returns tenant-wide totals over priced SKUs; it carries no department, no job
 * title and no per-user row, because `/subscribedSkus` is a per-SKU capacity
 * endpoint and nothing else in the scan path joins a licence to an org chart.
 * There is no role-template table anywhere in the platform to compare an
 * assignment against, and no persona data of any kind for a tenant.
 *
 * The required-tier half is #451's finding stated as copy: only a licence gap's
 * own `_licenseGapFeature` names a tier, and only for the check that hit it —
 * so "these 96 users need E5" is a sentence this platform can never say
 * truthfully, however plausible it reads.
 *
 * It renders unconditionally: it is a fact about our coverage, not about this
 * tenant's scan.
 */
export const LICENSING_BREAKDOWN_GAP =
  "Three lines a licensing review would normally carry are deliberately not here. The first is a per-department or per-role breakdown — which teams are over-provisioned and which are short. Your subscription data is read per SKU across the whole tenant; nothing in this assessment joins a licence to a department, a job title or a role template, so no seat-drift analysis is offered and none should be inferred from the totals below. The second is persona readiness: this platform holds no persona data for your tenant, so no report here names a persona or counts the users in one. The third is a required-tier recommendation. This assessment can name the tier a specific check needs only when Microsoft's own response to that check named it, which is what the Upgrade Opportunities section below reports; it cannot work backwards from a user count to a SKU those users ought to hold, so it does not.";

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the licensing pillar's own real headline and score.
 *
 * The design's version leads with a dollar figure ("$18,400 a year in seats
 * nobody uses") and a consequence that is a sales line ("it funds two thirds of
 * the E5 uplift the controls require"). Neither is inherited: the dollar figure
 * is Halden's, and the consequence is both an invented uplift cost and exactly
 * the promotional framing #451 rules out.
 *
 * The real version states the pillar's real lead finding — a real
 * `severity_rules` label, `CLEAN_PILLAR_HEADLINE` for a pillar genuinely
 * evaluated clean (#399), or nothing for a pillar nothing scored.
 */
export function buildVerdict(licensing: JourneyPillarView | undefined): LicensingAlignmentReport["verdict"] {
  const score = licensing?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Licensing posture",
      headline: "No licensing score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Licensing pillar, so there is no posture score and no worst finding to lead with. What follows is what the scan did measure.",
      severity: "unmeasured",
    };
  }
  const headline = licensing?.headline;
  return {
    eyebrow: verdictEyebrow("Licensing posture", headline),
    headline: headline ?? `Licensing scores ${score} of 100`,
    sub: `The Licensing pillar scores ${score} of 100 on this tenant's last scan. Every figure below is read from your own subscription data; nothing here is a benchmark, a projection or a quote.`,
    severity: pillarVerdictSeverity(licensing),
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<LicensingAlignmentSectionKey, string> = {
  summary: "Licensing Posture Summary",
  cost: "Cost Waste Summary",
  copilotImpact: "Copilot Readiness Impact",
};

const COVERAGE_HEADING = "Eligibility & Coverage Gaps";

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildLicensingAlignmentReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireLicensingAlignmentPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): LicensingAlignmentReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const licensing = pillars.find((p) => p.key === "licensing");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );
  const prose = (key: LicensingAlignmentSectionKey): LicensingAlignmentBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  const sections: LicensingAlignmentSection[] = [];

  // ── Licensing Posture Summary ──────────────────────────────────────────────
  const summary = buildRows(pillars, SUMMARY_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.summary,
    blocks: [
      ...prose("summary"),
      ...keyValuesBlock(summary.rows),
      ...unavailableBlock(
        "Figures behind this summary that this tenant's subscription data does not carry:",
        summary.missing,
      ),
      ...declaredGapBlock(LICENSING_BREAKDOWN_GAP),
    ],
  });

  // ── Cost Waste Summary ─────────────────────────────────────────────────────
  //
  // One real figure and the prose that explains it. `no_sku_prices` is the
  // reason that lands here most often, and it says something specific and true:
  // the seats were counted but no priced SKU exists to value them against, which
  // is an unpriceable estate rather than a waste-free one.
  const cost = buildRows(pillars, COST_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.cost,
    blocks: [
      ...prose("cost"),
      ...keyValuesBlock(cost.rows),
      ...unavailableBlock(
        "Cost figures this tenant's subscription data does not carry. An absent figure here means the spend could not be priced, not that there is none:",
        cost.missing,
      ),
    ],
  });

  // ── Eligibility & Coverage Gaps ────────────────────────────────────────────
  //
  // Pure data: the licensing pillar's own real findings, and nothing else. The
  // design's four rows under this heading are the E5-eligibility and persona
  // claims dropped in the header.
  sections.push({
    heading: COVERAGE_HEADING,
    blocks: findingsBlocks(
      licensing,
      "The Licensing pillar was evaluated on this tenant's last scan and returned no critical or warning finding about seat allocation, duplication or unused entitlement. That is a real result, not an empty section.",
      "No rule that feeds the Licensing pillar was evaluated on this tenant's last scan, so no eligibility or coverage finding can be reported either way.",
    ),
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // reports'. Placed AFTER the cost section deliberately and not beside it: a
  // recoverable-spend figure and an upgrade tier printed adjacently read as a
  // funding proposal, which is the promotional framing #451 rules out. They are
  // two separate facts about the tenant and are presented as two.
  const licenceGaps = upgradeOpportunities([
    ...summary.missing,
    ...cost.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ] as readonly UnavailableCheck[], view.licenseGapPurchase);
  if (licenceGaps.length) {
    sections.push({
      heading: UPGRADE_OPPORTUNITY_HEADING,
      blocks: [
        {
          kind: "upgradeOpportunity",
          detail: UPGRADE_OPPORTUNITY_DETAIL,
          items: licenceGaps,
          callToAction: upgradeOpportunityCallToAction(view.licenseGapPurchase),
        },
      ],
    });
  }

  // ── Copilot Readiness Impact ───────────────────────────────────────────────
  sections.push({
    heading: SECTION_HEADINGS.copilotImpact,
    blocks: [...prose("copilotImpact"), ...keyValuesBlock(gateRow(view))],
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  //
  // Two sentences at most, and the second only when there is a real score to
  // write it from. Neither states a recovery figure, a payback period or a
  // ranking of this pillar against the others — the design's closing does all
  // three, and all three are claims about Halden.
  const closing: string[] = [
    "Licensing decides whether a Copilot rollout is affordable rather than whether it is safe. Seats nobody holds and licences on people who have gone are real spend against no return, and they are the part of this assessment you can act on without touching a single control.",
  ];
  if (typeof licensing?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Licensing pillar scores ${licensing.score} of 100 on this scan. Every seat count and every dollar figure above is read from your own subscription data across SKUs with a real price — free and trial SKUs are excluded, so these are seats somebody actually bought.`,
    );
  }

  return {
    kicker: "Copilot licensing alignment",
    headline:
      typeof licensing?.score === "number"
        ? `What ${view.tenant.name} is paying for, and what it is using`
        : `Licensing posture for ${view.tenant.name}`,
    standfirst:
      "This report reads your tenant's own subscription data and reports what was bought, what is unassigned, and what is still held by users who are no longer active. It offers no per-department breakdown and recommends no licence tier — see the summary below for why both are deliberately absent.",
    verdict: buildVerdict(licensing),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  SUMMARY_PICKS,
  COST_PICKS,
  SECTION_HEADINGS,
  COVERAGE_HEADING,
};
