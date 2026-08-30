/**
 * operational-health-narrative-generator.ts
 *
 * The three AI-written prose sections of the Microsoft 365 Operational Health &
 * Service Integrity Report (#292) — the Health Posture Summary's opening
 * paragraph, the Configuration Correctness section, and the Copilot Readiness
 * Impact section's connection to the Gate score.
 *
 * SAME PATTERN AS ITS PREDECESSORS, DELIBERATELY. The loop is
 * `pillar-report-narrative.ts` and the never-fabricate machinery under it is
 * `narrative-grounding.ts`; what is declared HERE is only what makes this the
 * Operational Health report.
 *
 * NO METRIC IS RESOLVED ON THE SIDE. Every figure this report shows is already
 * on the `/portal/pillars` wire — the health card's four Intune posture counts
 * (non-compliant devices, configuration drift, unencrypted devices, outdated OS
 * builds) are the whole of it.
 *
 * ── THE SERVICE-AVAILABILITY QUESTION, ANSWERED ──────────────────────────────
 * #292 held this report's availability content open pending confirmation that
 * real time-series health data exists, with the standing instruction that the
 * honest fallback is to omit it. It was checked for this issue and the answer is
 * NO, on three counts:
 *
 *   m365:service-health   A REAL `monitor_checks` row over
 *                         /admin/serviceAnnouncement/healthOverviews — but its
 *                         own seeding migration states outright that it is read
 *                         live at request time by `public-status.ts` for SHANE'S
 *                         OWN tenant and is "not aggregated by the generic
 *                         monitor-executor pipeline". Its `mapping` and
 *                         `severity_rules` are both empty, so it writes no
 *                         `tenant_monitor_profiles` value and raises no finding
 *                         for any customer.
 *   m365:message-center   Real, and it does persist per-tenant rows — but they
 *                         are Microsoft's change ANNOUNCEMENTS (roadmap items,
 *                         deprecations, action-required notices), not incidents
 *                         and not uptime.
 *   serviceHealth.uptimeStatus
 *                         The only registry metric in the area. Its sourceKey is
 *                         `not_collected:service-health-overview` and its status
 *                         is `not_collected` — a key naming nothing, of exactly
 *                         the kind #441 found printed to a paying customer.
 *
 * So there is no per-tenant availability record at all: no uptime percentage, no
 * per-workload health state, no incident history, no outage count. The section
 * is declared absent to the reader in words (`SERVICE_AVAILABILITY_GAP` in
 * `pillarOperationalHealth.ts`), and the prompts below carry an explicit
 * prohibition on availability claims — which matters more here than any other
 * report in the set, because the temptation is in the report's own title rather
 * than in the facts it is handed.
 *
 * WHAT ELSE THIS REPORT DROPS, AND WHY
 * ------------------------------------
 * "Health Drift & Violations" and the Summary's "Health trend" row are absent on
 * the standing reasoning: drift is a diff against a recorded baseline and there
 * is none on a first scan. `intune:config-drift` is NOT that — it is a real
 * point-in-time count of devices sitting away from their assigned profile, and
 * the prompts say so explicitly so the model cannot narrate it as a change log.
 * "Tenant Hygiene & Operational Cleanliness" is absent because orphaned
 * channels, ownerless groups, inactive sites, storage quota and OneDrive
 * sync-error counts are five separate figures this platform produces none of.
 */

import {
  OPERATIONAL_HEALTH_CONFIGURATION_PROMPT,
  OPERATIONAL_HEALTH_COPILOT_IMPACT_PROMPT,
  OPERATIONAL_HEALTH_SUMMARY_PROMPT,
} from "./operational-health-prompts.ts";
import {
  generatePillarReportNarrative,
  type PillarReportAttribution,
  type PillarReportNarrativeResult,
  type PillarReportSpec,
} from "./pillar-report-narrative.ts";

/** The three prose sections, in the order the report renders them. */
export const OPERATIONAL_HEALTH_NARRATIVE_SECTIONS = ["summary", "configuration", "copilotImpact"] as const;
export type OperationalHealthSectionKey = (typeof OPERATIONAL_HEALTH_NARRATIVE_SECTIONS)[number];

/**
 * Which pillars ground which section, and the rest of what makes this report
 * itself.
 *
 * `health` here is the War Room pillar name for the engine's `architecture`
 * pillar — `ENGINE_PILLAR_FOR_DISPLAY_PILLAR` is where that single translation lives, and
 * the card this grounds from is the same one the Reveal's Health satellite
 * shows.
 *
 * `configuration` reads security alongside health because the two genuinely
 * overlap on the endpoint: a device outside the compliance baseline is a health
 * fact and an access fact at once, and the security card is where the identity
 * side of that lives. `summary` deliberately does NOT — it states what the
 * endpoint estate IS, and a security figure in that paragraph would be a figure
 * the table beside it does not show.
 *
 * `copilotImpact` is the only section given the Gate, because it is the only one
 * whose prompt body carries `{{gateBlock}}`.
 */
export const OPERATIONAL_HEALTH_SPEC: PillarReportSpec = {
  feature: "operational_health",
  logName: "operational-health-narrative",
  sections: [
    {
      key: "summary",
      heading: "Health Posture Summary",
      pillars: ["health"],
      promptKey: "assessment-operational-health-summary",
      promptBody: OPERATIONAL_HEALTH_SUMMARY_PROMPT,
    },
    {
      key: "configuration",
      heading: "Configuration Correctness",
      pillars: ["health", "security"],
      promptKey: "assessment-operational-health-configuration",
      promptBody: OPERATIONAL_HEALTH_CONFIGURATION_PROMPT,
    },
    {
      key: "copilotImpact",
      heading: "Copilot Readiness Impact",
      pillars: ["health", "copilot"],
      promptKey: "assessment-operational-health-copilot-impact",
      promptBody: OPERATIONAL_HEALTH_COPILOT_IMPACT_PROMPT,
      withGate: true,
    },
  ],
};

export type OperationalHealthNarrativeResult = PillarReportNarrativeResult;

/**
 * Generate all three prose sections for one real customer.
 *
 * Never throws for a thin or empty tenant: that is a real state with a real,
 * honest rendering. It throws only if the underlying real data cannot be read at
 * all, which the route surfaces as an error rather than an empty report.
 */
export function generateOperationalHealthNarrative(params: {
  readonly customerId: number;
  readonly tenantName: string;
  readonly attribution: PillarReportAttribution;
}): Promise<OperationalHealthNarrativeResult> {
  return generatePillarReportNarrative(OPERATIONAL_HEALTH_SPEC, params);
}

/** Exported for tests — the section specs ARE the grounding contract. */
export const __testables = { OPERATIONAL_HEALTH_SPEC };
