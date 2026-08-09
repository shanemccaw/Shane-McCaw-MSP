/**
 * M365 Endpoints — the real shapes, and the pure helpers that operate on them.
 *
 * `handoff.md` section 6 calls this "the hardest screen" and states the loop it
 * has to make possible:
 *
 *   run -> browse what came back -> click a value -> get a rule
 *
 * The design prototype implements that loop over invented data with an invented
 * rule grammar (`epEval`, a `when` string like `"neverAccepted > 5"`). None of
 * that exists in this platform, and building it would produce a screen that
 * confidently disagrees with the engine. The real chain, which this module
 * types verbatim, is:
 *
 *   `monitor_checks` row  (the endpoint definition: endpoint/method/select/filter/mapping)
 *     -> POST /api/admin/monitor-checks/:key/run          (a real Graph call, 202 + runId)
 *       -> GET  /api/admin/monitor-check-runs/:runId      (poll to terminal)
 *         -> GET  .../:runId/items                        ("what came back", raw)
 *         -> POST .../:runId/trace                        (the REAL mapping + the REAL rule evaluation)
 *           -> POST /api/admin/signal-rules               (the rule the operator just wrote)
 *
 * Two consequences worth stating, because they are the difference between this
 * screen and the prototype:
 *
 * 1. **"Would this fire?" is answered by the server, not guessed here.** The
 *    trace route re-applies `applyMapping` and `evaluateRule` — the same
 *    functions the scheduled pipeline runs — against the response the run
 *    already captured, and issues no network call while doing it. A
 *    reimplemented client-side evaluator would drift, and a trace that
 *    disagrees with production is worse than no trace (`monitor-check-trace.ts`
 *    says exactly this).
 * 2. **The rule candidates are real inferences, not type-shaped guesses.** The
 *    prototype offers `> 0` / `> current` / `> half` for any number. The
 *    platform's `inferSuggestion` reads the key's NAME as well as its value and
 *    picks a DIRECTION with a stated rationale — a protective count gets
 *    `profile_key_lt`, because a `>` rule on `conditionalAccessPolicyCount` can
 *    only fire on tenants that are already well configured. That rationale is
 *    surfaced verbatim; this screen never authors a second explanation.
 *
 * Everything here is pure and dependency-free so `endpoints.test.tsx` can drive
 * it without a DOM.
 */

// ── monitor_checks ────────────────────────────────────────────────────────────

/** `monitor_checks.executor_type`. Only `graph` rows have a URL this screen can run. */
export type ExecutorType = "graph" | "powershell" | "sharepoint-admin" | "dns";

export type CheckFrequency = string;

/** One mapping rule: `monitor_checks.mapping[]`. */
export interface MappingRule {
  sourceField: string;
  targetField: string;
  transform?: string;
}

/** One severity rule: `monitor_checks.severity_rules[]`. Not the same thing as a signal rule. */
export interface CheckSeverityRule {
  expression: string;
  severity: string;
  label?: string;
}

/** A `monitor_checks` row, as `GET /api/admin/monitor-checks` returns it. */
export interface MonitorCheck {
  id: number;
  checkId: string;
  key: string;
  label: string;
  description: string | null;
  endpoint: string;
  method: string;
  requestBody: Record<string, unknown> | null;
  selectParams: string | null;
  filterParams: string | null;
  properties: string[];
  mapping: MappingRule[];
  severityRules: CheckSeverityRule[];
  outputSchema: Record<string, unknown> | null;
  engines: string[];
  frequency: CheckFrequency;
  requiresCustomerScript: boolean;
  executorType: ExecutorType;
  fanOutSource: string | null;
  spOperation: string | null;
  psCmdletKey: string | null;
  status: string;
  updatedAt: string;
}

/** A `monitoring_packages` row. */
export interface MonitoringPackage {
  key: string;
  label: string;
  status: string;
}

// ── Runs ──────────────────────────────────────────────────────────────────────

export type RunStatus = "pending" | "running" | "completed" | "failed";

/** `CheckResult` from monitor-executor.ts. */
export interface CheckResult {
  checkKey: string;
  status: "ok" | "error" | "consent_revoked" | "requires_script" | "license_gap" | "partial";
  extractedProperties: Record<string, unknown>;
  severityMatched: string | null;
  severityLabel?: string | null;
  errorMessage?: string;
  itemCount: number;
  pageCount: number;
  licenseFeature?: string;
}

/** What the poll route returns on `run` (minus `items`/`trace`, which it strips). */
export interface MonitorCheckRun {
  runId: string;
  checkKey: string;
  checkLabel: string;
  customerId: number;
  tenantId: string;
  status: RunStatus;
  statusText: string;
  progress: number;
  startedAt: string;
  completedAt?: string;
  result?: CheckResult;
  error?: string;
  request: { endpoint: string; method: string; requestBody: unknown };
  itemsOmitted: boolean;
  itemsOmittedReason?: string;
  mapping: MappingRule[];
  properties: string[];
  tracedAt?: string;
}

/** Phase-4 failure triage, attached by the read routes. Null on a run that didn't fail. */
export interface FailureClassification {
  category?: string;
  title?: string;
  detail?: string;
  remedy?: string;
  [k: string]: unknown;
}

// ── The trace ─────────────────────────────────────────────────────────────────

/** One signal rule reading a produced key, with its REAL outcome from `evaluateRule`. */
export interface TracedRule {
  ruleId: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  result: boolean;
  /** From `evaluateRule()`. Surfaced verbatim — never regenerated here. */
  reason: string;
}

/** The platform's own rule inference for one produced key. */
export interface RuleSuggestion {
  sourceKey: string;
  ruleType: string;
  compareValue: string | null;
  observedValue: unknown;
  observedType: "boolean" | "number" | "string" | "other";
  /** Plain-English statement of the direction call and WHY. Shown as-is. */
  rationale: string;
  dominantPillar: string;
  pillarImpacts: Record<string, number>;
  suggestedSignalKey: string;
  severity: string;
}

export interface TracedKey {
  key: string;
  value: unknown;
  origin: "mapping" | "property" | "itemCount";
  sourceField?: string;
  transform?: string;
  rules: TracedRule[];
  uncovered: boolean;
  suggestion: RuleSuggestion | null;
}

export interface CheckTrace {
  checkKey: string;
  keys: TracedKey[];
  suggestions: RuleSuggestion[];
  itemCount: number;
  coveredKeyCount: number;
  uncoveredKeyCount: number;
}

// ── Signal rules ──────────────────────────────────────────────────────────────

/** A `signal_derivation_rules` row as `/admin/signal-rules/for-check` returns it. */
export interface SignalRule {
  id: number;
  signalKey: string;
  groupId: number | null;
  ruleType: string;
  sourceKey: string;
  compareValue: string | null;
  description: string | null;
  severity?: string;
  /** `for-check` only: whether this rule was matched by name or through its source key. */
  matchedVia?: "signalKey" | "sourceKey";
}

/** A `custom_signals` catalog row. A rule cannot be created against a key with no row. */
export interface CustomSignal {
  key: string;
  label: string;
  description: string;
  expectedImpact: string;
  isAdjustment: boolean;
}

// ── Tenants ───────────────────────────────────────────────────────────────────

/**
 * One row of `GET /api/admin/testbeds`.
 *
 * `id` is `tenants.id` — the SAME id space `POST /monitor-checks/:key/run`
 * resolves `customerId` against (`resolveCustomer` selects on
 * `tenantsTable.id`). `GET /admin/clients/with-azure-credentials` looks like a
 * plausible alternative and is NOT one: it returns `users.id`, so passing those
 * ids to the run route resolves a different customer or 404s.
 */
export interface TenantOption {
  id: number;
  mspId: number | null;
  name: string;
  domain: string | null;
}

// ── Request composition ───────────────────────────────────────────────────────

/**
 * A per-check request override. Held only in this screen's memory: it is sent
 * with the run and never written to the catalog unless the operator explicitly
 * saves it (the peek's edit fields do that, through `PATCH /monitor-checks/:key`).
 *
 * `undefined` on a field means "use the saved value"; a value (including `""`
 * and `null`) means "override it". That distinction is the whole reason this is
 * a sparse object rather than a filled-in copy of the check.
 */
export interface RequestOverride {
  endpoint?: string;
  method?: string;
  selectParams?: string | null;
  filterParams?: string | null;
}

export function hasOverride(o: RequestOverride | undefined): boolean {
  if (!o) return false;
  return (
    o.endpoint !== undefined
    || o.method !== undefined
    || o.selectParams !== undefined
    || o.filterParams !== undefined
  );
}

/** The effective value of one request field: the override if set, else the saved one. */
export function effectiveEndpoint(check: MonitorCheck, o?: RequestOverride): string {
  return o?.endpoint !== undefined ? o.endpoint : check.endpoint;
}

export function effectiveMethod(check: MonitorCheck, o?: RequestOverride): string {
  return o?.method !== undefined ? o.method : check.method;
}

export function effectiveSelect(check: MonitorCheck, o?: RequestOverride): string | null {
  return o?.selectParams !== undefined ? o.selectParams : check.selectParams;
}

export function effectiveFilter(check: MonitorCheck, o?: RequestOverride): string | null {
  return o?.filterParams !== undefined ? o.filterParams : check.filterParams;
}

/** Ported verbatim from `monitor-executor.ts` so the preview cannot drift from the request. */
function stripParam(url: string, prefixRegex: RegExp): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;
  const base = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  const kept = query.split("&").filter((part) => !prefixRegex.test(part));
  if (kept.length === 0) return base;
  return `${base}?${kept.join("&")}`;
}

/**
 * The URL the executor will actually build — `appendQueryParams` from
 * `monitor-executor.ts`, ported line for line.
 *
 * This is the parser `handoff.md` section 6 warns about, in its real form. The
 * design assumed `$select`/`$filter` live inline in the saved path and that a
 * missing parser "silently drops the filter and queries the whole tenant". In
 * this platform they are BOTH: `monitor_checks` has dedicated `select_params` /
 * `filter_params` columns AND the `endpoint` string frequently carries its own
 * inline query. The server resolves that by having the columns REPLACE their
 * inline namesakes (`stripParam` then append) rather than adding a second copy,
 * so a preview that merely concatenated would show a URL with two `$filter=`
 * clauses that the tenant is never asked for.
 */
export function buildRequestUrl(
  endpoint: string,
  selectParams?: string | null,
  filterParams?: string | null,
): string {
  let finalUrl = endpoint;
  if (selectParams !== undefined && selectParams !== null && selectParams.trim() !== "") {
    finalUrl = stripParam(finalUrl, /^\$select=/i);
    const trimmed = selectParams.trim().replace(/^[?&]/, "").replace(/^\$select=/i, "");
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl += `${sep}$select=${trimmed}`;
  }
  if (filterParams !== undefined && filterParams !== null && filterParams.trim() !== "") {
    finalUrl = stripParam(finalUrl, /^\$filter=/i);
    let trimmed = filterParams.trim().replace(/^[?&]/, "").replace(/^\$filter=/i, "");
    try {
      trimmed = decodeURIComponent(trimmed);
    } catch {
      /* a filter that is not valid percent-encoding is used as typed */
    }
    const sep = finalUrl.includes("?") ? "&" : "?";
    finalUrl += `${sep}$filter=${encodeURIComponent(trimmed)}`;
  }
  return finalUrl;
}

/** The full effective URL for a check under its current overrides. */
export function requestUrlFor(check: MonitorCheck, o?: RequestOverride): string {
  return buildRequestUrl(
    effectiveEndpoint(check, o),
    effectiveSelect(check, o),
    effectiveFilter(check, o),
  );
}

/**
 * The fields a `$select` picker can offer before anything has been run.
 *
 * Parsed out of whatever `$select` the request already carries, plus the check's
 * own `properties[]` (which is what `applyMapping` extracts per item). After a
 * run there is a better source — the keys of the first captured item — and
 * `fieldsFromItems` supplies that.
 */
export function selectedFields(check: MonitorCheck, o?: RequestOverride): string[] {
  const raw = effectiveSelect(check, o);
  const fromColumn = raw ? raw.trim().replace(/^[?&]/, "").replace(/^\$select=/i, "") : "";
  const inline = /\$select=([^&]+)/i.exec(effectiveEndpoint(check, o));
  const source = fromColumn || (inline ? inline[1]! : "");
  return source
    .split(",")
    .map((f) => f.trim())
    .filter(Boolean);
}

/** Every field name the captured response actually contains, across all items. */
export function fieldsFromItems(items: unknown[] | null): string[] {
  if (!items?.length) return [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      for (const k of Object.keys(item as Record<string, unknown>)) seen.add(k);
    }
  }
  return [...seen].sort();
}

// ── Taxonomy ──────────────────────────────────────────────────────────────────

/**
 * `monitor_checks` has no category column: a check key is namespaced by domain
 * (`identity:mfa-registration` -> `identity`) and that prefix IS the taxonomy.
 * The bulk-run route says so in as many words, and `domainOf` here is the same
 * function `monitor-check-trace.ts` exports.
 */
export function domainOf(checkKey: string): string {
  const idx = checkKey.indexOf(":");
  return idx > 0 ? checkKey.slice(0, idx) : checkKey;
}

/**
 * Domain -> dominant pillar, mirroring `DOMAIN_PILLARS` in
 * `monitor-check-trace.ts`.
 *
 * Duplicated rather than imported because `artifacts/api-server` is a separate
 * app with no shared-code channel to `artifacts/admin-panel` other than a
 * `lib/*` workspace package, and lifting one constant into a new package is a
 * bigger change than this screen. It is only ever used to GROUP and FILTER the
 * endpoint list — never to compute a rule's pillar impacts, which come from the
 * server's own `suggestion.pillarImpacts` and cannot drift from it.
 */
export const DOMAIN_PILLAR: Record<string, string> = {
  identity: "security",
  security: "security",
  compliance: "compliance",
  governance: "governance",
  devices: "security",
  intune: "security",
  sharepoint: "governance",
  onedrive: "governance",
  teams: "adoption",
  exchange: "security",
  adoption: "adoption",
  copilot: "copilot",
  licensing: "licensing",
  usage: "adoption",
  platform: "architecture",
  architecture: "architecture",
  backup: "architecture",
};

/** `DEFAULT_DOMAIN_PILLARS.dominant` in monitor-check-trace.ts. */
export const DEFAULT_PILLAR = "governance";

export function pillarOf(checkKey: string): string {
  return DOMAIN_PILLAR[domainOf(checkKey)] ?? DEFAULT_PILLAR;
}

/** Every pillar present in a catalog, in a stable order, for the filter. */
export function pillarsIn(checks: MonitorCheck[]): string[] {
  const seen = new Set(checks.map((c) => pillarOf(c.key)));
  const order = ["security", "governance", "compliance", "adoption", "copilot", "licensing", "architecture"];
  return order.filter((p) => seen.has(p)).concat([...seen].filter((p) => !order.includes(p)).sort());
}

// ── Rule types ────────────────────────────────────────────────────────────────

/**
 * The seven `signal_derivation_rules.rule_type` values `evaluateRule` switches
 * on, with the plain-English name `handoff.md` section 6 asks for ("The operator
 * dropdown is plain English").
 */
export const RULE_TYPES: ReadonlyArray<{ value: string; label: string; needsValue: boolean; hint: string }> = [
  { value: "profile_key_truthy", label: "is true", needsValue: false, hint: "Fires when the value is set, non-zero and not empty." },
  { value: "profile_key_falsy", label: "is not true", needsValue: false, hint: "Fires when the value is missing, zero, empty or false." },
  { value: "profile_key_eq", label: "is exactly", needsValue: true, hint: "Fires on an exact match against the value you type." },
  { value: "profile_key_gt", label: "is more than", needsValue: true, hint: "Fires when the number is above your threshold." },
  { value: "profile_key_lt", label: "is fewer than", needsValue: true, hint: "Fires when the number is below your threshold." },
  { value: "threshold", label: "item count above", needsValue: true, hint: "Reads how many items came back, not a mapped value." },
  { value: "findings_keyword", label: "a finding mentions", needsValue: true, hint: "Reads the run's finding text, not the response." },
];

export function ruleTypeLabel(ruleType: string): string {
  return RULE_TYPES.find((r) => r.value === ruleType)?.label ?? ruleType;
}

export function ruleTypeNeedsValue(ruleType: string): boolean {
  return RULE_TYPES.find((r) => r.value === ruleType)?.needsValue ?? true;
}

/**
 * `SIGNAL_SEVERITIES` verbatim — `parseIntelligenceFields` rejects anything else
 * with a 400 naming the legal set.
 *
 * Note this is NOT the vocabulary `monitor_checks.severity_rules[].severity`
 * uses. That column is free text and the real corpus holds
 * warning/critical/info/medium/high/low. The two are shown in different places
 * on this screen for that reason (see `EndpointProperties.tsx`), and neither
 * list may be used to validate the other.
 */
export const SEVERITIES = ["informational", "low", "medium", "high", "critical"] as const;
export type Severity = (typeof SEVERITIES)[number];

// ── Verdicts ──────────────────────────────────────────────────────────────────

/**
 * The three states a rule can be in against the result in front of you.
 *
 * `cannot-read` is the one that must never be hidden: `handoff.md` section 6
 * calls it "the failure mode the user was blind to" — the rule's source key is
 * not among the keys this response produced, so the rule can never fire no
 * matter what the tenant does.
 */
export type Verdict = "fires" | "quiet" | "cannot-read";

export function verdictLabel(v: Verdict): string {
  return v === "fires" ? "fires" : v === "quiet" ? "quiet" : "cannot read";
}

/**
 * Every rule attached to this check, resolved against a trace.
 *
 * A rule reaches this screen from two independent places and they answer
 * different questions, so both are needed:
 *   • `/signal-rules/for-check` — every rule pointing at this check, whether or
 *     not it has ever been run. This is the only source that can show a rule
 *     whose source key the response does not produce.
 *   • the trace — the real evaluated outcome, but only for keys the response
 *     DID produce.
 * Taking the trace alone would silently drop exactly the broken rules the
 * screen exists to surface.
 */
export function resolveRuleVerdicts(
  rules: SignalRule[],
  trace: CheckTrace | null,
): Array<{ rule: SignalRule; verdict: Verdict; reason: string | null; producedValue: unknown }> {
  if (!trace) {
    return rules.map((rule) => ({ rule, verdict: "cannot-read" as Verdict, reason: null, producedValue: undefined }));
  }
  const byRuleId = new Map<number, { traced: TracedRule; value: unknown }>();
  for (const key of trace.keys) {
    for (const traced of key.rules) byRuleId.set(traced.ruleId, { traced, value: key.value });
  }
  return rules.map((rule) => {
    const hit = byRuleId.get(rule.id);
    if (!hit) return { rule, verdict: "cannot-read" as Verdict, reason: null, producedValue: undefined };
    return {
      rule,
      verdict: (hit.traced.result ? "fires" : "quiet") as Verdict,
      reason: hit.traced.reason,
      producedValue: hit.value,
    };
  });
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** The JS type badge shown beside a produced key. */
export function typeOf(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

/** A produced value rendered for a single line. Long arrays/objects are elided, never truncated mid-token. */
export function displayValue(value: unknown): string {
  if (value === undefined) return "—";
  if (value === null) return "null";
  if (Array.isArray(value)) return value.length === 0 ? "empty" : `${value.length} items`;
  if (typeof value === "object") return `${Object.keys(value as object).length} fields`;
  return String(value);
}

/**
 * The one sentence for a check no package runs, used in three places.
 *
 * Kept as a constant because it is the design's own copy and it has to read
 * identically wherever it appears: `handoff.md` section 8 — "Copy is plain and
 * consequence-first... Say what will happen, not what the control is called."
 */
export function unpackagedLabel(): string {
  return "In no package yet — it runs against nobody.";
}

export function relativeTime(iso: string | undefined | null): string {
  if (!iso) return "never";
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return String(iso);
  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(then).toLocaleDateString();
}
