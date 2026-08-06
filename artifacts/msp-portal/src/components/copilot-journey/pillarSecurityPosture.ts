/**
 * pillarSecurityPosture.ts — the real Microsoft 365 Security Posture & Blast
 * Radius Report, as data (#343).
 *
 * The live counterpart to `previewDocumentBodies.ts`'s `SECURITY_POSTURE`: the
 * same ordered-block structure the design approved, built from one real
 * tenant's own `war-room-pillars` payload plus
 * `/portal/assessment/security-posture-narrative` — three AI-written sections
 * and the one metric the War Room payload does not carry — instead of from
 * Halden Materials' worked example.
 *
 * A pure `.ts` and not inlined into the renderer for the same two reasons its
 * sibling is: `node --test` cannot load `.tsx`, so the rules below are testable;
 * and the platform's no-hardcoding rule keeps counts and figures out of `.tsx`.
 * Every number here arrives from the wire; none is written down.
 *
 * The honesty machinery — what may be quoted, how an absence is declared, which
 * absences are our own wiring fault and must never reach the reader, and the
 * Upgrade Opportunity category — is `liveReportBlocks.ts`, shared verbatim with
 * the Copilot Readiness Report. Nothing about it is re-decided here.
 *
 * ── WHAT THIS REPORT DROPS FROM THE DESIGN, AND WHY ──────────────────────────
 *   1. "Security Drift & Violations" is DROPPED entirely, and so is the
 *      "Security drift" row inside the Summary. Same reasoning as the Copilot
 *      Readiness Report's dropped "Copilot Drift & Violations": drift is a diff
 *      against a recorded baseline and there is none on a first scan. The
 *      design's copy for that section is explicit about it — "6 signals raised
 *      over 90 days · none triaged · no baseline to compare against" — and its
 *      other rows name a policy ("CA01"), a date ("14 June") and a decision
 *      ("a 2024 decommission decision") that no check produces. The registry's
 *      drift metrics (`drift:ca-policy`, `security.secureScoreDriftCount`) are
 *      not among the stats this report resolves. There is nothing real to put
 *      there, so it is absent rather than approximated.
 *   2. "Self-Resolution Actions" is DROPPED. Its six bullets are remediation
 *      instructions keyed to Halden's specific numbers ("reduce 11 standing
 *      Global Administrators to 2"), and remediation is the Full Remediation
 *      Guide's job in this journey, not this report's.
 *
 * ── THE ONE HONEST GAP THIS REPORT DECLARES IN WORDS ─────────────────────────
 * "Conditional Access scoped to privileged roles" is a row the design asks for
 * that has NO check behind it — see `CA_PRIVILEGED_ROLES_GAP` for the full
 * reasoning and for why it is stated in prose rather than as a named check key.
 */

import type { JourneyPillarView, JourneyView, WirePillarStat } from "./journeyModel.ts";
import { blastRadiusRows } from "./copilotReadinessReport.ts";
import {
  UPGRADE_OPPORTUNITY_DETAIL,
  UPGRADE_OPPORTUNITY_HEADING,
  buildProvenance,
  buildRows,
  buildRowsFromStats,
  declaredGapBlock,
  findingsBlocks,
  gateRow,
  keyValuesBlock,
  narrativeBlocks,
  pillarTone,
  unavailableBlock,
  upgradeOpportunities,
  type LiveReportBlock,
  type LiveReportSection,
  type StatPick,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/**
 * `findingRows` and `findingsBlocks` were written here for #343 and now live in
 * `liveReportBlocks.ts`, shared with the four pillar reports #292 added. They
 * are re-exported unchanged so this module's contract with its renderer and its
 * tests is exactly what it was — the same treatment the honesty machinery got
 * when #343 extracted it out of `copilotReadinessReport.ts`.
 */
export { findingRows, findingsBlocks } from "./liveReportBlocks.ts";

/* ------------------------------------------------------------------ *
 * The wire shape — mirrors the api-server route's response
 * ------------------------------------------------------------------ */

/** This report's own three prose sections, in render order. */
export type SecurityPostureSectionKey = "summary" | "blastRadius" | "copilotImpact";

/**
 * The Security Posture narrative payload: the shared narrative shape plus the
 * extra real stats this route resolves that `war-room-pillars` does not carry.
 *
 * `stats` arrive in the SAME shape as a pillar card's, deliberately, so they go
 * through `buildRowsFromStats` — the same never-fabricate rule as every other
 * row — rather than through a second path that could classify an unavailable
 * value differently. Today that is exactly one stat: Microsoft Secure Score.
 */
export interface WireSecurityPosturePayload extends WireNarrativePayload {
  readonly stats?: readonly WirePillarStat[];
}

export type SecurityPostureSection = LiveReportSection;
export type SecurityPostureBlock = LiveReportBlock;

export interface SecurityPostureReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: { readonly eyebrow: string; readonly headline: string; readonly sub: string };
  readonly sections: readonly SecurityPostureSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Security Posture Summary
 * ------------------------------------------------------------------ */

/**
 * Microsoft Secure Score, from the narrative route's own `stats`.
 *
 * Not a `StatPick` because it belongs to no pillar card: `security.secureScore`
 * is a real registry metric over the real `security:secure-score` check, but it
 * is NOT one of `WAR_ROOM_PILLAR_STAT_SPECS`' 28 stats, so nothing puts it on
 * the `war-room-pillars` wire. `security-posture-narrative-generator.ts`
 * resolves it through the same `resolveMetric` path those stats use and sends
 * it down here — see that file's header for why it is not simply added to the
 * spec list (it would silently change the Copilot Readiness Report's own prose).
 */
const SUMMARY_EXTRA_PICKS: readonly { statId: string; label: string; caption: string }[] = [
  { statId: "security.secureScore", label: "Security maturity", caption: "Microsoft Secure Score" },
];

/**
 * The Summary's real metric rows, in the design's own order.
 *
 * Every one has a real check behind it and a real `WAR_ROOM_PILLAR_STAT_SPECS`
 * entry, so a tenant that ran the check gets a number and one that did not gets
 * a named gap. The design's fifth row, "Security drift", is deliberately absent
 * — see the header.
 */
const SUMMARY_PICKS: readonly StatPick[] = [
  { statId: "security.globalAdmins", pillar: "security", label: "Privileged accounts", caption: "global administrators" },
  { statId: "security.mfaRegistered", pillar: "security", label: "MFA registration", caption: "users registered for multi-factor authentication" },
  { statId: "security.legacyAuth", pillar: "security", label: "Legacy authentication", caption: "legacy protocol sign-ins" },
  { statId: "health.nonCompliantDevices", pillar: "health", label: "Device compliance", caption: "devices failing the compliance baseline" },
];

/**
 * The one row the design asks for that this platform cannot answer, declared in
 * words rather than fabricated or silently dropped.
 *
 * ── WHY IT IS PROSE AND NAMES NO CHECK KEY ───────────────────────────────────
 * The obvious move is an `unavailable` block naming a check. There is no honest
 * key to name. Three candidates exist and none of them answers the question:
 *
 *   identity:ca-policy-count            counts policies. A count says nothing
 *                                       about what any of them is scoped to,
 *                                       and it has no DASHBOARD_METRICS entry
 *                                       either — #441 is the record of what
 *                                       happens when that key reaches a reader:
 *                                       it printed as "not wired to a check in
 *                                       the catalogue" in a section about gaps
 *                                       in THEIR assessment, which is both
 *                                       wrong on its face and not their concern.
 *   security:conditional-access-failures counts failures, not scopes.
 *   drift:ca-policy                     counts changes, not scopes.
 *
 * So the gap is genuinely "no check this platform runs reads a policy's role
 * scope" — a fact about our coverage, not about this tenant's scan, and not one
 * that varies by customer. #441's rule is that a fault of OURS must not be
 * dressed up as a gap in the customer's data; stating it plainly, in its own
 * words, is what is left once you take that seriously.
 *
 * It renders unconditionally for exactly that reason: it is not a function of
 * what the scan returned, so there is no tenant for whom it becomes untrue.
 */
export const CA_PRIVILEGED_ROLES_GAP =
  "One line the security review would normally carry is deliberately not here: whether any Conditional Access policy is scoped specifically to your privileged roles. No check this assessment runs reads a policy's role scope — the checks behind this report count Conditional Access policies and count their failures, and neither answers that question. Its absence is a gap in what this platform measures today, and nothing here should be read as saying such a policy does or does not exist.";

/* ------------------------------------------------------------------ *
 * Section 4 — Device & Endpoint Compliance
 * ------------------------------------------------------------------ */

/**
 * The endpoint posture counts, minus the one the Summary already quotes.
 *
 * `health.nonCompliantDevices` is deliberately NOT repeated here: it is the
 * headline device figure and it leads the Summary, and the same number under
 * two headings reads as two findings.
 */
const DEVICE_PICKS: readonly StatPick[] = [
  { statId: "health.unencrypted", pillar: "health", label: "Device encryption", caption: "devices with no encryption reported" },
  { statId: "health.outdated", pillar: "health", label: "Operating system currency", caption: "devices on an outdated OS build" },
  { statId: "health.configDrift", pillar: "health", label: "Configuration profile alignment", caption: "devices drifted from their assigned profile" },
];

/* ------------------------------------------------------------------ *
 * Section 5 — Copilot Readiness Impact
 * ------------------------------------------------------------------ */

/**
 * This section has ONE real row, and it is the Gate itself.
 *
 * WHY NOT THE COPILOT CARD'S OWN STATS. `war-room-pillars` does carry a
 * `copilot` card (`copilot.exposure`, `copilot.riskyUsers`, …), but this
 * journey's `PILLAR_KEYS` are the six the Reveal draws — governance, security,
 * compliance, licensing, adoption, health — and `buildPillarViews` maps over
 * exactly those. The copilot card's stats therefore never reach `JourneyView`
 * at all, so picking them here would produce not a row and not even an honest
 * gap, but silence with no explanation.
 *
 * `copilot.exposure` is in any case the SAME metric as `security.blastRadius`
 * (`copilot.overshareExposureCount`), already stated in full one section up —
 * so the only figure genuinely lost is the risky-user count, which this report
 * does not claim. The section carries its real prose, the real Gate row below,
 * and nothing it cannot source.
 */
const COPILOT_IMPACT_PICKS: readonly StatPick[] = [];

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the security pillar's own real headline and score.
 *
 * The design's version states a specific worst finding ("4 unprotected Global
 * Administrator accounts") and its consequence. The real version states the
 * pillar's real lead finding — which is either a real `severity_rules` label, or
 * `CLEAN_PILLAR_HEADLINE` for a pillar genuinely evaluated clean (#399), or
 * null for a pillar nothing scored. It never asserts a worst finding for a
 * pillar that was not evaluated, and never writes the consequence sentence,
 * which on the design's card is a claim about Halden specifically.
 */
export function buildVerdict(security: JourneyPillarView | undefined): SecurityPostureReport["verdict"] {
  const score = security?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Security posture",
      headline: "No security score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Security pillar, so there is no posture score and no worst finding to lead with. What follows is what the scan did measure.",
    };
  }
  const headline = security?.headline;
  return {
    eyebrow: headline ? "Worst finding" : "Security posture",
    headline: headline ?? `Security scores ${score} of 100`,
    sub: `The Security pillar scores ${score} of 100 on this tenant's last scan. Every figure below is read directly from your own tenant; nothing here is a benchmark or an estimate.`,
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<SecurityPostureSectionKey, string> = {
  summary: "Security Posture Summary",
  blastRadius: "Data Exposure & Blast Radius",
  copilotImpact: "Copilot Readiness Impact",
};

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 *
 * The Secure Score row therefore only appears once the narrative payload has
 * landed — it rides that route. Until then the Summary shows the four rows it
 * has, which is the same honest degradation every other absent figure gets.
 */
export function buildSecurityPostureReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireSecurityPosturePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): SecurityPostureReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const security = pillars.find((p) => p.key === "security");
  const health = pillars.find((p) => p.key === "health");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );
  const prose = (key: SecurityPostureSectionKey): SecurityPostureBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  const sections: SecurityPostureSection[] = [];

  // ── Security Posture Summary ───────────────────────────────────────────────
  //
  // Secure Score leads, because it is Microsoft's own read on the tenant and the
  // one figure here that is not ours. It takes the Security pillar's band for
  // the same reason every other row takes its pillar's — see liveReportBlocks.
  const secureScore = buildRowsFromStats(
    narrative?.stats ?? [],
    SUMMARY_EXTRA_PICKS,
    pillarTone(security),
  );
  const summary = buildRows(pillars, SUMMARY_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.summary,
    blocks: [
      ...prose("summary"),
      ...keyValuesBlock([...secureScore.rows, ...summary.rows]),
      ...unavailableBlock(
        "Figures behind this summary that this tenant's scan does not carry:",
        [...secureScore.missing, ...summary.missing],
      ),
      ...declaredGapBlock(CA_PRIVILEGED_ROLES_GAP),
    ],
  });

  // ── Identity & Access Risks (real findings) ────────────────────────────────
  sections.push({
    heading: "Identity & Access Risks",
    blocks: findingsBlocks(
      security,
      "The Security pillar was evaluated on this tenant's last scan and returned no critical or warning finding. That is a real result, not an empty section.",
      "No rule that feeds the Security pillar was evaluated on this tenant's last scan, so no identity or access finding can be reported either way.",
    ),
  });

  // ── Data Exposure & Blast Radius ───────────────────────────────────────────
  //
  // The rows come from `blastRadiusRows` — the Copilot Readiness Report's own
  // function, called rather than copied, so the two reports cannot quote
  // different blast radii for the same tenant on the same day. It is already the
  // real `copilot.overshareExposureCount` the Reveal's Security pillar shows.
  const blast = blastRadiusRows(pillars);
  sections.push({
    heading: SECTION_HEADINGS.blastRadius,
    blocks: [
      ...prose("blastRadius"),
      ...keyValuesBlock(blast.rows),
      ...unavailableBlock(
        "The exposure figures behind the blast-radius line are not available for this tenant:",
        blast.missing,
      ),
    ],
  });

  // ── Device & Endpoint Compliance ───────────────────────────────────────────
  const devices = buildRows(pillars, DEVICE_PICKS);
  sections.push({
    heading: "Device & Endpoint Compliance",
    blocks: [
      ...keyValuesBlock(devices.rows),
      ...findingsBlocks(
        health,
        "The Health pillar was evaluated on this tenant's last scan and returned no critical or warning finding against your endpoints.",
        "No rule that feeds the Health pillar was evaluated on this tenant's last scan, so no device or endpoint finding can be reported either way.",
      ),
      ...unavailableBlock(
        "Endpoint figures this tenant's scan does not carry:",
        devices.missing,
      ),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // report's: several checks are quoted by both a pure-data section and the
  // narrative's grounding, so per-section blocks would repeat one licence fact
  // in several places, and a category the reader is meant to tell apart from
  // the severity ladder is easier to tell apart when it is one place.
  const copilotImpact = buildRows(pillars, COPILOT_IMPACT_PICKS);
  const licenceGaps = upgradeOpportunities([
    ...secureScore.missing,
    ...summary.missing,
    ...blast.missing,
    ...devices.missing,
    ...copilotImpact.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ] as readonly UnavailableCheck[]);
  if (licenceGaps.length) {
    sections.push({
      heading: UPGRADE_OPPORTUNITY_HEADING,
      blocks: [
        { kind: "upgradeOpportunity", detail: UPGRADE_OPPORTUNITY_DETAIL, items: licenceGaps },
      ],
    });
  }

  // ── Copilot Readiness Impact ───────────────────────────────────────────────
  sections.push({
    heading: SECTION_HEADINGS.copilotImpact,
    blocks: [
      ...prose("copilotImpact"),
      ...keyValuesBlock([...gateRow(view), ...copilotImpact.rows]),
      ...unavailableBlock(
        "Copilot-facing figures this tenant's scan does not carry:",
        copilotImpact.missing,
      ),
    ],
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  //
  // Two sentences at most, and the second only when there is a real score to
  // write it from. Neither predicts a post-remediation figure: this journey
  // quotes none on this path, so any gain stated here would be invented.
  const closing: string[] = [
    "Copilot inherits your identity model rather than replacing it. Every permission, every standing admin and every over-shared item is something Copilot can reach on a user's behalf, which is why security posture is a Copilot question and not only a security one.",
  ];
  if (typeof security?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Security pillar scores ${security.score} of 100 on this scan. Each finding above is a specific, named result from a specific check — there is nothing in this report that is not read from your own tenant.`,
    );
  }

  return {
    kicker: "Security posture & blast radius",
    headline:
      typeof security?.score === "number"
        ? `Identity is the first thing Copilot inherits at ${view.tenant.name}`
        : `Security posture for ${view.tenant.name}`,
    standfirst:
      "This report evaluates your tenant's security posture across identity, access, data exposure and device compliance. Every finding traces to security telemetry surfaced in your own assessment, and every one of them affects what Microsoft Copilot would be able to reach.",
    verdict: buildVerdict(security),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  SUMMARY_PICKS,
  SUMMARY_EXTRA_PICKS,
  DEVICE_PICKS,
  COPILOT_IMPACT_PICKS,
  SECTION_HEADINGS,
  gateRow,
};
