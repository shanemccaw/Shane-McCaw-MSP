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
 *   calculateArchitectureHealthScore(customerId)          (health-engine.ts)
 *   fetchTenantEvaluableSignalKeys(customerId, rules, …)  (pillar-coverage.ts)
 *   buildPillarViews(...)                                 (telemetry-comparison.ts)
 *     └─ computePillarDisplayScore                        (health-display.ts)
 *
 * Since #413 the denominator that chain uses is scoped to the checks this
 * customer was ACTUALLY scanned with, resolved from the very same
 * `fetchScannedCheckKeys` the stat-unavailability refinement below uses.
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
 *       ratio. These were replaced by four per-workload active-user counts on
 *       the stated basis that the adoption pillar's `usage:*` checks produce
 *       them; #441 established that `usage:` is not a real check-key domain, so
 *       the replacements were phantom too and the adoption card is now empty.
 *       See the `adoption: []` spec below for why they are not repointed.
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
 * Real `msp_diagnostic_findings` rows, grouped per pillar primarily by
 * `signal_derivation_rules.pillar` for that check's owning signal — #469's
 * enforced single source of truth for "what pillar does this signal belong
 * to", joined via the same `resolveOwningCheckKey` hop `buildFindingRankWeights`
 * already uses (`buildCheckKeyPillarMap`, below). `WAR_ROOM_PILLAR_CHECK_DOMAINS`
 * (the domain grouping #305 introduced) is now only the FALLBACK, for a check
 * with no matching rule row or an ambiguous one. Before #521 the domain map was
 * the ONLY signal read here, so a check reclassified to a different pillar
 * without its key being renamed (`governance:sensitivity-label-adoption`,
 * `governance:auto-labeling-coverage`, `copilot:sensitivity-labels-exist`, …,
 * since #469) kept filing findings under its old domain-prefixed card instead
 * of the one it actually scores. These replace `HERO_PHASE`'s fake `find`
 * strings ("41 sites publishing tenant-wide", "no named champions") on the
 * card's own note line.
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
  monitorChecksTable,
  type SignalDerivationRule,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getMetric } from "@workspace/dashboard-registry";
import {
  calculateArchitectureHealthScore,
  getSignalHealthImpacts,
  PILLAR_FIELD,
  type SignalHealthImpactConfig,
} from "./health-engine.ts";
import {
  fetchScannedCheckKeys,
  fetchTenantEvaluableSignalKeys,
  resolveOwningCheckKey,
  RADAR_PILLARS,
  type RadarPillar,
} from "./pillar-coverage.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import { buildPillarViews } from "./telemetry-comparison.ts";
import { MIN_EVALUABLE_SIGNALS_PER_PILLAR, type PillarEvaluation } from "./health-display.ts";
import { resolveMetric, type MetricResult } from "./dashboard-resolvers.ts";
import { resolvePaidSeatFigures } from "./license-waste-source.ts";
import { computeSkuCostBreakdown, centsToDollars } from "./cost-engine.ts";
import { getPillarScoreTrends, PILLAR_TREND_WINDOW_DAYS } from "./pillar-trend.ts";
import {
  buildLicenseGapPurchase,
  recommendationForCheckKey,
  type LicenseGapPurchase,
  type LicenseGapRecommendation,
} from "./license-gap-purchase-links.ts";
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

/**
 * `signal_derivation_rules.pillar` (free text, `SIGNAL_PILLARS`) → the War Room
 * pillar it names, inverted from `WAR_ROOM_ENGINE_PILLAR` so the two naming
 * schemes can never disagree (`architecture` → `health`, same as the engine
 * pillar every score already resolves through). `cost` is kept as a second
 * accepted string alongside `licensing`, mirroring the SAME real alias
 * `WAR_ROOM_PILLAR_CHECK_DOMAINS` already documents for the `cost:*` check-key
 * domain — the live table uses it interchangeably with `licensing` (see that
 * map's own comment).
 */
const RADAR_PILLAR_BY_RULE_PILLAR = new Map<string, WarRoomPillarKey>(
  WAR_ROOM_PILLAR_KEYS.map((pillar) => [WAR_ROOM_ENGINE_PILLAR[pillar], pillar]),
);
RADAR_PILLAR_BY_RULE_PILLAR.set("cost", "licensing");

/**
 * A `signal_derivation_rules.pillar` value → the War Room pillar it names, or
 * null when the column is blank or names something outside `SIGNAL_PILLARS`
 * (an unset/typo'd row, not a claim on any card). Pure; exported for tests.
 */
export function warRoomPillarForRulePillar(rulePillar: string | null | undefined): WarRoomPillarKey | null {
  if (!rulePillar) return null;
  return RADAR_PILLAR_BY_RULE_PILLAR.get(rulePillar.trim().toLowerCase()) ?? null;
}

/**
 * Which War Room pillar a real check key's findings belong to, or null if
 * unclaimed (#521). Resolved primarily from `checkKeyPillars`
 * (`buildCheckKeyPillarMap` — `signal_derivation_rules.pillar` for that check's
 * owning signal, #469's enforced single source of truth), falling back to the
 * `WAR_ROOM_PILLAR_CHECK_DOMAINS` prefix map only for a check with no matching
 * rule row (or an ambiguous one — see `buildCheckKeyPillarMap`). Callers with no
 * rule data at all (tests, or a caller that genuinely has none) get the domain
 * fallback outright, same as before #521. Pure.
 */
export function warRoomPillarForCheckKey(
  checkKey: string | null | undefined,
  checkKeyPillars?: ReadonlyMap<string, WarRoomPillarKey>,
): WarRoomPillarKey | null {
  if (!checkKey) return null;
  const fromRules = checkKeyPillars?.get(checkKey);
  if (fromRules) return fromRules;
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
 * The real stat callouts, in the order the cards render — four per pillar
 * except adoption, which is empty (see its own note).
 *
 * Every `metricKey` must be a real `DASHBOARD_METRICS` entry (lib/dashboard-
 * registry) whose `sourceKey` is a real `monitor_checks` key. That second half
 * was assumed rather than checked until #441 and was false for four of them;
 * `registry-source-key-contract.test.ts` now asserts both halves on every spec
 * here, so a rename or removal in the catalog fails a test instead of reaching
 * a customer's report as an unresolved key.
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

  // EMPTY, and deliberately so since #441.
  //
  // This card used to carry four "active <workload> users" stats, on the stated
  // basis that they "are exactly what the adoption pillar's `usage:*` checks do
  // produce". That basis was false: `usage:` is not a check-key domain in this
  // platform's catalog and never has been, so all four resolved to
  // `unknown_check_key` for every tenant, forever. They were not empty-because-
  // unscanned; they were empty-because-misspelt, and the Copilot Readiness
  // Report printed the four phantom keys to a paying customer as "not wired to
  // a check in the catalogue".
  //
  // They are NOT repointed at the real `adoption:*` activity checks. Those four
  // (`adoption:teams-activity-trend`, `adoption:sharepoint-onedrive-trend`,
  // `adoption:email-activity-trend`, `adoption:overall-active-rate`) are Graph
  // usage-report DETAIL endpoints — one row per user, or per site — so a metric
  // pointed at them falls through to `_itemCount` and renders the entire
  // licensed roster under a caption reading "active users". That is the same
  // trap this file already refuses for the Health card's `intune:*` stats, and
  // it is worse here because the number would look plausible.
  //
  // The gap is recorded in WAR_ROOM_UNPRODUCIBLE_STATS below and needs a real
  // check + mapping (DB-resident) to close, not a registry edit. Until then the
  // card shows its real score, trend and findings and asserts no figure.
  adoption: [],

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
  // #441. The four the adoption card used to claim. Listed individually because
  // each needs its own real check, and because listing them here is the only
  // record that the card is empty by decision rather than by neglect.
  "active Teams users (no check counts ACTIVE users; adoption:teams-activity-trend is a per-user detail report)",
  "active SharePoint users (adoption:sharepoint-onedrive-trend is a per-SITE usage report, not a user count)",
  "active OneDrive users (no OneDrive per-user activity check exists at all)",
  "active email users (no check counts ACTIVE users; adoption:email-activity-trend is a per-user detail report)",
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
   * Set ONLY when `unavailableReason === "license_gap"`: the customer-safe name
   * of the Microsoft 365 add-on the tenant's own scan reported as missing
   * (`MetricResultNotAvailable.licenseFeature`, ultimately monitor-executor's
   * `_licenseGapFeature`).
   *
   * #451. A licence gap is neither a fault of ours nor a finding about their
   * configuration — it is a measurement that could not be taken, and the only
   * honest way to say WHICH tier would take it is to repeat what Microsoft told
   * the scan. Passed through rather than re-derived so no consumer has to
   * hardcode a tier per check.
   */
  licenseFeature?: string;
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
 * Reasons that are a PLATFORM WIRING FAULT rather than a fact about the tenant.
 *
 * Every other unavailability reason answers "what does this customer's scan
 * carry" — the check was not in their package, it ran and found nothing, their
 * licence tier does not include it. These three answer "is our own registry
 * correct", and the answer is no. The distinction matters twice:
 *
 *   • Server-side, they are logged as errors (below), because a stat that can
 *     never resolve for ANY tenant is a defect with no self-healing path and
 *     needs to be loud. #441 existed because it was silent for months.
 *   • Client-side, the Copilot Readiness Report excludes them from the
 *     customer-facing "not available for this tenant" block. Printing
 *     `usage:teams-activity — not wired to a check in the catalogue` in a paid
 *     deliverable states our bug as though it were a gap in their environment.
 *
 * Exported so the consumers of this payload classify identically rather than
 * each re-deciding which reasons are ours.
 */
export const WAR_ROOM_STAT_WIRING_FAULT_REASONS: readonly string[] = [
  "unknown_check_key",
  "unknown_metric_key",
  "resolver_error",
];

/** True when a stat is unavailable because of OUR wiring, not the tenant's data. */
export function isStatWiringFault(reason: string | undefined): boolean {
  return reason != null && WAR_ROOM_STAT_WIRING_FAULT_REASONS.includes(reason);
}

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
  /**
   * The real signal weight this finding's own check carries FOR THE PILLAR THIS
   * FINDING IS FILED UNDER, used to rank it against its severity peers (#414).
   * See `FINDING_RANK_IMPACT_FIELD` and `buildFindingRankWeights` for where the
   * number comes from.
   *
   * Deliberately a flat number rather than a per-pillar map: a
   * `WarRoomPillarCard` is already pillar-scoped, and a finding reaches exactly
   * one card (`warRoomPillarForCheckKey` is single-valued), so the pillar is
   * known at the point this is written and carrying the other six columns to
   * the client would be dead weight the wire cannot use.
   *
   * `0` means the join found no rule fed by this check, or found rules that
   * carry no weight for this pillar — an honest "unranked", not a claim that
   * the finding does not matter.
   */
  rankWeight: number;
}

/** The impact columns a signal's weight can live in. Mirrors health-display.ts. */
type PillarImpactField = keyof Omit<SignalHealthImpactConfig, "signalKey">;

/**
 * Which of `signal_derivation_rules`' seven impact columns ranks a finding
 * against its severity peers — resolved PER PILLAR (#414, corrected 2026-08-06).
 *
 * Security's findings rank by `securityImpact`, Licensing's by
 * `licensingImpact`, Copilot's by `copilotImpact`, and so on. This is
 * health-engine's own `PILLAR_FIELD` — the SAME map `computePillarDisplayScore`
 * uses to compute the score printed beside these findings — rather than a
 * second copy that could drift from it. Only the local cast is new, and it
 * matches what health-display.ts and pillar-coverage.ts already do at their own
 * call sites (`PILLAR_FIELD` is typed `string`-valued for historical reasons).
 *
 * ── This REVERSES the original #414 decision, and why ───────────────────────
 * The fix that first landed (`6c648df4`) used a single constant,
 * `copilotImpact`, for all seven pillars, on the reasoning that the entire
 * product is scoped to Copilot readiness so the headline should be the finding
 * that most obstructs Copilot. That docstring recorded `PILLAR_FIELD[enginePillar]`
 * as the considered-and-rejected alternative, and flagged one risk it could not
 * check from this environment: `copilotImpact` only ranks anything if it
 * genuinely varies across the rules feeding a pillar.
 *
 * It does not. Shane ran Query 1 of `docs/2026-08-05-finding-rank-weights-414.sql`
 * against the live database on 2026-08-06 and every pillar EXCEPT `copilot`
 * itself has `copilot_impact` flat at 0 across all of its rules, while every
 * pillar's own column carries real variance:
 *
 *     pillar         rules   distinct copilot_impact   distinct own-field
 *     security         56      1  (0/0)                  20
 *     governance       26      1  (0/0)                  11
 *     architecture     17      1  (0/0)                   8
 *     cost              8      1  (0/0)                   4
 *     compliance        5      1  (0/0)                   5
 *     adoption          8      1  (0/0)                   2
 *     copilot           6      4  (0/20)                  —
 *
 * So the landed ranking was a NO-OP for six of seven pillars — including
 * Security, the pillar the reported bug came from: `identity:break-glass-health`
 * and the CA findings both sit at `copilot_impact = 0`, tie, and fall straight
 * through to the `checkKey.localeCompare` tiebreak that put break-glass first in
 * the first place. The mechanism (`buildFindingRankWeights`,
 * `compareRankedFindings`, `orderPillarFindings`) was correct throughout; only
 * the column it read was empty.
 *
 * ── What this trades away, stated rather than hidden ────────────────────────
 * "Headline = most Copilot-blocking" becomes "headline = most severe on the
 * pillar being displayed". Signals legitimately cross pillars — `ca-mfa-coverage`
 * carries real weight in both `securityImpact` and `copilotImpact` — so this is
 * not a claim that Copilot relevance stopped mattering. It is that a pillar's
 * own column is the one column proven to be populated for that pillar's own
 * findings, and a ranking that reads an empty column ranks nothing at all. The
 * consolation the original docstring named as this option's merit now applies:
 * a card's headline IS the biggest driver of the score printed next to it.
 *
 * The `copilot` card is not a special case under this rule — it is the one
 * pillar for which the old and new behaviour coincide, since `PILLAR_FIELD.copilot`
 * IS `copilotImpact`. That is asserted as a test rather than left as a comment.
 *
 * Note the live table labels one pillar `cost` where the engine calls it
 * `licensing`; that is a value in `signal_derivation_rules.pillar`, a free-text
 * column this lookup never reads. Ranking is keyed by the ENGINE pillar the card
 * was scored as (`WAR_ROOM_ENGINE_PILLAR`), so the two naming schemes cannot
 * disagree here.
 */
export const FINDING_RANK_IMPACT_FIELD = PILLAR_FIELD as Record<RadarPillar, PillarImpactField>;

/**
 * A check's rank weight for every engine pillar, so one pass over the rules
 * serves all seven cards (#414). Read at the point a finding is filed under its
 * pillar; see `WarRoomPillarFinding.rankWeight` for why only one of the seven
 * survives onto the wire.
 */
export type CheckRankWeights = Record<RadarPillar, number>;

/** The subset of a `monitor_checks` row `resolveOwningCheckKey` needs. */
interface RankCheckDefinition {
  key: string;
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }> | null;
  properties: string[] | null;
}

/**
 * Real check key → the weight its findings rank by (#414).
 *
 * ── Why this join is needed at all ──────────────────────────────────────────
 * A finding row (`msp_diagnostic_findings`) carries a `check_key` and nothing
 * else that could rank it. The weights live on `signal_derivation_rules`, keyed
 * by `signal_key`. Those two are three hops apart (#441): a rule names a
 * `source_key`, which is a merged-PROFILE key, which some check's `mapping` /
 * `properties` / bare key / bridged key produces. `resolveOwningCheckKey` is
 * the platform's existing, already-tested answer to exactly that hop, so it is
 * reused here rather than re-deriving a second matching rule that could drift
 * from the one the Simulator Studio Pillar Matrix already uses.
 *
 * `impacts` (not the raw rule rows) is the weight source on purpose: it is the
 * same `getSignalHealthImpacts` map the SCORE beside these findings is computed
 * from, so it already resolves a signal's weight as the MAX across every rule
 * and every group carrying it. Reading the rule row's own impact column directly
 * would ignore group-level weights and could rank a finding by a number the
 * scoring path does not agree with.
 *
 * Many rules can resolve to one check; the check takes the strongest of them,
 * mirroring how a signal takes the max across its own rules. That max is taken
 * PER PILLAR (#414, corrected 2026-08-06) — one rule can be the heaviest
 * contributor to a check's `securityImpact` while a different rule on the same
 * check is the heaviest for `governanceImpact`, and collapsing to one number
 * before knowing which card is asking would lose that.
 *
 * All seven pillars are accumulated in this single pass rather than the function
 * being called once per pillar: `resolveOwningCheckKey` walks the whole check
 * catalog per rule, so seven calls would repeat that scan seven times to produce
 * results the caller reads one column of anyway.
 *
 * Pure; exported for tests.
 */
export function buildFindingRankWeights(
  rules: readonly Pick<SignalDerivationRule, "ruleType" | "sourceKey" | "signalKey">[],
  impacts: ReadonlyMap<string, SignalHealthImpactConfig>,
  checkDefinitions: readonly RankCheckDefinition[],
): Map<string, CheckRankWeights> {
  const byCheckKey = new Map<string, CheckRankWeights>();
  for (const rule of rules) {
    const checkKey = resolveOwningCheckKey(rule, checkDefinitions);
    if (!checkKey) continue;
    const impact = impacts.get(rule.signalKey);
    let weights = byCheckKey.get(checkKey);
    if (!weights) {
      weights = Object.fromEntries(RADAR_PILLARS.map((p) => [p, 0])) as CheckRankWeights;
      byCheckKey.set(checkKey, weights);
    }
    for (const pillar of RADAR_PILLARS) {
      weights[pillar] = Math.max(weights[pillar], impact?.[FINDING_RANK_IMPACT_FIELD[pillar]] ?? 0);
    }
  }
  return byCheckKey;
}

/**
 * Real check key → the War Room pillar its owning signal's
 * `signal_derivation_rules.pillar` names (#521), for `warRoomPillarForCheckKey`
 * to prefer over `WAR_ROOM_PILLAR_CHECK_DOMAINS`. Joins through
 * `resolveOwningCheckKey` — the SAME check-ownership hop `buildFindingRankWeights`
 * uses just above, over the SAME `rules` — rather than a second mapping that
 * could drift from it: a check's pillar and a check's rank-weight column both
 * need to agree on which signal owns the check, and this reuses that answer
 * rather than re-deriving it.
 *
 * `pillar` (not the impact columns `buildFindingRankWeights` reads) is the
 * source here on purpose: since #469 it is the enforced single source of truth
 * for "what pillar does this signal belong to", independent of how many pillars
 * the signal's impact columns happen to carry nonzero weight in.
 *
 * When two rules resolve to the SAME check key but name two DIFFERENT pillars,
 * neither wins — the check is left out of the map entirely, so the caller falls
 * back to the domain map rather than this function guessing between two live,
 * disagreeing classifications. Mirrors `resolveOwningCheckKey`'s own
 * `findings_keyword` tie-break: an ambiguous case is reported as unresolved, not
 * guessed at.
 *
 * Pure; exported for tests.
 */
export function buildCheckKeyPillarMap(
  rules: readonly Pick<SignalDerivationRule, "ruleType" | "sourceKey" | "pillar">[],
  checkDefinitions: readonly RankCheckDefinition[],
): Map<string, WarRoomPillarKey> {
  const pillarsByCheckKey = new Map<string, Set<WarRoomPillarKey>>();
  for (const rule of rules) {
    const pillar = warRoomPillarForRulePillar(rule.pillar);
    if (!pillar) continue;
    const checkKey = resolveOwningCheckKey(rule, checkDefinitions);
    if (!checkKey) continue;
    const pillars = pillarsByCheckKey.get(checkKey) ?? new Set<WarRoomPillarKey>();
    pillars.add(pillar);
    pillarsByCheckKey.set(checkKey, pillars);
  }
  const resolved = new Map<string, WarRoomPillarKey>();
  for (const [checkKey, pillars] of pillarsByCheckKey) {
    if (pillars.size === 1) resolved.set(checkKey, [...pillars][0]!);
  }
  return resolved;
}

/**
 * The order a pillar's findings are presented in, and the order its cap keeps
 * (#414). Severity tier first and always — a warning can never outrank a
 * critical however heavy it is — then the real signal weight, then the
 * pre-existing `checkKey` tiebreak so two identical runs cannot disagree.
 *
 * Pure; exported for tests.
 */
export function compareRankedFindings(a: WarRoomPillarFinding, b: WarRoomPillarFinding): number {
  const severityRank: Record<WarRoomFindingSeverity, number> = { critical: 0, warning: 1 };
  return (
    severityRank[a.severity] - severityRank[b.severity] ||
    b.rankWeight - a.rankWeight ||
    a.checkKey.localeCompare(b.checkKey)
  );
}

/**
 * A purchase link on ONE pillar card (#489).
 *
 * The card shows the recommendation that answers ITS OWN gapped checks, and the
 * tier that chose that recommendation was decided tenant-wide before this was
 * built — so at tier 3 every affected card points at the same single E7 link
 * rather than each card advertising its own add-on. That is the whole point of
 * the consolidation and it would be undone by deciding per card.
 *
 * `checkKeys` is this pillar's real gapped checks only, so the card can name its
 * own evidence rather than the category's full roster.
 */
export interface WarRoomPillarUpgradeLink {
  skuKey: string;
  skuName: string;
  url: string;
  checkKeys: string[];
}

export interface WarRoomPillarCard {
  pillar: WarRoomPillarKey;
  /** The engine pillar this score really came from — provenance, not decoration. */
  enginePillar: RadarPillar;
  /** 0–100, higher = healthier. Null when no evaluable rule feeds it — never fabricated. */
  score: number | null;
  /**
   * WHY `score` is (or is not) a number (#517). `"scored"` means the pillar had
   * enough genuinely evaluable signals behind it to state one;
   * `"insufficient_data"` means it had some but too few, and
   * `"not_evaluated"` means it had none at all. The client renders different,
   * honest copy for each — a bare null let all three read as the same shrug, and
   * a nonzero-but-tiny denominator let the third read as a confident 100.
   */
  evaluation: PillarEvaluation;
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
  /**
   * Purchase links for the licence gaps THIS pillar's own checks reported
   * (#489). Empty for a pillar with no gapped check — never a placeholder.
   */
  licenseGapUpgrades: WarRoomPillarUpgradeLink[];
}

export interface WarRoomPillarStatsPayload {
  pillars: WarRoomPillarCard[];
  /**
   * The tenant-wide licence-gap purchase recommendation (#489): which of the
   * three categories are gapped, and the 1/2/3-tiered call to action that
   * follows. Null when this tenant has no licence gap at all — there is then
   * nothing to recommend and nothing is rendered.
   *
   * Computed ONCE here, tenant-wide, rather than per card or per report,
   * because the tier is a fact about the whole tenant: a report that only sees
   * its own pillar's gaps would count one category and link one add-on for a
   * tenant that is actually gapped in all three and should be seeing E7.
   */
  licenseGapPurchase: LicenseGapPurchase | null;
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
  /**
   * The real `monitor_checks.key` values behind `scannedCheckCount` — the same
   * `fetchScannedCheckKeys` set every `not_in_scan_package` reason above is
   * refined against, just not reduced to a count. A live-rendered report that
   * needs to know WHICH of its own checks actually ran for this tenant (#575:
   * the Adoption report's standfirst naming a workload no check in this
   * tenant's package reads) reads this rather than re-deriving it.
   */
  scannedCheckKeys: string[];
  /**
   * Real `monitor_checks.key` → War Room pillar, for every real check in the
   * catalog — resolved through `warRoomPillarForCheckKey` (#521: rule-derived
   * `signal_derivation_rules.pillar` first, `WAR_ROOM_PILLAR_CHECK_DOMAINS`
   * fallback second), the SAME function `findingsByPillar` above is filed with.
   *
   * Exists so a live consumer streaming per-check results off the diagnostics
   * SSE feed (msp-portal's `scanCheckResults`, #245) can resolve a checkKey to
   * a pillar chip using this exact resolution rather than a second, potentially
   * drifting client-side domain-guessing map (#526). Already the FULL
   * resolution — fallback included — so a client-side miss means the check
   * genuinely maps to no pillar, not that the client needs a fallback of its
   * own.
   */
  checkKeyPillars: Record<string, WarRoomPillarKey>;
  generatedAt: string;
}

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
    return {
      ...base,
      value: null,
      unavailableReason: result.reason,
      // Only present on a licence gap, and only ever the resolver's own value —
      // never synthesised here, so a stat with no named SKU stays un-named.
      ...(result.licenseFeature ? { licenseFeature: result.licenseFeature } : {}),
      source,
    };
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

  const [output, { rules, groups }, pillarTrends, scanned] = await Promise.all([
    calculateArchitectureHealthScore(customerId),
    fetchSignalRulesAndGroups(),
    getPillarScoreTrends(customerId),
    // Resolved ONCE and used for both halves of the card: the scoring
    // denominator below and each stat's `not_in_scan_package` reason further
    // down. Two separate resolutions could disagree, and a stat reading "never
    // scanned" beside a score computed as though it had been is exactly the
    // contradiction #341 removed and #413 finished removing.
    fetchScannedCheckKeys(customerId),
  ]);
  const evaluableSignalKeys = await fetchTenantEvaluableSignalKeys(customerId, rules, {
    firedSignalKeys: output.rawSignals,
    scannedCheckKeys: scanned.checkKeys,
  });
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

  // #414: the real weight each finding is ranked by, for every pillar at once —
  // `fetchPillarFindings` picks the one column that applies once it knows which
  // card a finding lands on. `rules`/`impacts` are the ones already resolved
  // above for scoring — the same numbers the dial uses — so the only new read is
  // the check catalog `resolveOwningCheckKey` needs to walk a rule's sourceKey
  // back to the check that produces it.
  const rankCheckDefinitions: RankCheckDefinition[] = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
    })
    .from(monitorChecksTable);
  const findingRankWeights = buildFindingRankWeights(rules, impacts, rankCheckDefinitions);

  // #521: the same rules/checkDefinitions pair, joined instead to
  // `signal_derivation_rules.pillar` so a finding files under the pillar its own
  // signal was reclassified to rather than its check key's domain prefix.
  const checkKeyPillars = buildCheckKeyPillarMap(rules, rankCheckDefinitions);

  // #526: the FULLY resolved check→pillar table (rule-based above, falling back
  // to `WAR_ROOM_PILLAR_CHECK_DOMAINS` via `warRoomPillarForCheckKey` itself, the
  // exact same call `findingsByPillar` below is filed with) for every real check
  // in the catalog — not just the subset a rule names. Sent on the wire so a live
  // consumer never needs its own domain-guessing fallback: this one table already
  // is the fallback, applied server-side.
  const wireCheckKeyPillars: Record<string, WarRoomPillarKey> = {};
  for (const def of rankCheckDefinitions) {
    const pillar = warRoomPillarForCheckKey(def.key, checkKeyPillars);
    if (pillar) wireCheckKeyPillars[def.key] = pillar;
  }

  const { findingsByPillar, findingsRunId, findingsRunStatus, licenseGapCheckKeys } =
    await fetchPillarFindings(customerId, findingRankWeights, checkKeyPillars);

  // #489. Tenant-wide, from the same run the findings came from, so the tier and
  // the findings beside it can never describe two different scans.
  const licenseGapPurchase = buildLicenseGapPurchase(licenseGapCheckKeys);

  // A check that reported a real licence gap but belongs to none of the three
  // categories is a gap in OUR mapping, not in the tenant — logged for the same
  // reason a wiring-fault stat is: it is silent otherwise, and #441 showed how
  // long silent registry drift can survive. Nothing renders a link from these.
  if (licenseGapPurchase?.uncategorisedCheckKeys.length) {
    log.warn(
      { customerId, checkKeys: licenseGapPurchase.uncategorisedCheckKeys },
      "war-room-pillar-stats: license_gap checks map to no purchase category — no upgrade link can be offered for them",
    );
  }

  /**
   * The links one card shows, grouped by SKU. Derived from the tenant's real
   * gapped keys through `warRoomPillarForCheckKey` — the same function that
   * files a finding under a card — rather than from a second category→pillar
   * table that could disagree with it.
   */
  const upgradesByPillar = new Map<WarRoomPillarKey, WarRoomPillarUpgradeLink[]>();
  for (const checkKey of licenseGapCheckKeys) {
    const pillar = warRoomPillarForCheckKey(checkKey, checkKeyPillars);
    const recommendation: LicenseGapRecommendation | null = recommendationForCheckKey(
      licenseGapPurchase,
      checkKey,
    );
    if (!pillar || !recommendation) continue;

    const list = upgradesByPillar.get(pillar) ?? [];
    const existing = list.find((u) => u.skuKey === recommendation.sku.key);
    if (existing) {
      if (!existing.checkKeys.includes(checkKey)) existing.checkKeys.push(checkKey);
    } else {
      list.push({
        skuKey: recommendation.sku.key,
        skuName: recommendation.sku.name,
        url: recommendation.sku.url,
        checkKeys: [checkKey],
      });
    }
    upgradesByPillar.set(pillar, list);
  }

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
    // `buildPillarViews` covers every RADAR_PILLARS entry, so a missing view is
    // a wiring fault rather than a thin tenant — reported as "not evaluated"
    // rather than silently defaulted to something that sounds measured (#517).
    const evaluation: PillarEvaluation = view?.evaluation ?? {
      status: "not_evaluated",
      score: null,
      evaluableSignalCount: 0,
      minRequiredSignals: MIN_EVALUABLE_SIGNALS_PER_PILLAR,
      theoreticalMax: 0,
      reason: `the engine produced no ${enginePillar} pillar view for this tenant`,
    };

    const stats = WAR_ROOM_PILLAR_STAT_SPECS[pillar].map((spec): WarRoomStat => {
      const base = {
        id: spec.id,
        label: spec.label,
        unit: spec.unit,
        checkKey: null as string | null,
        replaces: spec.replaces,
      };

      if (spec.source.kind === "pillarScore") {
        // #517: the two kinds of "no score" are now told apart here too. A
        // pillar with SOME evaluable coverage that fell below the floor is not
        // the same tenant as one with none, and labelling both
        // "no_evaluable_rules" was the second half of the same lie.
        return score == null
          ? {
              ...base,
              value: null,
              unavailableReason:
                evaluation.status === "insufficient_data" ? "insufficient_data" : "no_evaluable_rules",
              source: `health_engine:${enginePillar}`,
            }
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

    // A stat that can never resolve for anyone is a defect, not a thin tenant.
    // Logged per request rather than once at boot on purpose: the catalog is
    // DB-resident, so a key can stop existing without this process restarting.
    for (const stat of stats) {
      if (isStatWiringFault(stat.unavailableReason)) {
        log.error(
          { customerId, pillar, statId: stat.id, checkKey: stat.checkKey, reason: stat.unavailableReason },
          "war-room-pillar-stats: stat is unresolvable for every tenant — registry sourceKey does not match the live monitor_checks catalog",
        );
      }
    }

    const found = findingsByPillar.get(pillar) ?? [];
    const trendPoints = pillarTrends.get(enginePillar) ?? null;
    return {
      pillar,
      enginePillar,
      score,
      evaluation,
      rawRiskScore: view?.rawRiskScore ?? 0,
      stats,
      findings: found,
      findingCounts: {
        critical: found.filter((f) => f.severity === "critical").length,
        warning: found.filter((f) => f.severity === "warning").length,
      },
      trend: trendPoints
        ? { series: trendPoints.map((p) => p.score), window: `${PILLAR_TREND_WINDOW_DAYS}d` }
        : null,
      licenseGapUpgrades: upgradesByPillar.get(pillar) ?? [],
    };
  });

  return {
    pillars,
    licenseGapPurchase,
    findingsRunId,
    findingsRunStatus,
    activeRunId: activeRun?.runId ?? null,
    scannedPackageKeys: scanned.packageKeys,
    scannedCheckCount: scanned.checkKeys?.size ?? 0,
    scannedCheckKeys: scanned.checkKeys ? Array.from(scanned.checkKeys) : [],
    checkKeyPillars: wireCheckKeyPillars,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Real findings of the most recent run that OWNS any, grouped per pillar with
 * critical before warning. Mid-scan that is the previous run — reported with its
 * own id/status so the caller never presents it as the run in flight.
 *
 * `rankWeights` (#414) orders findings WITHIN a severity tier by their real
 * signal weight. Every real critical/warning finding is returned — there is
 * no per-pillar cap here or downstream — but the order still matters: it is
 * what the radar and every other projection (headline, satellite, chips) read
 * as "worst first". This list used to be sorted alphabetically by `checkKey`,
 * which is how a heavily-weighted finding could lose the headline slot to one
 * that merely sorted earlier.
 *
 * Which of a check's seven weights applies is decided HERE (corrected
 * 2026-08-06), because this is the first point at which the pillar is known:
 * `warRoomPillarForCheckKey` files the finding, `WAR_ROOM_ENGINE_PILLAR`
 * translates that to the engine pillar the card was actually scored as, and
 * `FINDING_RANK_IMPACT_FIELD` names that pillar's own impact column.
 *
 * `checkKeyPillars` (#521, `buildCheckKeyPillarMap`) is what `warRoomPillarForCheckKey`
 * uses to file a finding by its check's real `signal_derivation_rules.pillar`
 * before falling back to the domain map — passed in so the caller resolves it
 * once from the same `rules`/`checkDefinitions` pair `rankWeights` was built
 * from, rather than this function re-deriving it.
 */
async function fetchPillarFindings(
  customerId: number,
  rankWeights: ReadonlyMap<string, CheckRankWeights>,
  checkKeyPillars: ReadonlyMap<string, WarRoomPillarKey>,
): Promise<{
  findingsByPillar: Map<WarRoomPillarKey, WarRoomPillarFinding[]>;
  findingsRunId: string | null;
  findingsRunStatus: string | null;
  licenseGapCheckKeys: string[];
}> {
  const findingsByPillar = new Map<WarRoomPillarKey, WarRoomPillarFinding[]>();

  const [latest] = await db
    .select({ runId: mspDiagnosticFindingsTable.runId })
    .from(mspDiagnosticFindingsTable)
    .where(eq(mspDiagnosticFindingsTable.customerId, customerId))
    .orderBy(desc(mspDiagnosticFindingsTable.createdAt))
    .limit(1);

  if (!latest) {
    return {
      findingsByPillar,
      findingsRunId: null,
      findingsRunStatus: null,
      licenseGapCheckKeys: [],
    };
  }

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

  for (const row of rows) {
    const pillar = warRoomPillarForCheckKey(row.checkKey, checkKeyPillars);
    if (!pillar) continue;
    const list = findingsByPillar.get(pillar) ?? [];
    list.push({
      severity: row.severity as WarRoomFindingSeverity,
      checkKey: row.checkKey,
      title: row.title,
      rankWeight: rankWeights.get(row.checkKey)?.[WAR_ROOM_ENGINE_PILLAR[pillar]] ?? 0,
    });
    findingsByPillar.set(pillar, list);
  }
  // Severity tier first (unchanged), then real signal weight (#414), then the
  // pre-existing check-key tiebreak so two identical runs can't disagree.
  for (const list of findingsByPillar.values()) list.sort(compareRankedFindings);

  // #489. The licence gaps of the SAME run, read separately because they are
  // deliberately not in the query above: `diagnostics-runner` classifies a
  // `license_gap` as severity `info` (a licence tier is not a security finding),
  // and the card's finding list is critical/warning only. So the pillar cards
  // have never carried them and this second read is the only way the run's real
  // licence gaps reach the payload at all.
  //
  // Keyed off `check_status`, the raw status `diagnostics-runner` stamps on the
  // row, rather than off the recommendation JSON or the finding title: that
  // column is the classification itself, and matching on prose would break the
  // moment #484-#495's wording is edited.
  const gapRows = await db
    .select({ checkKey: mspDiagnosticFindingsTable.checkKey })
    .from(mspDiagnosticFindingsTable)
    .where(
      and(
        eq(mspDiagnosticFindingsTable.runId, latest.runId),
        eq(mspDiagnosticFindingsTable.checkStatus, "license_gap"),
      ),
    );

  const [runRow] = await db
    .select({ status: mspDiagnosticRunsTable.status })
    .from(mspDiagnosticRunsTable)
    .where(eq(mspDiagnosticRunsTable.runId, latest.runId))
    .limit(1);

  return {
    findingsByPillar,
    findingsRunId: latest.runId,
    findingsRunStatus: runRow?.status ?? null,
    licenseGapCheckKeys: gapRows.map((r) => r.checkKey),
  };
}
