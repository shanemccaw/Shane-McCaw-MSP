/**
 * war-room-pillar-stats.ts
 *
 * Real backing for the War Room's seven completed-scan pillar summary cards
 * (#320, parent epic #302) — each card's SCORE and its four STAT CALLOUTS.
 *
 * Before this, all of it was the hardcoded `HERO_PHASE` literal in msp-portal's
 * `warRoomData.ts`: seven fixed scores (34/38/54/34/58/41/34) and 28 fixed stat
 * numbers invented for the fictional "Northline Health" demo tenant — "1,204
 * sites inventoried", "$847,608 annual waste", "214,806 files reachable", and so
 * on. They were identical for every customer and touched no scan.
 *
 * ── NO NEW SCORING FORMULA ────────────────────────────────────────────────────
 * Shane's standing instruction, carried over from #245. The seven scores here
 * are the platform's existing, already-live health scoring path, exactly as the
 * Copilot Assessment telemetry panel consumes it:
 *
 *   calculateArchitectureHealthScore(customerId)   (health-engine.ts)
 *   fetchEvaluableSignalKeys(rules)                (pillar-coverage.ts)
 *   buildPillarViews(...)                          (telemetry-comparison.ts)
 *     └─ computePillarDisplayScore                 (health-display.ts)
 *
 * `buildPillarViews` is imported rather than re-derived so the War Room card and
 * the telemetry radar can never disagree about the same pillar on the same
 * tenant.
 *
 * ── The pillar name mismatch, resolved once, here ─────────────────────────────
 * The War Room names its fifth pillar `health`; the engine calls the same thing
 * `architecture` (`HEALTH_PILLARS` / `RADAR_PILLARS`). Every other key matches
 * 1:1. `WAR_ROOM_ENGINE_PILLAR` below is that translation, and it is the only
 * place it exists — see the table for why `health → architecture` is the honest
 * mapping rather than a convenience.
 *
 * ── Where the 28 stat numbers come from ───────────────────────────────────────
 * Each stat resolves through ONE of three real sources, all pre-existing:
 *
 *   metric        → `resolveMetric` (dashboard-resolvers.ts) over a real
 *                   `DASHBOARD_METRICS` entry, i.e. the latest
 *                   `tenant_monitor_profiles` row for that metric's real
 *                   `monitor_checks` key. That resolver already refuses to
 *                   fabricate: it distinguishes `no_data`, `unknown_check_key`
 *                   and `license_gap` from a real zero, and this module passes
 *                   that distinction straight through.
 *   licenseSeats  → `resolvePaidSeatFigures` + `computeSkuCostBreakdown`, the
 *                   real `/subscribedSkus` arithmetic (seats bought − seats
 *                   assigned) restricted to SKUs with a real price in
 *                   `sku_price_reference`. This is the one source that can answer
 *                   "seats provisioned" and "annual waste" honestly; see
 *                   license-waste-source.ts for the three traps it exists to
 *                   avoid — the third (#333) being Microsoft's free/viral SKUs,
 *                   whose sentinel `prepaidUnits.enabled` capacities are not
 *                   seats anyone bought.
 *   pillarScore   → the pillar's own real display score (Copilot readiness only,
 *                   whose headline stat IS the readiness percentage).
 *
 * ── Fake stats with NO real producer, named rather than faked ─────────────────
 * Nine of the original 28 asked for a number nothing in this platform collects.
 * They are NOT approximated and NOT carried over; each spec below records what
 * it replaced in `replaces`, and the ones with no real sibling at all are listed
 * in `WAR_ROOM_UNPRODUCIBLE_STATS` so the gap stays visible instead of quietly
 * disappearing:
 *
 *   "files reachable" / "files in blast radius"  — no check counts files; the
 *       real over-exposure count (`copilot:overshare-exposure`) counts ITEMS and
 *       is used under its own honest label.
 *   "meetings transcribed %", "named champions", "files shared in chat %" — no
 *       check collects transcription state, champion nomination or chat-share
 *       ratio. Replaced by the four real per-workload active-user counts, which
 *       are what the adoption pillar's checks genuinely produce.
 *   "files evaluated", "PHI containers labelled %" — no check counts scanned
 *       files or PHI containers.
 *   "managed endpoints", "device compliance %", "tickets a week" — no total
 *       device-inventory check and no ticket source on this tenant path.
 *   "CA policies", "Copilot session policies" — no registry metric resolves a
 *       Conditional Access POLICY COUNT (`identity:ca-policy-count` is bridged
 *       for signal derivation but has no `DASHBOARD_METRICS` entry), and Copilot
 *       session policies are not collected at all.
 *   "test prompts returned PHI", "PHI exposure priced" — the Copilot test-prompt
 *       harness does not exist; nothing prices PHI exposure.
 *
 * ── Why five of seven cards can be empty next to a real score (#341) ─────────
 * Shane's post-completion screenshot showed Governance/Licensing/Adoption/
 * Compliance/Health with a real dial score (19/24/31/28/41) but no stat text at
 * all, while Security and Copilot showed both. That is NOT a matching or
 * reading bug in this module, and the audit that proves it is worth keeping:
 *
 *   • The SCORE path and the STAT path read different things. A pillar's score
 *     is `computePillarDisplayScore` over the SIGNALS that fired, and a signal's
 *     impact is many-to-many across pillars — one `identity:*` signal can carry
 *     a nonzero `governanceImpact`, `licensingImpact`, `adoptionImpact` and so
 *     on. So checks from ONE domain can legitimately score all seven pillars.
 *   • A stat, by contrast, needs ITS OWN named check to have a
 *     `tenant_monitor_profiles` row. There is no cross-pillar substitute, by
 *     design — that is what stops a card inventing a number.
 *   • The 28 specs below name 22 distinct checks. The platform's canonical scan
 *     package, `core:security-baseline` (2026-07-21-repopulate-monitoring-
 *     package-checks.sql), curates 29 checks — and exactly FOUR of the 22 are in
 *     it: `identity:mfa-registration`, `identity:global-admin-count`,
 *     `identity:legacy-auth-usage`, `identity:risky-users`. Three feed the
 *     Security card; the fourth feeds Copilot, whose headline stat is the pillar
 *     score itself and so is never empty. Every stat on the other five cards
 *     names a check that package never runs. That is the whole symptom, exactly.
 *
 * So the empty cards are honest — but the REASON they carried was not. Every one
 * of them resolved to `no_data`, which reads as "this check ran and found
 * nothing" when the truth is "this check was never in the scan". Those are
 * different statements to a customer, and only the second is true here, which is
 * why the cards' blanket placeholder ends up contradicting the real score beside
 * it. `refineStatUnavailability` below turns that into a distinct, honest
 * `not_in_scan_package`, resolved from the real `monitoring_package_checks` rows
 * of the packages this customer has actually run — the same table
 * pillar-coverage.ts joins for the radar's coverage decision.
 *
 * NOT changed here, deliberately: the Health card's four stats name `intune:*`
 * checks while `core:security-baseline` runs four semantically parallel
 * `devices:*` ones (`devices:compliant-vs-noncompliant`,
 * `devices:encryption-status`, `devices:os-patch-compliance`,
 * `devices:bitlocker-key-escrow`), and the registry has no `devices:*` metric at
 * all. Re-pointing them looks like a one-line win and is exactly the #333 trap:
 * a check whose `mapping` declares no numeric targetField falls through to
 * `_itemCount`, i.e. the raw row count of whatever its endpoint returned, which
 * would render a whole device inventory under "non-compliant devices". The
 * endpoint and mapping are DB-resident, so that call cannot be made from the
 * repo — the SQL that decides it is in
 * `lib/db/migrations/manual/2026-08-02-war-room-pillar-stat-coverage-341.sql`.
 *
 * ── Findings ─────────────────────────────────────────────────────────────────
 * Real `msp_diagnostic_findings` rows, grouped per pillar by their check key's
 * domain (`WAR_ROOM_PILLAR_CHECK_DOMAINS` — the same grouping #305 uses to light
 * the pillar rows). These replace `HERO_PHASE`'s fake `find` strings ("41 sites
 * publishing tenant-wide", "no named champions") on the card's own note line.
 *
 * As in telemetry-comparison.ts: findings are written in ONE batch AFTER every
 * check finishes, so mid-run they belong to the most recent run that HAS them.
 * That run's id and status are reported alongside so the client can label it
 * honestly rather than passing a previous run's findings off as this one's.
 */

import {
  db,
  tenantsTable,
  mspDiagnosticRunsTable,
  mspDiagnosticFindingsTable,
  monitoringPackageChecksTable,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getMetric } from "@workspace/dashboard-registry";
import { calculateArchitectureHealthScore, getSignalHealthImpacts } from "./health-engine.ts";
import { fetchEvaluableSignalKeys, type RadarPillar } from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { buildPillarViews } from "./telemetry-comparison.ts";
import { resolveMetric, type MetricResult } from "./dashboard-resolvers.ts";
import { resolvePaidSeatFigures } from "./license-waste-source.ts";
import { computeSkuCostBreakdown, centsToDollars } from "./cost-engine.ts";
import { getPillarScoreTrends, PILLAR_TREND_WINDOW_DAYS } from "./pillar-trend.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * The seven War Room pillars, in `HERO_PHASE` order. MUST stay in lockstep with
 * `WAR_ROOM_PILLAR_KEYS` in msp-portal's warRoomScan.ts — that file cannot be
 * imported here (separate app, and it is the client's own copy), so the order is
 * asserted by a test on both sides.
 */
export const WAR_ROOM_PILLAR_KEYS = [
  "governance",
  "licensing",
  "adoption",
  "compliance",
  "health",
  "security",
  "copilot",
] as const;

export type WarRoomPillarKey = (typeof WAR_ROOM_PILLAR_KEYS)[number];

/**
 * War Room pillar → the engine pillar that really scores it.
 *
 * Six map by identity. `health → architecture` is the one translation: the
 * engine's `architecture` pillar is what accumulates tenant-hygiene and
 * configuration risk (device posture, drift, orphaned resources), which is
 * precisely what the War Room's "Health Scan" card describes in its own check
 * list ("workload stability", "configuration drift", "tenant hygiene and
 * orphaned resources"). There is no separate `health` pillar in the engine, and
 * inventing one would be the new scoring formula this must not add.
 */
export const WAR_ROOM_ENGINE_PILLAR: Record<WarRoomPillarKey, RadarPillar> = {
  governance: "governance",
  licensing: "licensing",
  adoption: "adoption",
  compliance: "compliance",
  health: "architecture",
  security: "security",
  copilot: "copilot",
};

/**
 * Real `monitor_checks.key` domains behind each pillar, for grouping real
 * findings. Mirrors `WAR_ROOM_PILLAR_DOMAINS` in msp-portal's warRoomScan.ts
 * (#305) and extends it with domains that genuinely exist in the catalog but
 * which that map left unclaimed, so their findings had nowhere to land:
 *   `intune`        → health     (device compliance/encryption/OS currency IS
 *                                 the tenant-health surface the Health card lists)
 *   `cost`          → licensing  (the real /subscribedSkus seat + waste checks)
 *   `collaboration` → adoption   (mailbox/channel inventory feeding usage)
 *   `appgov`        → security   (app governance / consent posture)
 *   `m365`          → health     (Microsoft 365 service health)
 *   `onedrive`      → governance (OneDrive sharing/inventory posture)
 *   `platform`      → governance (tenant-wide platform hygiene)
 *
 * `license` (#397) is deliberately kept as a SECOND accepted string alongside
 * `licensing`, not merged into it — `license:*` is the real, separately-named
 * check-key prefix for the `assess:license-cost-optimization` package (see
 * `AssessmentCreationWizard.tsx`'s own comment: that package "backs two more
 * [real] assessments"), not a stray typo. Renaming it to `licensing:` would
 * touch real stored check keys across two live assessments and their
 * historical findings, which is a data migration Shane needs to approve, not
 * a mapping-file fix — so both prefixes are accepted here instead.
 *
 * `exchange` is deliberately NOT mapped — that check was intentionally
 * removed from the Copilot Assessment package (#389); any exchange:* findings
 * still in the data are stale/historical only, not an ongoing gap.
 *
 * A check key whose domain no pillar claims still counts toward overall
 * progress; its findings simply attach to no card rather than being forced onto
 * the nearest one.
 */
export const WAR_ROOM_PILLAR_CHECK_DOMAINS: Record<WarRoomPillarKey, readonly string[]> = {
  governance: ["governance", "sharepoint", "teams", "onedrive", "platform"],
  licensing: ["licensing", "cost", "license"],
  adoption: ["adoption", "usage", "collaboration"],
  compliance: ["compliance"],
  health: ["health", "device", "devices", "intune", "m365"],
  security: ["security", "identity", "appgov"],
  copilot: ["copilot"],
};

const PILLAR_BY_DOMAIN = new Map<string, WarRoomPillarKey>();
for (const pillar of WAR_ROOM_PILLAR_KEYS) {
  for (const domain of WAR_ROOM_PILLAR_CHECK_DOMAINS[pillar]) PILLAR_BY_DOMAIN.set(domain, pillar);
}

/** Which pillar a real check key's findings belong to, or null if unclaimed. Pure. */
export function warRoomPillarForCheckKey(checkKey: string | null | undefined): WarRoomPillarKey | null {
  if (!checkKey) return null;
  const domain = String(checkKey).split(":")[0]!.trim().toLowerCase();
  return PILLAR_BY_DOMAIN.get(domain) ?? null;
}

/** Severities the pillar cards surface, matching telemetry-comparison.ts. */
export const WAR_ROOM_FINDING_SEVERITIES = ["critical", "warning"] as const;
export type WarRoomFindingSeverity = (typeof WAR_ROOM_FINDING_SEVERITIES)[number];

// ── Stat specs ────────────────────────────────────────────────────────────────

/** How the client should render a resolved number. The number itself is raw. */
export type WarRoomStatUnit = "count" | "percent" | "currency";

export type WarRoomStatSource =
  | { kind: "metric"; metricKey: string }
  | { kind: "licenseSeats"; field: "provisioned" | "unassigned" | "annualWasteDollars" }
  | { kind: "pillarScore" };

export interface WarRoomStatSpec {
  /** Stable id, so the client can key/test a stat without matching on its label. */
  id: string;
  /** The customer-facing caption under the number. */
  label: string;
  unit: WarRoomStatUnit;
  source: WarRoomStatSource;
  /**
   * The fictional `HERO_PHASE` stat this replaces, verbatim — kept so the swap
   * stays auditable and so a reviewer can see which originals had no real
   * producer at all (those are the ones whose label genuinely changed).
   */
  replaces: string;
}

/**
 * The 28 real stat callouts, four per pillar, in the order the cards render.
 *
 * Every `metricKey` is a real `DASHBOARD_METRICS` entry (lib/dashboard-registry),
 * whose `sourceKey` is a real `monitor_checks` key — the registry already carries
 * the "is this check real" audit (see its inline notes on phantom sourceKeys).
 */
export const WAR_ROOM_PILLAR_STAT_SPECS: Record<WarRoomPillarKey, readonly WarRoomStatSpec[]> = {
  // Exact matches: the governance card's own four numbers all have a real check.
  governance: [
    { id: "governance.sites", label: "sites inventoried", unit: "count",
      source: { kind: "metric", metricKey: "compliance.sharePointSiteCount" },
      replaces: "1,204 sites inventoried" },
    { id: "governance.overshared", label: "overshared sites", unit: "count",
      source: { kind: "metric", metricKey: "compliance.oversharedSiteCount" },
      replaces: "41 overshared sites" },
    // Relabelled, not approximated: `copilot:overshare-exposure` counts over-exposed
    // ITEMS, which is the real blast-radius number. Nothing counts "files reachable".
    { id: "governance.exposure", label: "items over-exposed", unit: "count",
      source: { kind: "metric", metricKey: "copilot.overshareExposureCount" },
      replaces: "214,806 files reachable" },
    // Relabelled: the real check counts public CHANNELS, not teams that have one.
    { id: "governance.publicChannels", label: "public channels", unit: "count",
      source: { kind: "metric", metricKey: "compliance.publicChannelCount" },
      replaces: "17 Teams with public channels" },
  ],

  // Three exact matches off the real /subscribedSkus arithmetic; the fourth
  // replaces "Copilot owned / used", which has no scalar producer (the Copilot
  // readiness check emits a breakdown, not an owned/used pair).
  licensing: [
    // "paid" is load-bearing in the caption, not decoration: the number counts
    // only SKUs with a real price, so the free/viral capacity Graph reports is
    // deliberately absent from it (#333).
    { id: "licensing.provisioned", label: "paid seats provisioned", unit: "count",
      source: { kind: "licenseSeats", field: "provisioned" },
      replaces: "6,180 seats provisioned" },
    { id: "licensing.unassigned", label: "paid, unassigned", unit: "count",
      source: { kind: "licenseSeats", field: "unassigned" },
      replaces: "1,308 paid, unassigned" },
    { id: "licensing.annualWaste", label: "annual waste", unit: "currency",
      source: { kind: "licenseSeats", field: "annualWasteDollars" },
      replaces: "$847,608 annual waste" },
    { id: "licensing.inactive", label: "inactive licences", unit: "count",
      source: { kind: "metric", metricKey: "licensing.inactiveLicenseCount" },
      replaces: "25 / 2 Copilot owned / used" },
  ],

  // Only the first had a real producer. The other three asked for transcription
  // state, champion nominations and a chat-share ratio, none of which any check
  // collects — replaced by the four real per-workload active-user counts, which
  // are exactly what the adoption pillar's `usage:*` checks do produce.
  adoption: [
    { id: "adoption.teamsActive", label: "active Teams users", unit: "count",
      source: { kind: "metric", metricKey: "collaboration.activeTeamsUserCount" },
      replaces: "1,631 daily active users" },
    { id: "adoption.sharePointActive", label: "active SharePoint users", unit: "count",
      source: { kind: "metric", metricKey: "collaboration.activeSharePointUserCount" },
      replaces: "22% meetings transcribed" },
    { id: "adoption.oneDriveActive", label: "active OneDrive users", unit: "count",
      source: { kind: "metric", metricKey: "collaboration.activeOneDriveUserCount" },
      replaces: "0 named champions" },
    { id: "adoption.emailActive", label: "active email users", unit: "count",
      source: { kind: "metric", metricKey: "collaboration.activeEmailUserCount" },
      replaces: "64% files shared in chat" },
  ],

  // "regulated, unlabelled" maps exactly onto the real missing-labels check. The
  // other three replace file-scan / PHI-container / mailbox-DLP numbers nothing
  // collects, with the real compliance checks nearest to what each described.
  compliance: [
    { id: "compliance.missingLabels", label: "missing sensitivity labels", unit: "count",
      source: { kind: "metric", metricKey: "compliance.missingLabelCount" },
      replaces: "40,480 regulated, unlabelled" },
    { id: "compliance.retentionDrift", label: "retention policy drift", unit: "count",
      source: { kind: "metric", metricKey: "compliance.retentionDriftCount" },
      replaces: "184,000 files evaluated" },
    { id: "compliance.weakDlp", label: "weak DLP policies", unit: "count",
      source: { kind: "metric", metricKey: "compliance.weakDlpPolicyCount" },
      replaces: "1,412 mailboxes outside DLP" },
    { id: "compliance.guests", label: "guest users", unit: "count",
      source: { kind: "metric", metricKey: "compliance.guestUserCount" },
      replaces: "78% PHI containers labelled" },
  ],

  // "outside baseline" is genuinely the non-compliant-device count. There is no
  // total-device-inventory check and no ticket source, so the remaining three are
  // the real Intune posture counts the card's own check list names.
  health: [
    { id: "health.nonCompliantDevices", label: "non-compliant devices", unit: "count",
      source: { kind: "metric", metricKey: "intune.nonCompliantDeviceCount" },
      replaces: "312 outside baseline" },
    { id: "health.configDrift", label: "device config drift", unit: "count",
      source: { kind: "metric", metricKey: "intune.configDriftCount" },
      replaces: "1,876 managed endpoints" },
    { id: "health.unencrypted", label: "unencrypted devices", unit: "count",
      source: { kind: "metric", metricKey: "intune.unencryptedDeviceCount" },
      replaces: "94.2% device compliance" },
    { id: "health.outdated", label: "outdated OS devices", unit: "count",
      source: { kind: "metric", metricKey: "intune.outdatedDeviceCount" },
      replaces: "340 tickets a week" },
  ],

  // MFA is real but is a COUNT of registered users, not the coverage percentage
  // the fake stat showed — no denominator metric is configured for it, so it is
  // labelled as the count it really is rather than divided by a guess. The CA
  // policy count and Copilot session policies have no registry metric at all;
  // replaced by the real identity posture counts this pillar's checks produce.
  security: [
    { id: "security.mfaRegistered", label: "MFA-registered users", unit: "count",
      source: { kind: "metric", metricKey: "identity.mfaRegisteredCount" },
      replaces: "96% MFA coverage" },
    { id: "security.globalAdmins", label: "global administrators", unit: "count",
      source: { kind: "metric", metricKey: "identity.globalAdminCount" },
      replaces: "42 CA policies" },
    { id: "security.legacyAuth", label: "legacy auth sign-ins", unit: "count",
      source: { kind: "metric", metricKey: "identity.legacyAuthCount" },
      replaces: "0 Copilot session policies" },
    // Same real over-exposure count governance shows — deliberately, because the
    // original card showed the same 214,806 in both places.
    { id: "security.blastRadius", label: "items in blast radius", unit: "count",
      source: { kind: "metric", metricKey: "copilot.overshareExposureCount" },
      replaces: "214,806 files in blast radius" },
  ],

  // The readiness headline is the pillar's own real score. The PHI test-prompt
  // harness and the priced PHI exposure do not exist; replaced by the real
  // exposure count and the real risky-user count.
  copilot: [
    { id: "copilot.readiness", label: "readiness score", unit: "percent",
      source: { kind: "pillarScore" },
      replaces: "34% readiness against a 75 gate" },
    { id: "copilot.exposure", label: "items Copilot could reach", unit: "count",
      source: { kind: "metric", metricKey: "copilot.overshareExposureCount" },
      replaces: "3 / 3 test prompts returned PHI" },
    { id: "copilot.riskyUsers", label: "risky users", unit: "count",
      source: { kind: "metric", metricKey: "identity.riskyUserCount" },
      replaces: "$2.4M PHI exposure priced" },
    { id: "copilot.duplicateLicenses", label: "duplicate licences", unit: "count",
      source: { kind: "metric", metricKey: "licensing.duplicateLicenseCount" },
      replaces: "9 documents generated" },
  ],
};

/**
 * The original stat callouts that no real check in this platform can produce, so
 * a future reader can see the gap rather than rediscover it. Each was replaced
 * by a real sibling above (see each spec's `replaces`); none was approximated.
 */
export const WAR_ROOM_UNPRODUCIBLE_STATS: readonly string[] = [
  "files reachable / files in blast radius (no check counts files; item-level over-exposure is used instead)",
  "% of meetings transcribed (no transcription-state check)",
  "named champions (no champion nomination source)",
  "% of files shared in chat (no chat-share ratio check)",
  "files evaluated (no file-scan tally)",
  "% PHI containers labelled (no PHI container classification check)",
  "managed endpoints (no total device-inventory check)",
  "% device compliance (no compliant/total device ratio check)",
  "tickets a week (no ticket source on the tenant assessment path)",
  "CA policies (identity:ca-policy-count has no DASHBOARD_METRICS entry)",
  "Copilot session policies (not collected)",
  "test prompts returning PHI (no Copilot test-prompt harness)",
  "PHI exposure priced (nothing prices PHI exposure)",
  "documents generated (lives on the doc-generation workflow, not a scan check)",
];

// ── Payload ───────────────────────────────────────────────────────────────────

export interface WarRoomStat {
  id: string;
  label: string;
  unit: WarRoomStatUnit;
  /** The real number, or null when the source genuinely has no data for it. */
  value: number | null;
  /**
   * Why `value` is null — the resolver's own machine-stable reason
   * (`no_data`, `not_in_scan_package`, `unknown_check_key`, `license_gap`,
   * `no_seat_data`, …). Present only when value is null, so a consumer can say
   * WHICH kind of nothing it is.
   */
  unavailableReason?: string;
  /**
   * The real `monitor_checks.key` this stat needs, so a consumer can name the
   * missing check instead of guessing at it (#341). Null for the two stats that
   * aren't check-backed: the Copilot readiness score (the pillar's own score)
   * and the seat figures when no `/subscribedSkus` row exists to name a key.
   */
  checkKey: string | null;
  /** Where the number came from, for provenance (`monitor_profile:<checkKey>`, …). */
  source: string;
  replaces: string;
}

/**
 * A stat whose check is not in ANY monitoring package this customer has ever
 * been scanned with — so it never ran, as opposed to running and finding
 * nothing. Distinct from `no_data` (the check is in the scan and reported
 * nothing) and from `unknown_check_key` (no such check exists in the catalog at
 * all, i.e. a registry wiring bug). See the header for why this distinction is
 * the whole of #341: five of seven cards were reporting "ran, found nothing"
 * for checks that were never scanned, which reads as a broken pillar sitting
 * next to a perfectly real score.
 */
export const WAR_ROOM_STAT_NOT_SCANNED = "not_in_scan_package";

/**
 * Pure: correct a stat's `no_data` to `not_in_scan_package` when its check is
 * genuinely outside every package this customer has run.
 *
 * Only ever RE-labels a stat that already has no value, and only the one reason
 * that is ambiguous:
 *   • a stat with a real value (including a real 0) is never touched;
 *   • `license_gap` / `unknown_check_key` / `no_seat_data` / `no_sku_prices` are
 *     already specific and already true — leave them alone;
 *   • with no scanned package known (a customer who has never run a scan, or a
 *     package with no curated checks) nothing can be claimed, so `no_data`
 *     stands. Silence is better than a confident wrong reason.
 *
 * Note this stays correct across a customer whose packages changed over time:
 * `tenant_monitor_profiles` keeps the newest row per check forever, so a check
 * dropped from today's package but scanned last month still has a value and
 * exits at the first guard.
 */
export function refineStatUnavailability(
  stat: WarRoomStat,
  scannedCheckKeys: ReadonlySet<string> | null,
): WarRoomStat {
  if (stat.value != null) return stat;
  if (stat.unavailableReason !== "no_data") return stat;
  if (!stat.checkKey) return stat;
  if (scannedCheckKeys == null || scannedCheckKeys.size === 0) return stat;
  if (scannedCheckKeys.has(stat.checkKey)) return stat;
  return { ...stat, unavailableReason: WAR_ROOM_STAT_NOT_SCANNED };
}

export interface WarRoomPillarFinding {
  severity: WarRoomFindingSeverity;
  checkKey: string;
  title: string;
}

export interface WarRoomPillarCard {
  pillar: WarRoomPillarKey;
  /** The engine pillar this score really came from — provenance, not decoration. */
  enginePillar: RadarPillar;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds it — never fabricated. */
  score: number | null;
  /** The engine's raw risk accumulation for the pillar (higher = worse). */
  rawRiskScore: number;
  stats: WarRoomStat[];
  /** Real findings for this pillar's checks, worst first, capped. */
  findings: WarRoomPillarFinding[];
  findingCounts: { critical: number; warning: number };
  /**
   * Real `tenant_monitor_profiles` history replayed through the same
   * per-check → pillar-impact resolution the score above uses (#356,
   * pillar-trend.ts). Null below `PILLAR_TREND_MIN_POINTS` real checkpoints —
   * never a synthesised shape.
   */
  trend: { series: number[]; window: string } | null;
}

export interface WarRoomPillarStatsPayload {
  pillars: WarRoomPillarCard[];
  /** The run the findings belong to, and its real status — never implied. */
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  /** The run in flight right now, if any. */
  activeRunId: string | null;
  /**
   * Every distinct `msp_diagnostic_runs.package_key` this customer has been
   * scanned with, and how many curated checks those packages cover between them
   * — the evidence behind any `not_in_scan_package` reason above, so a reader
   * can see WHICH scan a stat was measured against rather than taking the
   * verdict on trust. Empty when the customer has never run a scan.
   */
  scannedPackageKeys: string[];
  scannedCheckCount: number;
  generatedAt: string;
}

/** How many real findings a card shows on its note line. */
export const WAR_ROOM_FINDINGS_PER_PILLAR = 3;

const ACTIVE_RUN_STATUSES = ["pending", "running"] as const;

// ── Assembly ──────────────────────────────────────────────────────────────────

/**
 * Pure: turn one resolved `MetricResult` into a stat entry. Extracted so the
 * "never fabricate" behaviour (a not_available metric becomes a null value with
 * its real reason, NOT a zero) is testable without a database.
 */
export function statFromMetricResult(
  spec: WarRoomStatSpec,
  metricSourceKey: string,
  result: MetricResult | null,
): WarRoomStat {
  const base = {
    id: spec.id,
    label: spec.label,
    unit: spec.unit,
    checkKey: metricSourceKey,
    replaces: spec.replaces,
  };
  const source = `monitor_profile:${metricSourceKey}`;

  if (result == null) {
    return { ...base, value: null, unavailableReason: "unknown_metric_key", source };
  }
  if (result.status === "error") {
    return { ...base, value: null, unavailableReason: "resolver_error", source };
  }
  if (result.status === "not_available") {
    return { ...base, value: null, unavailableReason: result.reason, source };
  }

  // A real zero is a real answer and must survive as 0, not become "no data".
  const raw = (result.data as { value?: unknown; percentage?: unknown }).value;
  const value = typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  return value == null
    ? { ...base, value: null, unavailableReason: "non_numeric_value", source }
    : { ...base, value, source };
}

/** Real license-seat figures for one tenant, or null when they can't be sourced. */
interface SeatFigures {
  provisioned: number;
  unassigned: number;
  annualWasteDollars: number | null;
  checkKey: string;
}

/**
 * The card's three licensing numbers, all over the PAID estate (#333).
 *
 * This originally read `resolveLicenseWasteCounts`' every-SKU totals, which count
 * Microsoft's free / viral / self-service SKUs at the sentinel capacity Graph
 * reports for them (1,000,000 for POWER_BI_STANDARD, 10,000 for FLOW_FREE and the
 * viral trials). Those are not seats anyone provisioned or paid for, and on a real
 * tenant with five active users they rendered as "1,020,000 seats provisioned" and
 * "1,019,995 paid, unassigned" under captions that both say otherwise.
 *
 * The giveaway was already on the card: annual waste stayed BLANK next to a
 * million unassigned seats, because those SKUs have no price and the dollar figure
 * has always been priced-estate-only. `resolvePaidSeatFigures` puts the two counts
 * on that same footing, so all three describe one estate — see license-waste-source.ts
 * for why `sku_price_reference` is the authority on "paid" and not a capacity heuristic.
 */
async function resolveSeatFigures(tenantId: string): Promise<SeatFigures | null> {
  const seats = await resolvePaidSeatFigures(tenantId);
  if (!seats) return null;

  let annualWasteDollars: number | null = null;
  try {
    const breakdown = await computeSkuCostBreakdown(seats.paidCounts);
    // A total of zero with every SKU unpriced is "we couldn't price it", not "$0".
    annualWasteDollars =
      breakdown.totalAnnualCents > 0 ? centsToDollars(breakdown.totalAnnualCents) : null;
  } catch (err) {
    log.warn({ err, tenantId }, "war-room-pillar-stats: SKU cost breakdown failed; annual waste omitted");
  }

  return {
    provisioned: seats.provisioned,
    unassigned: seats.unassigned,
    annualWasteDollars,
    checkKey: seats.checkKey,
  };
}

/**
 * Build every real pillar card for one customer.
 *
 * `mspId` is resolved from the customer's own tenant row purely to satisfy
 * `ResolveContext`; every metric used here is `scope: "customer"`, so it never
 * drives a value.
 */
export async function buildWarRoomPillarStats(customerId: number): Promise<WarRoomPillarStatsPayload> {
  const [tenantRow] = await db
    .select({ tenantId: tenantsTable.tenantId, mspId: tenantsTable.mspId })
    .from(tenantsTable)
    .where(eq(tenantsTable.id, customerId))
    .limit(1);

  const [output, { rules, groups }, pillarTrends] = await Promise.all([
    calculateArchitectureHealthScore(customerId),
    fetchSignalRulesAndGroups(),
    getPillarScoreTrends(customerId),
  ]);
  const evaluableSignalKeys = await fetchEvaluableSignalKeys(rules);
  const impacts = getSignalHealthImpacts(rules, groups);
  const { pillars: enginePillars } = buildPillarViews(output, impacts, evaluableSignalKeys);
  const byEnginePillar = new Map(enginePillars.map((p) => [p.pillar, p]));

  // Seat figures are needed by three licensing stats — fetched once, and only
  // when the customer actually has a tenant to key monitor rows by.
  const seats = tenantRow?.tenantId ? await resolveSeatFigures(tenantRow.tenantId) : null;

  const ctx = { customerId, mspId: tenantRow?.mspId ?? 0 };

  // Resolve every distinct metric once — several specs share one (the
  // over-exposure count appears on three cards).
  const metricKeys = new Set<string>();
  for (const pillar of WAR_ROOM_PILLAR_KEYS) {
    for (const spec of WAR_ROOM_PILLAR_STAT_SPECS[pillar]) {
      if (spec.source.kind === "metric") metricKeys.add(spec.source.metricKey);
    }
  }
  const metricResults = new Map<string, { result: MetricResult | null; sourceKey: string }>();
  await Promise.all(
    [...metricKeys].map(async (metricKey) => {
      const def = getMetric(metricKey);
      if (!def) {
        // A spec naming a metric the registry doesn't have is a wiring bug, not a
        // tenant with no data — say so rather than rendering an empty card.
        log.error({ metricKey }, "war-room-pillar-stats: spec references an unknown registry metric");
        metricResults.set(metricKey, { result: null, sourceKey: metricKey });
        return;
      }
      metricResults.set(metricKey, { result: await resolveMetric(def, ctx), sourceKey: def.sourceKey });
    }),
  );

  const { findingsByPillar, findingsRunId, findingsRunStatus } = await fetchPillarFindings(customerId);
  const scanned = await fetchScannedCheckKeys(customerId);

  const [activeRun] = await db
    .select({ runId: mspDiagnosticRunsTable.runId })
    .from(mspDiagnosticRunsTable)
    .where(
      and(
        eq(mspDiagnosticRunsTable.customerId, customerId),
        inArray(mspDiagnosticRunsTable.status, [...ACTIVE_RUN_STATUSES]),
      ),
    )
    .orderBy(desc(mspDiagnosticRunsTable.createdAt))
    .limit(1);

  const pillars: WarRoomPillarCard[] = WAR_ROOM_PILLAR_KEYS.map((pillar) => {
    const enginePillar = WAR_ROOM_ENGINE_PILLAR[pillar];
    const view = byEnginePillar.get(enginePillar);
    const score = view?.displayScore ?? null;

    const stats = WAR_ROOM_PILLAR_STAT_SPECS[pillar].map((spec): WarRoomStat => {
      const base = {
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        checkKey: null as string | null,
        replaces: spec.replaces,
      };

      if (spec.source.kind === "pillarScore") {
        return score == null
          ? { ...base, value: null, unavailableReason: "no_evaluable_rules", source: `health_engine:${enginePillar}` }
          : { ...base, value: score, source: `health_engine:${enginePillar}` };
      }

      if (spec.source.kind === "licenseSeats") {
        const source = seats ? `monitor_profile:${seats.checkKey}` : "monitor_profile:subscribedSkus";
        if (!seats) {
          return { ...base, value: null, unavailableReason: "no_seat_data", source };
        }
        base.checkKey = seats.checkKey;
        const value =
          spec.source.field === "provisioned"
            ? seats.provisioned
            : spec.source.field === "unassigned"
              ? seats.unassigned
              : seats.annualWasteDollars;
        return value == null
          ? { ...base, value: null, unavailableReason: "no_sku_prices", source }
          : { ...base, value, source };
      }

      const resolved = metricResults.get(spec.source.metricKey);
      return statFromMetricResult(spec, resolved?.sourceKey ?? spec.source.metricKey, resolved?.result ?? null);
    })
      // Applied to every source kind, not just the metric branch, so a
      // never-scanned check can't keep an "it ran and found nothing" label
      // whichever path produced it (#341).
      .map((stat) => refineStatUnavailability(stat, scanned.checkKeys));

    const found = findingsByPillar.get(pillar) ?? [];
    const trendPoints = pillarTrends.get(enginePillar) ?? null;
    return {
      pillar,
      enginePillar,
      score,
      rawRiskScore: view?.rawRiskScore ?? 0,
      stats,
      findings: found.slice(0, WAR_ROOM_FINDINGS_PER_PILLAR),
      findingCounts: {
        critical: found.filter((f) => f.severity === "critical").length,
        warning: found.filter((f) => f.severity === "warning").length,
      },
      trend: trendPoints
        ? { series: trendPoints.map((p) => p.score), window: `${PILLAR_TREND_WINDOW_DAYS}d` }
        : null,
    };
  });

  return {
    pillars,
    findingsRunId,
    findingsRunStatus,
    activeRunId: activeRun?.runId ?? null,
    scannedPackageKeys: scanned.packageKeys,
    scannedCheckCount: scanned.checkKeys?.size ?? 0,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Every check key the customer's own scans could genuinely have collected: the
 * union of `monitoring_package_checks` over the distinct `package_key`s of that
 * customer's `msp_diagnostic_runs`.
 *
 * The union (rather than just the newest run's package) is deliberate — a
 * customer whose entitlement moved them from `core:security-baseline` to
 * `assess:copilot-readiness` still legitimately holds rows from the earlier
 * package, and calling those "not in the scan" would be a new wrong answer in
 * place of the old one.
 *
 * Returns a null `checkKeys` when there is nothing to conclude from — no runs at
 * all, or packages with no curated checks (the platform-wide state before
 * 2026-07-21's repopulation, which would otherwise mark every stat unscanned).
 */
async function fetchScannedCheckKeys(customerId: number): Promise<{
  packageKeys: string[];
  checkKeys: Set<string> | null;
}> {
  const runRows = await db
    .selectDistinct({ packageKey: mspDiagnosticRunsTable.packageKey })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.customerId, customerId));

  const packageKeys = runRows.map((r) => r.packageKey).filter((k): k is string => !!k);
  if (packageKeys.length === 0) return { packageKeys: [], checkKeys: null };

  const checkRows = await db
    .selectDistinct({ checkKey: monitoringPackageChecksTable.checkKey })
    .from(monitoringPackageChecksTable)
    .where(inArray(monitoringPackageChecksTable.packageKey, packageKeys));

  const checkKeys = new Set(checkRows.map((r) => r.checkKey));
  if (checkKeys.size === 0) {
    log.warn(
      { customerId, packageKeys },
      "war-room-pillar-stats: scanned packages curate no checks — stat unavailability cannot be attributed",
    );
    return { packageKeys, checkKeys: null };
  }
  return { packageKeys, checkKeys };
}

/**
 * Real findings of the most recent run that OWNS any, grouped per pillar with
 * critical before warning. Mid-scan that is the previous run — reported with its
 * own id/status so the caller never presents it as the run in flight.
 */
async function fetchPillarFindings(customerId: number): Promise<{
  findingsByPillar: Map<WarRoomPillarKey, WarRoomPillarFinding[]>;
  findingsRunId: string | null;
  findingsRunStatus: string | null;
}> {
  const findingsByPillar = new Map<WarRoomPillarKey, WarRoomPillarFinding[]>();

  const [latest] = await db
    .select({ runId: mspDiagnosticFindingsTable.runId })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
    .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
    .limit(1);

  if (!latest) return { findingsByPillar, findingsRunId: null, findingsRunStatus: null };

  const rows = await db
    .select({
      checkKey: mspDiagnosticFindingsTable.checkKey,
      severity: mspDiagnosticFindingsTable.severity,
      title: mspDiagnosticFindingsTable.title,
      recommendation: mspDiagnosticFindingsTable.recommendation,
    })
    .from(mspDiagnosticFindingsTable)
    .where(
      and(
        eq(mspDiagnosticFindingsTable.runId, latest.runId),
        inArray(mspDiagnosticFindingsTable.severity, [...WAR_ROOM_FINDING_SEVERITIES]),
      ),
    );

  const severityRank: Record<WarRoomFindingSeverity, number> = { critical: 0, warning: 1 };
  for (const row of rows) {
    const pillar = warRoomPillarForCheckKey(row.checkKey);
    if (!pillar) continue;
    const list = findingsByPillar.get(pillar) ?? [];
    list.push({
      severity: row.severity as WarRoomFindingSeverity,
      checkKey: row.checkKey,
      title: row.title,
    });
    findingsByPillar.set(pillar, list);
  }
  // Same ordering rule as telemetry-comparison's rankDiscrepancies: severity
  // first, then stably by check key so two identical runs can't disagree.
  for (const list of findingsByPillar.values()) {
    list.sort(
      (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.checkKey.localeCompare(b.checkKey),
    );
  }

  const [runRow] = await db
    .select({ status: mspDiagnosticRunsTable.status })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.runId, latest.runId))
    .limit(1);

  return { findingsByPillar, findingsRunId: latest.runId, findingsRunStatus: runRow?.status ?? null };
}
