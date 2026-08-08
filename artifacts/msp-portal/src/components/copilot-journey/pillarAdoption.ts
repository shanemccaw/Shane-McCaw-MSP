/**
 * pillarAdoption.ts — the real Copilot Adoption & Usage Report, as data.
 *
 * The live counterpart to `previewDocumentBodies.ts`'s `ADOPTION_READINESS`,
 * built from one real tenant's own `war-room-pillars` payload plus
 * `/portal/assessment/adoption-narrative` instead of from Halden Materials'
 * worked example.
 *
 * A pure `.ts` for the same two reasons as its six siblings: `node --test`
 * cannot load `.tsx`, so the rules below are testable; and the platform's
 * no-hardcoding rule keeps counts out of `.tsx`. The honesty machinery is
 * `liveReportBlocks.ts`, shared verbatim — nothing about it is re-decided here.
 *
 * ── THE ONE STRUCTURAL FACT THAT MAKES THIS REPORT DIFFERENT ─────────────────
 * IT HAS NO MEASURED FIGURES AT ALL, and that is a real, documented state
 * rather than a wiring miss. `WAR_ROOM_PILLAR_STAT_SPECS.adoption` is an EMPTY
 * ARRAY in api-server's `war-room-pillar-stats.ts`, and its own note records
 * why: the four "active <workload> users" stats the card used to carry named
 * `usage:*` keys that #441 established are not a check-key domain in this
 * catalog at all, and the nearest real checks are Graph usage-report DETAIL
 * endpoints — one row per user, one row per site — so a metric pointed at any
 * of them falls through to `_itemCount` and renders the entire licensed roster
 * under a caption reading "active users". That is the same `_itemCount` trap
 * the Health card's `intune:*` stats are deliberately not re-pointed into, and
 * it is worse here because the number would look plausible.
 *
 * So this report carries NO `StatPick`, no `buildRows` call and no measured
 * `keyValues` table anywhere except the one real Gate row. What it does carry
 * is real: the Adoption pillar's own display score, every real
 * `msp_diagnostic_findings` row that scores that pillar, the real Copilot Gate,
 * and three gaps declared to the reader in words. A shorter report, not an
 * invented one — the same trade every report in this set makes.
 *
 * ── THE REAL CHECKS BEHIND IT ────────────────────────────────────────────────
 * Six live `monitor_checks` rows in the `adoption` category, each with a real
 * `signal_derivation_rules` row whose pillar is `adoption`, so their findings
 * reach this report's card through #469's single source of truth:
 *
 *   adoption:overall-active-rate        /reports/getOffice365ActiveUserDetail
 *   adoption:teams-activity-trend       /reports/getTeamsUserActivityUserDetail
 *   adoption:email-activity-trend       /reports/getEmailActivityUserDetail
 *   adoption:sharepoint-onedrive-trend  /reports/getSharePointSiteUsageDetail
 *   adoption:viva-engage-health         /employeeExperience/communities
 *   adoption:planner-usage              /groups/{itemId}/planner/plans (fan-out)
 *
 * `teams:inactive-teams` is a seventh: it sits in the `teams` category but its
 * signal's pillar is `adoption`, so its findings land on this card too. That is
 * why the findings section below is scoped to the PILLAR and not to a written-
 * down list of check keys — a list would have silently dropped it, and would
 * drop the next check reclassified onto this pillar the same way #521 found the
 * War Room's domain grouping doing.
 *
 * ── WHAT THIS REPORT DROPS FROM THE DESIGN, AND WHY ──────────────────────────
 * The design is the structural and tonal reference and nothing more. Most of
 * its figures are placeholders with no producer in this platform, and each is
 * dropped rather than approximated — the same discipline `pillarSecurityPosture
 * .ts` applied to its own design's blast-radius and Secure Score trend figures.
 *
 *   1. "Persona Readiness Analysis" is DROPPED entirely. Its five rows name
 *      personas ("Field Technician", "Plant Supervisor", "Bid Manager", "Legal
 *      Counsel") and count them ("3 personas fully ready", "516 users need
 *      fundamentals", "84 users where Copilot pays back fastest"). NO check in
 *      this catalog produces a persona model, and none maps a user to a role.
 *      Every one of those names is Halden's, and they are on `FIXTURE_LEAKS`
 *      precisely so a suite fails if one reaches a live report.
 *   2. "Workflow Alignment Assessment" is DROPPED. "52 / 100 across six
 *      departments", "four competing procurement patterns", "improvable
 *      immediately" and "automation-eligible but blocked" are five separate
 *      measurements and this platform performs none of them. There is no
 *      workflow signal on this tenant path at all: the one `workflow:*` signal
 *      in the catalog (`hasManualProcessOverhead`) is an EXAMPLE row seeded for
 *      the rule builder, with confidence 0 and every impact 0.
 *   3. "Training & Enablement Gaps" is DROPPED. Departments ("Operations and
 *      Field Services — 638 users, no training delivered to date"), a
 *      recommended enablement sequence and a training-impact projection are all
 *      unbacked. This assessment reads Graph; it holds no training record and
 *      no department roster.
 *   4. THE PROJECTED SCORE IS DROPPED, and this one is a standing rule rather
 *      than a per-report call. The design's "enablement alone moves Adoption
 *      from 46 to an estimated 61" and "Adoption contributes 22 points of
 *      available gain" are a predicted future score and a predicted point gain.
 *      The other six reports state neither — `COPILOT_IMPACT_RULES` forbids
 *      both in prompt form — and introducing one here would make this the only
 *      report in the set that promises the customer a number it cannot owe them.
 *   5. THE DRIFT CLAIMS ARE DROPPED: "usage has been flat for two periods",
 *      "412 users have not opened Teams in 30 days". Same reasoning the other
 *      six already applied to their own drift sections, plus a sharper one that
 *      belongs to this report specifically — see `TREND_DIRECTION_GAP`, which
 *      states it to the reader instead of going quiet about it.
 *   6. "Self-Resolution Actions" is DROPPED, on #343's precedent: remediation is
 *      the Full Remediation Guide's job in this journey, not this report's.
 *   7. The three design FIGURES — `usageTrend`, `personaSplit` and
 *      `departmentUsage` — are dropped with the data behind them. There IS a
 *      real per-pillar series on the wire (`pillar-trend.ts`, #356), and it is
 *      deliberately not drawn under a usage caption: it is the ADOPTION PILLAR
 *      SCORE over time, which is a different quantity from workload activity,
 *      and plotting it beneath "usage" would be exactly the fabricated shape
 *      #343 refused when it declined to draw Secure Score history from the same
 *      series. See `AdoptionReportBody.tsx` for where that decision is enacted.
 *
 * ── THE THREE HONEST GAPS THIS REPORT DECLARES IN WORDS ──────────────────────
 * `USAGE_FIGURE_GAP`, `TREND_DIRECTION_GAP` and `PERSONA_AND_ENABLEMENT_GAP`
 * below. All three render unconditionally: they are facts about what this
 * platform measures, not about one tenant's scan, so there is no customer for
 * whom any of them becomes untrue and none may silently disappear on a rich
 * tenant. None names a check key — #441's rule that our own wiring vocabulary
 * never reaches a paying reader — and none carries a digit, so none can be
 * mistaken for the figure it exists to say is absent.
 */

import type { JourneyPillarView, JourneyView } from "./journeyModel.ts";
import {
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  buildProvenance,
  declaredGapBlock,
  findingsBlocks,
  gateRow,
  keyValuesBlock,
  narrativeBlocks,
  pillarVerdictSeverity,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  verdictEyebrow,
  type LiveReportBlock,
  type LiveReportSection,
  type LiveReportVerdict,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections, in render order. */
export type AdoptionSectionKey = "summary" | "activity" | "copilotImpact";

/**
 * The Adoption narrative payload. Plain `WireNarrativePayload`: this report
 * resolves no metric of its own and shows no measured figure, so unlike the
 * Security Posture report there is nothing for the route to carry down beside
 * the prose.
 */
export type WireAdoptionPayload = WireNarrativePayload;

export type AdoptionSection = LiveReportSection;
export type AdoptionBlock = LiveReportBlock;

export interface AdoptionReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: LiveReportVerdict;
  readonly sections: readonly AdoptionSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * The three declared gaps
 * ------------------------------------------------------------------ */

/**
 * Why this report shows no usage table — the gap that explains the shape of the
 * whole document, so it leads the Summary.
 *
 * The design's summary is four rows of exactly the figures named here
 * ("412 users on email-only workflows, 31% OneDrive activation", "Meetings 84%
 * · chat 71% · channel posts 22%"). Each would need a per-workload active-user
 * COUNT, and the audit for why this platform holds none is in
 * `war-room-pillar-stats.ts` beside the empty `adoption: []` spec: the checks
 * are per-user and per-site detail endpoints, and the only number a metric
 * could take from one is the row count of the response, which is the roster
 * rather than the active share of it.
 */
export const USAGE_FIGURE_GAP =
  "This report states no usage figure, and that is a limit of what this assessment measures rather than a gap in your scan. The activity checks behind it read Microsoft's own per-person and per-site usage reporting, and this platform holds no measurement that turns those rows into a count. So there is no number here for how many of your people are active in Teams, no share using OneDrive, no proportion of mail traffic and no percentage of your roster doing anything at all. Where a check raised a finding, it is stated below in the words the platform itself recorded; where it did not, nothing has been estimated in its place.";

/**
 * The sharper drift point, and the one that belongs to this report alone.
 *
 * Three of the six real checks have the word "trend" in their own catalogue
 * labels, and every one of them reads a `period='D7'` Graph usage report: a
 * single seven-day window, collected once. There is no second window persisted
 * beside it, so there is no diff to take and no direction of travel to state —
 * which is why the design's "usage has been flat for two periods" and "412
 * users have not opened Teams in 30 days" are not merely unbacked but
 * unbackable from these checks. Stated to the reader rather than left as a
 * silence, because "activity trend" is a phrase the reader will supply a
 * meaning for if this report does not.
 */
export const TREND_DIRECTION_GAP =
  "Every activity reading behind this section is a single seven-day window of Microsoft's usage reporting, collected once. No earlier window is recorded beside it, so nothing here can honestly be described as rising, falling or holding steady: this assessment carries no baseline for your activity, no month-on-month or quarter-on-quarter comparison, and no history of how your people's usage has moved. Where this report speaks of activity, it means one recent week — a reading, not a direction of travel.";

/**
 * The question this report is most likely to be asked and cannot answer.
 *
 * Sits in Copilot Readiness Impact rather than the Summary because that is
 * where a reader looks for "so who should we license first" — the whole of the
 * design's Persona Readiness Analysis, Workflow Alignment Assessment and
 * Training & Enablement Gaps sections rolled into the one honest sentence the
 * platform can actually stand behind.
 */
export const PERSONA_AND_ENABLEMENT_GAP =
  "One question this section deliberately does not answer is which of your people Copilot would serve first. This assessment builds no persona model, measures no workflow, and holds no record of training delivered or outstanding. It does not read which department a user belongs to, which of your processes still run on mail and attachments, or who has been through enablement and who has not — no check in this scan collects any of that. So nothing here names a role, a department or a team, ranks anyone by readiness, or recommends an order to enable people in. What it reasons from is your tenant's own activity findings and its real readiness score, and nothing else.";

/* ------------------------------------------------------------------ *
 * The scanned workload list (#575 Fix 1)
 *
 * The standfirst used to hardcode "mail, Teams, SharePoint, OneDrive, Viva
 * Engage and Planner" for every tenant, regardless of which of the six real
 * `adoption:*` checks that tenant's own scan package actually curates —
 * confirmed live: a tenant without Viva Engage or Planner in its package still
 * had this report claim both were evaluated. `scannedCheckKeys` (#575, off
 * `fetchScannedCheckKeys` — the same real set `not_in_scan_package` is refined
 * against) is the platform's own record of which checks this tenant's scan
 * actually curates; the standfirst now names only the workloads behind a check
 * present in that set.
 * ------------------------------------------------------------------ */

/**
 * Real `adoption:*` checks that name a specific Microsoft 365 workload, mapped
 * to how this report names it in prose. `adoption:overall-active-rate` is
 * deliberately absent — a tenant-wide active-rate check, not a named
 * workload — and so is `teams:inactive-teams`, the seventh check that feeds
 * this pillar (see the header): it is a Teams-domain finding, not a second
 * Teams workload entry.
 */
const ADOPTION_WORKLOAD_CHECKS: readonly { readonly checkKey: string; readonly labels: readonly string[] }[] = [
  { checkKey: "adoption:email-activity-trend", labels: ["mail"] },
  { checkKey: "adoption:teams-activity-trend", labels: ["Teams"] },
  { checkKey: "adoption:sharepoint-onedrive-trend", labels: ["SharePoint", "OneDrive"] },
  { checkKey: "adoption:viva-engage-health", labels: ["Viva Engage"] },
  { checkKey: "adoption:planner-usage", labels: ["Planner"] },
];

/** "a" / "a and b" / "a, b and c" — no Oxford comma, matching this report's existing prose. */
function joinWithAnd(items: readonly string[]): string {
  if (items.length === 0) return "";
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/**
 * The workloads THIS tenant's scan actually curates a check for — never the
 * full catalogue. Empty until the narrative fetch settles and empty forever
 * for a tenant whose scan packages curate no checks at all; both render as no
 * workload list rather than a guessed one.
 */
function scannedWorkloadLabels(scannedCheckKeys: readonly string[] | undefined): readonly string[] {
  const scanned = new Set(scannedCheckKeys ?? []);
  return ADOPTION_WORKLOAD_CHECKS.filter((w) => scanned.has(w.checkKey)).flatMap((w) => w.labels);
}

/* ------------------------------------------------------------------ *
 * The clean-result writeups (#575 Fix 3)
 *
 * `narrativeBlocks` renders "This section is not available" for every reason
 * a section carries no AI html — including a model that produced nothing for
 * a tenant this pillar's own real score and finding counts already show is
 * genuinely clean. That is case (b) from the confirmed live bug: data exists,
 * the pillar scored, checks ran, zero findings fired — a real GOOD result, not
 * an absence of one. These three writeups are the platform's own honest
 * substitute for that specific case, built from nothing but the real score —
 * never grounded in the AI section that failed to produce them.
 * ------------------------------------------------------------------ */

/** A genuinely clean, fully-measured result: a real score, zero real findings. */
function isCleanScoredPillar(pillar: JourneyPillarView | undefined): boolean {
  return typeof pillar?.score === "number" && pillar.criticalCount === 0 && pillar.warningCount === 0;
}

function cleanSummaryWriteup(tenantName: string, score: number): string {
  return `${tenantName}'s Adoption pillar scored ${score} of 100 on its last scan. Every rule that feeds this pillar was evaluated, and none of them raised a critical or warning finding — a real, fully-measured result, not a gap in this report. A clean result here means the scan found nothing wrong with how your people are using Microsoft 365; it does not mean usage is high, growing or complete, since this report measures no usage figure at all.`;
}

function cleanActivityWriteup(tenantName: string, score: number, workloads: readonly string[]): string {
  const scope = workloads.length ? ` across ${joinWithAnd(workloads)}` : "";
  return `Every activity check behind ${tenantName}'s Adoption pillar${scope} ran on its last scan, and none of them raised a critical or warning finding. The pillar scored ${score} of 100. That is a real, clean result — nothing the scan can see is wrong with how your people are collaborating in Microsoft 365 — not an absence of measurement.`;
}

function cleanCopilotImpactWriteup(tenantName: string, score: number): string {
  return `${tenantName}'s Adoption pillar scored ${score} of 100 with no critical or warning finding. That is a real, positive signal for a Copilot rollout: Copilot grounds on and appears inside collaboration that is already happening, and this pillar's own checks found nothing wrong with that collaboration. It is the whole of what this section can honestly draw from the score alone — see below for what it deliberately does not answer.`;
}

/**
 * A section's prose: the real AI-written HTML, or — once the fetch has
 * settled with nothing — the real clean-result writeup when `cleanWriteup` is
 * given (the caller has already established this pillar is genuinely clean),
 * falling back to `narrativeBlocks`'s honest disclaimer for every other
 * reason a section carries no html: genuinely no data at all, or a real
 * generation failure on a pillar that is NOT clean, where the findings below
 * already carry the real result.
 */
function proseOrCleanResult(
  section: WireNarrativeSection | undefined,
  narrativeSettled: boolean,
  cleanWriteup: string | null,
): AdoptionBlock[] {
  if (section?.html) return [{ kind: "narrative", html: section.html }];
  if (!narrativeSettled) return [];
  if (cleanWriteup) return [{ kind: "prose", text: cleanWriteup }];
  return narrativeBlocks(section, narrativeSettled);
}

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the adoption pillar's own real headline and score.
 *
 * The design's version leads with "412 users have not opened Teams in 30 days"
 * and a consequence drawn from it. The real version states the pillar's real
 * lead finding — a real `severity_rules` label — or falls back to the score,
 * or, for a pillar nothing scored, says so and claims nothing.
 */
export function buildVerdict(adoption: JourneyPillarView | undefined): AdoptionReport["verdict"] {
  const score = adoption?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Adoption",
      headline: "No adoption score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Adoption pillar, so there is no adoption score and no worst finding to lead with. What follows is what the scan did measure.",
      severity: "unmeasured",
    };
  }
  const headline = adoption?.headline;
  return {
    eyebrow: verdictEyebrow("Adoption", headline),
    headline: headline ?? `Adoption scores ${score} of 100`,
    sub: `The Adoption pillar scores ${score} of 100 on this tenant's last scan. Everything below is read from your own tenant's activity checks; none of it is a usage count, an activation rate, or a comparison against an earlier period.`,
    severity: pillarVerdictSeverity(adoption),
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<AdoptionSectionKey, string> = {
  summary: "Adoption Posture Summary",
  activity: "Workload Activity & Usage Signals",
  copilotImpact: "Copilot Readiness Impact",
};

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildAdoptionReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireAdoptionPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): AdoptionReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const adoption = view.pillars.find((p) => p.key === "adoption");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );

  const workloads = scannedWorkloadLabels(narrative?.scannedCheckKeys);
  // Only the platform's own real score/finding counts decide "clean" — never
  // the AI section's own absence, which would make a generation failure on a
  // genuinely bad tenant read as good news (#575).
  const clean = isCleanScoredPillar(adoption);
  const score = adoption?.score ?? null;

  const sections: AdoptionSection[] = [];

  // ── Adoption Posture Summary ───────────────────────────────────────────────
  //
  // No `keyValuesBlock` here and none possible: the adoption card carries no
  // stats at all. The gap declaration is what stands in its place, and it
  // explains the absence rather than papering over it.
  sections.push({
    heading: SECTION_HEADINGS.summary,
    blocks: [
      ...proseOrCleanResult(
        narrativeByKey.get("summary"),
        narrativeSettled,
        clean ? cleanSummaryWriteup(view.tenant.name, score!) : null,
      ),
      ...declaredGapBlock(USAGE_FIGURE_GAP),
    ],
  });

  // ── Workload Activity & Usage Signals ──────────────────────────────────────
  //
  // Scoped to the PILLAR, not to a written-down list of check keys — see the
  // header for why `teams:inactive-teams` is the reason that matters.
  sections.push({
    heading: SECTION_HEADINGS.activity,
    blocks: [
      ...proseOrCleanResult(
        narrativeByKey.get("activity"),
        narrativeSettled,
        clean ? cleanActivityWriteup(view.tenant.name, score!, workloads) : null,
      ),
      ...findingsBlocks(
        adoption,
        "The Adoption pillar was evaluated on this tenant's last scan and returned no critical or warning finding about how your people are using Microsoft 365. That is a real result, not an empty section.",
        "No rule that feeds the Adoption pillar was evaluated on this tenant's last scan, so no activity or usage finding can be reported either way.",
      ),
      ...declaredGapBlock(TREND_DIRECTION_GAP),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // reports'. This report picks no stats, so the only licence gap it can learn
  // about is one the narrative route reported from the same payload.
  const licenceGaps = upgradeOpportunities(
    (narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []) as readonly UnavailableCheck[],
    view.licenseGapPurchase,
  );
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
    blocks: [
      ...proseOrCleanResult(
        narrativeByKey.get("copilotImpact"),
        narrativeSettled,
        clean ? cleanCopilotImpactWriteup(view.tenant.name, score!) : null,
      ),
      ...keyValuesBlock(gateRow(view)),
      ...declaredGapBlock(PERSONA_AND_ENABLEMENT_GAP),
    ],
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  //
  // Two sentences at most, and the second only when there is a real score to
  // write it from. Neither promises a score after enablement, quotes a number
  // of points adoption could contribute, or recommends a rollout order — the
  // design's closing does the first two and its Training section does the third.
  const closing: string[] = [
    "Copilot does not create work; it joins work that is already happening. Where your people collaborate inside Microsoft 365, Copilot has something to ground on and somewhere to appear. Where they do not, a licence buys a button nobody presses — and that is an adoption question rather than a licensing one.",
  ];
  if (typeof adoption?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Adoption pillar scores ${adoption.score} of 100 on this scan. Every statement above comes from a named check that ran against your own tenant; where this report has no figure it says so plainly, and it has not estimated one in place of looking.`,
    );
  }

  return {
    kicker: "Copilot adoption & usage",
    headline:
      typeof adoption?.score === "number"
        ? "Copilot returns value only where the work already happens"
        : `Adoption and usage for ${view.tenant.name}`,
    standfirst: workloads.length
      ? `This report evaluates how your people are actually using Microsoft 365 — ${joinWithAnd(workloads)} — and what those usage patterns mean for a Copilot rollout. It states no usage count, no activation rate and no direction of travel; the notes in each section say why every one of those is absent rather than approximated.`
      : "This report evaluates how your people are actually using Microsoft 365 and what those usage patterns mean for a Copilot rollout. It states no usage count, no activation rate and no direction of travel; the notes in each section say why every one of those is absent rather than approximated.",
    verdict: buildVerdict(adoption),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the headings and the gaps are this report's contract. */
export const __testables = {
  SECTION_HEADINGS,
  DECLARED_GAPS: [USAGE_FIGURE_GAP, TREND_DIRECTION_GAP, PERSONA_AND_ENABLEMENT_GAP] as const,
};
