/**
 * pillarOperationalHealth.ts — the real Microsoft 365 Operational Health &
 * Service Integrity Report, as data (#292).
 *
 * The live counterpart to `previewDocumentBodies.ts`'s `OPERATIONAL_HEALTH`,
 * built from one real tenant's own `war-room-pillars` payload plus
 * `/portal/assessment/operational-health-narrative` instead of from Halden
 * Materials' worked example.
 *
 * A pure `.ts` for the same two reasons as its siblings: `node --test` cannot
 * load `.tsx`, so the rules below are testable; and the platform's
 * no-hardcoding rule keeps counts out of `.tsx`. Every number here arrives from
 * the wire; none is written down. The honesty machinery is
 * `liveReportBlocks.ts`, shared verbatim.
 *
 * ── THE FOUR REAL FIGURES THIS REPORT HAS ────────────────────────────────────
 * `WAR_ROOM_PILLAR_STAT_SPECS.health` is four stats, all real Intune posture
 * counts: non-compliant devices (`intune:non-compliant-devices`), device
 * configuration drift (`intune:config-drift`), unencrypted devices
 * (`intune:unencrypted-devices`) and outdated OS builds
 * (`intune:outdated-devices`).
 *
 * Three of these also appear in the Security Posture & Blast Radius Report's
 * "Device & Endpoint Compliance" section, deliberately and without a
 * reconciliation step: both reports read the SAME wire stat ids off the SAME
 * `war-room-pillars` payload, so they cannot disagree about one tenant on one
 * day. They are stated here under an operational heading rather than a security
 * one because that is the question this report asks of them.
 *
 * ── THE SECTION THAT MIGHT HAVE BEEN REAL, AND IS NOT ────────────────────────
 * "Service Availability & Reliability" — per-workload uptime, per-workload
 * status, Microsoft-side incident history — was checked before being dropped,
 * because two real-looking check keys exist. Both were run down and neither
 * backs it. See `SERVICE_AVAILABILITY_GAP` for the full audit; the short version
 * is that `m365:service-health` is a real `monitor_checks` row that is read live
 * for Shane's OWN tenant by the public status page and never aggregated
 * per-customer, `m365:message-center` is a change-announcement feed rather than
 * an availability record, and the one registry metric that would consume either
 * (`serviceHealth.uptimeStatus`) carries the sourceKey
 * `not_collected:service-health-overview` and the status `not_collected` — a
 * phantom key of exactly the kind #441 exists to stop reaching a reader.
 *
 * ── WHAT ELSE THIS REPORT DROPS FROM THE DESIGN, AND WHY ─────────────────────
 *   1. "Health Drift & Violations" is DROPPED entirely, and so is the Summary's
 *      "Health trend" row. Drift is a diff against a recorded baseline and there
 *      is none on a first scan — the same reasoning as every report before it.
 *      Its five rows name per-workload change counts, "two device compliance
 *      policies relaxed in 90 days", legacy protocols "re-enabled after the 2024
 *      decommission decision" and "37 signals over 90 days · none triaged", none
 *      of which has a producer.
 *      `intune:config-drift` is NOT that: it is a real point-in-time count of
 *      devices sitting away from their assigned profile, and it is stated below
 *      under its own honest label rather than as evidence of movement over time.
 *   2. "Tenant Hygiene & Operational Cleanliness" is DROPPED. Orphaned channels,
 *      ownerless groups, inactive sites, SharePoint quota consumption and
 *      OneDrive sync-error counts are five separate figures and this platform
 *      produces none of them.
 *   3. The Summary's "Configuration correctness" row ("11 misconfigurations
 *      across four workloads · no baseline on record") is DROPPED: nothing
 *      counts misconfigurations across workloads, and the second clause is the
 *      baseline claim from (1).
 *   4. "Self-Resolution Actions" is DROPPED, on #343's precedent: remediation is
 *      the Full Remediation Guide's job in this journey, not this report's. It
 *      is also the section the design MCP's 256 KiB read cap truncated, so this
 *      file could not have reproduced it faithfully even had it belonged here.
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
  unavailableBlock,
  upgradeOpportunities,
  upgradeOpportunityCallToAction,
  type LiveReportBlock,
  type LiveReportSection,
  type StatPick,
  type UnavailableCheck,
  type WireNarrativePayload,
  type WireNarrativeSection,
} from "./liveReportBlocks.ts";

/** This report's own three prose sections, in render order. */
export type OperationalHealthSectionKey = "summary" | "configuration" | "copilotImpact";

/**
 * The Operational Health narrative payload. Plain `WireNarrativePayload`: every
 * figure this report shows is already on the `war-room-pillars` wire, so unlike
 * the Security Posture report there is nothing for the route to resolve on the
 * side — and in particular nothing resolves a service-availability figure,
 * because none exists to resolve.
 */
export type WireOperationalHealthPayload = WireNarrativePayload;

export type OperationalHealthSection = LiveReportSection;
export type OperationalHealthBlock = LiveReportBlock;

export interface OperationalHealthReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: { readonly eyebrow: string; readonly headline: string; readonly sub: string };
  readonly sections: readonly OperationalHealthSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
}

/* ------------------------------------------------------------------ *
 * Section 1 — Health Posture Summary
 * ------------------------------------------------------------------ */

/**
 * The endpoint posture counts that describe the estate's operational state.
 *
 * `health.configDrift` is deliberately NOT here: it leads the Configuration &
 * Service Health section below, where the prose that explains it lives, and the
 * same number under two headings reads as two findings — the same call
 * `pillarSecurityPosture.ts` makes about its own headline device figure.
 */
const SUMMARY_PICKS: readonly StatPick[] = [
  { statId: "health.nonCompliantDevices", pillar: "health", label: "Device compliance", caption: "enrolled devices failing your own compliance baseline" },
  { statId: "health.unencrypted", pillar: "health", label: "Device encryption", caption: "enrolled devices reporting no disk encryption" },
  { statId: "health.outdated", pillar: "health", label: "Operating system currency", caption: "devices on an operating-system build behind your baseline" },
];

/** The one real configuration figure: devices away from their assigned profile. */
const CONFIGURATION_PICKS: readonly StatPick[] = [
  { statId: "health.configDrift", pillar: "health", label: "Configuration profile alignment", caption: "devices drifted from the configuration profile assigned to them" },
];

/**
 * The design's "Service Availability & Reliability" section, declared in words
 * after the two candidate producers were run down and neither held.
 *
 * ── THE AUDIT, WRITTEN DOWN SO IT IS NOT REPEATED ────────────────────────────
 * Unlike most gaps in this set, this one had real-looking candidates. Both were
 * checked against the repo:
 *
 *   m365:service-health   A REAL `monitor_checks` row over
 *                         /admin/serviceAnnouncement/healthOverviews — but its
 *                         own seeding migration states outright that it is read
 *                         live at request time by `public-status.ts` for Shane's
 *                         own tenant and "not aggregated by the generic
 *                         monitor-executor pipeline". Its `mapping` and
 *                         `severity_rules` are both empty, so it writes no
 *                         `tenant_monitor_profiles` value and raises no finding
 *                         for any customer.
 *   m365:message-center   Real, and it does persist per-tenant rows — but they
 *                         are Microsoft's change ANNOUNCEMENTS (roadmap items,
 *                         deprecations, action-required notices), not incidents
 *                         and not uptime. Counting them would produce a number
 *                         under a caption that means something else.
 *   serviceHealth.uptimeStatus
 *                         The only registry metric in this area. Its sourceKey
 *                         is `not_collected:service-health-overview` and its
 *                         status is `not_collected` — a key naming nothing, of
 *                         exactly the kind #441 found printed to a paying
 *                         customer. It resolves for no tenant and never has.
 *
 * So the honest answer is that this platform holds no per-tenant availability
 * record at all: no uptime percentage, no per-workload health state, no incident
 * history and no outage count. The design's "99.94% · two Microsoft-side
 * degradation events" is Halden's, and the nearest real thing is a status page
 * about a different tenant.
 *
 * It renders unconditionally: it is a fact about our coverage, not about this
 * tenant's scan, so there is no tenant for whom it becomes untrue.
 */
export const SERVICE_AVAILABILITY_GAP =
  "The section an operational review would normally open with — per-workload availability, uptime over the last thirty days, and the Microsoft-side incidents behind any dip — is deliberately not here. This assessment holds no availability record for your tenant: it does not measure uptime for Exchange, SharePoint, Teams or OneDrive, it does not read your service incident history, and it does not count outages. What it reads is your tenant's configuration, which is a different question. Nothing below should be taken as saying your workloads were available or that they were not — this scan did not look, and no figure has been estimated in place of looking.";

/* ------------------------------------------------------------------ *
 * The verdict
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the health pillar's own real headline and score.
 *
 * The design's version leads with the drift claim dropped in the header ("37
 * configuration changes. None reviewed.") and a consequence about baselines. The
 * real version states the pillar's real lead finding — a real `severity_rules`
 * label, `CLEAN_PILLAR_HEADLINE` for a pillar genuinely evaluated clean (#399),
 * or nothing for a pillar nothing scored.
 *
 * Note the pillar this scores is the engine's `architecture` pillar under the
 * War Room's `health` name — `WAR_ROOM_ENGINE_PILLAR` is where that single
 * translation lives, and it is the same score the Reveal's Health satellite
 * shows.
 */
export function buildVerdict(health: JourneyPillarView | undefined): OperationalHealthReport["verdict"] {
  const score = health?.score ?? null;
  if (score === null) {
    return {
      eyebrow: "Operational health",
      headline: "No operational health score yet",
      sub: "This tenant's scan has not yet evaluated a rule that feeds the Health pillar, so there is no posture score and no worst finding to lead with. What follows is what the scan did measure.",
    };
  }
  const headline = health?.headline;
  return {
    eyebrow: headline ? "Worst finding" : "Operational health",
    headline: headline ?? `Operational health scores ${score} of 100`,
    sub: `The Health pillar scores ${score} of 100 on this tenant's last scan. Every figure below is read directly from your own tenant's device management; nothing here is a benchmark, an availability figure or an estimate.`,
  };
}

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

const SECTION_HEADINGS: Record<OperationalHealthSectionKey, string> = {
  summary: "Health Posture Summary",
  configuration: "Configuration & Service Health",
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
export function buildOperationalHealthReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireOperationalHealthPayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): OperationalHealthReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const health = pillars.find((p) => p.key === "health");

  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );
  const prose = (key: OperationalHealthSectionKey): OperationalHealthBlock[] =>
    narrativeBlocks(narrativeByKey.get(key), narrativeSettled);

  const sections: OperationalHealthSection[] = [];

  // ── Health Posture Summary ─────────────────────────────────────────────────
  const summary = buildRows(pillars, SUMMARY_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.summary,
    blocks: [
      ...prose("summary"),
      ...keyValuesBlock(summary.rows),
      ...unavailableBlock(
        "Figures behind this summary that this tenant's scan does not carry:",
        summary.missing,
      ),
      ...declaredGapBlock(SERVICE_AVAILABILITY_GAP),
    ],
  });

  // ── Configuration & Service Health ─────────────────────────────────────────
  const configuration = buildRows(pillars, CONFIGURATION_PICKS);
  sections.push({
    heading: SECTION_HEADINGS.configuration,
    blocks: [
      ...prose("configuration"),
      ...keyValuesBlock(configuration.rows),
      ...findingsBlocks(
        health,
        "The Health pillar was evaluated on this tenant's last scan and returned no critical or warning finding about device configuration, compliance, currency or service health. That is a real result, not an empty section.",
        "No rule that feeds the Health pillar was evaluated on this tenant's last scan, so no configuration, device or service-health finding can be reported either way.",
      ),
      ...unavailableBlock(
        "Configuration and service-health figures this tenant's scan does not carry:",
        configuration.missing,
      ),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document, on the same reasoning as its sibling
  // reports'.
  const licenceGaps = upgradeOpportunities([
    ...summary.missing,
    ...configuration.missing,
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
  // write it from. Neither claims the score will decay, that remediation "undoes
  // itself inside two quarters", or that health contributes a specific number of
  // available points — the design's closing does all three from Halden's data,
  // and this journey quotes no such projection.
  const closing: string[] = [
    "Operational health is not what clears the Copilot Gate; it is what decides whether clearing it holds. A device outside your compliance baseline, one without encryption, or one on an operating-system build you no longer support is an endpoint Copilot will happily work through, whatever the tenant-level controls say.",
  ];
  if (typeof health?.score === "number") {
    closing.push(
      `${view.tenant.name}'s Health pillar scores ${health.score} of 100 on this scan. Each figure above is a specific, named result from a specific device-management check — there is nothing in this report that is not read from your own tenant, and nothing in it is an availability claim.`,
    );
  }

  return {
    kicker: "Operational health & service integrity",
    headline:
      typeof health?.score === "number"
        ? `The score ${view.tenant.name} earns is only ever the score it keeps`
        : `Operational health for ${view.tenant.name}`,
    standfirst:
      "This report evaluates the operational health of your tenant's managed endpoints and services — device compliance against your own baseline, encryption, operating-system currency, configuration alignment and any service-health finding your scan surfaced. It reports no service availability or uptime figure; see the summary below for why that section is deliberately absent.",
    verdict: buildVerdict(health),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  SUMMARY_PICKS,
  CONFIGURATION_PICKS,
  SECTION_HEADINGS,
};
