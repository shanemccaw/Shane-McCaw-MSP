/**
 * monitor-check-trace.ts
 *
 * The Simulator Studio's engine trace: collapses the whole manual chain
 *
 *   endpoint response
 *     -> monitor_checks.mapping transforms
 *       -> the real profile keys produced
 *         -> signal_derivation_rules referencing those keys
 *           -> whether each evaluates true/false
 *
 * into one derivation, computed against a response that was ALREADY captured by
 * a run. Tracing this by hand is hours of SQL; this module is that work done
 * live, in code, from the same functions the real pipeline uses.
 *
 * REUSE, NOT REIMPLEMENTATION — the central constraint of this phase:
 *   • `applyMapping` (monitor-executor.ts) performs the mapping. Every
 *     transform — count / exists / first / join / countTruthy / countFalse /
 *     countEquals / countIfLastSignInOlderThan / groupByCount / countDuplicates
 *     — is the real one. None of that logic is restated here.
 *   • `evaluateRule` (tenant-signals.ts) decides each rule's true/false AND
 *     produces the human-readable reason string. Both are surfaced verbatim;
 *     this module never authors a second explanation of a rule's outcome.
 *   • `mergeMonitorProfileRows` (tenant-signals.ts) builds the merged profile
 *     evaluateRule reads, so `<checkKey>__itemCount` (what `threshold` rules
 *     consume) is derived exactly as the real pipeline derives it, rather than
 *     assembled ad-hoc here.
 *   • `getAllRules` (admin-signal-rules.ts) supplies the rules, already scoped
 *     to platform-owned rows (msp_id IS NULL) — the same scope the rest of this
 *     session's rule work used.
 *
 * A duplicated copy of any of those would drift from the real engine, and a
 * trace that disagrees with production is worse than no trace at all.
 */

import { applyMapping, type MappingRule } from "./monitor-executor.ts";
import {
  evaluateRule,
  mergeMonitorProfileRows,
  type SignalDerivationRule,
  type TenantMonitorProfileRow,
} from "./tenant-signals.ts";
import { PILLAR_FIELD, type HealthPillar } from "./health-engine.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One rule that reads a produced key, with its real evaluation outcome. */
export interface TracedRule {
  ruleId: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  /** From evaluateRule() — the real result. */
  result: boolean;
  /** From evaluateRule() — surfaced verbatim, never regenerated here. */
  reason: string;
}

/** One real profile key this response produced, and what reads it. */
export interface TracedKey {
  key: string;
  /** The value applyMapping actually produced for this key. */
  value: unknown;
  /** Where the key came from: a mapping rule's targetField, a `properties` extraction, or the synthetic item count. */
  origin: "mapping" | "property" | "itemCount";
  /** For origin "mapping": the mapping rule that produced it. */
  sourceField?: string;
  transform?: string;
  /** Every msp_id-IS-NULL rule whose sourceKey is this key, with its real outcome. */
  rules: TracedRule[];
  /** True when no rule references this key at all — the uncovered case a suggestion is offered for. */
  uncovered: boolean;
}

export interface RuleSuggestion {
  /** The produced key the suggested rule would read. */
  sourceKey: string;
  ruleType: string;
  compareValue: string | null;
  /** The observed value the suggestion was inferred from — shown so the judgment is auditable. */
  observedValue: unknown;
  observedType: "boolean" | "number" | "string" | "other";
  /** Plain-English statement of the direction call and WHY it was made. */
  rationale: string;
  /** The dominant pillar, from the check key's domain prefix. */
  dominantPillar: string;
  /** Suggested per-pillar impact values, keyed by the real intelligence field name. */
  pillarImpacts: Record<string, number>;
  /** A starting signalKey the operator can change — never auto-applied. */
  suggestedSignalKey: string;
  severity: string;
}

export interface CheckTrace {
  checkKey: string;
  /** Keys produced by applying the check's real mapping to the real response. */
  keys: TracedKey[];
  /** Suggestions for produced keys that ZERO rules reference. */
  suggestions: RuleSuggestion[];
  itemCount: number;
  /** Count of produced keys that at least one rule reads. */
  coveredKeyCount: number;
  uncoveredKeyCount: number;
}

// ── Direction discipline ──────────────────────────────────────────────────────

/**
 * Count keys naming something that SHOULD exist — a healthy tenant has MORE of
 * these, so the alarm fires when the count is LOW (`profile_key_lt`).
 *
 * This is the CA-policy-count lesson made reusable: `conditionalAccessPolicyCount`
 * was given a `>` rule, which can only fire on a tenant that has MANY policies —
 * backwards, because zero policies is the actual alarm. Getting this wrong
 * produces a rule that looks correct, never fires, and hides a real gap.
 */
const PROTECTIVE_COUNT_PATTERNS: RegExp[] = [
  /\bpolic(y|ies)Count\b/i,
  /conditionalAccess/i,
  /\bmfa\w*(registered|enabled|coverage|count)\b/i,
  /\b(dlp|retention|backup|alert|baseline|compliance)\w*Count\b/i,
  /\b(protected|compliant|enrolled|registered|licensed|encrypted|managed)\w*Count\b/i,
  /\bsecureScore\b/i,
  /Score$/,
];

/**
 * Count keys naming something inherently BAD — a healthy tenant has FEWER (ideally
 * zero), so the alarm fires when the count is HIGH (`profile_key_gt`).
 */
const RISK_COUNT_PATTERNS: RegExp[] = [
  /\b(stale|inactive|orphan|expired|disabled|unmanaged|noncompliant|nonCompliant)\w*\b/i,
  /\b(guest|external|anonymous|shared|legacy)\w*Count\b/i,
  /\b(globalAdmin|admin)\w*Count\b/i,
  /\b(risky|risk|vulnerab|incident|alert|breach|failure|failed|error)\w*\b/i,
  /\b(duplicate|missing|gap|unprotected|unencrypted|unlicensed)\w*\b/i,
  /\bwithout\w*\b/i,
];

/**
 * Boolean keys whose SAFE state is `true` — the alarm fires on falsy
 * (`profile_key_falsy`). e.g. `mfaEnforced: false` is the problem.
 */
const PROTECTIVE_BOOLEAN_PATTERNS: RegExp[] = [
  /^(is|has|are)?\s*\w*(enabled|enforced|configured|compliant|protected|registered|required|active|on)\b/i,
  /\b(mfa|encryption|backup|audit|dlp|retention)\w*\b/i,
];

function matchesAny(key: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(key));
}

// ── Domain → pillar mapping ───────────────────────────────────────────────────

/**
 * Monitor check keys are namespaced by domain (`identity:mfa-registration` ->
 * `identity`) — the real taxonomy, since monitor_checks has no category column.
 * This maps that domain onto the platform's real pillar universe (the seven
 * radar pillars; `PILLAR_FIELD` in health-engine.ts owns the pillar -> impact
 * column names, so the field names here are never hand-spelled).
 *
 * `spillover` names 1–2 plausibly-related pillars that get a small non-zero
 * value; every other pillar stays at exactly zero. A rule that nudges all seven
 * pillars is indistinguishable from noise on the radar.
 */
const DOMAIN_PILLARS: Record<string, { dominant: HealthPillar | "security"; spillover: Array<HealthPillar | "security"> }> = {
  identity: { dominant: "security", spillover: ["governance", "compliance"] },
  security: { dominant: "security", spillover: ["compliance"] },
  compliance: { dominant: "compliance", spillover: ["governance"] },
  governance: { dominant: "governance", spillover: ["compliance"] },
  devices: { dominant: "security", spillover: ["architecture"] },
  intune: { dominant: "security", spillover: ["architecture"] },
  sharepoint: { dominant: "governance", spillover: ["security", "adoption"] },
  onedrive: { dominant: "governance", spillover: ["adoption"] },
  teams: { dominant: "adoption", spillover: ["governance"] },
  exchange: { dominant: "security", spillover: ["governance"] },
  adoption: { dominant: "adoption", spillover: ["copilot"] },
  copilot: { dominant: "copilot", spillover: ["adoption", "licensing"] },
  licensing: { dominant: "licensing", spillover: ["architecture"] },
  usage: { dominant: "adoption", spillover: ["licensing"] },
  platform: { dominant: "architecture", spillover: ["governance"] },
  architecture: { dominant: "architecture", spillover: ["governance"] },
  backup: { dominant: "architecture", spillover: ["compliance"] },
};

/** Fallback when a check key uses a domain not in the table above. */
const DEFAULT_DOMAIN_PILLARS = { dominant: "governance" as const, spillover: ["security" as const] };

const DOMINANT_IMPACT = 5;
const SPILLOVER_IMPACT = 2;

/**
 * `licensingImpact` is a real column on signal_derivation_rules, but the admin
 * signal-rules API neither accepts nor returns it (verified: no reference in
 * admin-signal-rules.ts — the same round-trip gap SignalRules.tsx documents).
 * A suggestion carrying it would show the operator a number that is silently
 * dropped on save, so it is excluded from suggested impacts and the licensing
 * pillar falls back to its dominant/spillover alternative below. Reinstate it
 * here once the API round-trips the field.
 */
const UNSUPPORTED_IMPACT_FIELDS = new Set<string>([PILLAR_FIELD.licensing]);

/** Pillar substituted when a domain's chosen pillar has no writable impact field. */
const LICENSING_FALLBACK_PILLAR = "architecture" as const;

export function domainOf(checkKey: string): string {
  const idx = checkKey.indexOf(":");
  return idx > 0 ? checkKey.slice(0, idx) : checkKey;
}

/**
 * Builds a starting pillar-impact profile: the dominant pillar for the check's
 * domain, small non-zero spillover on its related pillars, and an explicit ZERO
 * on every other pillar (explicit, not omitted, so the suggestion states its
 * full position rather than leaving fields to backend defaults).
 */
export function suggestPillarImpacts(checkKey: string): { dominantPillar: string; pillarImpacts: Record<string, number> } {
  const cfg = DOMAIN_PILLARS[domainOf(checkKey)] ?? DEFAULT_DOMAIN_PILLARS;

  // Only pillars whose impact field the API can actually persist.
  const writable = (p: HealthPillar | "security"): boolean => !UNSUPPORTED_IMPACT_FIELDS.has(PILLAR_FIELD[p]);
  const dominant = writable(cfg.dominant) ? cfg.dominant : LICENSING_FALLBACK_PILLAR;

  const impacts: Record<string, number> = {};
  for (const field of Object.values(PILLAR_FIELD)) {
    if (!UNSUPPORTED_IMPACT_FIELDS.has(field)) impacts[field] = 0;
  }
  impacts[PILLAR_FIELD[dominant]] = DOMINANT_IMPACT;
  for (const p of cfg.spillover) {
    if (!writable(p)) continue;
    // Never let spillover overwrite the dominant pillar's larger value.
    if (PILLAR_FIELD[p] === PILLAR_FIELD[dominant]) continue;
    impacts[PILLAR_FIELD[p]] = SPILLOVER_IMPACT;
  }
  return { dominantPillar: dominant, pillarImpacts: impacts };
}

// ── Rule-type inference ───────────────────────────────────────────────────────

/**
 * Infers a rule from the property's ACTUAL JS value type in this response, with
 * a stated direction judgment per suggestion.
 *
 * Numbers derive their threshold from the observed value rather than a
 * hardcoded guess:
 *   • protective count (more is safer) -> `profile_key_lt`, threshold at the
 *     observed value, so "fewer than we have right now" is the alarm. When the
 *     observed value is already 0 the threshold becomes 1 — otherwise
 *     `lt 0` could never fire and the rule would be dead on arrival.
 *   • risk count (fewer is safer) -> `profile_key_gt`, threshold at 0 when
 *     none exist today (any occurrence is the alarm), else at the observed
 *     value (further growth is the alarm).
 *
 * Returns null for values no rule type can meaningfully read (objects from
 * groupByCount, arrays, nulls) rather than inventing a rule that cannot fire.
 */
export function inferSuggestion(key: string, value: unknown, checkKey: string): RuleSuggestion | null {
  const { dominantPillar, pillarImpacts } = suggestPillarImpacts(checkKey);
  const base = {
    sourceKey: key,
    observedValue: value,
    dominantPillar,
    pillarImpacts,
    suggestedSignalKey: `${dominantPillar}:${key}`,
  };

  if (typeof value === "boolean") {
    const protective = matchesAny(key, PROTECTIVE_BOOLEAN_PATTERNS);
    return {
      ...base,
      observedType: "boolean",
      ruleType: protective ? "profile_key_falsy" : "profile_key_truthy",
      compareValue: null,
      severity: protective ? "high" : "medium",
      rationale: protective
        ? `"${key}" names a protection that should be ON, so the alarm is the FALSY case — profile_key_falsy. (Observed: ${value}.) A truthy rule here would only fire on correctly-configured tenants.`
        : `"${key}" reads as a condition whose presence is the problem, so the alarm is the TRUTHY case — profile_key_truthy. (Observed: ${value}.) Flip to profile_key_falsy if this key actually names something that SHOULD be true.`,
    };
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const risk = matchesAny(key, RISK_COUNT_PATTERNS);
    const protective = !risk && matchesAny(key, PROTECTIVE_COUNT_PATTERNS);

    if (protective) {
      const threshold = value > 0 ? value : 1;
      return {
        ...base,
        observedType: "number",
        ruleType: "profile_key_lt",
        compareValue: String(threshold),
        severity: "high",
        rationale:
          `"${key}" counts something a healthy tenant should have MORE of, so the alarm is a LOW count — profile_key_lt, not gt. ` +
          `This is the conditional-access-policy-count lesson: a "> n" rule on a protective count only fires on tenants that are already well configured, and stays silent on the zero-policy tenant that actually needs attention. ` +
          `Threshold seeded from the observed value (${value})${value > 0 ? "" : ", raised to 1 because \"lt 0\" could never fire"}.`,
      };
    }

    const threshold = risk ? (value > 0 ? value : 0) : value > 0 ? value : 0;
    return {
      ...base,
      observedType: "number",
      ruleType: "profile_key_gt",
      compareValue: String(threshold),
      severity: risk ? "high" : "medium",
      rationale: risk
        ? `"${key}" counts something inherently undesirable, so the alarm is a HIGH count — profile_key_gt. Threshold seeded from the observed value (${value})${value > 0 ? ", so further growth fires" : ", so any occurrence at all fires"}.`
        : `"${key}" has no clear protective/risk signal in its name, so this defaults to profile_key_gt at the observed value (${value}) — a deliberately weak call. CONFIRM THE DIRECTION before accepting: if more of "${key}" is actually safer, switch to profile_key_lt.`,
    };
  }

  if (typeof value === "string" && value.trim() !== "") {
    return {
      ...base,
      observedType: "string",
      ruleType: "profile_key_eq",
      compareValue: value,
      severity: "medium",
      rationale: `"${key}" produced the string ${JSON.stringify(value)}. Suggested as an equality rule against that observed value — confirm whether this exact value is the ALARM state or the HEALTHY state before accepting.`,
    };
  }

  // Objects (groupByCount), arrays, null/undefined: no rule type reads these
  // meaningfully. Suggesting one would create a rule that can never fire.
  return null;
}

// ── The trace ─────────────────────────────────────────────────────────────────

/** Keys applyMapping emits for bookkeeping rather than as signal-readable values. */
const INTERNAL_KEY_PREFIX = "_";

/**
 * Runs the full trace against an ALREADY-CAPTURED response.
 *
 * Deliberately takes `items` (not a tenantId, endpoint or fetch) so it cannot
 * issue a network call: this is what makes "Re-evaluate" instant and repeatable
 * against identical data while tuning a rule.
 */
export function traceCheckResponse(opts: {
  checkKey: string;
  items: unknown[];
  mapping: MappingRule[];
  properties: string[];
  rules: SignalDerivationRule[];
  /** Real finding strings, for findings_keyword rules. Empty is honest for a single-check trace. */
  parsedFindings?: string[];
}): CheckTrace {
  const { checkKey, items, mapping, properties, rules, parsedFindings = [] } = opts;

  // 1. THE REAL MAPPING. applyMapping is monitor-executor's own function — the
  //    same call executeMonitorCheck makes on the live path.
  const extracted = applyMapping(items, mapping, properties);

  // 2. THE REAL MERGE. mergeMonitorProfileRows is what buildTenantProfile and
  //    the workflow executor use, so `<checkKey>__itemCount` (read by
  //    `threshold` rules) is derived identically to production.
  const mergedProfile: Record<string, unknown> = {};
  const profileRow: TenantMonitorProfileRow = {
    checkKey,
    status: "ok",
    severityMatched: null,
    extractedProperties: extracted,
  };
  mergeMonitorProfileRows(mergedProfile, [profileRow]);

  // 3. Attribute each produced key to how it was produced.
  const originOf = (key: string): { origin: TracedKey["origin"]; sourceField?: string; transform?: string } => {
    const mapped = mapping.find((m) => m.targetField === key);
    if (mapped) return { origin: "mapping", sourceField: mapped.sourceField, transform: mapped.transform ?? "none" };
    return { origin: "property" };
  };

  const rulesBySourceKey = new Map<string, SignalDerivationRule[]>();
  for (const r of rules) {
    const list = rulesBySourceKey.get(r.sourceKey);
    if (list) list.push(r);
    else rulesBySourceKey.set(r.sourceKey, [r]);
  }

  const keys: TracedKey[] = [];
  const suggestions: RuleSuggestion[] = [];

  const producedKeys = Object.keys(extracted).filter((k) => !k.startsWith(INTERNAL_KEY_PREFIX));
  // The synthetic itemCount key `threshold` rules read is a real, rule-readable
  // key even though it isn't in `extracted` — include it so a threshold rule
  // shows up in the trace instead of appearing to reference nothing.
  const itemCountKey = `${checkKey}__itemCount`;

  for (const key of producedKeys) {
    const matching = rulesBySourceKey.get(key) ?? [];
    const traced: TracedRule[] = matching.map((rule) => {
      // 4. THE REAL EVALUATION. Both the boolean AND the reason string come
      //    straight from evaluateRule — no second explanation is authored here.
      const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
      return {
        ruleId: rule.id,
        signalKey: rule.signalKey,
        groupId: rule.groupId,
        ruleType: rule.ruleType,
        sourceKey: rule.sourceKey,
        compareValue: rule.compareValue,
        description: rule.description,
        result,
        reason,
      };
    });

    const { origin, sourceField, transform } = originOf(key);
    const uncovered = traced.length === 0;
    keys.push({ key, value: extracted[key], origin, sourceField, transform, rules: traced, uncovered });

    if (uncovered) {
      const suggestion = inferSuggestion(key, extracted[key], checkKey);
      if (suggestion) suggestions.push(suggestion);
    }
  }

  // The item-count key, traced the same way (never suggested for: a threshold
  // rule's direction depends on what the endpoint returns, which the operator
  // knows and a name-pattern cannot).
  const itemCountRules = rulesBySourceKey.get(checkKey) ?? [];
  const itemCountTraced: TracedRule[] = itemCountRules
    .filter((r) => r.ruleType === "threshold")
    .map((rule) => {
      const { result, reason } = evaluateRule(rule, mergedProfile, parsedFindings);
      return {
        ruleId: rule.id,
        signalKey: rule.signalKey,
        groupId: rule.groupId,
        ruleType: rule.ruleType,
        sourceKey: rule.sourceKey,
        compareValue: rule.compareValue,
        description: rule.description,
        result,
        reason,
      };
    });
  keys.push({
    key: itemCountKey,
    value: mergedProfile[itemCountKey],
    origin: "itemCount",
    rules: itemCountTraced,
    uncovered: itemCountTraced.length === 0,
  });

  const coveredKeyCount = keys.filter((k) => !k.uncovered).length;
  return {
    checkKey,
    keys,
    suggestions,
    itemCount: items.length,
    coveredKeyCount,
    uncoveredKeyCount: keys.length - coveredKeyCount,
  };
}
