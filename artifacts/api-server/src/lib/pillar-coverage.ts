/**
 * pillar-coverage.ts
 *
 * Determines which real health pillars a customer's scanned monitoring
 * package genuinely covers, for the Assessment generating screen's radar —
 * never fabricating a score for a pillar the package's checks don't actually
 * feed. Reuses the real health engine and its existing display normalization
 * (health-engine.ts / health-display.ts) rather than a second scoring path.
 *
 * Real join, generic across packages (no per-package hardcoding):
 *   monitoring_package_checks (packageKey -> checkKey)
 *     -> the profile keys those checks genuinely PRODUCE (see below)
 *     -> signal_derivation_rules whose sourceKey reads one of those keys
 *     -> that signal's per-pillar impact fields (health-engine.ts's own
 *        getSignalHealthImpacts)
 * A pillar is included only if (a) at least one of the package's real checks
 * feeds a rule with nonzero impact for that pillar, AND (b) the health
 * engine's own display normalization has real data for that pillar
 * system-wide (theoreticalMax > 0 — health-display.ts's own "don't fabricate"
 * guard). As monitoring_package_checks gets curated for more packages, this
 * automatically surfaces more pillars; nothing here needs to change.
 *
 * ── How a check "feeds" a rule (the real linkage, by ruleType) ────────────────
 * This mirrors exactly what `evaluateRule()` (tenant-signals.ts) reads and what
 * the monitor pipeline writes (`applyMapping()` in monitor-executor.ts +
 * `mergeMonitorProfileRows()` / `bridgeLegacyProfileKeys()` in
 * tenant-signals.ts). A naive `sourceKey === checkKey` equality — the original
 * implementation — only ever matches `threshold` rules, because real
 * `profile_key_*` rules reference the DB-configured `monitor_checks.mapping`
 * targetFields (`hasAADP1orP2`, `projectPlanFiveCount`, …), NOT check keys.
 * That gap is why a real 122-check package with 67 passing checks still
 * returned radar.pillars: [] — the join found zero covered signals.
 *
 *   • `threshold` rules — evaluateRule reads `profile[sourceKey + "__itemCount"]`,
 *     and mergeMonitorProfileRows stamps `<checkKey>__itemCount` for every
 *     check row. So sourceKey IS a check key: covered iff the package contains
 *     that check.
 *   • `profile_key_*` rules — sourceKey is a merged-profile field. A covered
 *     check produces it when it is:
 *       – one of the check's `mapping[].targetField` values (applyMapping), or
 *       – `<prop>_count` / `<prop>_first` / `<prop>_values` for one of the
 *         check's raw `properties` entries (applyMapping's raw extraction), or
 *       – the synthetic `<checkKey>__itemCount` key itself, or
 *       – a bridged legacy key with its known real producer check in the
 *         package (bridgeLegacyProfileKeys: `conditionalAccessPolicyCount` /
 *         `conditionalAccessPoliciesCount` ← `identity:ca-policy-count`,
 *         `securityScore` ← `security:secure-score`), or
 *       – a runtime license-gap flag (`LICENSE_GAP_PROFILE_FLAG_KEYS` —
 *         `hasAADP1orP2` / `hasDefender`), which `executeMonitorCheck` stamps
 *         onto ANY Graph check's row when the tenant's own Graph response
 *         proves it lacks the SKU (LicenseGapError → licenseGapProfileFlags),
 *         and `mergeMonitorProfileRows` merges regardless of row status.
 *         These are producible by any package containing at least one Graph
 *         (non-script) check — no `monitor_checks.mapping` entry ever lists
 *         them, so enumerating mapping targetFields alone misses this real
 *         producer entirely. Or
 *       – the bare check key (defensive: a mapping is free to target the check
 *         key itself, and the original narrow-package verification relied on
 *         exactly that shape — kept so it can never regress).
 *     Script-era profile keys with no monitor-check producer are deliberately
 *     NOT counted — this module measures what the PACKAGE covers, and a key
 *     only a customer-uploaded script writes is not package coverage.
 *   • `findings_keyword` rules — evaluateRule substring-matches the keyword
 *     against finding strings, and `deriveMonitorFindings()` builds those
 *     strings as `"<checkKey>: <severity> severity condition matched…"`. The
 *     deterministic keyword surface a package contributes is therefore its
 *     check keys: covered iff the keyword appears (case-insensitive) inside
 *     any covered check key. (Script-run findings are, again, not package
 *     coverage.)
 */

import {
  db,
  monitoringPackageChecksTable,
  monitorChecksTable,
  mspDiagnosticRunsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { LICENSE_GAP_PROFILE_FLAG_KEYS } from "./monitor-executor.ts";
import {
  HEALTH_PILLARS,
  getSignalHealthImpacts,
  calculateArchitectureHealthScore,
  type HealthPillar,
} from "./health-engine.ts";
// `PILLAR_FIELD` / `SignalHealthImpactConfig` / `computePillarDisplayScore` were
// imported for the per-pillar "has any covered signal any weight here" test this
// module used to run inline; #517 moved that into `evaluatePillarDisplay` so
// there is one definition of "enough coverage to score", not two.
import { evaluatePillarDisplay } from "./health-display.ts";
import { fetchSignalRulesAndGroups } from "./priority-engine.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * The radar's full pillar universe: the six health pillars PLUS the
 * separately-computed security pillar. Security is deliberately NOT added to
 * `HEALTH_PILLARS` itself (that would double-count it inside
 * `computeHealthEngine` — it's scored by the standalone Security Engine and
 * combined one level up in `calculateArchitectureHealthScore`, whose combined
 * breakdown this module already consumes). Here it is just one more checkable
 * coverage option: `PILLAR_FIELD.security` -> `securityImpact` already exists
 * on every rule/group, so the identical real-coverage test applies.
 */
export type RadarPillar = HealthPillar | "security";
export const RADAR_PILLARS: readonly RadarPillar[] = [...HEALTH_PILLARS, "security"];

/** Mirrors MissionControl.tsx's PILLAR_LABELS so the same pillar reads identically everywhere. */
export const PILLAR_LABELS: Record<RadarPillar, string> = {
  governance: "Governance",
  compliance: "Compliance",
  adoption: "Adoption",
  copilot: "Copilot Readiness",
  architecture: "Architecture",
  licensing: "Licensing",
  security: "Security",
};

export interface PillarCoverageEntry {
  pillar: RadarPillar;
  label: string;
  score: number;
}

/**
 * Bridged legacy profile keys and their single real producer check — MUST stay
 * in lockstep with `bridgeLegacyProfileKeys()` in tenant-signals.ts (each entry
 * there documents its code-verified Graph producer; keys with no real producer
 * are deliberately absent from both places).
 */
const BRIDGED_KEY_PRODUCER_CHECK: Record<string, string> = {
  conditionalAccessPolicyCount: "identity:ca-policy-count",
  conditionalAccessPoliciesCount: "identity:ca-policy-count",
  securityScore: "security:secure-score",
};

/** The definition subset needed to enumerate a check's producible profile keys. */
interface CheckDefinitionRow {
  key: string;
  mapping: Array<{ sourceField: string; targetField: string; transform?: string }> | null;
  properties: string[] | null;
  /** Graph checks (false — the schema default) can hit LicenseGapError and
   *  stamp the runtime license-gap flags; script-only checks (true) never call
   *  Graph and can't. Optional so the pure helper stays callable with minimal
   *  literals; absent is treated as the schema default (Graph). */
  requiresCustomerScript?: boolean;
}

/**
 * Every merged-profile key the given checks can genuinely produce — mirrors
 * `applyMapping()` + `mergeMonitorProfileRows()` + `bridgeLegacyProfileKeys()`.
 * Pure; exported for tests.
 */
export function buildProducibleProfileKeys(
  coveredCheckKeys: ReadonlySet<string>,
  checkDefinitions: CheckDefinitionRow[],
): Set<string> {
  const producible = new Set<string>();

  for (const checkKey of coveredCheckKeys) {
    // Bare check key (defensive — a mapping may target it directly) and the
    // synthetic itemCount key mergeMonitorProfileRows always stamps.
    producible.add(checkKey);
    producible.add(`${checkKey}__itemCount`);
  }

  let hasGraphCheck = false;
  for (const def of checkDefinitions) {
    if (!coveredCheckKeys.has(def.key)) continue;
    if (!def.requiresCustomerScript) hasGraphCheck = true;
    for (const rule of def.mapping ?? []) {
      if (rule?.targetField) producible.add(rule.targetField);
    }
    for (const prop of def.properties ?? []) {
      if (!prop) continue;
      producible.add(`${prop}_count`);
      producible.add(`${prop}_first`);
      producible.add(`${prop}_values`);
    }
  }

  // Runtime license-gap flags — stamped by executeMonitorCheck (NOT by any
  // mapping) when a Graph check's own tenant response proves the SKU is
  // missing, then merged into the profile by mergeMonitorProfileRows even on
  // non-ok rows. Any package with at least one Graph (non-script) check can
  // genuinely produce them (see the file header).
  if (hasGraphCheck) {
    for (const key of LICENSE_GAP_PROFILE_FLAG_KEYS) producible.add(key);
  }

  for (const [bridgedKey, producerCheck] of Object.entries(BRIDGED_KEY_PRODUCER_CHECK)) {
    if (coveredCheckKeys.has(producerCheck)) producible.add(bridgedKey);
  }

  return producible;
}

/**
 * Whether at least one of the package's checks genuinely feeds this rule —
 * ruleType-aware, mirroring exactly what `evaluateRule()` reads (see the file
 * header). Pure; exported for tests.
 */
export function ruleIsFedByPackage(
  rule: Pick<SignalDerivationRule, "ruleType" | "sourceKey">,
  coveredCheckKeys: ReadonlySet<string>,
  producibleProfileKeys: ReadonlySet<string>,
): boolean {
  switch (rule.ruleType) {
    case "threshold":
      // evaluateRule reads profile[`${sourceKey}__itemCount`], stamped per check.
      return coveredCheckKeys.has(rule.sourceKey);
    case "findings_keyword": {
      // deriveMonitorFindings strings start with the check key — the package's
      // deterministic keyword surface.
      const keyword = (rule.sourceKey ?? "").toLowerCase();
      if (!keyword) return false;
      for (const checkKey of coveredCheckKeys) {
        if (checkKey.toLowerCase().includes(keyword)) return true;
      }
      return false;
    }
    default:
      // profile_key_truthy / falsy / eq / gt / lt (and any future profile
      // reader): sourceKey is a merged-profile field.
      return producibleProfileKeys.has(rule.sourceKey);
  }
}

/**
 * Which real monitor check owns (can produce) this rule's sourceKey — the same
 * per-ruleType resolution `ruleIsFedByPackage` uses, but returning the specific
 * checkKey instead of a boolean. Used by the Simulator Studio Pillar Matrix to
 * jump from a rule row straight into that check's own Engine Trace, scoped to
 * the real check the rule actually reads. Returns null when no real check
 * produces the sourceKey (mirrors `fed: false`) or (for `findings_keyword`)
 * when more than one check key could match the keyword — an ambiguous case,
 * not guessed at. Pure; exported for tests.
 */
export function resolveOwningCheckKey(
  rule: Pick<SignalDerivationRule, "ruleType" | "sourceKey">,
  checkDefinitions: readonly CheckDefinitionRow[],
): string | null {
  switch (rule.ruleType) {
    case "threshold":
      return checkDefinitions.some((c) => c.key === rule.sourceKey) ? rule.sourceKey : null;
    case "findings_keyword": {
      const keyword = (rule.sourceKey ?? "").toLowerCase();
      if (!keyword) return null;
      const matches = checkDefinitions.filter((c) => c.key.toLowerCase().includes(keyword));
      return matches.length === 1 ? matches[0].key : null;
    }
    default: {
      // profile_key_*: find the check whose mapping targetField or raw
      // property extraction produces this sourceKey, then fall back to the
      // synthetic itemCount / bare-key / bridged-key producers.
      for (const def of checkDefinitions) {
        if ((def.mapping ?? []).some((m) => m?.targetField === rule.sourceKey)) return def.key;
        for (const prop of def.properties ?? []) {
          if (!prop) continue;
          if (rule.sourceKey === `${prop}_count` || rule.sourceKey === `${prop}_first` || rule.sourceKey === `${prop}_values`) {
            return def.key;
          }
        }
      }
      for (const def of checkDefinitions) {
        if (rule.sourceKey === def.key || rule.sourceKey === `${def.key}__itemCount`) return def.key;
      }
      for (const [bridgedKey, producerCheck] of Object.entries(BRIDGED_KEY_PRODUCER_CHECK)) {
        if (rule.sourceKey === bridgedKey && checkDefinitions.some((c) => c.key === producerCheck)) return producerCheck;
      }
      return null;
    }
  }
}

/**
 * The set of signal keys that at least one currently-configured monitor check
 * can genuinely feed, evaluated across the ENTIRE monitor_checks catalog (NOT
 * scoped to any single package). Reuses the EXACT Stage-3 producible-key logic
 * `getPillarCoverage` uses for one package (`buildProducibleProfileKeys` +
 * `ruleIsFedByPackage`) — here "covered checks" is every check in the catalog,
 * so a rule counts as evaluable iff SOME real check anywhere can produce its
 * sourceKey.
 *
 * ── SCOPE WARNING (#413) — this is NOT the denominator for a tenant's score ───
 * This set answers "can ANY check anywhere feed this rule". It blocks a rule
 * that can never fire ANYWHERE (orphaned, miswired, reading a key no check
 * produces) from inflating theoreticalMax — the real, live-reproduced exploit
 * (a test rule with an extreme weight moving a pillar toward 100% the instant
 * it was created, despite never contributing to the raw score).
 *
 * It does NOT answer "can this rule fire for THIS TENANT", and using it as a
 * tenant's scoring denominator was the confirmed root cause of #413: the
 * numerator can only contain signals fed by the checks the tenant was actually
 * scanned with (7 or 29 of them), while this denominator spans the whole
 * ~122-check catalog. That asymmetry puts a hard floor under the score — a
 * tenant on `core:security-baseline` could not score below 76/100 with EVERY
 * check it ran broken; on `assess:copilot-readiness` the floor was 95/100.
 * Use `fetchTenantEvaluableSignalKeys` for anything that scores a tenant.
 *
 * What this set is still right for: rule-authoring surfaces that reason about
 * the catalog rather than about one tenant (the Simulator Studio Pillar Matrix),
 * and as the documented fallback when a tenant's real scan scope cannot be
 * resolved at all.
 *
 * Async — reads monitor_checks.
 */
export async function fetchEvaluableSignalKeys(
  rules: Pick<SignalDerivationRule, "ruleType" | "sourceKey" | "signalKey">[],
): Promise<Set<string>> {
  const checkDefinitions: CheckDefinitionRow[] = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
      requiresCustomerScript: monitorChecksTable.requiresCustomerScript,
    })
    .from(monitorChecksTable);

  const allCheckKeys = new Set(checkDefinitions.map((c) => c.key));
  const producibleProfileKeys = buildProducibleProfileKeys(allCheckKeys, checkDefinitions);

  return new Set(
    rules
      .filter((r) => ruleIsFedByPackage(r, allCheckKeys, producibleProfileKeys))
      .map((r) => r.signalKey),
  );
}

/**
 * The signal keys a GIVEN SET OF CHECKS genuinely feeds — the exact Stage-3
 * resolution `getPillarCoverage` performs for one package, lifted out so the
 * package-scoped denominator has ONE definition rather than two that can drift.
 *
 * Fetches only the covered checks' definitions (the same `inArray` restriction
 * `getPillarCoverage` used inline), enumerates what they can produce via
 * `buildProducibleProfileKeys`, then filters the rules with `ruleIsFedByPackage`.
 * Nothing new here — this IS the pre-existing logic, now shared.
 */
async function resolveCoveredSignalKeys(
  coveredCheckKeys: ReadonlySet<string>,
  rules: Pick<SignalDerivationRule, "ruleType" | "sourceKey" | "signalKey">[],
): Promise<Set<string>> {
  if (coveredCheckKeys.size === 0) return new Set();

  const checkDefinitions: CheckDefinitionRow[] = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
      requiresCustomerScript: monitorChecksTable.requiresCustomerScript,
    })
    .from(monitorChecksTable)
    .where(inArray(monitorChecksTable.key, [...coveredCheckKeys]));

  const producibleProfileKeys = buildProducibleProfileKeys(coveredCheckKeys, checkDefinitions);

  return new Set(
    rules
      .filter((r) => ruleIsFedByPackage(r, coveredCheckKeys, producibleProfileKeys))
      .map((r) => r.signalKey),
  );
}

/**
 * Every monitor check a customer's own scans could genuinely have collected: the
 * union of `monitoring_package_checks` over the distinct `package_key`s of that
 * customer's `msp_diagnostic_runs`.
 *
 * The union (rather than just the newest run's package) is deliberate — a
 * customer whose entitlement moved them from `core:security-baseline` to
 * `assess:copilot-readiness` still legitimately holds rows from the earlier
 * package, and calling those "not in the scan" would be a new wrong answer in
 * place of the old one.
 *
 * Deliberately NOT filtered by run status: a run that is still `pending` /
 * `running` has already named its package, and its per-check rows land as each
 * check finishes (`executeMonitorCheck` writes before the next check starts), so
 * a mid-scan score must be scoped to the package being scanned right now — the
 * one case telemetry-comparison.ts's header called out as why it could not use
 * `getPillarCoverage` (which needs a COMPLETED run's packageKey).
 *
 * Returns a null `checkKeys` when there is nothing to conclude from — no runs at
 * all, or packages with no curated checks (the platform-wide state before
 * 2026-07-21's repopulation, which would otherwise mark every stat unscanned).
 *
 * Lives here (rather than in war-room-pillar-stats.ts, where it was written for
 * #341's `not_in_scan_package` honesty fix) because the scoring denominator and
 * the stat-unavailability reason must be answering the same question about the
 * same tenant — two copies could disagree, and a card reading "never scanned"
 * beside a score computed as though it had been is exactly the contradiction
 * #341 set out to remove.
 */
export async function fetchScannedCheckKeys(customerId: number): Promise<{
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
      "pillar-coverage: scanned packages curate no checks — scan scope cannot be resolved",
    );
    return { packageKeys, checkKeys: null };
  }
  return { packageKeys, checkKeys };
}

/**
 * THE denominator restriction for scoring ONE TENANT — the fix for #413.
 *
 * `computePillarDisplayScore` is `100 − (rawScore / theoreticalMax) × 100`, and
 * both sides must be measured over the SAME population or the score is clamped
 * before any weight is applied. The numerator can only ever contain signals fed
 * by checks the tenant was actually scanned with; this makes the denominator
 * agree, using the same package-scoped resolution `getPillarCoverage` has always
 * used (`fetchScannedCheckKeys` → `resolveCoveredSignalKeys`), just resolved
 * from the tenant's real run history instead of one supplied packageKey.
 *
 * Two deliberate widenings, both of which can only make a score MORE favourable,
 * never less — neither invents a signal, and neither is a new formula:
 *
 *  1. `firedSignalKeys` (the engine's own `output.rawSignals`) are unioned in.
 *     A signal that FIRED is evaluable for this tenant by direct proof — the
 *     data that fired it exists in the merged profile. Some real producers sit
 *     outside `monitoring_package_checks` entirely (`client_m365_profiles`,
 *     `script_run_results`, bridged legacy keys whose producer check is not in
 *     the package), so without this a fired signal could land in the numerator
 *     while being absent from the denominator — `rawScore > theoreticalMax`,
 *     clamped to a spurious 0. Passing them keeps numerator ⊆ denominator, which
 *     is a precondition of the formula, not an adjustment to it.
 *  2. When the tenant's scan scope cannot be resolved at all (no runs, or
 *     packages that curate no checks — `fetchScannedCheckKeys` returning null),
 *     this falls back to the catalog-wide `fetchEvaluableSignalKeys` and says so
 *     in the log. Silently nulling every pillar for a data-availability blip
 *     would be a new wrong answer; the honest "this tenant has never been
 *     scanned" surface is a separate, deliberate product decision (#413
 *     Finding 2) and is not made here by accident.
 *
 * `opts.scannedCheckKeys` lets a caller that has ALREADY resolved the tenant's
 * scan scope (war-room-pillar-stats.ts needs it for `not_in_scan_package`) pass
 * it in rather than repeat the two queries — `undefined` means "resolve it",
 * `null` means "already resolved, and there was nothing to conclude from".
 */
export async function fetchTenantEvaluableSignalKeys(
  customerId: number,
  rules: Pick<SignalDerivationRule, "ruleType" | "sourceKey" | "signalKey">[],
  opts?: {
    firedSignalKeys?: Iterable<string>;
    scannedCheckKeys?: ReadonlySet<string> | null;
  },
): Promise<Set<string>> {
  const scannedCheckKeys =
    opts?.scannedCheckKeys !== undefined
      ? opts.scannedCheckKeys
      : (await fetchScannedCheckKeys(customerId)).checkKeys;

  if (scannedCheckKeys == null || scannedCheckKeys.size === 0) {
    log.warn(
      { customerId },
      "pillar-coverage: no resolvable scan scope for this customer — falling back to the catalog-wide denominator",
    );
    return fetchEvaluableSignalKeys(rules);
  }

  const evaluable = await resolveCoveredSignalKeys(scannedCheckKeys, rules);

  // Proof-of-evaluability widening (1) above.
  let firedOutsidePackage = 0;
  for (const signalKey of opts?.firedSignalKeys ?? []) {
    if (evaluable.has(signalKey)) continue;
    evaluable.add(signalKey);
    firedOutsidePackage++;
  }

  log.debug(
    {
      customerId,
      scannedCheckCount: scannedCheckKeys.size,
      evaluableSignalCount: evaluable.size,
      firedOutsidePackage,
    },
    "pillar-coverage: resolved the tenant-scoped scoring denominator",
  );

  return evaluable;
}

/**
 * Per-rule "fed / structurally inert" status across the ENTIRE monitor_checks
 * catalog, for the Simulator Studio Pillar Matrix. Reuses the EXACT producible-
 * key primitives (`buildProducibleProfileKeys` + `ruleIsFedByPackage`) that
 * `fetchEvaluableSignalKeys` and `getPillarCoverage` already use — this is the
 * same "can any real check genuinely produce this rule's sourceKey" test, just
 * surfaced per rule (by id) instead of collapsed to a set of signal keys.
 *
 * The returned `evaluableSignalKeys` set is, by construction, IDENTICAL to what
 * `fetchEvaluableSignalKeys(rules)` returns (a signal is evaluable iff at least
 * one of its rules is fed) — CATALOG-WIDE, which is the right scope for a
 * rule-authoring matrix: it answers "does this rule reach any real check at
 * all", a question about the corpus, not about one tenant.
 *
 * Since #413 that is deliberately NO LONGER the denominator a tenant's live
 * score uses — that one is package-scoped (`fetchTenantEvaluableSignalKeys`).
 * A theoreticalMax computed from this set is therefore an upper bound on any
 * individual tenant's, not a match for it. Do not describe the two as equal.
 *
 * Async — reads monitor_checks once. Exported for the pillar-matrix route.
 */
export async function computeRuleFedStatus(
  rules: Pick<SignalDerivationRule, "id" | "ruleType" | "sourceKey" | "signalKey">[],
): Promise<{
  fedByRuleId: Map<number, boolean>;
  evaluableSignalKeys: Set<string>;
  checkKeyByRuleId: Map<number, string | null>;
}> {
  const checkDefinitions: CheckDefinitionRow[] = await db
    .select({
      key: monitorChecksTable.key,
      mapping: monitorChecksTable.mapping,
      properties: monitorChecksTable.properties,
      requiresCustomerScript: monitorChecksTable.requiresCustomerScript,
    })
    .from(monitorChecksTable);

  const allCheckKeys = new Set(checkDefinitions.map((c) => c.key));
  const producibleProfileKeys = buildProducibleProfileKeys(allCheckKeys, checkDefinitions);

  const fedByRuleId = new Map<number, boolean>();
  const evaluableSignalKeys = new Set<string>();
  const checkKeyByRuleId = new Map<number, string | null>();
  for (const rule of rules) {
    const fed = ruleIsFedByPackage(rule, allCheckKeys, producibleProfileKeys);
    fedByRuleId.set(rule.id, fed);
    if (fed) evaluableSignalKeys.add(rule.signalKey);
    checkKeyByRuleId.set(rule.id, resolveOwningCheckKey(rule, checkDefinitions));
  }
  return { fedByRuleId, evaluableSignalKeys, checkKeyByRuleId };
}

export async function getPillarCoverage(
  packageKey: string,
  customerId: number,
): Promise<PillarCoverageEntry[]> {
  const [packageChecks, { rules, groups }, healthOutput] = await Promise.all([
    db
      .select({ checkKey: monitoringPackageChecksTable.checkKey })
      .from(monitoringPackageChecksTable)
      .where(eq(monitoringPackageChecksTable.packageKey, packageKey)),
    fetchSignalRulesAndGroups(),
    calculateArchitectureHealthScore(customerId),
  ]);

  const coveredCheckKeys = new Set(packageChecks.map((c) => c.checkKey));
  if (coveredCheckKeys.size === 0) return [];

  // The package's genuinely-fed signals — the shared resolution (fetch the
  // covered checks' real definitions, enumerate the profile keys they produce,
  // filter the rules by what `evaluateRule` would actually read). Shared with
  // `fetchTenantEvaluableSignalKeys` so the radar's denominator and the
  // customer-facing score's denominator can never drift apart (#413).
  const coveredSignalKeys = await resolveCoveredSignalKeys(coveredCheckKeys, rules);
  if (coveredSignalKeys.size === 0) return [];

  const impacts = getSignalHealthImpacts(rules, groups);

  const covered: PillarCoverageEntry[] = [];
  for (const pillar of RADAR_PILLARS) {
    // Same honest display normalization for all seven pillars.
    // `healthOutput` comes from `calculateArchitectureHealthScore`, whose
    // breakdown already includes the Security Engine's real security entry —
    // no separate scoring path here. theoreticalMax is restricted to the
    // package's genuinely-fed signals (`coveredSignalKeys`) — the same set the
    // numerator's coverage decision above uses — so a rule the package can't
    // feed can't inflate this pillar's denominator either.
    //
    // #517: the "does at least one covered signal weigh on this pillar" test
    // that used to guard this loop is now inside `evaluatePillarDisplay`, as
    // `evaluableSignalCount`, measured against a real floor rather than against
    // one. Keeping a second copy here would have left the radar admitting a
    // pillar on ONE signal that the scoring layer then refused to score — an
    // axis with a permanent hole in it. One test, one place.
    const evaluation = evaluatePillarDisplay(pillar, healthOutput, impacts, coveredSignalKeys);
    if (evaluation.status !== "scored" || evaluation.score == null) continue; // don't fabricate

    covered.push({ pillar, label: PILLAR_LABELS[pillar], score: evaluation.score });
  }

  return covered;
}
