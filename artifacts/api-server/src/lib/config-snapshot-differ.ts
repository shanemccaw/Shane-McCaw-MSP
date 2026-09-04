/**
 * config-snapshot-differ.ts — ONE diff engine over two configuration snapshots (Git #1797).
 *
 * #1795 landed the store, #1796 landed the collector that fills it. This file is the
 * consumer: given any two sealed snapshots, it computes the property-level difference
 * between them and persists it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * Four capabilities, one engine. The mode is a label on the PAIR, not a branch.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   drift                tenant now            vs  that tenant's baseline snapshot
 *   baseline_assessment  tenant now            vs  a known-good snapshot
 *   tenant_compare       tenant A              vs  tenant B
 *   promotion            source environment    vs  target environment
 *
 * There is deliberately no `if (mode === ...)` anywhere in the comparison below. All
 * four are the same computation over a different pair, which is the entire argument of
 * #1797: writing 13 more bespoke drift collection specs would be doing one job thirteen
 * times, while a snapshot differ serves every domain the collector can reach from one
 * implementation. The mode is recorded because it tells a consumer what the pair MEANS,
 * and because it makes the pairing validatable — `config_diffs` has a CHECK rejecting a
 * `drift` across two tenants and a `tenant_compare` of a tenant with itself.
 *
 * NO APPLY PATH, and none may be added here. `promotion` in this file means COMPUTING
 * the difference between two environments. Applying configuration is the Config Pack
 * write path with its consent gates, break-glass gate and approval steps; joining the
 * two is a separate product decision that #1797 puts explicitly out of scope.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * The four rules that decide every line below
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * 1. ABSENCE, UNREADABILITY AND DELETION ARE THREE DIFFERENT THINGS.
 *
 *    The single most important correctness rule in #1797. `resolveComparability` is
 *    where it lives, and every object-level verdict flows through it:
 *
 *      - Both sides `collected`/`empty`  → comparable. An object on one side only is a
 *                                          REAL add or remove.
 *      - A side is `partial`             → partially_comparable. Paired objects still
 *                                          diff property-by-property, because that rests
 *                                          on data actually read. An unpaired object is
 *                                          `object_indeterminate` — the absence is
 *                                          UNKNOWN, not a deletion.
 *      - A side is `skipped`/`failed`/
 *        never targeted                  → not_comparable. NO change rows at all. The
 *                                          status row, carrying both sides' real reason,
 *                                          is the whole honest answer.
 *
 *    On the live pair this is not a hypothetical: 778 resources FAILED and 425 were
 *    SKIPPED in snapshot 8. A differ that treated "not in this snapshot" as "deleted"
 *    would have reported roughly twelve hundred fabricated deletions on its first run.
 *
 *    Defence in depth: `config_diff_resource_status` carries a CHECK that a
 *    non-`comparable` resource can never store a non-zero `objects_added`/
 *    `objects_removed`, so even a future regression in this file cannot write the lie.
 *
 * 2. PROPERTY-LEVEL, NOT OBJECT-LEVEL. "This policy changed" is not useful; "`state`
 *    went from X to Y" is the product. Every property-level row names one path and
 *    carries both values.
 *
 *    This is the concrete improvement over `detectDrift` (`pcc/drift-detector.ts`), the
 *    primitive the current drift collector uses. That function compares arrays
 *    POSITIONALLY and, on any length change, emits ONE `replace` of the whole array with
 *    no property detail at all — so adding a single user to a Conditional Access policy's
 *    `includeUsers` reads as "the entire list was replaced", and a pure reorder, which
 *    Graph nowhere promises not to do, reads as a total rewrite.
 *
 * 3. STABLE AND ORDERED. `sortChanges` imposes a total order over
 *    (resource_key, object_identity, property_path, change_kind, canonical old, canonical
 *    new). The same pair under the same ruleset yields identical rows in identical
 *    sequence, so "the same pair always produces the same result" is checkable rather
 *    than asserted — `verify-1797-differ.ts` runs the same pair twice and compares.
 *
 *    Scalar arrays are compared as MULTISETS for the same reason: member order is not a
 *    guarantee any of these collections makes, so treating it as significant manufactures
 *    churn. A genuine reorder is not discarded — it is reported once as `array_reordered`,
 *    a kind of its own, so an ordered collection (transport rule priority) still surfaces
 *    while unordered ones can be suppressed by a rule.
 *
 * 4. NOISE CONTROL IS DATA. The rules live in `config_diff_property_rules` and this file
 *    contains no property names of its own. An ignored change is STORED with
 *    `is_ignored = true` and the rule that ignored it — nothing is dropped, so a rule
 *    that proves wrong can be withdrawn and the finding is still there.
 *
 *    `deriveVolatilityRules` closes the loop: it MEASURES volatility from a real diff of
 *    two snapshots taken with no intervening change and writes `observed_volatile` rules
 *    carrying that measurement. That is what "driven by data rather than a hardcoded
 *    list" means here — the list is produced by observation, not typed in.
 *
 * READ-ONLY with respect to the tenant. This file touches the database only; it makes no
 * Graph or PowerShell call and cannot, by construction, reach a customer tenant at all.
 */

import { createHash } from "node:crypto";
import { db } from "@workspace/db";
import {
  tenantConfigSnapshotsTable,
  tenantConfigSnapshotObjectsTable,
  tenantConfigSnapshotResourceStatusTable,
  configDiffsTable,
  configDiffResourceStatusTable,
  configDiffChangesTable,
  configDiffPropertyRulesTable,
  type ConfigDiffMode,
  type ConfigDiffComparability,
  type ConfigDiffChangeKind,
  type ConfigDiffTrigger,
  type ConfigDiffPropertyRule,
  type InsertConfigDiffChange,
  type SnapshotResourceStatus,
  type SnapshotSkipReason,
  type SnapshotIdentityStrategy,
} from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { canonicalizeJson } from "./config-snapshot-collector.ts";
import { logger } from "./logger.ts";

const log = logger.child({ channel: "engine.dashboard" });

/**
 * Bumped when a change to this file would alter the ROWS a given pair produces. Stored
 * on every diff so a result computed under older logic is identifiable rather than
 * silently mixed in with newer ones.
 */
export const CONFIG_DIFFER_VERSION = "1797.1";

/**
 * A single diff can legitimately produce a very large number of rows — the live pair has
 * 50,124 objects on one side alone. This cap bounds one run's memory and write volume;
 * hitting it marks the diff `is_complete = false` with the reason recorded, rather than
 * silently truncating, because a truncated diff presented as whole is the same class of
 * lie this file exists to prevent.
 */
export const DEFAULT_MAX_CHANGES = 200_000;

/** Rows per insert batch. Keeps one statement well inside Postgres' parameter limit. */
const INSERT_BATCH = 500;

// ── Paths ────────────────────────────────────────────────────────────────────

/**
 * The rule-matching form of a property path: every array subscript collapsed to `[]`.
 *
 * `conditions.users.includeUsers[2]` → `conditions.users.includeUsers[]`
 * `Rules[id=abc].Action`             → `Rules[].Action`
 *
 * Rules match on this, never on the display path, so a rule survives reindexing and
 * reordering. Conflating the two would make every rule index-dependent — which for a
 * collection whose order Graph does not guarantee means a rule that works today and
 * silently stops matching tomorrow.
 */
export function normalizePropertyPath(path: string): string {
  return path.replace(/\[[^\]]*\]/g, "[]");
}

/** Append a property segment to a path, keeping the display form readable. */
function childPath(parent: string, key: string): string {
  return parent ? `${parent}.${key}` : key;
}

// ── Rule matching ────────────────────────────────────────────────────────────

/**
 * Does one rule's pattern match a normalized path? Three forms, and no others — a richer
 * pattern language would be a guess about paths nobody has seen yet:
 *
 *   exact    `conditions.users.includeUsers`
 *   prefix   `conditions.users.*`   → that path and everything beneath it
 *   suffix   `*@odata.etag`         → any path ending that way
 */
export function ruleMatchesPath(pattern: string, normalizedPath: string): boolean {
  if (pattern === "*") return true;
  if (pattern.startsWith("*")) {
    return normalizedPath.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith(".*")) {
    const base = pattern.slice(0, -2);
    return normalizedPath === base || normalizedPath.startsWith(`${base}.`);
  }
  if (pattern.endsWith("*")) {
    return normalizedPath.startsWith(pattern.slice(0, -1));
  }
  return normalizedPath === pattern;
}

/**
 * Precedence, computed rather than hand-assigned so the ordering is visible in the data:
 * an exact pattern outranks a wildcard, a longer wildcard outranks a shorter one, and a
 * rule naming a real `resource_key` outranks the same pattern at `*`.
 */
export function computeRuleSpecificity(resourceKey: string, pattern: string): number {
  const isWildcard = pattern.includes("*");
  const base = isWildcard ? 200 + pattern.length : 300 + pattern.length;
  return base + (resourceKey === "*" ? 0 : 1000);
}

export interface RuleDecision {
  ignored: boolean;
  rule: ConfigDiffPropertyRule | null;
}

/**
 * The winning rule for a (resource, path), or none.
 *
 * Highest specificity wins. At EQUAL specificity `always_report` beats `ignore`, because
 * a deliberate rescue should never lose a coin toss to a suppression — that asymmetry is
 * what lets one meaningful property stay visible under a wildcard that suppresses its
 * neighbours, instead of forcing the broad rule to be abandoned.
 */
export function decideRule(
  rules: readonly ConfigDiffPropertyRule[],
  resourceKey: string,
  normalizedPath: string,
): RuleDecision {
  let winner: ConfigDiffPropertyRule | null = null;
  for (const r of rules) {
    if (r.resourceKey !== "*" && r.resourceKey !== resourceKey) continue;
    if (!ruleMatchesPath(r.propertyPathPattern, normalizedPath)) continue;
    if (winner === null) { winner = r; continue; }
    if (r.specificity > winner.specificity) { winner = r; continue; }
    if (r.specificity === winner.specificity
        && r.action === "always_report" && winner.action === "ignore") {
      winner = r;
    }
  }
  if (!winner || winner.action === "always_report") return { ignored: false, rule: null };
  return { ignored: true, rule: winner };
}

/**
 * A fingerprint over the ACTIVE ruleset. Part of a diff's identity because the result is
 * a function of (base, head, ruleset): the two snapshots are immutable but the rules are
 * not, so caching on the pair alone would serve a stale answer after a rule changed.
 * Sorted before hashing so the value depends on the rules themselves, never on row order.
 */
export function fingerprintRuleset(rules: readonly ConfigDiffPropertyRule[]): string {
  const parts = rules
    .map((r) => `${r.resourceKey}\x00${r.propertyPathPattern}\x00${r.action}\x00${r.specificity}`)
    .sort();
  return createHash("sha256").update(parts.join("\n"), "utf8").digest("hex");
}

/**
 * A fingerprint over the `resourceKeys` scope of a diff request (Git #2032). Part of a
 * diff's identity for the same reason `rulesetFingerprint` is: a diff narrowed to a
 * handful of resource keys is a DIFFERENT computed answer than the same pair's
 * full-tenant diff, even though both share the same (base, head, mode, ruleset).
 *
 * Before `config_diffs.resource_keys_fingerprint` existed, `resourceKeys` was not part
 * of the cache key at all — a scoped recompute and a full-tenant diff of the same pair
 * collided on the identical stored row, and whichever ran second silently overwrote the
 * other regardless of which was actually the caller's intent.
 *
 * `'*'` for "every resource either side targeted" (`resourceKeys` omitted) — the common
 * case, and the sentinel `config_diffs.resource_keys_fingerprint` defaults to, so every
 * pre-existing row reads as what it always was: a full-tenant diff. Any other value is a
 * SHA-256 over the sorted, deduplicated scope, so two requests naming the same resource
 * keys in a different order or with duplicates still hash identically.
 */
export function fingerprintResourceKeys(resourceKeys: string[] | undefined): string {
  if (!resourceKeys) return "*";
  const sorted = [...new Set(resourceKeys)].sort();
  return createHash("sha256").update(sorted.join("\n"), "utf8").digest("hex");
}

// ── Comparability — rule 1 ───────────────────────────────────────────────────

/** One side's collection outcome for a resource. `null` = the side never targeted it. */
export interface SideStatus {
  status: SnapshotResourceStatus;
  skipReason: SnapshotSkipReason | null;
  reasonDetail: string | null;
  objectCount: number;
}

export interface ComparabilityVerdict {
  comparability: ConfigDiffComparability;
  /** The honest sentence. Required for anything but `comparable`. */
  reason: string | null;
}

/**
 * THE CORE JUDGEMENT OF #1797. Given what each side said about a resource, decide whether
 * their object sets can be compared — and, crucially, whether an object present on one
 * side only means anything at all.
 *
 * `collected` and `empty` are both SUCCESSFUL reads: `empty` means the tenant genuinely
 * has zero objects of the type, which the store keeps structurally distinct from every
 * failure state precisely so this function can trust it. Everything else is a statement
 * about the READ, not about the tenant, and cannot support a deletion claim.
 */
export function resolveComparability(
  resourceKey: string,
  base: SideStatus | null,
  head: SideStatus | null,
): ComparabilityVerdict {
  const describe = (side: "base" | "head", s: SideStatus | null): string => {
    if (!s) return `${side} snapshot never targeted ${resourceKey}`;
    const reason = s.skipReason ? ` (${s.skipReason})` : "";
    const detail = s.reasonDetail ? `: ${s.reasonDetail}` : "";
    return `${side} snapshot status "${s.status}"${reason}${detail}`;
  };

  // Never targeted on a side — a distinct and visible fact from having been targeted and
  // failed, and equally unable to support an add/remove verdict.
  if (!base || !head) {
    return {
      comparability: "not_comparable",
      reason: `${describe("base", base)}; ${describe("head", head)}. `
        + "A resource absent from one snapshot's target set was never asked about, so its "
        + "objects cannot be compared and their absence is not a deletion.",
    };
  }

  const readable = (s: SideStatus) => s.status === "collected" || s.status === "empty";

  if (readable(base) && readable(head)) {
    return { comparability: "comparable", reason: null };
  }

  // `partial` is the interesting middle: the read SUCCEEDED but the set is known
  // incomplete. What was returned is real, so paired objects compare honestly; what is
  // missing is unknown, so it can never be a deletion.
  const partialSide = base.status === "partial" || head.status === "partial";
  const failedSide = !readable(base) && base.status !== "partial"
    ? base
    : (!readable(head) && head.status !== "partial" ? head : null);

  if (partialSide && !failedSide) {
    return {
      comparability: "partially_comparable",
      reason: `${describe("base", base)}; ${describe("head", head)}. `
        + "The read succeeded but the object SET is known incomplete, so objects present "
        + "on both sides are compared normally while objects present on only one side are "
        + "indeterminate — their absence is unknown, not a deletion.",
    };
  }

  return {
    comparability: "not_comparable",
    reason: `${describe("base", base)}; ${describe("head", head)}. `
      + "At least one side did not successfully read this resource, so no object-level or "
      + "property-level difference can be asserted. This is explicitly NOT a report that "
      + "anything was added or removed.",
  };
}

// ── The value comparison — rule 2 and rule 3 ─────────────────────────────────

/** One property-level difference found inside a paired object. */
export interface PropertyChange {
  kind: ConfigDiffChangeKind;
  path: string;
  oldValue?: unknown;
  newValue?: unknown;
  oldPresent: boolean;
  newPresent: boolean;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isScalar = (v: unknown): boolean =>
  v === null || ["string", "number", "boolean"].includes(typeof v);

/** Every member is a scalar — the case where order is not meaningful and a multiset is right. */
const isScalarArray = (v: unknown): v is unknown[] =>
  Array.isArray(v) && v.every(isScalar);

/**
 * How strongly a property NAME reads as an identifier. `NOT_A_KEY_NAME` means the name
 * carries no identifier signal at all, which disqualifies the property outright — see
 * `arrayMemberKey` for why one signal is not enough.
 */
const NOT_A_KEY_NAME = 99;
function keyNameRank(name: string): number {
  const lower = name.toLowerCase();
  if (lower === "id") return 0;
  if (lower === "identity") return 1;
  if (lower.endsWith("id")) return 2;      // keyId, objectId, appId, …
  if (lower === "key" || lower === "name") return 3;
  if (lower.endsWith("key") || lower.endsWith("name")) return 4;
  return NOT_A_KEY_NAME;
}

/**
 * The property an array-of-objects is paired on, or null if it cannot be keyed.
 *
 * TWO INDEPENDENT SIGNALS MUST AGREE, and neither alone is sufficient:
 *
 *   the DATA   the property is present on every member of BOTH sides, scalar and non-null
 *              throughout, and unique within each side. Requiring both sides is the
 *              point — a property unique in one and repeated in the other pairs members
 *              ambiguously, and a partially-keyed array cannot be keyed without guessing.
 *
 *   the NAME   the property reads as an identifier (`keyNameRank` below `NOT_A_KEY_NAME`).
 *
 * Requiring the data alone is too weak, and the failure is not hypothetical — it is what
 * a test here drove out. In `[{a: 1}]` vs `[{a: 2}]`, `a` is trivially "unique" because
 * each side has one member, so a data-only rule keys on it and reports the member
 * REMOVED and a different one ADDED. The truth is that a single member's `a` changed
 * from 1 to 2. Vacuous uniqueness is not evidence of identity.
 *
 * Requiring the name alone is what the live run disproved. A fixed candidate list
 * ("id", "Identity", "key", "name") missed `passwordCredentials[].keyId` on
 * `/applications`, so two credentials that had merely SWAPPED POSITIONS between snapshot
 * 8 and snapshot 10 were reported as eight property changes across both — displayName,
 * hint, keyId, startDateTime and endDateTime each "changing" into the other credential's
 * value. Every one of those was false. Ranking names by SHAPE rather than listing them
 * finds `keyId` without anyone having anticipated it, and does the same for the next
 * shape nobody anticipates.
 *
 * Ties break by rank then alphabetically, so the choice is deterministic — rule 3 would
 * be violated by a key that varied between runs.
 */
function arrayMemberKey(a: unknown[], b: unknown[]): string | null {
  if (a.length === 0 || b.length === 0) return null;
  if (!a.every(isPlainObject) || !b.every(isPlainObject)) return null;

  const usableIn = (arr: Record<string, unknown>[], prop: string): boolean => {
    const values = new Set<string>();
    for (const m of arr) {
      const v = m[prop];
      if (v === null || v === undefined || !isScalar(v)) return false;
      values.add(String(v));
    }
    return values.size === arr.length;
  };

  const objectsA = a as Record<string, unknown>[];
  const objectsB = b as Record<string, unknown>[];
  const candidates = Object.keys(objectsA[0])
    .filter((prop) => keyNameRank(prop) !== NOT_A_KEY_NAME)
    .filter((prop) => usableIn(objectsA, prop) && usableIn(objectsB, prop));

  if (candidates.length === 0) return null;
  candidates.sort((x, y) => (keyNameRank(x) - keyNameRank(y)) || (x < y ? -1 : x > y ? 1 : 0));
  return candidates[0];
}

/**
 * Compare two values at `path`, appending every property-level difference found.
 *
 * Array handling is where this differs most from `detectDrift`, and deliberately:
 *
 *   scalar arrays   compared as MULTISETS. A member gained or lost is reported as its own
 *                   `array_member_added`/`array_member_removed` naming the member, rather
 *                   than as a whole-array replace. Multiset-equal but differently ordered
 *                   is reported ONCE as `array_reordered` — kept, because for an ordered
 *                   collection order is real, but separable, because for the many
 *                   unordered ones it is noise a rule can suppress.
 *   object arrays   paired by a shared unique key where one exists (`Rules[id=abc]`),
 *                   falling back to position (`Rules[0]`) only when no key does. Recursing
 *                   into a keyed pair is what keeps the output property-level for nested
 *                   structures instead of collapsing to "the array changed".
 */
export function compareValues(
  path: string,
  oldValue: unknown,
  newValue: unknown,
  out: PropertyChange[],
): void {
  if (canonicalizeJson(oldValue) === canonicalizeJson(newValue)) return;

  // Scalar arrays: multiset semantics.
  if (isScalarArray(oldValue) && isScalarArray(newValue)) {
    const count = (arr: unknown[]) => {
      const m = new Map<string, { value: unknown; n: number }>();
      for (const v of arr) {
        const k = canonicalizeJson(v);
        const e = m.get(k);
        if (e) e.n += 1; else m.set(k, { value: v, n: 1 });
      }
      return m;
    };
    const a = count(oldValue);
    const b = count(newValue);
    let membershipChanged = false;

    for (const [k, { value, n }] of [...a.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const there = b.get(k)?.n ?? 0;
      for (let i = 0; i < n - there; i++) {
        membershipChanged = true;
        out.push({
          kind: "array_member_removed", path: `${path}[]`,
          oldValue: value, oldPresent: true, newPresent: false,
        });
      }
    }
    for (const [k, { value, n }] of [...b.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const there = a.get(k)?.n ?? 0;
      for (let i = 0; i < n - there; i++) {
        membershipChanged = true;
        out.push({
          kind: "array_member_added", path: `${path}[]`,
          newValue: value, oldPresent: false, newPresent: true,
        });
      }
    }
    // Same members, different order. Reported once, as its own kind — never as N value
    // changes, which is exactly the false churn rule 3 exists to prevent.
    if (!membershipChanged) {
      out.push({
        kind: "array_reordered", path,
        oldValue, newValue, oldPresent: true, newPresent: true,
      });
    }
    return;
  }

  // Arrays of objects (or mixed): pair by key where the array supports it, else by index.
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const keyProp = arrayMemberKey(oldValue, newValue);

    if (keyProp) {
      const index = (arr: unknown[]) =>
        new Map(arr.map((m) => [String((m as Record<string, unknown>)[keyProp]), m]));
      const a = index(oldValue);
      const b = index(newValue);
      for (const k of [...new Set([...a.keys(), ...b.keys()])].sort()) {
        const seg = `${path}[${keyProp}=${k}]`;
        const hasA = a.has(k);
        const hasB = b.has(k);
        if (hasA && hasB) { compareValues(seg, a.get(k), b.get(k), out); continue; }
        if (hasB) {
          out.push({ kind: "property_added", path: seg, newValue: b.get(k), oldPresent: false, newPresent: true });
        } else {
          out.push({ kind: "property_removed", path: seg, oldValue: a.get(k), oldPresent: true, newPresent: false });
        }
      }
      return;
    }

    const len = Math.max(oldValue.length, newValue.length);
    for (let i = 0; i < len; i++) {
      const seg = `${path}[${i}]`;
      const hasA = i < oldValue.length;
      const hasB = i < newValue.length;
      if (hasA && hasB) { compareValues(seg, oldValue[i], newValue[i], out); continue; }
      if (hasB) {
        out.push({ kind: "property_added", path: seg, newValue: newValue[i], oldPresent: false, newPresent: true });
      } else {
        out.push({ kind: "property_removed", path: seg, oldValue: oldValue[i], oldPresent: true, newPresent: false });
      }
    }
    return;
  }

  // Objects: recurse per key, so the output names the leaf that actually moved.
  if (isPlainObject(oldValue) && isPlainObject(newValue)) {
    for (const key of [...new Set([...Object.keys(oldValue), ...Object.keys(newValue)])].sort()) {
      const seg = childPath(path, key);
      const hasA = key in oldValue;
      const hasB = key in newValue;
      if (hasA && hasB) { compareValues(seg, oldValue[key], newValue[key], out); continue; }
      if (hasB) {
        out.push({ kind: "property_added", path: seg, newValue: newValue[key], oldPresent: false, newPresent: true });
      } else {
        out.push({ kind: "property_removed", path: seg, oldValue: oldValue[key], oldPresent: true, newPresent: false });
      }
    }
    return;
  }

  // Everything else — including a type change (array ↔ object ↔ scalar) — is one changed
  // value at this path. Both sides are present; only their contents differ.
  out.push({
    kind: "property_changed", path: path || "(root)",
    oldValue, newValue, oldPresent: true, newPresent: true,
  });
}

/** The two objects of a pair, compared. Path is relative to the object root. */
export function diffObjects(
  baseObject: Record<string, unknown>,
  headObject: Record<string, unknown>,
): PropertyChange[] {
  const out: PropertyChange[] = [];
  compareValues("", baseObject, headObject, out);
  return out;
}

// ── Ordering — rule 3 ────────────────────────────────────────────────────────

/** A change with everything needed to write and to order it. */
interface PendingChange {
  resourceKey: string;
  objectIdentity: string;
  objectDisplayName: string | null;
  identityStrategy: SnapshotIdentityStrategy | null;
  kind: ConfigDiffChangeKind;
  path: string | null;
  normalizedPath: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  oldPresent: boolean;
  newPresent: boolean;
}

/**
 * The total order that makes a diff reproducible. Every tiebreak is over a value the
 * comparison itself produced, so no two distinct rows can compare equal and be left in
 * arbitrary relative order — which is what "stable and ordered" has to mean if it is
 * going to be checkable.
 */
export function sortChanges(changes: PendingChange[]): PendingChange[] {
  const key = (c: PendingChange) => [
    c.resourceKey,
    c.objectIdentity,
    c.path ?? "",
    c.kind,
    c.oldPresent ? canonicalizeJson(c.oldValue) : "",
    c.newPresent ? canonicalizeJson(c.newValue) : "",
  ];
  return [...changes].sort((x, y) => {
    const kx = key(x), ky = key(y);
    for (let i = 0; i < kx.length; i++) {
      if (kx[i] < ky[i]) return -1;
      if (kx[i] > ky[i]) return 1;
    }
    return 0;
  });
}

// ── The run ──────────────────────────────────────────────────────────────────

export interface DiffSnapshotsOptions {
  mode: ConfigDiffMode;
  /** The reference side: baseline, known-good, source environment, tenant A. */
  baseSnapshotRowId: number;
  /** The subject side: now, tenant B, target environment. */
  headSnapshotRowId: number;
  trigger?: ConfigDiffTrigger;
  triggerRef?: string | null;
  wfRunId?: number | null;
  requestedByUserId?: number | null;
  /** Limit to these resource keys. Omitted = every resource either side targeted. */
  resourceKeys?: string[];
  maxChanges?: number;
  /**
   * Return the stored diff when one already exists for (base, head, mode, ruleset).
   * Default true — a diff of two immutable snapshots under an unchanged ruleset cannot
   * have a different answer, so recomputing 50,000 objects would burn time to reproduce
   * a row that is already there.
   *
   * `false` means RECOMPUTE AND REPLACE: any stored diff for that exact key is deleted
   * first and a fresh one written. It has to, because (base, head, mode, fingerprint) is
   * UNIQUE — a second row for the same key is precisely what the cache exists to prevent.
   *
   * Replacing is sound in a way that editing a sealed diff would not be. A diff is not
   * primary evidence: it is DERIVED from two immutable snapshots under a recorded
   * ruleset, so discarding one and recomputing must yield the same answer — that is what
   * determinism means, and `verify-1797-differ.ts --determinism` checks it rather than
   * assuming it. The snapshots themselves, which ARE primary evidence, are never touched.
   */
  useCache?: boolean;
  onProgress?: (e: { resourceKey: string; done: number; total: number }) => void;
}

export interface DiffSnapshotsResult {
  diffRowId: number;
  diffId: string;
  fromCache: boolean;
  mode: ConfigDiffMode;
  status: "sealed" | "failed";
  isComplete: boolean;
  rulesetFingerprint: string;
  rulesetSize: number;
  resourceTypesCompared: number;
  resourceTypesPartial: number;
  resourceTypesNotComparable: number;
  objectsPaired: number;
  objectsAdded: number;
  objectsRemoved: number;
  objectsIndeterminate: number;
  objectsUnpairable: number;
  changesTotal: number;
  changesSignificant: number;
  changesIgnored: number;
  truncated: boolean;
  durationMs: number;
}

/** A diff can only be computed over snapshots that are finished and therefore immutable. */
export class SnapshotNotDiffableError extends Error {
  constructor(message: string) { super(message); this.name = "SnapshotNotDiffableError"; }
}

/**
 * Compute (or fetch) the difference between two snapshots.
 *
 * Refuses a `running` snapshot outright: its object set is incomplete BY DEFINITION and
 * still growing, so every object the collector has not reached yet would read as absent.
 * Diffing one would produce exactly the fabricated-deletion result rule 1 exists to
 * prevent, and unlike a `failed` read there would be no status row to record the doubt.
 */
export async function diffSnapshots(opts: DiffSnapshotsOptions): Promise<DiffSnapshotsResult> {
  const startedAt = Date.now();
  const maxChanges = opts.maxChanges ?? DEFAULT_MAX_CHANGES;

  if (opts.baseSnapshotRowId === opts.headSnapshotRowId) {
    throw new SnapshotNotDiffableError(
      "base and head are the same snapshot: the answer is trivially 'no changes' and "
      + "storing it would put a meaningless all-clear in the cache.",
    );
  }

  const headers = await db.select().from(tenantConfigSnapshotsTable)
    .where(inArray(tenantConfigSnapshotsTable.id, [opts.baseSnapshotRowId, opts.headSnapshotRowId]));
  const base = headers.find((h) => h.id === opts.baseSnapshotRowId);
  const head = headers.find((h) => h.id === opts.headSnapshotRowId);
  if (!base) throw new SnapshotNotDiffableError(`base snapshot ${opts.baseSnapshotRowId} does not exist`);
  if (!head) throw new SnapshotNotDiffableError(`head snapshot ${opts.headSnapshotRowId} does not exist`);
  for (const [side, s] of [["base", base], ["head", head]] as const) {
    if (s.status === "running") {
      throw new SnapshotNotDiffableError(
        `${side} snapshot ${s.id} is still running. Its object set is incomplete by `
        + "definition, so every not-yet-collected object would read as absent and be "
        + "reported as a deletion. Seal it first.",
      );
    }
  }

  // Mode/tenant coherence is also a database CHECK; failing here gives the caller a
  // sentence instead of a constraint violation.
  if (opts.mode === "drift" && base.tenantId !== head.tenantId) {
    throw new SnapshotNotDiffableError(
      `mode "drift" compares a tenant with itself, but base is tenant ${base.tenantId} `
      + `and head is tenant ${head.tenantId}. Use "tenant_compare" or "promotion".`,
    );
  }
  if ((opts.mode === "tenant_compare" || opts.mode === "promotion") && base.tenantId === head.tenantId) {
    throw new SnapshotNotDiffableError(
      `mode "${opts.mode}" compares two different tenants, but both snapshots belong to `
      + `tenant ${base.tenantId}. Use "drift" or "baseline_assessment".`,
    );
  }

  const rules = await db.select().from(configDiffPropertyRulesTable)
    .where(eq(configDiffPropertyRulesTable.isActive, true));
  const rulesetFingerprint = fingerprintRuleset(rules);
  // Git #2032: resourceKeys is part of the cache key, so a scoped recompute gets its own
  // row instead of colliding with (and silently overwriting) the full-tenant diff.
  const resourceKeysFingerprint = fingerprintResourceKeys(opts.resourceKeys);

  const sameKey = and(
    eq(configDiffsTable.baseSnapshotRowId, opts.baseSnapshotRowId),
    eq(configDiffsTable.headSnapshotRowId, opts.headSnapshotRowId),
    eq(configDiffsTable.mode, opts.mode),
    eq(configDiffsTable.rulesetFingerprint, rulesetFingerprint),
    eq(configDiffsTable.resourceKeysFingerprint, resourceKeysFingerprint),
  );

  if (opts.useCache === false) {
    // Recompute-and-replace. The key is UNIQUE, so a fresh insert cannot coexist with the
    // stored row — see `useCache` for why discarding a derived result is sound where
    // editing a sealed one would not be. Deleting the header cascades to its children,
    // and the immutability trigger permits exactly that cascade.
    const removed = await db.delete(configDiffsTable).where(sameKey).returning({ id: configDiffsTable.id });
    if (removed.length > 0) {
      log.info(
        { diffRowIds: removed.map((r) => r.id), mode: opts.mode },
        "config diff: replacing stored diff for this pair (useCache=false)",
      );
    }
  } else {
    const [cached] = await db.select().from(configDiffsTable).where(sameKey).limit(1);
    if (cached && cached.status === "sealed") {
      log.info({ diffRowId: cached.id, mode: opts.mode }, "config diff: served from cache");
      return {
        diffRowId: cached.id, diffId: cached.diffId, fromCache: true, mode: opts.mode,
        status: "sealed", isComplete: cached.isComplete,
        rulesetFingerprint, rulesetSize: cached.rulesetSize,
        resourceTypesCompared: cached.resourceTypesCompared,
        resourceTypesPartial: cached.resourceTypesPartial,
        resourceTypesNotComparable: cached.resourceTypesNotComparable,
        objectsPaired: cached.objectsPaired, objectsAdded: cached.objectsAdded,
        objectsRemoved: cached.objectsRemoved, objectsIndeterminate: cached.objectsIndeterminate,
        objectsUnpairable: cached.objectsUnpairable,
        changesTotal: cached.changesTotal, changesSignificant: cached.changesSignificant,
        changesIgnored: cached.changesIgnored,
        truncated: false, durationMs: cached.durationMs ?? 0,
      };
    }
  }

  const [header] = await db.insert(configDiffsTable).values({
    mode: opts.mode,
    baseSnapshotRowId: opts.baseSnapshotRowId,
    headSnapshotRowId: opts.headSnapshotRowId,
    baseTenantId: base.tenantId,
    headTenantId: head.tenantId,
    rulesetFingerprint,
    resourceKeysFingerprint,
    rulesetSize: rules.length,
    differVersion: CONFIG_DIFFER_VERSION,
    status: "computing",
    trigger: opts.trigger ?? "manual",
    triggerRef: opts.triggerRef ?? null,
    wfRunId: opts.wfRunId ?? null,
    requestedByUserId: opts.requestedByUserId ?? null,
  }).returning();

  log.info({
    diffRowId: header.id, mode: opts.mode,
    baseSnapshotRowId: opts.baseSnapshotRowId, headSnapshotRowId: opts.headSnapshotRowId,
    rulesetSize: rules.length,
  }, "config diff: started");

  try {
    const result = await runDiff({
      header, base, head, rules, rulesetFingerprint, maxChanges,
      resourceKeys: opts.resourceKeys, onProgress: opts.onProgress, startedAt,
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // The failed run is SEALED and KEPT: a failed comparison is evidence, and discarding
    // it would leave a hole indistinguishable from a comparison nobody ever ran.
    await db.update(configDiffsTable).set({
      status: "failed", error: message.slice(0, 4000), isComplete: false,
      sealedAt: new Date(), finishedAt: new Date(), durationMs: Date.now() - startedAt,
    }).where(eq(configDiffsTable.id, header.id));
    log.error({ diffRowId: header.id, message }, "config diff: failed");
    throw err;
  }
}

interface RunDiffArgs {
  header: typeof configDiffsTable.$inferSelect;
  base: typeof tenantConfigSnapshotsTable.$inferSelect;
  head: typeof tenantConfigSnapshotsTable.$inferSelect;
  rules: ConfigDiffPropertyRule[];
  rulesetFingerprint: string;
  maxChanges: number;
  resourceKeys?: string[];
  onProgress?: DiffSnapshotsOptions["onProgress"];
  startedAt: number;
}

async function runDiff(args: RunDiffArgs): Promise<DiffSnapshotsResult> {
  const { header, base, head, rules, maxChanges, startedAt } = args;

  // ── Both sides' completeness records: the input to every comparability verdict ──
  const statusRows = await db.select().from(tenantConfigSnapshotResourceStatusTable)
    .where(inArray(tenantConfigSnapshotResourceStatusTable.snapshotRowId, [base.id, head.id]));

  const sideStatus = (snapshotRowId: number) => {
    const m = new Map<string, SideStatus>();
    for (const r of statusRows) {
      if (r.snapshotRowId !== snapshotRowId) continue;
      m.set(r.resourceKey, {
        status: r.status, skipReason: r.skipReason ?? null,
        reasonDetail: r.reasonDetail ?? null, objectCount: r.objectCount,
      });
    }
    return m;
  };
  const baseStatus = sideStatus(base.id);
  const headStatus = sideStatus(head.id);

  const filter = args.resourceKeys ? new Set(args.resourceKeys) : null;
  const resourceKeys = [...new Set([...baseStatus.keys(), ...headStatus.keys()])]
    .filter((k) => !filter || filter.has(k))
    .sort();

  const pending: PendingChange[] = [];
  const resourceRows: (typeof configDiffResourceStatusTable.$inferInsert)[] = [];
  let truncated = false;
  const totals = {
    compared: 0, partial: 0, notComparable: 0,
    paired: 0, added: 0, removed: 0, indeterminate: 0, unpairable: 0,
  };

  let done = 0;
  for (const resourceKey of resourceKeys) {
    done += 1;
    args.onProgress?.({ resourceKey, done, total: resourceKeys.length });

    const b = baseStatus.get(resourceKey) ?? null;
    const h = headStatus.get(resourceKey) ?? null;
    const verdict = resolveComparability(resourceKey, b, h);

    const row: typeof configDiffResourceStatusTable.$inferInsert = {
      diffRowId: header.id,
      resourceKey,
      comparability: verdict.comparability,
      notComparableReason: verdict.reason,
      baseStatus: b?.status ?? null,
      baseSkipReason: b?.skipReason ?? null,
      baseReasonDetail: b?.reasonDetail ?? null,
      baseObjectCount: b?.objectCount ?? 0,
      headStatus: h?.status ?? null,
      headSkipReason: h?.skipReason ?? null,
      headReasonDetail: h?.reasonDetail ?? null,
      headObjectCount: h?.objectCount ?? 0,
    };

    // NOT COMPARABLE: no change rows at ALL. The status row above, carrying both sides'
    // real status and reason, IS the output. This is rule 1's load-bearing branch — it is
    // what stops 778 failed and 425 skipped resources becoming twelve hundred fabricated
    // deletions on the live pair.
    if (verdict.comparability === "not_comparable") {
      totals.notComparable += 1;
      resourceRows.push(row);
      continue;
    }

    if (verdict.comparability === "partially_comparable") totals.partial += 1;
    else totals.compared += 1;

    const objects = await db.select({
      snapshotRowId: tenantConfigSnapshotObjectsTable.snapshotRowId,
      objectIdentity: tenantConfigSnapshotObjectsTable.objectIdentity,
      identityStrategy: tenantConfigSnapshotObjectsTable.identityStrategy,
      displayName: tenantConfigSnapshotObjectsTable.displayName,
      objectJson: tenantConfigSnapshotObjectsTable.objectJson,
      objectHash: tenantConfigSnapshotObjectsTable.objectHash,
    }).from(tenantConfigSnapshotObjectsTable).where(and(
      inArray(tenantConfigSnapshotObjectsTable.snapshotRowId, [base.id, head.id]),
      eq(tenantConfigSnapshotObjectsTable.resourceKey, resourceKey),
    ));

    const baseObjects = new Map(objects.filter((o) => o.snapshotRowId === base.id)
      .map((o) => [o.objectIdentity, o]));
    const headObjects = new Map(objects.filter((o) => o.snapshotRowId === head.id)
      .map((o) => [o.objectIdentity, o]));

    let rPaired = 0, rAdded = 0, rRemoved = 0, rIndet = 0, rUnpair = 0;
    let rChanges = 0;

    for (const identity of [...new Set([...baseObjects.keys(), ...headObjects.keys()])].sort()) {
      const bo = baseObjects.get(identity);
      const ho = headObjects.get(identity);

      if (bo && ho) {
        rPaired += 1;
        // Equal hashes mean equal objects — the store computes them over the same
        // canonical form this file uses, so one string comparison replaces walking a
        // 40-property body. On the live pair this skips the overwhelming majority.
        if (bo.objectHash === ho.objectHash) continue;

        for (const c of diffObjects(bo.objectJson, ho.objectJson)) {
          if (pending.length >= maxChanges) { truncated = true; break; }
          rChanges += 1;
          pending.push({
            resourceKey, objectIdentity: identity,
            objectDisplayName: ho.displayName ?? bo.displayName ?? null,
            identityStrategy: ho.identityStrategy,
            kind: c.kind, path: c.path, normalizedPath: normalizePropertyPath(c.path),
            oldValue: c.oldValue, newValue: c.newValue,
            oldPresent: c.oldPresent, newPresent: c.newPresent,
          });
        }
        if (truncated) break;
        continue;
      }

      // Present on ONE side only. What that means depends entirely on rule 1.
      const only = (bo ?? ho)!;
      const inHead = Boolean(ho);

      let kind: ConfigDiffChangeKind;
      if (verdict.comparability === "partially_comparable") {
        // The set is known incomplete: the absence is UNKNOWN, never a deletion.
        kind = "object_indeterminate";
        rIndet += 1;
      } else if (only.identityStrategy === "content-hash") {
        // Identity IS the content, so a modification is indistinguishable from a
        // delete-plus-add. The store documents this limitation; reporting a confident
        // add/remove here would be exactly the overstatement rule 1 forbids.
        kind = "object_unpairable";
        rUnpair += 1;
      } else if (inHead) {
        kind = "object_added";
        rAdded += 1;
      } else {
        kind = "object_removed";
        rRemoved += 1;
      }

      if (pending.length >= maxChanges) { truncated = true; break; }
      rChanges += 1;
      pending.push({
        resourceKey, objectIdentity: identity,
        objectDisplayName: only.displayName ?? null,
        identityStrategy: only.identityStrategy,
        kind, path: null, normalizedPath: null,
        // The object's hash and name, not a 40-property body — the body is already in the
        // snapshot and duplicating it here would bloat every diff for no new information.
        oldValue: inHead ? undefined : { objectHash: only.objectHash, displayName: only.displayName },
        newValue: inHead ? { objectHash: only.objectHash, displayName: only.displayName } : undefined,
        oldPresent: !inHead, newPresent: inHead,
      });
    }

    row.objectsPaired = rPaired;
    row.objectsAdded = rAdded;
    row.objectsRemoved = rRemoved;
    row.objectsIndeterminate = rIndet;
    row.objectsUnpairable = rUnpair;
    row.changesTotal = rChanges;
    resourceRows.push(row);

    totals.paired += rPaired; totals.added += rAdded; totals.removed += rRemoved;
    totals.indeterminate += rIndet; totals.unpairable += rUnpair;

    if (truncated) break;
  }

  // ── Order, then classify against the ruleset ──────────────────────────────
  const ordered = sortChanges(pending);
  const significantByResource = new Map<string, number>();
  let changesSignificant = 0;
  let changesIgnored = 0;

  const rows: InsertConfigDiffChange[] = ordered.map((c, i) => {
    // Object-level kinds have no property path, so no path rule can apply to them. An
    // object appearing or disappearing is never noise.
    const decision = c.normalizedPath
      ? decideRule(rules, c.resourceKey, c.normalizedPath)
      : { ignored: false, rule: null };
    if (decision.ignored) changesIgnored += 1;
    else {
      changesSignificant += 1;
      significantByResource.set(c.resourceKey, (significantByResource.get(c.resourceKey) ?? 0) + 1);
    }
    return {
      diffRowId: header.id,
      sequence: i + 1,
      resourceKey: c.resourceKey,
      objectIdentity: c.objectIdentity,
      objectDisplayName: c.objectDisplayName,
      identityStrategy: c.identityStrategy,
      changeKind: c.kind,
      propertyPath: c.path,
      propertyPathNormalized: c.normalizedPath,
      oldValue: c.oldPresent ? (c.oldValue ?? null) : null,
      newValue: c.newPresent ? (c.newValue ?? null) : null,
      oldValuePresent: c.oldPresent,
      newValuePresent: c.newPresent,
      isIgnored: decision.ignored,
      ignoredByRuleId: decision.rule?.id ?? null,
    };
  });

  for (const r of resourceRows) {
    r.changesSignificant = significantByResource.get(r.resourceKey) ?? 0;
  }

  for (let i = 0; i < resourceRows.length; i += INSERT_BATCH) {
    await db.insert(configDiffResourceStatusTable).values(resourceRows.slice(i, i + INSERT_BATCH));
  }
  for (let i = 0; i < rows.length; i += INSERT_BATCH) {
    await db.insert(configDiffChangesTable).values(rows.slice(i, i + INSERT_BATCH));
  }

  // `is_complete` is about the INPUTS: a diff over a pair where resources were partial,
  // uncomparable or truncated is a real answer about what it could compare, but it is not
  // a statement about the whole tenant and must not be readable as one.
  const isComplete = totals.partial === 0 && totals.notComparable === 0 && !truncated;
  const durationMs = Date.now() - startedAt;

  await db.update(configDiffsTable).set({
    status: "sealed",
    sealedAt: new Date(),
    resourceTypesCompared: totals.compared,
    resourceTypesPartial: totals.partial,
    resourceTypesNotComparable: totals.notComparable,
    objectsPaired: totals.paired,
    objectsAdded: totals.added,
    objectsRemoved: totals.removed,
    objectsIndeterminate: totals.indeterminate,
    objectsUnpairable: totals.unpairable,
    changesTotal: rows.length,
    changesSignificant,
    changesIgnored,
    isComplete,
    notes: truncated
      ? `TRUNCATED at ${maxChanges} changes. The result is incomplete and is marked so; `
        + "raise maxChanges or narrow resourceKeys to compute the whole pair."
      : null,
    finishedAt: new Date(),
    durationMs,
  }).where(eq(configDiffsTable.id, header.id));

  log.info({
    diffRowId: header.id, mode: header.mode,
    resourceTypesCompared: totals.compared, resourceTypesPartial: totals.partial,
    resourceTypesNotComparable: totals.notComparable,
    changesTotal: rows.length, changesSignificant, changesIgnored,
    objectsAdded: totals.added, objectsRemoved: totals.removed,
    objectsIndeterminate: totals.indeterminate, isComplete, truncated, durationMs,
  }, "config diff: sealed");

  return {
    diffRowId: header.id, diffId: header.diffId, fromCache: false, mode: header.mode,
    status: "sealed", isComplete,
    rulesetFingerprint: args.rulesetFingerprint, rulesetSize: rules.length,
    resourceTypesCompared: totals.compared,
    resourceTypesPartial: totals.partial,
    resourceTypesNotComparable: totals.notComparable,
    objectsPaired: totals.paired, objectsAdded: totals.added, objectsRemoved: totals.removed,
    objectsIndeterminate: totals.indeterminate, objectsUnpairable: totals.unpairable,
    changesTotal: rows.length, changesSignificant, changesIgnored,
    truncated, durationMs,
  };
}

// ── Rule 4: measuring volatility instead of hardcoding it ────────────────────

export interface DerivedVolatilityRule {
  resourceKey: string;
  propertyPathPattern: string;
  objectCount: number;
  created: boolean;
}

/**
 * Turn a real diff into `observed_volatile` noise rules.
 *
 * The premise, and the reason this is evidence rather than opinion: if two snapshots of
 * the SAME tenant were taken with no intervening configuration change, then every path
 * that differs between them moves on READ, not because anything was configured. Such a
 * path is noise by observation, and the rule written for it carries the measurement — the
 * diff it came from, how many distinct objects it moved in, and when — so it can be
 * audited and withdrawn rather than believed.
 *
 * This is what #1797 means by "driven by data rather than a hardcoded list": the list is
 * PRODUCED here, from a measurement, and never typed into a file.
 *
 * `minObjects` guards against promoting a single genuine edit into a suppression rule: a
 * path that moved in one object is far more likely to be a real change than a volatile
 * field, whereas a path that moved in every object of its type on a no-change interval is
 * volatile by construction.
 */
export async function deriveVolatilityRules(opts: {
  diffRowId: number;
  minObjects?: number;
  /** Compute and return the rules without writing them. */
  dryRun?: boolean;
}): Promise<DerivedVolatilityRule[]> {
  const minObjects = opts.minObjects ?? 2;

  const [diff] = await db.select().from(configDiffsTable)
    .where(eq(configDiffsTable.id, opts.diffRowId)).limit(1);
  if (!diff) throw new Error(`diff ${opts.diffRowId} does not exist`);
  if (diff.baseTenantId !== diff.headTenantId) {
    throw new Error(
      `diff ${opts.diffRowId} compares two different tenants (${diff.baseTenantId} vs `
      + `${diff.headTenantId}). Volatility means "moves on read for one tenant"; a `
      + "cross-tenant difference is a real configuration difference and must never be "
      + "suppressed as noise.",
    );
  }

  // Candidate paths, and the real count behind each.
  const candidates = await db.select({
    resourceKey: configDiffChangesTable.resourceKey,
    path: configDiffChangesTable.propertyPathNormalized,
    objectCount: sql<number>`count(distinct ${configDiffChangesTable.objectIdentity})::int`,
  }).from(configDiffChangesTable)
    .where(and(
      eq(configDiffChangesTable.diffRowId, opts.diffRowId),
      eq(configDiffChangesTable.isIgnored, false),
      sql`${configDiffChangesTable.propertyPathNormalized} IS NOT NULL`,
    ))
    .groupBy(configDiffChangesTable.resourceKey, configDiffChangesTable.propertyPathNormalized)
    .having(sql`count(distinct ${configDiffChangesTable.objectIdentity}) >= ${minObjects}`);

  const out: DerivedVolatilityRule[] = [];
  for (const c of candidates) {
    if (!c.path) continue;
    const rule: DerivedVolatilityRule = {
      resourceKey: c.resourceKey,
      propertyPathPattern: c.path,
      objectCount: c.objectCount,
      created: false,
    };
    if (!opts.dryRun) {
      const inserted = await db.insert(configDiffPropertyRulesTable).values({
        resourceKey: c.resourceKey,
        propertyPathPattern: c.path,
        action: "ignore",
        basis: "observed_volatile",
        specificity: computeRuleSpecificity(c.resourceKey, c.path),
        rationale:
          `Measured: this path differed in ${c.objectCount} distinct objects between two `
          + `snapshots of tenant ${diff.headTenantId} taken with no intervening `
          + `configuration change (diff ${opts.diffRowId}), so it moves on read rather `
          + "than because anything was configured.",
        evidenceDiffId: opts.diffRowId,
        evidenceObjectCount: c.objectCount,
        evidenceObservedAt: new Date(),
      }).onConflictDoNothing().returning();
      rule.created = inserted.length > 0;
    }
    out.push(rule);
  }

  out.sort((a, b) => (b.objectCount - a.objectCount)
    || (a.resourceKey < b.resourceKey ? -1 : a.resourceKey > b.resourceKey ? 1 : 0)
    || (a.propertyPathPattern < b.propertyPathPattern ? -1 : 1));

  log.info({
    diffRowId: opts.diffRowId, candidates: out.length,
    created: out.filter((r) => r.created).length, minObjects, dryRun: Boolean(opts.dryRun),
  }, "config diff: derived volatility rules from measurement");

  return out;
}

// ── The four entry points ────────────────────────────────────────────────────
//
// Thin by design. Each one names a pair and a mode; none of them changes the comparison.
// They exist so a caller states WHICH capability it is invoking — the thing a consumer
// needs in order to interpret the result — rather than passing a bare mode string.

/** Drift: a tenant now, against its own earlier or approved snapshot. */
export function diffDrift(args: {
  baselineSnapshotRowId: number; currentSnapshotRowId: number;
} & Omit<DiffSnapshotsOptions, "mode" | "baseSnapshotRowId" | "headSnapshotRowId">) {
  const { baselineSnapshotRowId, currentSnapshotRowId, ...rest } = args;
  return diffSnapshots({
    ...rest, mode: "drift",
    baseSnapshotRowId: baselineSnapshotRowId, headSnapshotRowId: currentSnapshotRowId,
  });
}

/** Baseline assessment: a tenant now, against a known-good configuration. */
export function diffAgainstBaseline(args: {
  knownGoodSnapshotRowId: number; currentSnapshotRowId: number;
} & Omit<DiffSnapshotsOptions, "mode" | "baseSnapshotRowId" | "headSnapshotRowId">) {
  const { knownGoodSnapshotRowId, currentSnapshotRowId, ...rest } = args;
  return diffSnapshots({
    ...rest, mode: "baseline_assessment",
    baseSnapshotRowId: knownGoodSnapshotRowId, headSnapshotRowId: currentSnapshotRowId,
  });
}

/** Tenant compare: tenant A against tenant B. */
export function diffTenants(args: {
  tenantASnapshotRowId: number; tenantBSnapshotRowId: number;
} & Omit<DiffSnapshotsOptions, "mode" | "baseSnapshotRowId" | "headSnapshotRowId">) {
  const { tenantASnapshotRowId, tenantBSnapshotRowId, ...rest } = args;
  return diffSnapshots({
    ...rest, mode: "tenant_compare",
    baseSnapshotRowId: tenantASnapshotRowId, headSnapshotRowId: tenantBSnapshotRowId,
  });
}

/**
 * Promotion: a source environment against a target environment.
 *
 * COMPUTES THE DIFFERENCE ONLY. There is no apply path here and none may be added —
 * applying configuration is the Config Pack write path with its consent gates,
 * break-glass gate and approval steps, and joining the two is a separate product
 * decision (#1797, explicit non-goal).
 */
export function diffPromotion(args: {
  sourceSnapshotRowId: number; targetSnapshotRowId: number;
} & Omit<DiffSnapshotsOptions, "mode" | "baseSnapshotRowId" | "headSnapshotRowId">) {
  const { sourceSnapshotRowId, targetSnapshotRowId, ...rest } = args;
  return diffSnapshots({
    ...rest, mode: "promotion",
    baseSnapshotRowId: sourceSnapshotRowId, headSnapshotRowId: targetSnapshotRowId,
  });
}
