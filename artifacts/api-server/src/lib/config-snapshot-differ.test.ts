/**
 * config-snapshot-differ.test.ts — Git #1797.
 *
 * These are the assertions that matter, in the order #1797 ranks them:
 *
 *   1. ABSENCE vs UNREADABILITY vs DELETION. The single most important correctness rule
 *      in the issue, so it gets the most tests. A resource that could not be read must
 *      never produce an add or a remove — the false "your Conditional Access policy was
 *      deleted" alert is the failure mode the whole feature is judged on.
 *   2. PROPERTY-LEVEL output, including the array cases where the existing `detectDrift`
 *      primitive collapses to a whole-array replace. Those are driven side by side
 *      against the real `detectDrift` so the improvement is measured, not asserted.
 *   3. STABILITY. The same input yields the same ordered output.
 *   4. NOISE RULES as data — matching, precedence, and the `always_report` rescue.
 *
 * Pure functions only: no database, no Graph, no tenant. The live proof against two real
 * testbed snapshots is `src/scripts/verify-1797-differ.ts`, which is a different kind of
 * evidence and is deliberately not simulated here.
 */

import { describe, it, expect } from "vitest";
import {
  resolveComparability,
  compareValues,
  diffObjects,
  normalizePropertyPath,
  ruleMatchesPath,
  computeRuleSpecificity,
  decideRule,
  fingerprintRuleset,
  sortChanges,
  type SideStatus,
  type PropertyChange,
} from "./config-snapshot-differ.ts";
import { detectDrift } from "./pcc/drift-detector.ts";
import type { ConfigDiffPropertyRule } from "@workspace/db";

const side = (
  status: SideStatus["status"],
  skipReason: SideStatus["skipReason"] = null,
  objectCount = 0,
): SideStatus => ({ status, skipReason, reasonDetail: null, objectCount });

// ── 1. Absence vs unreadability vs deletion ─────────────────────────────────

describe("#1797 rule 1 — absence, unreadability and deletion are three different things", () => {
  it("both sides read successfully => comparable, so an absence IS a deletion", () => {
    expect(resolveComparability("k", side("collected", null, 3), side("collected", null, 2)).comparability)
      .toBe("comparable");
  });

  it("`empty` is a SUCCESSFUL read, not a failure — the whole point of the store's empty/failed split", () => {
    // A tenant that genuinely has zero of a resource is comparable against one that has
    // some: that pair is a real add or remove. Treating `empty` as unreadable would make
    // the differ blind to every "the last policy was deleted" event.
    expect(resolveComparability("k", side("empty"), side("collected", null, 1)).comparability)
      .toBe("comparable");
    expect(resolveComparability("k", side("collected", null, 1), side("empty")).comparability)
      .toBe("comparable");
    expect(resolveComparability("k", side("empty"), side("empty")).comparability)
      .toBe("comparable");
  });

  it.each([
    ["failed", "permission_denied"],
    ["failed", "license_required"],
    ["failed", "transport_error"],
    ["failed", "unknown_error"],
    ["skipped", "no_executor"],
    ["skipped", "not_collectable"],
  ] as const)(
    "a %s/%s side is NEVER comparable — this is the false-deletion guard",
    (status, reason) => {
      const a = resolveComparability("k", side(status, reason), side("collected", null, 5));
      const b = resolveComparability("k", side("collected", null, 5), side(status, reason));
      expect(a.comparability).toBe("not_comparable");
      expect(b.comparability).toBe("not_comparable");
      // The reason must carry the real cause, so an operator can see WHY rather than
      // just that something was withheld.
      expect(a.reason).toContain(reason);
      expect(a.reason).toContain("NOT a report that anything was added or removed");
    },
  );

  it("a resource one side never targeted is not comparable, and says so distinctly", () => {
    const v = resolveComparability("k", null, side("collected", null, 4));
    expect(v.comparability).toBe("not_comparable");
    expect(v.reason).toContain("never targeted");
    // Distinct from "targeted and failed": the sentence names absence from the target
    // set, not an error, because those are different facts about the platform.
    expect(v.reason).not.toContain("status \"failed\"");
  });

  it("neither side targeted it => still not comparable, never a silent all-clear", () => {
    expect(resolveComparability("k", null, null).comparability).toBe("not_comparable");
  });

  it("`partial` is the middle case: paired objects compare, unpaired ones are unknown", () => {
    const v = resolveComparability("k", side("partial", "budget_exhausted", 40), side("collected", null, 50));
    expect(v.comparability).toBe("partially_comparable");
    expect(v.reason).toContain("indeterminate");
    expect(v.reason).toContain("not a deletion");
  });

  it("`partial` on one side and FAILED on the other degrades to not_comparable", () => {
    // The weakest side decides. A partial read cannot rescue a side that never read.
    expect(
      resolveComparability("k", side("partial", "budget_exhausted", 40), side("failed", "permission_denied")).comparability,
    ).toBe("not_comparable");
    expect(
      resolveComparability("k", side("failed", "transport_error"), side("partial", "budget_exhausted", 3)).comparability,
    ).toBe("not_comparable");
  });

  it("every non-comparable verdict carries a reason; every comparable one carries none", () => {
    // Mirrors the database CHECK, so the code and the constraint cannot disagree.
    const statuses = ["collected", "empty", "partial", "skipped", "failed"] as const;
    for (const a of statuses) {
      for (const b of statuses) {
        const needsReason = (s: typeof a) => s === "partial" || s === "skipped" || s === "failed";
        const v = resolveComparability("k",
          side(a, needsReason(a) ? "unknown_error" : null),
          side(b, needsReason(b) ? "unknown_error" : null));
        if (v.comparability === "comparable") expect(v.reason).toBeNull();
        else expect(typeof v.reason).toBe("string");
      }
    }
  });
});

// ── 2. Property-level output ────────────────────────────────────────────────

describe("#1797 rule 2 — property-level, not object-level", () => {
  it("names the leaf property that moved, not the object", () => {
    const changes = diffObjects(
      { displayName: "Require MFA", state: "enabledForReportingOnlyAsSecurityDefaults" },
      { displayName: "Require MFA", state: "enabled" },
    );
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: "property_changed",
      path: "state",
      oldValue: "enabledForReportingOnlyAsSecurityDefaults",
      newValue: "enabled",
    });
  });

  it("reaches a nested leaf rather than reporting the branch", () => {
    const changes = diffObjects(
      { conditions: { users: { includeUsers: ["All"] }, clientAppTypes: ["all"] } },
      { conditions: { users: { includeUsers: ["All"] }, clientAppTypes: ["browser"] } },
    );
    // The unchanged `users` branch is silent; only the leaf that moved is reported. A
    // swapped member of a scalar array is a removal AND an addition, because multiset
    // semantics give a member no positional identity to "change" — which is the honest
    // answer, and the same one the engine gives for a 200-member list.
    expect(changes).toHaveLength(2);
    expect(new Set(changes.map((c) => c.path))).toEqual(new Set(["conditions.clientAppTypes[]"]));
    expect(changes.map((c) => c.kind).sort()).toEqual(["array_member_added", "array_member_removed"]);
    expect(changes.find((c) => c.kind === "array_member_removed")?.oldValue).toBe("all");
    expect(changes.find((c) => c.kind === "array_member_added")?.newValue).toBe("browser");
  });

  it("distinguishes a property that is absent from one that is present and null", () => {
    // Graph genuinely makes this distinction, and a differ that flattens it reports a
    // cleared field and an unset field as the same event.
    const absent = diffObjects({ a: 1 }, { a: 1, b: null });
    expect(absent).toHaveLength(1);
    expect(absent[0]).toMatchObject({ kind: "property_added", path: "b", oldPresent: false, newPresent: true });

    const nulled = diffObjects({ a: 1, b: "x" }, { a: 1, b: null });
    expect(nulled).toHaveLength(1);
    expect(nulled[0]).toMatchObject({ kind: "property_changed", path: "b", oldPresent: true, newPresent: true });
  });

  it("does not confuse the string \"false\" with the boolean false", () => {
    const changes = diffObjects({ enabled: false }, { enabled: "false" });
    expect(changes).toHaveLength(1);
    expect(changes[0].oldValue).toBe(false);
    expect(changes[0].newValue).toBe("false");
  });

  describe("scalar arrays — measured against the existing detectDrift primitive", () => {
    it("one member added is ONE named member change, where detectDrift replaces the whole array", () => {
      const base = { includeUsers: ["u1", "u2"] };
      const head = { includeUsers: ["u1", "u2", "u3"] };

      const old = detectDrift(base, head);
      // The current drift path's answer: one whole-array replace, no member named.
      expect(old).toHaveLength(1);
      expect(old[0].op).toBe("replace");
      expect(old[0].value).toEqual(["u1", "u2", "u3"]);

      const now = diffObjects(base, head);
      expect(now).toHaveLength(1);
      expect(now[0]).toMatchObject({
        kind: "array_member_added", path: "includeUsers[]", newValue: "u3",
      });
    });

    it("a pure REORDER is one `array_reordered`, where detectDrift reports N false value changes", () => {
      const base = { includeUsers: ["a", "b", "c"] };
      const head = { includeUsers: ["c", "b", "a"] };

      // detectDrift compares positionally: two positions "changed" though the set is
      // identical. That is the false churn #1797 calls out.
      const old = detectDrift(base, head);
      expect(old.length).toBeGreaterThan(1);

      const now = diffObjects(base, head);
      expect(now).toHaveLength(1);
      expect(now[0].kind).toBe("array_reordered");
    });

    it("a reorder is REPORTED, not discarded — an ordered collection still surfaces", () => {
      // Suppressing reorders outright would hide a transport-rule priority change. The
      // engine keeps it as its own kind so a rule can decide, per resource.
      const now = diffObjects({ p: [1, 2] }, { p: [2, 1] });
      expect(now.map((c) => c.kind)).toEqual(["array_reordered"]);
    });

    it("both sides equal as multisets AND in order => no change at all", () => {
      expect(diffObjects({ p: ["a", "b"] }, { p: ["a", "b"] })).toHaveLength(0);
    });

    it("handles duplicate members by count, not by presence", () => {
      const now = diffObjects({ p: ["a", "a", "b"] }, { p: ["a", "b"] });
      expect(now).toHaveLength(1);
      expect(now[0]).toMatchObject({ kind: "array_member_removed", oldValue: "a" });
    });
  });

  describe("arrays of objects", () => {
    it("pairs members by a shared unique key and recurses into the pair", () => {
      const now = diffObjects(
        { Rules: [{ id: "r1", Action: "Allow" }, { id: "r2", Action: "Block" }] },
        { Rules: [{ id: "r2", Action: "Block" }, { id: "r1", Action: "Block" }] },
      );
      // Reordered AND one real change. Only the real change is reported, at the leaf.
      expect(now).toHaveLength(1);
      expect(now[0]).toMatchObject({
        kind: "property_changed", path: "Rules[id=r1].Action",
        oldValue: "Allow", newValue: "Block",
      });
    });

    it("falls back to position only when no key property works for both sides", () => {
      const now = diffObjects({ p: [{ a: 1 }] }, { p: [{ a: 2 }] });
      expect(now).toHaveLength(1);
      expect(now[0].path).toBe("p[0].a");
    });

    it("a keyed member appearing is reported at its own key path", () => {
      const now = diffObjects(
        { Rules: [{ id: "r1", Action: "Allow" }] },
        { Rules: [{ id: "r1", Action: "Allow" }, { id: "r2", Action: "Block" }] },
      );
      expect(now).toHaveLength(1);
      expect(now[0]).toMatchObject({ kind: "property_added", path: "Rules[id=r2]" });
    });
  });

  it("identical objects produce nothing", () => {
    const o = { a: 1, b: { c: [1, 2, 3] }, d: null };
    expect(diffObjects(o, structuredClone(o))).toHaveLength(0);
  });
});

// ── 3. Stability and ordering ───────────────────────────────────────────────

describe("#1797 rule 3 — stable and ordered", () => {
  it("key ordering inside an object does not change the result", () => {
    const a = diffObjects({ x: 1, y: 2 }, { x: 9, y: 2 });
    const b = diffObjects({ y: 2, x: 1 }, { y: 2, x: 9 });
    expect(a).toEqual(b);
  });

  it("the same change set always sorts into the same sequence", () => {
    const mk = (resourceKey: string, objectIdentity: string, path: string) => ({
      resourceKey, objectIdentity, objectDisplayName: null, identityStrategy: null,
      kind: "property_changed" as const, path, normalizedPath: path,
      oldValue: 1, newValue: 2, oldPresent: true, newPresent: true,
    });
    const changes = [
      mk("b", "2", "z"), mk("a", "1", "b"), mk("a", "1", "a"), mk("a", "2", "a"), mk("b", "1", "a"),
    ];
    const once = sortChanges(changes).map((c) => `${c.resourceKey}/${c.objectIdentity}/${c.path}`);
    const twice = sortChanges([...changes].reverse()).map((c) => `${c.resourceKey}/${c.objectIdentity}/${c.path}`);
    expect(once).toEqual(twice);
    expect(once).toEqual(["a/1/a", "a/1/b", "a/2/a", "b/1/a", "b/2/z"]);
  });

  it("recursion order into nested objects is sorted, not insertion-ordered", () => {
    const out: PropertyChange[] = [];
    compareValues("", { z: 1, a: 1, m: 1 }, { z: 2, a: 2, m: 2 }, out);
    expect(out.map((c) => c.path)).toEqual(["a", "m", "z"]);
  });
});

// ── 4. Noise rules as data ──────────────────────────────────────────────────

describe("#1797 rule 4 — noise control is data", () => {
  it("normalizes array subscripts so a rule survives reindexing and rekeying", () => {
    expect(normalizePropertyPath("conditions.users.includeUsers[2]")).toBe("conditions.users.includeUsers[]");
    expect(normalizePropertyPath("Rules[id=abc].Action")).toBe("Rules[].Action");
    expect(normalizePropertyPath("a[0].b[1].c")).toBe("a[].b[].c");
    expect(normalizePropertyPath("plain.path")).toBe("plain.path");
  });

  describe("pattern forms", () => {
    it("exact", () => {
      expect(ruleMatchesPath("a.b", "a.b")).toBe(true);
      expect(ruleMatchesPath("a.b", "a.bc")).toBe(false);
      expect(ruleMatchesPath("a.b", "a.b.c")).toBe(false);
    });
    it("prefix matches the path itself and everything beneath it", () => {
      expect(ruleMatchesPath("a.*", "a")).toBe(true);
      expect(ruleMatchesPath("a.*", "a.b")).toBe(true);
      expect(ruleMatchesPath("a.*", "a.b.c")).toBe(true);
      expect(ruleMatchesPath("a.*", "ab")).toBe(false);
    });
    it("suffix — the form the shipped @odata rules use", () => {
      expect(ruleMatchesPath("*@odata.etag", "@odata.etag")).toBe(true);
      expect(ruleMatchesPath("*@odata.etag", "nested.thing@odata.etag")).toBe(true);
      expect(ruleMatchesPath("*@odata.etag", "@odata.context")).toBe(false);
    });
    it("bare * matches everything", () => {
      expect(ruleMatchesPath("*", "anything.at.all")).toBe(true);
    });
  });

  const rule = (o: Partial<ConfigDiffPropertyRule> & { id: number }): ConfigDiffPropertyRule => ({
    resourceKey: "*", propertyPathPattern: "*", action: "ignore", basis: "structural_annotation",
    specificity: 0, rationale: null, declaredByUserId: null, evidenceDiffId: null,
    evidenceObjectCount: null, evidenceObservedAt: null, isActive: true,
    createdAt: new Date(), updatedAt: new Date(), ...o,
  } as ConfigDiffPropertyRule);

  it("computes precedence so exact beats wildcard and a named resource beats '*'", () => {
    expect(computeRuleSpecificity("*", "a.b")).toBeGreaterThan(computeRuleSpecificity("*", "a.*"));
    expect(computeRuleSpecificity("policies/x", "a.b")).toBeGreaterThan(computeRuleSpecificity("*", "a.b"));
    expect(computeRuleSpecificity("*", "a.bbbb*")).toBeGreaterThan(computeRuleSpecificity("*", "a.b*"));
  });

  it("the most specific rule wins", () => {
    const rules = [
      rule({ id: 1, propertyPathPattern: "a.*", specificity: computeRuleSpecificity("*", "a.*") }),
      rule({ id: 2, propertyPathPattern: "a.b", action: "always_report", specificity: computeRuleSpecificity("*", "a.b") }),
    ];
    expect(decideRule(rules, "r", "a.b").ignored).toBe(false);
    expect(decideRule(rules, "r", "a.c").ignored).toBe(true);
  });

  it("a narrow always_report rescues one path from under a broad ignore", () => {
    const rules = [
      rule({ id: 1, propertyPathPattern: "*", specificity: computeRuleSpecificity("*", "*") }),
      rule({
        id: 2, resourceKey: "policies/ca", propertyPathPattern: "state", action: "always_report",
        specificity: computeRuleSpecificity("policies/ca", "state"),
      }),
    ];
    expect(decideRule(rules, "policies/ca", "state").ignored).toBe(false);
    expect(decideRule(rules, "policies/ca", "other").ignored).toBe(true);
    // The rescue is scoped to its own resource and does not leak to another.
    expect(decideRule(rules, "policies/other", "state").ignored).toBe(true);
  });

  it("at EQUAL specificity always_report beats ignore, whichever order they arrive in", () => {
    const spec = computeRuleSpecificity("*", "a.b");
    const ig = rule({ id: 1, propertyPathPattern: "a.b", action: "ignore", specificity: spec });
    const ar = rule({ id: 2, propertyPathPattern: "a.b", action: "always_report", specificity: spec });
    expect(decideRule([ig, ar], "r", "a.b").ignored).toBe(false);
    expect(decideRule([ar, ig], "r", "a.b").ignored).toBe(false);
  });

  it("a rule scoped to another resource never applies", () => {
    const rules = [rule({ id: 1, resourceKey: "other", propertyPathPattern: "a.b", specificity: 1300 })];
    expect(decideRule(rules, "mine", "a.b").ignored).toBe(false);
  });

  it("an ignored change names the rule that ignored it", () => {
    const rules = [rule({ id: 42, propertyPathPattern: "*@odata.etag", specificity: 212 })];
    const d = decideRule(rules, "r", "@odata.etag");
    expect(d.ignored).toBe(true);
    expect(d.rule?.id).toBe(42);
  });

  it("the ruleset fingerprint depends on the rules, not on their row order", () => {
    const a = rule({ id: 1, propertyPathPattern: "x" });
    const b = rule({ id: 2, propertyPathPattern: "y" });
    expect(fingerprintRuleset([a, b])).toBe(fingerprintRuleset([b, a]));
    expect(fingerprintRuleset([a])).not.toBe(fingerprintRuleset([a, b]));
    // Changing an action changes the fingerprint, which is what forces a NEW diff row
    // rather than a stale cached answer.
    expect(fingerprintRuleset([rule({ id: 1, propertyPathPattern: "x", action: "always_report" })]))
      .not.toBe(fingerprintRuleset([a]));
  });
});
