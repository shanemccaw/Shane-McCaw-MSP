/**
 * liveReportFixtures.ts — the tenant builders every live-rendered pillar
 * report's suite is written against (#292).
 *
 * NOT PRODUCTION CODE, and deliberately not a `.test.ts`: `node --test` treats
 * every `*.test.ts` under `src` as a suite, so a file of shared builders named
 * that way would be reported as a suite with no assertions in it. It ships in
 * the source tree because the four suites that import it are there too, and it
 * is imported by nothing else — a grep for its name finds only tests.
 *
 * WHY SHARED. `pillarSecurityPosture.test.ts` and `copilotReadinessReport.test.ts`
 * each carry their own `stat` / `pillar` / `view` / `withPillar` helpers, which
 * was fine at two and is not at six. More importantly the four suites #292 adds
 * must assert the same never-fabricate property — a THIN tenant produces a
 * SHORTER report rather than a fabricated one — and they can only be compared
 * with each other if "thin" and "real" mean the same thing in all four.
 *
 * The two existing suites are deliberately not repointed at this: they pass,
 * they are the record of what #409 and #343 asserted, and rewriting a green test
 * to share a fixture is how a suite quietly stops testing what it used to.
 */

import { PILLARS, PILLAR_KEYS, type PillarKey } from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView, WirePillarStat } from "./journeyModel.ts";

export function stat(overrides: Partial<WirePillarStat> & { id: string }): WirePillarStat {
  return {
    label: "things",
    unit: "count",
    value: null,
    checkKey: `check:${overrides.id}`,
    ...overrides,
  };
}

export function pillar(key: PillarKey, overrides: Partial<JourneyPillarView> = {}): JourneyPillarView {
  return {
    key,
    label: PILLARS[key].label,
    primary: PILLARS[key].primary,
    accent: PILLARS[key].accent,
    score: null,
    headline: null,
    chips: [],
    stats: [],
    findings: [],
    satelliteFinding: null,
    trend: null,
    criticalCount: 0,
    warningCount: 0,
    ...overrides,
  };
}

/** An empty tenant: every pillar present, nothing scored, no stat, no finding. */
export function view(overrides: Partial<JourneyView> = {}): JourneyView {
  return {
    tenant: { name: "Contoso", seatCount: null, scannedOn: "6 August 2026" },
    readinessScore: 41,
    remediatedScore: null,
    pillars: PILLAR_KEYS.map((k) => pillar(k)),
    generation: { ready: 0, total: 0, allReady: false, documents: [] },
    isPreview: false,
    ...overrides,
  };
}

export function withPillar(
  v: JourneyView,
  key: PillarKey,
  overrides: Partial<JourneyPillarView>,
): JourneyView {
  return { ...v, pillars: v.pillars.map((p) => (p.key === key ? { ...p, ...overrides } : p)) };
}

/**
 * The real stat ids and check keys each pillar card genuinely carries, verbatim
 * from api-server's `WAR_ROOM_PILLAR_STAT_SPECS`.
 *
 * Written out rather than invented so a suite that passes is evidence about the
 * real payload: if a spec's stat id or its metric's `sourceKey` changes, these
 * fixtures stop matching what the report picks, and the suite fails rather than
 * quietly asserting against a shape the wire no longer sends.
 */
export const REAL_GOVERNANCE_STATS: readonly WirePillarStat[] = [
  stat({ id: "governance.sites", label: "sites inventoried", value: 1847, checkKey: "compliance:sharepoint-sites" }),
  stat({ id: "governance.overshared", label: "overshared sites", value: 212, checkKey: "compliance:overshared-sites" }),
  stat({ id: "governance.exposure", label: "items over-exposed", value: 214806, checkKey: "copilot:overshare-exposure" }),
  stat({ id: "governance.publicChannels", label: "public channels", value: 61, checkKey: "compliance:public-channels" }),
];

export const REAL_COMPLIANCE_STATS: readonly WirePillarStat[] = [
  stat({ id: "compliance.missingLabels", label: "missing sensitivity labels", value: 40480, checkKey: "compliance:missing-labels" }),
  stat({ id: "compliance.retentionDrift", label: "retention policy drift", value: 184, checkKey: "compliance:retention-drift" }),
  stat({ id: "compliance.weakDlp", label: "weak DLP policies", value: 3, checkKey: "compliance:weak-dlp-policies" }),
  stat({ id: "compliance.guests", label: "guest users", value: 31, checkKey: "compliance:guest-users" }),
];

/**
 * The three seat figures share ONE check key, and a real `cost:*` one at that:
 * `resolveSeatFigures` reports whichever `/subscribedSkus` check most recently
 * collected for the tenant, not a `licensing:*` key — see
 * `license-waste-source.ts`, whose header lists the seven real `cost:*` checks
 * and records that the registry's own declared source
 * (`cost:license-waste-estimate`) does not exist in `monitor_checks` at all.
 */
export const REAL_LICENSING_STATS: readonly WirePillarStat[] = [
  stat({ id: "licensing.provisioned", label: "paid seats provisioned", value: 6180, checkKey: "cost:license-count-by-sku" }),
  stat({ id: "licensing.unassigned", label: "paid, unassigned", value: 1308, checkKey: "cost:license-count-by-sku" }),
  stat({ id: "licensing.annualWaste", label: "annual waste", unit: "currency", value: 18400, checkKey: "cost:license-count-by-sku" }),
  stat({ id: "licensing.inactive", label: "inactive licences", value: 25, checkKey: "licensing:inactive-user-licenses" }),
];

export const REAL_HEALTH_STATS: readonly WirePillarStat[] = [
  stat({ id: "health.nonCompliantDevices", label: "non-compliant devices", value: 312, checkKey: "intune:non-compliant-devices" }),
  stat({ id: "health.configDrift", label: "device config drift", value: 12, checkKey: "intune:config-drift" }),
  stat({ id: "health.unencrypted", label: "unencrypted devices", value: 61, checkKey: "intune:unencrypted-devices" }),
  stat({ id: "health.outdated", label: "outdated OS devices", value: 34, checkKey: "intune:outdated-devices" }),
];

/**
 * Every string the design's worked example ("Halden Materials") carries that
 * must never appear in a live report, whatever the tenant.
 *
 * Each is a real value from `previewDocumentBodies.ts` — a named tenant, a named
 * department, a named persona, a named policy, a date, and figures the platform
 * has no producer for. A live report containing any of them has inherited copy
 * rather than read data.
 *
 * "NASA" is deliberately NOT on this list. It is not a Halden value: it is the
 * provenance of Shane's own governance framework, kept in the Governance report
 * on his say-so (2026-08-06). What that report must not carry is the SCORE the
 * design attaches to it, which is why "4 of 11" is on the list and the framework's
 * name is not.
 */
export const FIXTURE_LEAKS: readonly string[] = [
  "Halden",
  "Finance",
  "Field Services",
  "Operations",
  "Bid Manager",
  "Legal Counsel",
  "Plant Supervisor",
  "14 June",
  "Safe Links",
  "4 of 11",
  "2,940",
  "1,240",
  "99.94",
  "$1,533",
  "$27,600",
  "$9,200",
];
