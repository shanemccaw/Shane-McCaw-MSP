/**
 * Wire types for the Tenant Signals screen.
 *
 * These mirror `artifacts/api-server/src/lib/tenant-signals.ts` and the
 * handlers in `artifacts/api-server/src/routes/admin-signal-rules.ts`. Nothing
 * here is invented: every field is one the API really returns, so a wrong
 * value on screen is a backend bug rather than a mapping one.
 *
 * The design (`Design/adminv2/Admin Shell.dc.html`, the `sg` section) models a
 * rule's condition as one free-text `when` string — "guests.noExpiry > 10".
 * The real model is three columns: `ruleType` + `sourceKey` + `compareValue`.
 * `conditionText()` below renders those three the way the design renders one,
 * so the screen reads like the prototype while editing what actually exists.
 */

/** The seven per-pillar impact columns a rule really carries. */
export const IMPACT_FIELDS = [
  "governanceImpact",
  "securityImpact",
  "complianceImpact",
  "adoptionImpact",
  "copilotImpact",
  "architectureImpact",
  "licensingImpact",
] as const;
export type ImpactField = (typeof IMPACT_FIELDS)[number];

export const IMPACT_LABELS: Record<ImpactField, string> = {
  governanceImpact: "Governance",
  securityImpact: "Security",
  complianceImpact: "Compliance",
  adoptionImpact: "Adoption",
  copilotImpact: "Copilot",
  architectureImpact: "Architecture",
  licensingImpact: "Licensing",
};

/**
 * Mirrors `SIGNAL_SEVERITIES` in api-server's tenant-signals.ts. No endpoint
 * serves the enum, which is why it is repeated here (the old panel's
 * `signalRuleForm.ts` repeats it for the same reason).
 */
export const SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

/**
 * The rule-type vocabulary, verbatim from `evaluateRule()`'s switch. `label` is
 * the plain-English form the design asks for; `sourceLabel` is what the source
 * key means for that type (a profile path, a monitor key, or a keyword), and
 * `compare` is null for the types `evaluateRule` ignores `compareValue` on.
 *
 * Kept in the same order and with the same wording as the old panel's
 * `components/signal-rules/signalRuleForm.ts` `RULE_TYPES`, so the two screens
 * cannot describe the same rule differently.
 */
export const RULE_TYPES: Array<{
  value: string;
  label: string;
  sourceLabel: string;
  compare: { label: string; hint: string } | null;
}> = [
  { value: "profile_key_truthy", label: "is set", sourceLabel: "Profile field", compare: null },
  { value: "profile_key_falsy", label: "is not set", sourceLabel: "Profile field", compare: null },
  { value: "profile_key_eq", label: "equals", sourceLabel: "Profile field", compare: { label: "Value", hint: "Compared as text" } },
  { value: "profile_key_gt", label: "is more than", sourceLabel: "Profile field", compare: { label: "Threshold", hint: "Compared as a number" } },
  { value: "profile_key_lt", label: "is less than", sourceLabel: "Profile field", compare: { label: "Threshold", hint: "Compared as a number" } },
  { value: "threshold", label: "returns more items than", sourceLabel: "Monitor check key", compare: { label: "Item count", hint: "Fires above this many items" } },
  { value: "findings_keyword", label: "appears in the findings", sourceLabel: "Keyword", compare: null },
];

export function ruleTypeMeta(value: string) {
  return RULE_TYPES.find((t) => t.value === value);
}

export function needsCompareValue(ruleType: string): boolean {
  return ruleTypeMeta(ruleType)?.compare != null;
}

// ─── Wire shapes ─────────────────────────────────────────────────────────────

/** A signal from the unified `custom_signals` catalog. */
export interface SignalDef {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  isAdjustment: boolean;
  isBuiltin: boolean;
  sortOrder: number;
  /** Sourced from `signal_enabled_state`, which is the authoritative toggle store. */
  enabled: boolean;
  /**
   * Only `GET /admin/engagement-projects/signals` supplies this — it is the
   * design's "unlocks" field, and it is real: the projects whose
   * `triggered_by` array names this signal.
   */
  unlocksProjects?: Array<{ id: number; title: string }>;
}

export interface SignalRule {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  sortOrder: number;
  priority: number;
  weight: number;
  severity: Severity;
  category: string;
  pillar: string;
  confidence: number;
  governanceImpact: number;
  securityImpact: number;
  complianceImpact: number;
  adoptionImpact: number;
  copilotImpact: number;
  architectureImpact: number;
  licensingImpact: number;
}

export interface SignalGroup {
  id: number;
  signalKey: string;
  logic: "AND" | "OR";
  label: string | null;
  sortOrder: number;
}

/** `GET /api/admin/signal-rules`. */
export interface SignalRulesResponse {
  bySignal: Record<string, { rules: SignalRule[]; groups: SignalGroup[] }>;
  rules: SignalRule[];
  groups: SignalGroup[];
}

/** `GET /api/admin/signal-rules/conflicts`. */
export interface Conflict {
  ruleIds: number[];
  description: string;
}

/**
 * `GET /api/admin/signal-rules/health` — how many clients each signal fires
 * for. Built from `script_run_results` only, so a tenant whose data arrives
 * through Graph monitor checks rather than a script run counts as zero here.
 * The screen says so rather than presenting the number as fleet truth.
 */
export type HealthMap = Record<string, { clientCount: number; totalClients: number }>;

export interface SimulationProfile {
  id: number;
  name: string;
  description: string | null;
  profileUpdates: Record<string, unknown>;
  parsedFindings: string[];
  tags: string[];
  lastRunAt: string | null;
}

export interface FiredSignal {
  key: string;
  label: string;
  expectedImpact: string;
}

export interface RuleTraceEntry {
  signalKey: string;
  groupId: number | null;
  ruleId: number;
  result: boolean;
  reason: string;
}

export interface ProjectRef {
  id: number;
  title: string;
  priceRange?: string | null;
}

/** `POST /admin/signal-rules/simulation-profiles/:id/run` and the two dry runs. */
export interface RunResult {
  /** Which runner produced it — drives the copy under the result. */
  kind: "test" | "projects" | "sow";
  profileName: string;
  firedSignals: FiredSignal[];
  ruleTrace: RuleTraceEntry[];
  includedProjects: ProjectRef[];
  excludedProjects: Array<{ project: ProjectRef; reason: string }>;
  previousRunDiff?: {
    newlyIncluded: ProjectRef[];
    movedToExcluded: ProjectRef[];
    newlyFired: Array<{ key: string; label: string }>;
    stoppedFiring: Array<{ key: string; label: string }>;
  } | null;
  /** The API's own words for a dry run, shown verbatim. */
  note?: string;
}

export interface RuleVersion {
  id: number;
  name: string;
  ruleCount: number;
  createdAt: string;
}

/** `GET /admin/signal-rules/clients-with-runs` — the "import a live client" list. */
export interface ClientWithRuns {
  id: number;
  name: string;
  tenantId: string | null;
  isTestbed: boolean;
  consentStatus: string | null;
}

// ─── Derived text ────────────────────────────────────────────────────────────

/**
 * The design's one-line condition, rebuilt from the three real columns.
 *
 * A rule with no `sourceKey` can never fire — `evaluateRule` reads
 * `mergedProfile[sourceKey]`, and an empty key reads nothing. That is the same
 * dead state the design paints red as "no condition — never fires", so it is
 * reported the same way rather than rendered as an empty but plausible rule.
 */
export function conditionText(rule: Pick<SignalRule, "ruleType" | "sourceKey" | "compareValue">): string {
  if (!rule.sourceKey) return "";
  const meta = ruleTypeMeta(rule.ruleType);
  if (!meta) return `${rule.sourceKey} ${rule.ruleType} ${rule.compareValue ?? ""}`.trim();
  if (!meta.compare) return `${rule.sourceKey} ${meta.label}`;
  return `${rule.sourceKey} ${meta.label} ${rule.compareValue ?? ""}`.trim();
}

/** Total pillar impact — the design's "N impact" on each rule row. */
export function totalImpact(rule: SignalRule): number {
  return IMPACT_FIELDS.reduce((sum, f) => sum + (Number(rule[f]) || 0), 0);
}

/**
 * Every reason a rule is broken, in the design's own terms. Kept client-side
 * and separate from `GET /admin/signal-rules/conflicts`, which only detects
 * contradictions *between* rules (truthy vs falsy on one key, disagreeing
 * `eq` values) and cannot see a rule that is individually inert.
 */
export function ruleFaults(rule: SignalRule): string[] {
  const out: string[] = [];
  if (!rule.sourceKey) out.push("no condition — it can never fire");
  else if (needsCompareValue(rule.ruleType) && (rule.compareValue ?? "") === "") {
    out.push("no value to compare against");
  }
  if (totalImpact(rule) === 0) out.push("affects no pillar");
  return out;
}
