/**
 * liveReportBlocks.ts — the shared vocabulary every live-rendered report is
 * assembled from (#409, extracted in #343).
 *
 * WHY THIS EXISTS
 * ---------------
 * `copilotReadinessReport.ts` established how a report built from a tenant's own
 * scan turns real stats into rows: which stats may be quoted, how an absent one
 * is declared, which absences are OUR bug and must not reach the reader, and
 * which are a licence tier with its own category. #343 ports a second report
 * onto that pattern, and a second copy of those rules is a second place for them
 * to rot — the failure #441 is the record of, where a report printed four
 * phantom check keys to a paying customer for months.
 *
 * So the rules live here and both reports import them. What stays in each
 * report's own file is what makes it that report: its stat picks, its section
 * order, its verdict, its copy.
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
 * One reason is deliberately NOT in that honest `unavailable` block.
 * `license_gap` — "this check reads a capability your tenant is not licensed
 * for" — is neither a finding (nothing is wrong) nor one of #441's wiring
 * faults (nothing of ours is broken). It is the one unavailability with a real
 * remediation attached, and it has its own "Upgrade Opportunities" section with
 * per-check copy naming what the tier would make measurable. See
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

import { COPILOT_GATE_TARGET, severityForScore, type PillarKey, type Severity } from "./journeyTokens.ts";
import type {
  JourneyPillarView,
  JourneyView,
  WireLicenseGapPurchase,
  WirePillarFinding,
  WirePillarStat,
} from "./journeyModel.ts";
import type { PreviewFindingRow, PreviewKeyValueRow, ReportBlock } from "./previewDocumentBodies.ts";

/* ------------------------------------------------------------------ *
 * The narrative wire shape — mirrors the api-server routes' responses
 * ------------------------------------------------------------------ */

/**
 * One AI-written section as it arrives on the wire. Identical across every
 * live-rendered report because both generators build it from the same
 * `narrative-grounding.ts` — only the `key` set differs, and that is each
 * report's own business.
 */
export interface WireNarrativeSection {
  readonly key: string;
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
 * Blocks — the shared vocabulary plus the three these reports need
 * ------------------------------------------------------------------ */

/**
 * Blocks the shared `ReportBlocks.tsx` renderer does not know about, handled by
 * each report's own renderer before it delegates. Deliberately additive rather
 * than widening `ReportBlock`: widening it would force every `switch` in the
 * preview path to grow cases for shapes the design's fixtures can never
 * produce, for no benefit.
 */
export type LiveReportExtraBlock =
  /** One AI-written section's sanitised HTML fragment. */
  | { readonly kind: "narrative"; readonly html: string }
  /**
   * The honest empty state. `checks` names what the platform wanted and did
   * not get; `detail` says what that means. Never styled as a finding.
   *
   * `checks` may be empty: a gap the platform cannot name a check key for at
   * all — because no check exists to name — is still declared, in words, rather
   * than silently dropped. See `pillarSecurityPosture.ts`'s Conditional Access
   * gap for the case that forced it.
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
      /**
       * The purchase call to action (#489). Absent when the tenant's gapped
       * checks map to no purchase category, or when the payload predates #489 —
       * the category still renders in full either way, minus the link.
       */
      readonly callToAction?: UpgradeOpportunityCallToAction | null;
    };

export type LiveReportBlock = ReportBlock | LiveReportExtraBlock;

export interface LiveReportSection {
  readonly heading: string;
  readonly blocks: readonly LiveReportBlock[];
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
 * lives — the one these reports have to name as a missing check.
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

/**
 * The final gate on everything the `unavailable` blocks show a customer: only
 * reasons that are statements about their own scan survive.
 *
 * `buildRows` already applies this to stats as it collects them; this exists for
 * the lists that do not come from `buildRows` — a report's hand-written gap
 * list, and the `missingChecks` a narrative route sends down with an omitted
 * prose section, which are assembled server-side by a narrative generator from
 * the same `WarRoomStat` payload and can carry the same faults.
 */
export function unavailableChecksForReader(
  checks: readonly UnavailableCheck[],
): readonly UnavailableCheck[] {
  return checks.filter((c) => !isWiringFault(c.reason));
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
 * One unavailable check as a report receives it — from `buildRows`, from a
 * hand-written gap list, or from a narrative route's `missingChecks`.
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
 * Every check behind a stat a live-rendered report can render, so a licence gap
 * on any of them has real copy rather than a generic line.
 *
 * The key set is the 18 distinct `monitor_checks` keys behind
 * `WAR_ROOM_PILLAR_STAT_SPECS`' 28 stats, plus the one metric the Security
 * Posture report resolves for itself (`security:secure-score`, #343) — the
 * complete universe of check keys that can reach one of these reports as a
 * licence gap, whether through a stat pick or through a narrative route's
 * `missingChecks`.
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
  // #343. Its tier is NOT written down here even though Secure Score is widely
  // available: `/security/secureScores` gating varies by tenant and by what
  // Defender workloads are licensed, and the repo cannot confirm it — so the
  // entry names no tier and falls back to whatever the tenant's own scan
  // reported, on the same rule as every other unconfirmable check above.
  "security:secure-score": {
    requires: null,
    unlocks: "Microsoft's own Secure Score for your tenant, and the control detail behind it",
    means:
      "the Security Posture Summary opens without a maturity figure for that reason — your Secure Score is unmeasured in this report, not confirmed sound.",
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

/** A purchase link as a report renders it. */
export interface UpgradeOpportunityLink {
  readonly skuName: string;
  readonly url: string;
}

/** One rendered row of the Upgrade Opportunity category. */
export interface UpgradeOpportunity {
  readonly checkKey: string;
  readonly disclosure: string;
  /**
   * The specific add-on that answers THIS check (#489). Present only when the
   * tenant is gapped in one or two categories: at tier 3 the recommendation is
   * consolidated into a single E7 call to action on the block, and repeating it
   * on every row would turn one clear recommendation back into several purchase
   * asks — the exact thing the consolidation exists to avoid.
   */
  readonly link?: UpgradeOpportunityLink;
}

/**
 * The block's own call to action (#489) — one recommendation per gapped
 * category, or the single E7 link that replaces all three.
 *
 * Separate from the rows on purpose. The rows say what is missing and are
 * unchanged by the tier; this says what to do about it and is the only thing
 * the tier decides. Keeping them apart is what lets a tier-3 report stay
 * specific about all three gaps while making exactly one purchase ask.
 */
export interface UpgradeOpportunityCallToAction {
  readonly text: string;
  readonly links: readonly UpgradeOpportunityLink[];
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
  purchase?: WireLicenseGapPurchase | null,
): readonly UpgradeOpportunity[] {
  const seen = new Set<string>();
  const rows: UpgradeOpportunity[] = [];
  for (const check of checks) {
    if (!isLicenceGap(check.reason) || seen.has(check.checkKey)) continue;
    seen.add(check.checkKey);
    rows.push({
      checkKey: check.checkKey,
      disclosure: licenceGapDisclosure(check),
      ...(purchaseLinkForCheck(purchase, check.checkKey) ?? {}),
    });
  }
  return rows;
}

/**
 * The per-row link, or nothing.
 *
 * Nothing in three cases, all deliberate: the tenant has no purchase payload at
 * all; the tier consolidated to E7 (the link belongs to the block, not the row);
 * or this check is a real licence gap that maps to none of the three purchase
 * categories. That last one is the honest case — the row still declares the gap
 * in full, it just makes no purchase claim we cannot back.
 */
function purchaseLinkForCheck(
  purchase: WireLicenseGapPurchase | null | undefined,
  checkKey: string,
): { readonly link: UpgradeOpportunityLink } | null {
  if (!purchase || purchase.consolidated) return null;
  const rec = purchase.recommendations.find((r) => r.checkKeys.includes(checkKey));
  return rec ? { link: { skuName: rec.sku.name, url: rec.sku.url } } : null;
}

/**
 * The block's call to action, or null when there is nothing to recommend.
 *
 * The tier-3 sentence says outright that ONE purchase covers all three gaps.
 * That is not salesmanship — it is the reason E7 replaces three add-on links
 * here, and a reader who is not told why they are seeing one link instead of
 * three has been given a recommendation with its reasoning removed.
 */
export function upgradeOpportunityCallToAction(
  purchase: WireLicenseGapPurchase | null | undefined,
): UpgradeOpportunityCallToAction | null {
  if (!purchase || purchase.recommendations.length === 0) return null;

  const links = purchase.recommendations.map((r) => ({ skuName: r.sku.name, url: r.sku.url }));
  const where = `Buying it is done by your own administrator in ${purchase.adminCenterPath} — we do not resell Microsoft licensing, so this is a pointer, not an offer.`;

  if (purchase.consolidated) {
    const sku = purchase.recommendations[0]!.sku.name;
    return {
      text: `All three of the areas above — ${purchase.recommendations[0]!.categoryLabels.join(", ").toLowerCase()} — are covered by ${sku}, so it is named here instead of three separate add-ons. ${where}`,
      links,
    };
  }

  const named = purchase.recommendations
    .map((r) => `${r.sku.name} for ${r.categoryLabels.join(" and ").toLowerCase()}`)
    .join("; ");
  return { text: `What would close the gaps above: ${named}. ${where}`, links };
}

/**
 * The category's own framing line. Says what the category is before any row is
 * read, so no row has to carry that weight on its own — and says plainly that
 * an unread check is not a passed one.
 */
export const UPGRADE_OPPORTUNITY_HEADING = "Upgrade Opportunities";

export const UPGRADE_OPPORTUNITY_DETAIL =
  "These checks returned nothing because your tenant does not hold the Microsoft 365 licence tier they read from. That is not a finding about your configuration and it is not a pass — each one is a measurement this assessment could not take, and each is listed with what holding that tier would make visible. Nothing below is scored, and none of it counts against your readiness figure.";

/* ------------------------------------------------------------------ *
 * Row assembly
 * ------------------------------------------------------------------ */

/** The pillar's own severity band — see the header for why not the number's. */
export function pillarTone(pillar: JourneyPillarView | undefined): Severity {
  return typeof pillar?.score === "number" ? severityForScore(pillar.score) : "attention";
}

export interface StatPick {
  /** The stat id as `war-room-pillar-stats.ts` names it — never matched on label. */
  readonly statId: string;
  readonly pillar: PillarKey;
  /** The row label. The stat's own caption is appended as the value's unit. */
  readonly label: string;
  /** Reads better than the raw caption in a report table. */
  readonly caption: string;
}

export interface BuiltRows {
  readonly rows: readonly PreviewKeyValueRow[];
  readonly missing: readonly UnavailableCheck[];
}

function findStat(pillars: readonly JourneyPillarView[], pick: StatPick): WirePillarStat | undefined {
  return pillars.find((p) => p.key === pick.pillar)?.stats.find((s) => s.id === pick.statId);
}

/**
 * Turn a list of wanted stats into real rows plus a list of what was missing.
 *
 * Rows keep the order of `picks`, not of the payload, so the table reads the
 * same way for every tenant regardless of which of its checks reported.
 */
export function buildRows(
  pillars: readonly JourneyPillarView[],
  picks: readonly StatPick[],
): BuiltRows {
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

/**
 * Turn already-resolved stats — ones a report's own route carried down rather
 * than the War Room payload — into rows on exactly the same rule.
 *
 * Exists so the Security Posture report's Secure Score row cannot become a
 * second, laxer path from a value to a table cell (#343). `tone` is passed in
 * because these stats belong to no `JourneyPillarView` to read a band from.
 */
export function buildRowsFromStats(
  stats: readonly WirePillarStat[],
  picks: readonly { readonly statId: string; readonly label: string; readonly caption: string }[],
  tone: Severity,
): BuiltRows {
  const rows: PreviewKeyValueRow[] = [];
  const missing: UnavailableCheck[] = [];

  for (const pick of picks) {
    const stat = stats.find((s) => s.id === pick.statId);
    if (isRealStat(stat)) {
      rows.push({ label: pick.label, tone, value: `${formatStat(stat)} ${pick.caption}` });
    } else if (stat?.checkKey && !isWiringFault(stat.unavailableReason)) {
      missing.push({
        checkKey: stat.checkKey,
        reason: stat.unavailableReason ?? "no_data",
        ...(stat.licenseFeature ? { licenseFeature: stat.licenseFeature } : {}),
      });
    }
  }

  return { rows, missing };
}

/** One `keyValues` block, or nothing when no row is real. */
export function keyValuesBlock(rows: readonly PreviewKeyValueRow[]): LiveReportBlock[] {
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
export function unavailableBlock(
  detail: string,
  checks: readonly UnavailableCheck[],
): LiveReportBlock[] {
  const { rest } = splitLicenceGaps(checks);
  return rest.length ? [{ kind: "unavailable", detail, checks: rest }] : [];
}

/**
 * A gap the platform can state in words but cannot name a check key for,
 * because no check exists to name (#343).
 *
 * Distinct from `unavailableBlock`, which always names keys and drops to
 * nothing when it has none. Declared unconditionally: it is a fact about what
 * this platform measures, not about this tenant's scan, so it does not vary by
 * customer and must not silently disappear.
 */
export function declaredGapBlock(detail: string): LiveReportBlock[] {
  return [{ kind: "unavailable", detail, checks: [] }];
}

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
 * The blocks for one AI-written section: its prose, or — once the fetch has
 * settled — an honest statement of which kind of nothing it is.
 *
 * An empty array means "still loading", which each report's renderer draws as a
 * pending state rather than as a section with nothing to say.
 */
export function narrativeBlocks(
  section: WireNarrativeSection | undefined,
  settled: boolean,
): LiveReportBlock[] {
  if (section?.html) return [{ kind: "narrative", html: section.html }];
  if (!settled) return [];
  return [
    {
      kind: "unavailable",
      detail: narrativeUnavailableDetail(section?.omittedReason ?? null),
      checks: unavailableChecksForReader(section?.missingChecks ?? []),
    },
  ];
}

/* ------------------------------------------------------------------ *
 * Findings — real rows, and the #399 clean/unevaluated distinction
 *
 * Written for the Security Posture report (#343) and moved here by #292, when
 * four more pillar reports needed the identical two functions. Same reasoning as
 * everything else in this module: a second copy of "how a real finding becomes a
 * row" is a second place for it to drift, and the distinction the second
 * function draws is one no report may get wrong.
 * ------------------------------------------------------------------ */

/**
 * A finding's `checkKey` (e.g. `"identity:ca-mfa-coverage"`) is an internal
 * registry identifier and must never reach customer-facing text verbatim.
 * This derives the one human-readable fact worth keeping from it — the
 * domain it belongs to — deterministically, with no elaboration invented.
 */
function checkDomainLabel(checkKey: string): string {
  const domain = checkKey.split(":", 1)[0] ?? checkKey;
  return domain
    .split("-")
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Turn one pillar's real findings into rows.
 *
 * `lead` is the finding's own title verbatim — since #408 that is the
 * `severity_rules` label, which is the sentence the platform itself decided
 * describes this result. `rest` is provenance and nothing else: it names the
 * domain of the real check the finding came from — never the raw `checkKey`
 * itself, which is an internal identifier, not customer-facing text. It
 * deliberately does NOT elaborate on the finding, because the platform holds
 * no second sentence about it and writing one here would be exactly the
 * invention these reports exist to avoid.
 *
 * The wire's `warning` maps to the `attention` tone: `Severity` is the
 * three-band presentation scale (critical / attention / healthy) and `warning`
 * is its middle band under a different name. Nothing is re-graded.
 */
export function findingRows(findings: readonly WirePillarFinding[]): readonly PreviewFindingRow[] {
  return findings.map((f) => ({
    severity: f.severity === "critical" ? ("critical" as const) : ("attention" as const),
    lead: f.title,
    rest: `Recorded by the ${checkDomainLabel(f.checkKey)} check on this tenant's last scan.`,
  }));
}

/**
 * A findings section's blocks: the real rows, or an honest statement of which
 * kind of nothing an empty list is.
 *
 * The distinction is #399's and it is load-bearing: a pillar with a real score
 * and no findings was genuinely evaluated clean, and a pillar with no score was
 * never evaluated at all. Rendering both as "no findings" would turn an absence
 * of data into a clean bill of health.
 *
 * Note the rows are every real critical/warning finding for the pillar,
 * worst-first — there is no cap, here or server-side.
 */
export function findingsBlocks(
  pillar: JourneyPillarView | undefined,
  cleanDetail: string,
  unevaluatedDetail: string,
): LiveReportBlock[] {
  const rows = findingRows(pillar?.findings ?? []);
  if (rows.length) return [{ kind: "findings", rows }];
  if (typeof pillar?.score === "number") return [{ kind: "prose", text: cleanDetail }];
  return [{ kind: "unavailable", detail: unevaluatedDetail, checks: [] }];
}

/**
 * The Copilot Gate row every pillar report's own "Copilot Readiness Impact"
 * section closes on — real, and only rendered when the platform actually has a
 * score (#343, shared in #292).
 *
 * Never rendered as a zero or an em dash for a tenant whose scan evaluated no
 * rule feeding the Copilot pillar: there is no readiness figure for them, and a
 * row saying "0 against a Gate of 82" would state a verdict the platform has not
 * reached. The section's prose says so in words instead.
 */
export function gateRow(view: JourneyView): PreviewKeyValueRow[] {
  const score = view.readinessScore;
  if (score === null) return [];
  const gap = COPILOT_GATE_TARGET - score;
  return [
    {
      label: "Copilot Gate",
      tone: gap > 0 ? ("critical" as const) : ("healthy" as const),
      value:
        gap > 0
          ? `${score} against a Gate of ${COPILOT_GATE_TARGET} — ${gap} points short`
          : `${score} against a Gate of ${COPILOT_GATE_TARGET} — cleared`,
    },
  ];
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

/** Exported for tests — the disclosure copy is the never-invent-a-SKU guarantee. */
export const __testables = { LICENCE_GAP_DISCLOSURES, findStat };
