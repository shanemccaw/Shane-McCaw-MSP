/**
 * copilotReadinessReport.ts — the real Copilot Readiness, Safety & Enablement
 * Report, as data (#409).
 *
 * This is the live counterpart to `previewDocumentBodies.ts`'s
 * `COPILOT_READINESS_REPORT`: the same ordered-block structure the design
 * approved, built from one real tenant's own `war-room-pillars` payload and the
 * three AI-written sections from `/portal/assessment/copilot-readiness-narrative`
 * instead of from Halden Materials' worked example.
 *
 * A pure `.ts` and not inlined into the renderer for two reasons — `node --test`
 * cannot load `.tsx`, so the rules below are testable; and the platform's
 * no-hardcoding rule keeps seat counts and dollar figures out of `.tsx`. Every
 * number here arrives from the wire; none is written down.
 *
 * ── TWO STRUCTURAL CHANGES SHANE APPROVED ────────────────────────────────────
 *   1. "Copilot Drift & Violations" is DROPPED entirely. The design's version
 *      cites "37 tenant configuration changes with no recorded review", a Safe
 *      Links policy disabled on a named date, and labels removed from 148 sites
 *      — none of which has a producer. The registry's drift metrics
 *      (`drift:ca-policy`, `drift:security-defaults`, …) are not among the 28
 *      stats `war-room-pillars` resolves, so there is nothing real to put in
 *      that section and it is absent rather than approximated.
 *   2. "Personas ready today" is DROPPED from the Readiness Summary. Personas
 *      are a War Room-era feature out of scope for this document, and the
 *      platform holds no per-tenant persona readiness count anyway.
 *
 * ── THE RULE EVERY PURE-DATA SECTION FOLLOWS ─────────────────────────────────
 * A row is rendered ONLY from a stat with a real, finite `value`. A stat with a
 * null value never becomes a row — not a zero, not an em dash inside a
 * severity-coloured value, not "not measured" dressed as a finding. Those are
 * collected instead into one honest `unavailable` block per section, which
 * names the real `monitor_checks` key and the resolver's own machine reason, so
 * "this check never ran" (`not_in_scan_package`) stays distinguishable from
 * "it ran and reported nothing" (`no_data`) — the distinction #341 exists to
 * draw, carried all the way to the customer's report.
 *
 * A section with no real rows AND no missing checks to name renders nothing at
 * all rather than an empty table.
 *
 * ── THE THIRD CATEGORY (#451) ────────────────────────────────────────────────
 * One reason is deliberately NOT in that honest `unavailable` block any more.
 * `license_gap` — "this check reads a capability your tenant is not licensed
 * for" — is neither a finding (nothing is wrong) nor one of #441's wiring
 * faults (nothing of ours is broken). It is the one unavailability with a real
 * remediation attached, and it now has its own "Upgrade Opportunities" section
 * with per-check copy naming what the tier would make measurable. See
 * `LICENCE_GAP_REASON` for the full three-way distinction, and
 * `LICENCE_GAP_DISCLOSURES` for the rule that stops that copy inventing a SKU.
 *
 * ── WHY TONE COMES FROM THE PILLAR, NOT THE NUMBER ───────────────────────────
 * `keyValues` rows carry a severity tone. Deriving one per stat would mean
 * inventing a threshold per metric ("how many legacy sign-ins is amber?"), and
 * this platform's own severity thresholds live in `severity_rules`, in the
 * database, per check — not here. So a row takes the band of the pillar it
 * belongs to via `severityForScore`, which is the platform's existing, real
 * severity for that area and the same band the reader already saw on the Reveal
 * and in the header's pillar strip. A pillar with no score yields a neutral
 * "attention" tone and says so in the row's own text.
 */

import {
  COPILOT_GATE_TARGET,
  PILLARS,
  severityForScore,
  type PillarKey,
  type Severity,
} from "./journeyTokens.ts";
import type { JourneyPillarView, JourneyView, WirePillarStat } from "./journeyModel.ts";
import type { PreviewKeyValueRow, ReportBlock, ReportSection } from "./previewDocumentBodies.ts";

/* ------------------------------------------------------------------ *
 * The narrative wire shape — mirrors the api-server route's response
 * ------------------------------------------------------------------ */

export type ReadinessNarrativeSectionKey = "safety" | "enablement" | "blockers";

export interface WireNarrativeSection {
  readonly key: ReadinessNarrativeSectionKey;
  readonly heading: string;
  readonly html: string | null;
  readonly omittedReason: string | null;
  readonly factCount: number;
  readonly missingChecks?: readonly UnavailableCheck[];
}

export interface WireNarrativePayload {
  readonly sections: readonly WireNarrativeSection[];
  readonly gate?: { readonly score: number | null; readonly threshold: number; readonly status: string | null };
  readonly scannedCheckCount?: number;
  readonly scannedPackageKeys?: readonly string[];
}

/* ------------------------------------------------------------------ *
 * Blocks — the shared vocabulary plus the two this report needs
 * ------------------------------------------------------------------ */

/**
 * A block the shared `ReportBlocks.tsx` renderer does not know about, handled
 * by this report's own renderer before it delegates. Deliberately additive
 * rather than widening `ReportBlock`: widening it would force every `switch` in
 * the preview path to grow cases for shapes the design's fixtures can never
 * produce, for no benefit.
 */
export type ReadinessExtraBlock =
  /** One AI-written section's sanitised HTML fragment. */
  | { readonly kind: "narrative"; readonly html: string }
  /**
   * The honest empty state. `checks` names what the platform wanted and did
   * not get; `detail` says what that means. Never styled as a finding.
   */
  | {
      readonly kind: "unavailable";
      readonly detail: string;
      readonly checks: readonly { readonly checkKey: string; readonly reason: string }[];
    }
  /**
   * The Upgrade Opportunity category (#451) — checks gated behind a licence
   * tier this tenant does not hold. Its own block kind, not a variant of
   * `unavailable` and not a `keyValues` row, because it is neither a coverage
   * apology nor a severity finding; see `LICENCE_GAP_REASON`.
   */
  | {
      readonly kind: "upgradeOpportunity";
      readonly detail: string;
      readonly items: readonly UpgradeOpportunity[];
    };

export type ReadinessBlock = ReportBlock | ReadinessExtraBlock;

export interface ReadinessSection {
  readonly heading: string;
  readonly blocks: readonly ReadinessBlock[];
}

export interface ReadinessReport {
  readonly kicker: string;
  readonly headline: string;
  readonly standfirst: string;
  readonly verdict: { readonly eyebrow: string; readonly headline: string; readonly sub: string };
  readonly sections: readonly ReadinessSection[];
  readonly closing: readonly string[];
  readonly provenance: string;
  /** The note beside the radar, derived from this tenant's own scores. */
  readonly radarNote: string;
}

/* ------------------------------------------------------------------ *
 * Stat helpers
 * ------------------------------------------------------------------ */

/** A real stat: one that carries a real, finite number. */
export type RealStat = WirePillarStat & { readonly value: number };

/**
 * A stat is quotable only when it carries a real, finite number.
 *
 * The predicate narrows to `RealStat` rather than to `WirePillarStat`, which
 * matters: narrowing to the whole type would make the ELSE branch `undefined`,
 * and the else branch is exactly where a stat that exists but has no value
 * lives — the one this report has to name as a missing check.
 */
export function isRealStat(stat: WirePillarStat | undefined): stat is RealStat {
  return !!stat && typeof stat.value === "number" && Number.isFinite(stat.value);
}

/**
 * Render a real stat value. No rounding or bucketing: this is the same number
 * the Reveal's chips show for the same tenant, and two surfaces disagreeing
 * about one figure is the failure the whole journey is built to avoid.
 */
export function formatStat(stat: RealStat): string {
  const value = stat.value;
  if (stat.unit === "percent") return `${Math.round(value)}%`;
  // Currency stats arrive in whole dollars from `war-room-pillar-stats.ts`'s
  // `centsToDollars` — NOT in cents like the Reveal's chip formatter assumes
  // for its own inputs. Formatted as given rather than divided again.
  if (stat.unit === "currency") return `$${Math.round(value).toLocaleString("en-US")}`;
  return Math.round(value).toLocaleString("en-US");
}

/**
 * Reasons that are OUR defect, not a fact about this tenant.
 *
 * Mirrors `WAR_ROOM_STAT_WIRING_FAULT_REASONS` in api-server's
 * war-room-pillar-stats.ts. Copied rather than imported because msp-portal and
 * api-server are separate apps with no shared module between them other than
 * `lib/*`; the two lists are asserted equal by a test on both sides, the same
 * way `WAR_ROOM_PILLAR_KEYS` is.
 *
 * `no_data`, `not_in_scan_package`, `license_gap`, `no_seat_data`,
 * `no_sku_prices` and `not_collected` all answer "what does your scan carry",
 * which is exactly what the unavailable block is for and stays visible. These
 * three answer "is our registry correct", and #441 is what happens when they do
 * not: a paying customer read `usage:teams-activity — not wired to a check in
 * the catalogue` in their own readiness report, under a heading claiming it was
 * a figure their scan does not carry. It was not. The key was misspelt at our
 * end and the check it named has never existed.
 *
 * They are dropped from the customer's document, NOT swallowed: api-server logs
 * every one of them at `error` on the `engine.dashboard` channel as it builds
 * the payload, and `registry-source-key-contract.test.ts` fails the build if a
 * document's grounding names a key the catalog does not have.
 */
export const WIRING_FAULT_REASONS: readonly string[] = [
  "unknown_check_key",
  "unknown_metric_key",
  "resolver_error",
];

/** True when a stat's unavailability is a platform wiring bug, not tenant data. */
export function isWiringFault(reason: string | undefined): boolean {
  return reason != null && WIRING_FAULT_REASONS.includes(reason);
}

/** Human wording for the resolver's machine reason. Never invents a cause. */
export function unavailableReasonText(reason: string | undefined): string {
  switch (reason) {
    case "not_in_scan_package":
      return "not included in the scan package this tenant has run";
    case "no_data":
      return "in the scan, but reported no value";
    case "license_gap":
      return "requires a licence tier this tenant does not hold";
    case "not_collected":
      return "not collected by any check this platform runs yet";
    case "unknown_check_key":
    case "unknown_metric_key":
      return "not wired to a check in the catalogue";
    case "no_seat_data":
      return "no subscribed-SKU data for this tenant";
    case "no_sku_prices":
      return "no priced SKU to value it against";
    case "resolver_error":
      return "failed to resolve on the last run";
    case "non_numeric_value":
      return "returned a value that is not a number";
    case "no_evaluable_rules":
      return "no evaluable rule feeds it";
    default:
      return reason ? `unavailable (${reason})` : "unavailable";
  }
}

/* ------------------------------------------------------------------ *
 * The third category — a licence gap is not a finding and not our bug (#451)
 * ------------------------------------------------------------------ */

/**
 * The resolver reason that means "this tenant is not licensed for the
 * capability this check reads".
 *
 * It is deliberately NOT one of the `WIRING_FAULT_REASONS` above and
 * deliberately not a severity either, and #451 exists because the report had
 * only those two shelves to put it on. A licence gap is a genuinely different
 * third thing:
 *
 *   critical / warning   → "something in your tenant is wrong"
 *   WIRING_FAULT_REASONS → "something in OUR registry is wrong" (dropped)
 *   license_gap          → "this is currently unknown, and here is what
 *                           would make it knowable"
 *
 * Folding it into the severity ladder would colour a licensing fact as risk;
 * leaving it in the `unavailable` block filed it under "gaps in what was
 * collected", which is true but reads as an apology and buries the one thing
 * about it that is actionable. It gets its own category instead.
 */
export const LICENCE_GAP_REASON = "license_gap";

/** True when a check's unavailability is a licence tier, not a fault of any kind. */
export function isLicenceGap(reason: string | undefined): boolean {
  return reason === LICENCE_GAP_REASON;
}

/**
 * One unavailable check as this report receives it — from `buildRows`, from the
 * hand-written prerequisite list, or from the narrative route's `missingChecks`.
 *
 * `licenseFeature` is present only on a licence gap and only when the tenant's
 * own scan named the missing add-on (`WarRoomStat.licenseFeature`, ultimately
 * monitor-executor's `_licenseGapFeature`).
 */
export interface UnavailableCheck {
  readonly checkKey: string;
  readonly reason: string;
  readonly licenseFeature?: string;
}

/**
 * What one gated check would make measurable, in three parts so the composed
 * sentence stays identical in shape for every check and cannot drift into a
 * pitch one entry at a time.
 *
 * Composed as `Requires {requires}. Upgrading unlocks {unlocks} — {means}` —
 * which reproduces Shane's two approved lines VERBATIM. Do not reword the
 * template without re-checking those two against the issue text.
 *
 * ── `requires` IS A CLAIM, SO IT IS ONLY WRITTEN WHERE IT CAN BE CONFIRMED ───
 * Non-null on exactly the three checks whose required tier is fixed by
 * Microsoft's own licensing of the endpoint they read, not by anything about
 * this tenant:
 *
 *   identity:mfa-registration   /reports/authenticationMethods/
 *                               userRegistrationDetails — the authentication
 *                               methods activity report, Entra ID P1/P2.
 *   identity:legacy-auth-usage  /auditLogs/signIns — the sign-in logs,
 *                               Entra ID P1/P2.
 *   identity:risky-users        /identityProtection/riskyUsers — Microsoft
 *                               Entra ID Protection's risk reports, P2.
 *
 * Those three are also the only ones this platform can independently
 * corroborate: `classifyGraphError`'s `ENTRA_PREMIUM_ERROR_CODES` path is what
 * turns their failure into a licence gap in the first place, and it names the
 * same family.
 *
 * `requires: null` everywhere else is not laziness — every other check's
 * endpoint and mapping live in `monitor_checks` (DB-resident), so the repo
 * cannot confirm a tier for them. Those entries name no tier of their own and
 * fall back to the one the tenant's OWN scan reported, or to naming none at
 * all. A wrong SKU in a customer's report is worse than an unnamed one.
 */
interface LicenceGapDisclosure {
  /** The confirmed tier, without the word "Requires". Null when unconfirmable. */
  readonly requires: string | null;
  /** What holding it makes measurable. Must read after both "Upgrading unlocks" and "cannot read". */
  readonly unlocks: string;
  /** What the empty result does and does not mean. Always ends the disclosure. */
  readonly means: string;
}

/**
 * Every check behind a stat this document can render, so a licence gap on any
 * of them has real copy rather than a generic line.
 *
 * The key set is the 18 distinct `monitor_checks` keys behind
 * `WAR_ROOM_PILLAR_STAT_SPECS`' 28 stats — the complete universe of check keys
 * that can reach this report as a licence gap, whether through a stat pick here
 * or through the narrative route's `missingChecks`.
 */
const LICENCE_GAP_DISCLOSURES: Readonly<Record<string, LicenceGapDisclosure>> = {
  // ── The two lines Shane approved, reproduced exactly by the template ───────
  "identity:mfa-registration": {
    requires: "Microsoft Entra ID P1 or P2",
    unlocks: "per-user MFA registration status across your org",
    means: "right now this is a real blind spot in the Security pillar, not a confirmed pass.",
  },
  "identity:legacy-auth-usage": {
    requires: "Microsoft Entra ID P1 or P2",
    unlocks: "visibility into legacy authentication sign-ins",
    means: "one of the most common real attack vectors, and currently invisible to this scan.",
  },

  // ── The third confirmable tier ────────────────────────────────────────────
  "identity:risky-users": {
    requires: "Microsoft Entra ID P2",
    unlocks:
      "the Microsoft Entra ID Protection risky-user list, meaning the accounts Microsoft has itself flagged as compromised or at risk",
    means:
      "the Copilot pillar carries no risky-user figure at all today, which is an absence of data rather than a count of zero.",
  },

  // ── Tier unconfirmable from this repo; named only from the tenant's scan ──
  "identity:global-admin-count": {
    requires: null,
    unlocks: "how many accounts hold the Global Administrator role",
    means:
      "the privileged-account line in Technical Prerequisites is empty for that reason, not because no standing admins were found.",
  },
  "copilot:overshare-exposure": {
    requires: null,
    unlocks:
      "the count of items reachable beyond their intended audience, which is the blast radius Copilot would inherit",
    means:
      "Governance, Security and Copilot all quote this same figure, so all three are silent on exposure rather than clear of it.",
  },
  "compliance:sharepoint-sites": {
    requires: null,
    unlocks: "the SharePoint site inventory every site-scoped figure in this report counts against",
    means:
      "without it those lines are absent rather than estimated, and no site total should be inferred from elsewhere in this document.",
  },
  "compliance:overshared-sites": {
    requires: null,
    unlocks: "which SharePoint sites are shared more widely than their content warrants",
    means: "no overshared-site count was read, and that is not a finding of zero overshared sites.",
  },
  "compliance:public-channels": {
    requires: null,
    unlocks: "how many Teams channels are open to everyone in the tenant",
    means: "the Governance pillar is silent on public channels rather than clear of them.",
  },
  "compliance:missing-labels": {
    requires: null,
    unlocks: "how much of your content carries no sensitivity label",
    // Deliberately descriptive only. An earlier draft added "unlabelled content
    // is a direct determinant of what Copilot may surface" — true, and the
    // reason this check exists, but it argues why the gap matters rather than
    // stating what the gap is, which is the line this category does not cross.
    means:
      "no labelling figure was read, so this report neither confirms nor disputes your labelling coverage.",
  },
  "compliance:retention-drift": {
    requires: null,
    unlocks: "where retention coverage has drifted from the policy that was meant to apply",
    means:
      "no drift figure was read, so the Compliance pillar neither confirms nor disputes that retention is holding.",
  },
  "compliance:weak-dlp-policies": {
    requires: null,
    unlocks:
      "which Data Loss Prevention policies are configured too weakly to stop the leak they were written to stop",
    means: "no DLP posture was read, so nothing here says your policies are sound, or that they are not.",
  },
  "compliance:guest-users": {
    requires: null,
    unlocks: "how many guest accounts hold standing access to your tenant",
    means: "no guest count was read, so no claim is made about external access either way.",
  },
  "licensing:inactive-user-licenses": {
    requires: null,
    unlocks: "which licences are still assigned to users who are no longer active",
    means:
      "the Licensing pillar's gap line is empty for that reason, not because every assigned licence was found to be in use.",
  },
  "licensing:duplicate-assignments": {
    requires: null,
    unlocks: "which users hold two licences granting the same capability",
    means: "no duplicate-assignment figure was read, and none should be inferred as zero.",
  },
  "intune:non-compliant-devices": {
    requires: null,
    unlocks: "how many enrolled devices fail your own Intune compliance baseline",
    means: "device compliance is unmeasured in this report, not confirmed.",
  },
  "intune:config-drift": {
    requires: null,
    unlocks: "which devices have drifted from the configuration profile assigned to them",
    means: "no drift count was read, so nothing here says your device configuration is holding.",
  },
  "intune:unencrypted-devices": {
    requires: null,
    unlocks: "which enrolled devices report no disk encryption",
    means: "encryption coverage is unknown in this report rather than verified.",
  },
  "intune:outdated-devices": {
    requires: null,
    unlocks: "which devices are running an operating-system build behind your baseline",
    means: "OS currency is unmeasured here, not confirmed current.",
  },
};

/**
 * The placeholder `dashboard-resolvers.ts` substitutes when a licence gap
 * carries no feature name at all. It is not a SKU and must never be printed as
 * one — matched by prefix so both the resolver's own wording and
 * `classifyGraphError`'s "…add-on license" variant are caught.
 */
const UNNAMED_FEATURE_PREFIX = "a required microsoft 365 add-on";

/** The observed add-on name, or null when what arrived names no real SKU. */
function namedFeature(feature: string | undefined): string | null {
  const trimmed = feature?.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().startsWith(UNNAMED_FEATURE_PREFIX) ? null : trimmed;
}

/**
 * True for the Purview feature names monitor-executor stamps on the PowerShell
 * path, where the cause is genuinely ambiguous.
 *
 * Its own comment is explicit that a `cmdlet_unavailable` means EITHER a
 * Purview licensing gap OR this platform not yet being in the Purview role
 * group that registers the cmdlet, and that "the two are indistinguishable from
 * the error text alone". Printing "Requires Microsoft Purview DLP" over that
 * would assert a purchase the evidence does not support, so those gaps say so
 * instead.
 */
function isAmbiguousPurviewFeature(feature: string): boolean {
  return feature.toLowerCase().includes("purview");
}

/**
 * The disclosure line for one gated check. Pure, and never invents a SKU:
 * a tier is named only when this file could confirm it or the tenant's own scan
 * reported it.
 */
export function licenceGapDisclosure(check: UnavailableCheck): string {
  const entry = LICENCE_GAP_DISCLOSURES[check.checkKey];
  const observed = namedFeature(check.licenseFeature);

  if (!entry) {
    // A check with a stat but no written disclosure yet — still declared, still
    // honest, just without the per-check specifics.
    return observed
      ? `Requires ${observed}. Your tenant is not licensed for the capability this check reads, so it returned nothing — an unknown result, not a pass.`
      : "Your tenant is not licensed for the capability this check reads, so it returned nothing. The scan did not name the tier required, so none is named here — the result is unknown, not a pass.";
  }

  if (observed && !entry.requires && isAmbiguousPurviewFeature(observed)) {
    return `Gated behind ${observed}. Microsoft's response cannot separate a licensing gap from this platform not yet holding the Purview role group that exposes it, so neither is asserted here. Either way, this assessment cannot read ${entry.unlocks} — ${entry.means}`;
  }

  const requires = entry.requires ?? observed;
  return requires
    ? `Requires ${requires}. Upgrading unlocks ${entry.unlocks} — ${entry.means}`
    : `This assessment cannot read ${entry.unlocks} — ${entry.means} The scan reported a Microsoft 365 licence gap but did not name the tier, so none is named here.`;
}

/** One rendered row of the Upgrade Opportunity category. */
export interface UpgradeOpportunity {
  readonly checkKey: string;
  readonly disclosure: string;
}

/**
 * Split a list of unavailable checks into the licence gaps and everything else.
 *
 * Every section runs its own list through this so a licence gap is reported
 * ONCE, in its own category, instead of twice — once as a coverage gap and once
 * as an upgrade opportunity.
 */
export function splitLicenceGaps(checks: readonly UnavailableCheck[]): {
  readonly gaps: readonly UnavailableCheck[];
  readonly rest: readonly UnavailableCheck[];
} {
  const gaps: UnavailableCheck[] = [];
  const rest: UnavailableCheck[] = [];
  for (const check of checks) (isLicenceGap(check.reason) ? gaps : rest).push(check);
  return { gaps, rest };
}

/**
 * The category's rows, deduplicated by check key in first-seen order.
 *
 * Deduplication is load-bearing rather than tidy: `copilot:overshare-exposure`
 * backs three separate stats on three pillars, so one licence gap on it would
 * otherwise print the same paragraph three times and read as three problems.
 */
export function upgradeOpportunities(
  checks: readonly UnavailableCheck[],
): readonly UpgradeOpportunity[] {
  const seen = new Set<string>();
  const rows: UpgradeOpportunity[] = [];
  for (const check of checks) {
    if (!isLicenceGap(check.reason) || seen.has(check.checkKey)) continue;
    seen.add(check.checkKey);
    rows.push({ checkKey: check.checkKey, disclosure: licenceGapDisclosure(check) });
  }
  return rows;
}

/**
 * The category's own framing line. Says what the category is before any row is
 * read, so no row has to carry that weight on its own — and says plainly that
 * an unread check is not a passed one.
 */
export const UPGRADE_OPPORTUNITY_HEADING = "Upgrade Opportunities";

export const UPGRADE_OPPORTUNITY_DETAIL =
  "These checks returned nothing because your tenant does not hold the Microsoft 365 licence tier they read from. That is not a finding about your configuration and it is not a pass — each one is a measurement this assessment could not take, and each is listed with what holding that tier would make visible. Nothing below is scored, and none of it counts against your readiness figure.";

/** The pillar's own severity band — see the header for why not the number's. */
function pillarTone(pillar: JourneyPillarView | undefined): Severity {
  return typeof pillar?.score === "number" ? severityForScore(pillar.score) : "attention";
}

interface StatPick {
  /** The stat id as `war-room-pillar-stats.ts` names it — never matched on label. */
  readonly statId: string;
  readonly pillar: PillarKey;
  /** The row label. The stat's own caption is appended as the value's unit. */
  readonly label: string;
  /** Reads better than the raw caption in a prerequisites table. */
  readonly caption: string;
}

function findStat(pillars: readonly JourneyPillarView[], pick: StatPick): WirePillarStat | undefined {
  return pillars.find((p) => p.key === pick.pillar)?.stats.find((s) => s.id === pick.statId);
}

interface BuiltRows {
  readonly rows: readonly PreviewKeyValueRow[];
  readonly missing: readonly UnavailableCheck[];
}

/**
 * Turn a list of wanted stats into real rows plus a list of what was missing.
 *
 * Rows keep the order of `picks`, not of the payload, so the table reads the
 * same way for every tenant regardless of which of its checks reported.
 */
function buildRows(pillars: readonly JourneyPillarView[], picks: readonly StatPick[]): BuiltRows {
  const rows: PreviewKeyValueRow[] = [];
  const missing: UnavailableCheck[] = [];

  for (const pick of picks) {
    const stat = findStat(pillars, pick);
    const pillar = pillars.find((p) => p.key === pick.pillar);
    if (isRealStat(stat)) {
      rows.push({
        label: pick.label,
        tone: pillarTone(pillar),
        value: `${formatStat(stat)} ${pick.caption}`,
      });
    } else if (stat?.checkKey && !isWiringFault(stat.unavailableReason)) {
      // A wiring fault is not a gap in THIS tenant's assessment and must not be
      // reported to them as one — see WIRING_FAULT_REASONS for why that is a
      // classification, not a suppression.
      missing.push({
        checkKey: stat.checkKey,
        reason: stat.unavailableReason ?? "no_data",
        // Only ever the stat's own observed value — never inferred from the key.
        ...(stat.licenseFeature ? { licenseFeature: stat.licenseFeature } : {}),
      });
    }
  }

  return { rows, missing };
}

/** One `keyValues` block, or nothing when no row is real. */
function keyValuesBlock(rows: readonly PreviewKeyValueRow[]): ReadinessBlock[] {
  return rows.length ? [{ kind: "keyValues", rows }] : [];
}

/**
 * One honest `unavailable` block, or nothing when there is nothing to declare.
 *
 * Licence gaps are stripped here rather than at every call site: they are a
 * category of their own now (#451), and leaving them in would file "you are not
 * licensed for this" under "gaps in what was collected" as well, reporting one
 * fact twice under two different meanings.
 */
function unavailableBlock(detail: string, checks: readonly UnavailableCheck[]): ReadinessBlock[] {
  const { rest } = splitLicenceGaps(checks);
  return rest.length ? [{ kind: "unavailable", detail, checks: rest }] : [];
}

/* ------------------------------------------------------------------ *
 * Section 1 — Copilot Readiness Summary
 * ------------------------------------------------------------------ */

/**
 * The blast-radius row, from the stats the platform already computes.
 *
 * NOT a new computation, and NOT the design's ring diagram. `security.blastRadius`
 * ("items in blast radius") and `governance.exposure` ("items over-exposed") are
 * the SAME real metric — `copilot.overshareExposureCount`, over
 * `copilot:overshare-exposure` — deliberately shown on both cards, and it is
 * already what the Reveal's Security pillar quotes. The design's five-ring
 * figure has no real backing at all (its ring values are Halden's), so the row
 * states the real over-exposure count and the real site counts around it rather
 * than plotting invented radii.
 */
export function blastRadiusRows(pillars: readonly JourneyPillarView[]): BuiltRows {
  return buildRows(pillars, [
    { statId: "security.blastRadius", pillar: "security", label: "Copilot blast radius", caption: "items reachable beyond their intended audience" },
    { statId: "governance.overshared", pillar: "governance", label: "Overshared sites", caption: "sites shared more widely than their content warrants" },
    { statId: "governance.sites", pillar: "governance", label: "Sites in scope", caption: "SharePoint sites inventoried by this scan" },
  ]);
}

/**
 * The radar's note, derived from this tenant's own scores.
 *
 * Names the highest and lowest scoring pillars only when at least two pillars
 * were actually scored — with one score there is no shape to describe, and the
 * design's own sentence ("Licensing is closest to ready, Compliance furthest
 * from it") is a claim about its stand-in tenant that must never be inherited.
 */
export function buildRadarNote(view: JourneyView): string {
  const scannedClause = view.tenant.scannedOn ? `, read on ${view.tenant.scannedOn}` : "";
  const scored = view.pillars.filter((p) => typeof p.score === "number");
  if (scored.length < 2) {
    return `Readiness contribution by pillar${scannedClause}. A pillar with no score is one no evaluable rule fed — it plots at the centre and asserts nothing.`;
  }
  const sorted = [...scored].sort((a, b) => (b.score as number) - (a.score as number));
  const best = sorted[0];
  const worst = sorted[sorted.length - 1];
  return `Readiness contribution by pillar${scannedClause}. The shape is the argument: ${PILLARS[best.key].label} is closest to ready at ${best.score}, ${PILLARS[worst.key].label} furthest from it at ${worst.score}.`;
}

/* ------------------------------------------------------------------ *
 * Section 2 — Technical Prerequisites & Platform Alignment
 * ------------------------------------------------------------------ */

/**
 * The prerequisites the platform genuinely measures, confirmed against the
 * registry's real `sourceKey`s rather than the design's row labels.
 *
 * WHAT THE DESIGN ASKED FOR AND WHY TWO ROWS ARE ABSENT:
 *   • "Conditional Access — no policy scoped to privileged roles" has NO real
 *     producer. `war-room-pillar-stats.ts` records this outright in its own
 *     unproducible list: "CA policies (identity:ca-policy-count has no
 *     DASHBOARD_METRICS entry)". Re-checked against `lib/dashboard-registry`
 *     for this issue — the registry holds `security:conditional-access-failures`
 *     (a failure count, not a policy count) and `drift:ca-policy` (a drift
 *     count), and neither answers "is a policy scoped to privileged roles".
 *     So the row is declared missing by name in the section's own unavailable
 *     block rather than silently dropped or filled from a near-miss metric.
 *   • "Workload stability — OneDrive activated for N% of the estate" needs a
 *     denominator no check provides. This note used to add that the numerator
 *     lived in the adoption section as `usage:onedrive-active`; #441 found that
 *     key names nothing in the catalog, so there is no numerator either. Both
 *     halves are missing, not just the denominator.
 */
const PREREQUISITE_PICKS: readonly StatPick[] = [
  { statId: "security.legacyAuth", pillar: "security", label: "Authentication & identity", caption: "legacy authentication sign-ins" },
  { statId: "security.mfaRegistered", pillar: "security", label: "MFA registration", caption: "users registered for multi-factor authentication" },
  { statId: "security.globalAdmins", pillar: "security", label: "Privileged accounts", caption: "global administrators" },
  { statId: "health.nonCompliantDevices", pillar: "health", label: "Device compliance", caption: "devices failing the compliance baseline" },
  { statId: "health.unencrypted", pillar: "health", label: "Device encryption", caption: "devices with no encryption reported" },
  { statId: "health.outdated", pillar: "health", label: "Operating system currency", caption: "devices on an outdated OS build" },
  { statId: "licensing.provisioned", pillar: "licensing", label: "Licensing baseline", caption: "paid seats provisioned" },
  { statId: "licensing.unassigned", pillar: "licensing", label: "Licensing headroom", caption: "paid seats provisioned but unassigned" },
  { statId: "licensing.inactive", pillar: "licensing", label: "Licence gaps", caption: "licences assigned to inactive users" },
];

/**
 * The one prerequisite the design names that this platform cannot measure at
 * all — not for this tenant, but anywhere. Kept as the in-code record that it
 * was decided rather than lost.
 *
 * NOT rendered to the customer since #441, and its own reason says why:
 * `identity:ca-policy-count` is a real, active check (it is sort_order 2 in
 * `core:security-baseline`) that simply has no `DASHBOARD_METRICS` entry to
 * consume it. That is a wiring gap at our end, so it was reaching the reader as
 * "identity:ca-policy-count — not wired to a check in the catalogue" in a
 * section about gaps in THEIR assessment, which is both wrong on its face (it
 * IS a check) and not their concern. `unavailableChecksForReader` below drops
 * it on the same rule as every other wiring fault.
 */
const UNPRODUCIBLE_PREREQUISITES: readonly { readonly checkKey: string; readonly reason: string }[] = [
  { checkKey: "identity:ca-policy-count", reason: "unknown_metric_key" },
];

/**
 * The final gate on everything the `unavailable` blocks show a customer: only
 * reasons that are statements about their own scan survive.
 *
 * `buildRows` already applies this to stats as it collects them; this exists for
 * the lists that do not come from `buildRows` — the hand-written prerequisite
 * gap above, and the `missingChecks` the narrative route sends down with an
 * omitted prose section, which are assembled server-side by the narrative
 * generator from the same `WarRoomStat` payload and can carry the same faults.
 */
export function unavailableChecksForReader(
  checks: readonly UnavailableCheck[],
): readonly UnavailableCheck[] {
  return checks.filter((c) => !isWiringFault(c.reason));
}

/* ------------------------------------------------------------------ *
 * Section 3 — Adoption & licensing, the pure-data half of enablement
 * ------------------------------------------------------------------ */

/**
 * WHY THE FOUR PER-WORKLOAD ACTIVE-USER ROWS ARE GONE (#441).
 *
 * They were `adoption.teamsActive` / `sharePointActive` / `oneDriveActive` /
 * `emailActive`, and they resolved through registry metrics whose `sourceKey`s
 * named `usage:teams-activity`, `usage:sharepoint-activity`,
 * `usage:onedrive-activity` and `usage:email-activity`. `usage:` is not a
 * check-key domain in this platform's catalog — the four keys name nothing, and
 * never did. So the rows could not render for any tenant, and this section
 * instead printed all four phantom keys to the reader as figures "this tenant's
 * scan does not carry". That sentence was false: the scan was never asked for
 * them.
 *
 * The picks are removed rather than repointed, for the same reason
 * `war-room-pillar-stats.ts` emptied the adoption card instead of repointing it:
 * the nearest real checks are per-user and per-site Graph usage-report detail
 * endpoints, and a metric aimed at one of those resolves to its row count —
 * "1,631 active Teams users" that is really "1,631 licensed users". A wrong
 * number in a readiness report is worse than an absent one.
 *
 * The section keeps its AI prose (grounded in the adoption and licensing pillar
 * scores and findings, which are real) and the one workload-adjacent figure the
 * platform genuinely computes.
 */
const WORKLOAD_PICKS: readonly StatPick[] = [
  { statId: "licensing.annualWaste", pillar: "licensing", label: "Recoverable licence spend", caption: "a year in paid, unassigned seats" },
];

/* ------------------------------------------------------------------ *
 * The report
 * ------------------------------------------------------------------ */

/**
 * The verdict card, from the real Gate score.
 *
 * Never asserts a verdict when the score is null: a tenant whose scan could not
 * evaluate a single Copilot-impacting rule has no readiness figure, and calling
 * that "not flight-ready" would state a finding the platform has not made —
 * the same rule `copilotGateStatus` follows server-side.
 */
function buildVerdict(view: JourneyView, scoredPillars: number): ReadinessReport["verdict"] {
  const score = view.readinessScore;
  if (score === null) {
    return {
      eyebrow: "The verdict",
      headline: "No readiness score yet",
      sub: `The Copilot Gate needs ${COPILOT_GATE_TARGET}. This tenant's scan has not yet evaluated a rule that feeds the Copilot pillar, so there is no score to gate on — and nothing here claims one either way.`,
    };
  }
  const gap = COPILOT_GATE_TARGET - score;
  const pillarClause =
    scoredPillars > 0
      ? `${scoredPillars} ${scoredPillars === 1 ? "pillar" : "pillars"} scored, one number. `
      : "";
  return {
    eyebrow: "The verdict",
    headline:
      gap > 0
        ? `${score} — not flight-ready for Copilot`
        : `${score} — cleared for Copilot rollout`,
    sub:
      gap > 0
        ? `${pillarClause}The Gate needs ${COPILOT_GATE_TARGET}, so the gap is ${gap} points. Every point of it maps to a named finding in the reports alongside this one.`
        : `${pillarClause}The Gate needs ${COPILOT_GATE_TARGET} and this tenant is at or above it. What follows is what still needs watching to keep it there.`,
  };
}

/**
 * The provenance line. Every clause is conditional on the platform actually
 * knowing that thing — a tenant with no scan date and no curated check count
 * gets the two sentences that are still true, not a sentence with blanks in it.
 */
export function buildProvenance(scannedOn: string | null, checkCount: number): string {
  const parts = [
    scannedOn
      ? `Read on ${scannedOn} through the Microsoft Graph API with read-only delegated permissions.`
      : "Read through the Microsoft Graph API with read-only delegated permissions.",
  ];
  if (checkCount > 0) {
    parts.push(`${checkCount.toLocaleString("en-US")} signal derivation checks across the scan packages this tenant has run.`);
  }
  parts.push("No configuration was altered during assessment.");
  return parts.join(" ");
}

/** Which AI section carries which heading, in render order. */
const NARRATIVE_ORDER: readonly ReadinessNarrativeSectionKey[] = ["safety", "enablement", "blockers"];

const NARRATIVE_HEADINGS: Record<ReadinessNarrativeSectionKey, string> = {
  safety: "Copilot Safety & Exposure",
  enablement: "Workflow Enablement & Value",
  blockers: "Gate Blockers & Remediation Path",
};

/**
 * What a prose section says when it has none. Distinct wording per reason,
 * because "your scan carries nothing to reason about here" and "we could not
 * write this just now" are different statements to a customer and only one of
 * them is about their tenant.
 */
export function narrativeUnavailableDetail(reason: string | null): string {
  switch (reason) {
    case "no_real_data":
      return "This tenant's scan carries no measured figure and no finding for the pillars behind this section, so there is nothing real to reason from. Nothing has been written in its place.";
    case "generation_failed":
      return "This section could not be written just now. That is a problem on our side, not a finding about your tenant — the rest of this report is unaffected.";
    case "empty_response":
      return "This section came back empty and has been left out rather than filled with generic content.";
    default:
      return "This section is not available.";
  }
}

/**
 * Build the whole report from real data.
 *
 * `narrative` is optional and separately fetched: the pure-data sections must
 * render the moment the pillar payload lands, without waiting on up to three
 * Anthropic calls. A null narrative means "still loading"; a narrative whose
 * section carries `html: null` means "resolved, and honestly empty".
 */
export function buildCopilotReadinessReport(input: {
  readonly view: JourneyView;
  readonly narrative: WireNarrativePayload | null;
  /** True once the narrative fetch has settled, success or failure. */
  readonly narrativeSettled: boolean;
  /** Real curated check count behind the provenance line. */
  readonly scannedCheckCount: number;
}): ReadinessReport {
  const { view, narrative, narrativeSettled, scannedCheckCount } = input;
  const pillars = view.pillars;
  const scoredPillars = pillars.filter((p) => typeof p.score === "number").length;

  const sections: ReadinessSection[] = [];

  // ── Copilot Readiness Summary ──────────────────────────────────────────────
  const blast = blastRadiusRows(pillars);
  sections.push({
    heading: "Copilot Readiness Summary",
    blocks: [
      { kind: "figure", figure: "readinessRadar" },
      { kind: "figure", figure: "scoreSummary" },
      { kind: "figure", figure: "pillarTable" },
      ...keyValuesBlock(blast.rows),
      ...unavailableBlock(
        "The exposure figures behind the blast-radius line are not available for this tenant:",
        blast.missing,
      ),
    ],
  });

  // ── Copilot Safety & Exposure (AI prose) ───────────────────────────────────
  // ── Workflow Enablement & Value (AI prose + real workload figures) ─────────
  // ── Technical Prerequisites & Platform Alignment (pure data) ───────────────
  // ── Gate Blockers & Remediation Path (AI prose) ────────────────────────────
  //
  // Order follows the design's approved structure, minus "Copilot Drift &
  // Violations" (see the header). The workload figures sit inside the
  // enablement section so the prose and the numbers it reasons about are
  // adjacent rather than a screen apart.
  const narrativeByKey = new Map<string, WireNarrativeSection>(
    (narrative?.sections ?? []).map((s) => [s.key, s]),
  );

  const narrativeBlocks = (key: ReadinessNarrativeSectionKey): ReadinessBlock[] => {
    const section = narrativeByKey.get(key);
    if (section?.html) return [{ kind: "narrative", html: section.html }];
    if (!narrativeSettled) return [];
    return [
      {
        kind: "unavailable",
        detail: narrativeUnavailableDetail(section?.omittedReason ?? null),
        checks: unavailableChecksForReader(section?.missingChecks ?? []),
      },
    ];
  };

  sections.push({
    heading: NARRATIVE_HEADINGS.safety,
    blocks: narrativeBlocks("safety"),
  });

  const workloads = buildRows(pillars, WORKLOAD_PICKS);
  sections.push({
    heading: NARRATIVE_HEADINGS.enablement,
    blocks: [
      ...narrativeBlocks("enablement"),
      ...keyValuesBlock(workloads.rows),
      ...unavailableBlock(
        "Workload and licence figures this tenant's scan does not carry:",
        workloads.missing,
      ),
    ],
  });

  const prerequisites = buildRows(pillars, PREREQUISITE_PICKS);
  sections.push({
    heading: "Technical Prerequisites & Platform Alignment",
    blocks: [
      ...keyValuesBlock(prerequisites.rows),
      ...unavailableBlock(
        "Prerequisites this assessment could not measure. These are gaps in what was collected, not findings about this tenant:",
        unavailableChecksForReader([...prerequisites.missing, ...UNPRODUCIBLE_PREREQUISITES]),
      ),
    ],
  });

  // ── Upgrade Opportunities (#451) ───────────────────────────────────────────
  //
  // ONE section for the whole document rather than a block per section, for two
  // reasons. `copilot:overshare-exposure` backs stats on three pillars and
  // several checks are quoted by both a pure-data section and the narrative's
  // grounding, so per-section blocks would repeat the same licence fact in up
  // to three places; and a category the reader is meant to tell apart from the
  // severity ladder is easier to tell apart when it is one place they can point
  // at, not a recurring aside.
  //
  // Every list the document holds is swept, including the narrative sections'
  // `missingChecks` whether or not that prose rendered — a licence gap is a real
  // fact about the tenant regardless of whether the section that wanted it had
  // enough other facts to be written.
  const licenceGaps = upgradeOpportunities([
    ...blast.missing,
    ...workloads.missing,
    ...prerequisites.missing,
    ...(narrative?.sections ?? []).flatMap((s) => s.missingChecks ?? []),
  ]);
  if (licenceGaps.length) {
    sections.push({
      heading: UPGRADE_OPPORTUNITY_HEADING,
      blocks: [
        { kind: "upgradeOpportunity", detail: UPGRADE_OPPORTUNITY_DETAIL, items: licenceGaps },
      ],
    });
  }

  sections.push({
    heading: NARRATIVE_HEADINGS.blockers,
    blocks: narrativeBlocks("blockers"),
  });

  // ── Closing ────────────────────────────────────────────────────────────────
  const closing: string[] = [
    "Copilot is only safe and effective when your environment is ready. Governance, security, compliance, adoption, licensing and health all have to be aligned before Copilot can be deployed.",
  ];
  if (view.readinessScore !== null) {
    const gap = COPILOT_GATE_TARGET - view.readinessScore;
    closing.push(
      gap > 0
        ? `${view.tenant.name} scored ${view.readinessScore}, below the safe-to-deploy threshold of ${COPILOT_GATE_TARGET}. The gap is ${gap} points, and every point maps to a named finding in the reports alongside this one.`
        : `${view.tenant.name} scored ${view.readinessScore}, at or above the safe-to-deploy threshold of ${COPILOT_GATE_TARGET}. The findings that follow are what keeps it there.`,
    );
  }

  return {
    kicker: "Copilot readiness, safety & enablement",
    headline:
      view.readinessScore === null
        ? `Copilot readiness for ${view.tenant.name}`
        : view.readinessScore >= COPILOT_GATE_TARGET
          ? `It is safe to turn Copilot on at ${view.tenant.name}`
          : `It is not yet safe to turn Copilot on at ${view.tenant.name}`,
    standfirst:
      "This report evaluates your tenant's readiness to safely deploy Microsoft Copilot. It measures governance, security, compliance, adoption, licensing and health signals that directly affect Copilot's accuracy, safety and value. Every finding traces to telemetry surfaced in your own assessment and directly impacts the Copilot Gate.",
    verdict: buildVerdict(view, scoredPillars),
    sections,
    closing,
    provenance: buildProvenance(view.tenant.scannedOn, scannedCheckCount),
    radarNote: buildRadarNote(view),
  };
}

/** Exported for tests — the picks are the contract with `war-room-pillar-stats.ts`. */
export const __testables = {
  PREREQUISITE_PICKS,
  WORKLOAD_PICKS,
  UNPRODUCIBLE_PREREQUISITES,
  NARRATIVE_ORDER,
  LICENCE_GAP_DISCLOSURES,
  buildRows,
};
