/**
 * simulator-run-diff.ts
 *
 * "What changed between these two runs of the same check?" — the Phase 3
 * comparison view.
 *
 * REUSE, NOT REIMPLEMENTATION (the same discipline Phase 2 was built under):
 * this module owns NO extraction, mapping or rule logic. It runs Phase 2's real
 * `traceCheckResponse()` once per side — which itself calls monitor-executor's
 * `applyMapping`, tenant-signals' `mergeMonitorProfileRows` and `evaluateRule` —
 * and then does nothing but compare the two resulting traces. A second,
 * diff-specific evaluator would be free to disagree with the engine, and a diff
 * that disagrees with production is worse than no diff.
 *
 * BOTH SIDES ARE TRACED WITH THE SAME RULE SET, deliberately. Rules are read
 * live at diff time and handed to both traces, so a rule that "stopped firing"
 * is a statement about the two RESPONSES, not an artifact of comparing an old
 * saved trace against a newer rule set. The one thing that is legitimately
 * per-run is the mapping/properties snapshot each run captured at execution
 * time; when those two snapshots disagree the diff says so explicitly
 * (`mappingChanged`), because a key whose value moved because the mapping was
 * edited is a different finding from one whose value moved because the tenant
 * changed.
 */

import { traceCheckResponse, type CheckTrace, type TracedRule } from "./monitor-check-trace.ts";
import type { MappingRule } from "./monitor-executor.ts";
import type { SignalDerivationRule } from "./tenant-signals.ts";

// ── Types ─────────────────────────────────────────────────────────────────────

/** One side of the comparison — everything the trace needs, straight off a persisted run. */
export interface DiffSide {
  runId: string;
  checkKey: string;
  /** The FULL captured item list for that run. */
  items: unknown[];
  /** That run's own snapshotted mapping/properties, not the catalog's current ones. */
  mapping: MappingRule[];
  properties: string[];
  startedAt: string;
  /**
   * Monotonic insertion order. Only used to break a startedAt tie, so two runs
   * that landed in the same millisecond still order deterministically rather
   * than swapping "before" and "after" between requests.
   */
  sequence?: number;
  status: string;
  resultStatus?: string | null;
}

export type KeyChangeKind = "added" | "removed" | "changed";

export interface DiffKeyChange {
  key: string;
  /** The value the earlier run produced for this key (undefined when "added"). */
  before: unknown;
  /** The value the later run produced (undefined when "removed"). */
  after: unknown;
  change: KeyChangeKind;
  /** How the key was produced — mapping / property / itemCount. */
  origin: string;
  /** The mapping transform behind it, when the key came from a mapping rule. */
  transformBefore?: string;
  transformAfter?: string;
  /** True when this key's producing mapping rule differs between the two runs' snapshots. */
  producedDifferently: boolean;
}

export type RuleChangeKind = "started_firing" | "stopped_firing" | "appeared" | "disappeared";

export interface DiffRuleChange {
  ruleId: number;
  signalKey: string;
  sourceKey: string;
  ruleType: string;
  description: string | null;
  /** null when the rule wasn't evaluated on that side (its source key wasn't produced). */
  before: boolean | null;
  after: boolean | null;
  change: RuleChangeKind;
  /** evaluateRule's own reason string from each side — never re-authored here. */
  reasonBefore: string | null;
  reasonAfter: string | null;
}

export interface RunDiff {
  checkKey: string;
  before: { runId: string; startedAt: string; status: string; resultStatus: string | null; itemCount: number };
  after: { runId: string; startedAt: string; status: string; resultStatus: string | null; itemCount: number };
  keyChanges: DiffKeyChange[];
  unchangedKeyCount: number;
  ruleChanges: DiffRuleChange[];
  unchangedRuleCount: number;
  /**
   * True when the two runs' snapshotted mappings differ at all. When set, a key
   * change may be attributable to a catalog edit rather than to the tenant, and
   * the UI says so rather than letting the operator assume otherwise.
   */
  mappingChanged: boolean;
  propertiesChanged: boolean;
  /** Both raw traces, so the UI can show either side in full without a second round trip. */
  traces: { before: CheckTrace; after: CheckTrace };
}

// ── Value comparison ──────────────────────────────────────────────────────────

/**
 * Deep equality over produced values. Mapping transforms emit numbers, booleans,
 * strings and — for groupByCount / countDuplicates — plain objects, so a `===`
 * comparison would report every grouped key as "changed" on every run. Object
 * keys are sorted before encoding so key ORDER never registers as a change.
 */
export function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a === b;
  if (typeof a !== "object" && typeof b !== "object") return false;
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Mapping snapshots compared as sets, so reordering the catalog isn't a "change". */
function mappingsEqual(a: MappingRule[], b: MappingRule[]): boolean {
  const norm = (m: MappingRule[]) =>
    m
      .map((r) => stableStringify({ sourceField: r.sourceField, targetField: r.targetField, transform: r.transform ?? "none" }))
      .sort();
  return stableStringify(norm(a)) === stableStringify(norm(b));
}

// ── The diff ──────────────────────────────────────────────────────────────────

/**
 * Traces both runs with the real Phase 2 trace and reports what moved.
 *
 * `sideA`/`sideB` are ordered by their real `startedAt` internally, so callers
 * may pass them in either order and "before"/"after" always mean chronologically
 * before and after.
 */
export function diffCheckRuns(opts: { sideA: DiffSide; sideB: DiffSide; rules: SignalDerivationRule[] }): RunDiff {
  const { rules } = opts;
  const aFirst =
    Date.parse(opts.sideA.startedAt) === Date.parse(opts.sideB.startedAt)
      ? (opts.sideA.sequence ?? 0) <= (opts.sideB.sequence ?? 0)
      : Date.parse(opts.sideA.startedAt) < Date.parse(opts.sideB.startedAt);
  const [before, after] = aFirst ? [opts.sideA, opts.sideB] : [opts.sideB, opts.sideA];

  // THE REUSE POINT — Phase 2's real trace, once per side, with one shared rule set.
  const traceBefore = traceCheckResponse({
    checkKey: before.checkKey,
    items: before.items,
    mapping: before.mapping,
    properties: before.properties,
    rules,
  });
  const traceAfter = traceCheckResponse({
    checkKey: after.checkKey,
    items: after.items,
    mapping: after.mapping,
    properties: after.properties,
    rules,
  });

  const beforeKeys = new Map(traceBefore.keys.map((k) => [k.key, k]));
  const afterKeys = new Map(traceAfter.keys.map((k) => [k.key, k]));

  const keyChanges: DiffKeyChange[] = [];
  let unchangedKeyCount = 0;

  for (const key of new Set([...beforeKeys.keys(), ...afterKeys.keys()])) {
    const b = beforeKeys.get(key);
    const a = afterKeys.get(key);

    if (b && a && valuesEqual(b.value, a.value)) {
      unchangedKeyCount += 1;
      continue;
    }

    const change: KeyChangeKind = !b ? "added" : !a ? "removed" : "changed";
    const entry: DiffKeyChange = {
      key,
      before: b?.value,
      after: a?.value,
      change,
      origin: (a ?? b)!.origin,
      producedDifferently: Boolean(b && a && (b.sourceField !== a.sourceField || b.transform !== a.transform)),
    };
    if (b?.transform != null) entry.transformBefore = b.transform;
    if (a?.transform != null) entry.transformAfter = a.transform;
    keyChanges.push(entry);
  }

  // Stable, readable ordering: changed values first (the thing being looked for),
  // then structural add/remove, alphabetical within each group.
  const changeRank: Record<KeyChangeKind, number> = { changed: 0, added: 1, removed: 2 };
  keyChanges.sort((x, y) => changeRank[x.change] - changeRank[y.change] || (x.key < y.key ? -1 : x.key > y.key ? 1 : 0));

  // ── Rules ──
  // A rule only appears in a trace when the key it reads was produced, so a rule
  // present on one side and absent on the other is a real, reportable difference
  // ("appeared"/"disappeared") — distinct from one that flipped true/false.
  const rulesOf = (trace: CheckTrace): Map<number, TracedRule> => {
    const m = new Map<number, TracedRule>();
    for (const k of trace.keys) for (const r of k.rules) m.set(r.ruleId, r);
    return m;
  };
  const beforeRules = rulesOf(traceBefore);
  const afterRules = rulesOf(traceAfter);

  const ruleChanges: DiffRuleChange[] = [];
  let unchangedRuleCount = 0;

  for (const ruleId of new Set([...beforeRules.keys(), ...afterRules.keys()])) {
    const b = beforeRules.get(ruleId);
    const a = afterRules.get(ruleId);

    if (b && a && b.result === a.result) {
      unchangedRuleCount += 1;
      continue;
    }

    const change: RuleChangeKind = !b ? "appeared" : !a ? "disappeared" : a.result ? "started_firing" : "stopped_firing";
    const ref = (a ?? b)!;
    ruleChanges.push({
      ruleId,
      signalKey: ref.signalKey,
      sourceKey: ref.sourceKey,
      ruleType: ref.ruleType,
      description: ref.description,
      before: b ? b.result : null,
      after: a ? a.result : null,
      change,
      reasonBefore: b ? b.reason : null,
      reasonAfter: a ? a.reason : null,
    });
  }

  const ruleRank: Record<RuleChangeKind, number> = {
    started_firing: 0,
    stopped_firing: 1,
    appeared: 2,
    disappeared: 3,
  };
  ruleChanges.sort((x, y) => ruleRank[x.change] - ruleRank[y.change] || x.ruleId - y.ruleId);

  return {
    checkKey: after.checkKey,
    before: {
      runId: before.runId,
      startedAt: before.startedAt,
      status: before.status,
      resultStatus: before.resultStatus ?? null,
      itemCount: traceBefore.itemCount,
    },
    after: {
      runId: after.runId,
      startedAt: after.startedAt,
      status: after.status,
      resultStatus: after.resultStatus ?? null,
      itemCount: traceAfter.itemCount,
    },
    keyChanges,
    unchangedKeyCount,
    ruleChanges,
    unchangedRuleCount,
    mappingChanged: !mappingsEqual(before.mapping, after.mapping),
    propertiesChanged: stableStringify([...before.properties].sort()) !== stableStringify([...after.properties].sort()),
    traces: { before: traceBefore, after: traceAfter },
  };
}
