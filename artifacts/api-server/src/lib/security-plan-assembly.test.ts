/**
 * security-plan-assembly.test.ts — proves the two sharp constraints the Security Plan
 * assembled view (#1561) must uphold, as pure functions of raw rows + a scope:
 *
 *   #1563 — scope narrows on a DIMENSION VALUE, never on an outcome; a row that cannot
 *           be classified by a scoped dimension is RETAINED, never silently dropped.
 *   #1565 — every (scoped or honest) result carries a filter footprint: what was
 *           excluded, per module, and a total — computed even for the honest view.
 *
 * These do not touch the database: `applyScopeAndFootprint` / `isExcludedByScope` are
 * the pure core the DB-backed `assembleSecurityPlan` delegates to.
 */
import { describe, it, expect } from "vitest";
import {
  applyScopeAndFootprint,
  isExcludedByScope,
  scopeHasConstraints,
  scopeMissingRequiredStatement,
  synthesizeScopeStatement,
  HONEST_SCOPE,
  type RawSecurityPlanModule,
} from "./security-plan-assembly.ts";
import type { SecurityPlanAssembledItem, SecurityPlanScope } from "@workspace/db";

function item(id: string, over: Partial<SecurityPlanAssembledItem> = {}): SecurityPlanAssembledItem {
  return { id, title: id, state: null, detail: null, pillar: null, framework: null, businessUnit: null, ...over };
}

const modules: RawSecurityPlanModule[] = [
  {
    key: "policy",
    label: "Policy Decisions",
    sourceIssue: "#1490",
    items: [
      item("p-identity", { pillar: "identity" }),
      item("p-data", { pillar: "data" }),
      item("p-unclassified"), // no pillar — must survive a pillar scope
    ],
  },
  {
    key: "risk",
    label: "Risk Register",
    sourceIssue: "#1487",
    items: [
      item("r-cis", { pillar: "identity", framework: "CIS" }),
      item("r-nist", { pillar: "data", framework: "NIST" }),
    ],
  },
];

describe("Security Plan scope filtering (#1563)", () => {
  it("keeps only in-scope dimension values and RETAINS rows the dimension cannot classify", () => {
    const scope: SecurityPlanScope = { dimensions: { pillar: ["identity"] } };
    const { modules: out } = applyScopeAndFootprint(modules, scope, "2026-08-31T00:00:00.000Z");

    const policy = out.find((m) => m.key === "policy")!;
    const kept = policy.items.map((i) => i.id);
    // p-identity kept (in scope); p-data dropped (out of scope); p-unclassified RETAINED.
    expect(kept).toContain("p-identity");
    expect(kept).toContain("p-unclassified");
    expect(kept).not.toContain("p-data");
    expect(policy.excludedCount).toBe(1);
  });

  it("an unclassifiable row is never excluded by a scoped dimension", () => {
    const scope: SecurityPlanScope = { dimensions: { pillar: ["identity"] } };
    expect(isExcludedByScope(item("x"), scope)).toBe(false); // null pillar → retained
    expect(isExcludedByScope(item("x", { pillar: "data" }), scope)).toBe(true);
    expect(isExcludedByScope(item("x", { pillar: "identity" }), scope)).toBe(false);
  });

  it("businessUnit (#2085) excludes/retains exactly like pillar/framework", () => {
    const scope: SecurityPlanScope = { dimensions: { businessUnit: ["Finance"] } };
    expect(isExcludedByScope(item("x"), scope)).toBe(false); // null businessUnit → retained
    expect(isExcludedByScope(item("x", { businessUnit: "Sales" }), scope)).toBe(true);
    expect(isExcludedByScope(item("x", { businessUnit: "Finance" }), scope)).toBe(false);
  });

  it("intersects multiple dimensions (both must pass) but still retains on absence", () => {
    const scope: SecurityPlanScope = { dimensions: { pillar: ["identity"], framework: ["CIS"] } };
    const { modules: out } = applyScopeAndFootprint(modules, scope, "2026-08-31T00:00:00.000Z");
    const risk = out.find((m) => m.key === "risk")!;
    expect(risk.items.map((i) => i.id)).toEqual(["r-cis"]); // r-nist fails both dims
  });

  it("the honest (empty) scope excludes nothing", () => {
    expect(scopeHasConstraints(HONEST_SCOPE)).toBe(false);
    const { modules: out, footprint } = applyScopeAndFootprint(modules, HONEST_SCOPE, "2026-08-31T00:00:00.000Z");
    expect(out.flatMap((m) => m.items).length).toBe(5);
    expect(footprint.totalExcluded).toBe(0);
    expect(footprint.isHonestView).toBe(true);
  });

  it("requires a scope statement on a constrained scope, but not on the honest view", () => {
    // Honest view: nothing is narrowed, so nothing needs explaining.
    expect(scopeMissingRequiredStatement(HONEST_SCOPE)).toBe(false);

    // Constrained with no statement, an empty statement, or a whitespace-only one — all
    // still missing the requirement.
    expect(scopeMissingRequiredStatement({ dimensions: { pillar: ["identity"] } })).toBe(true);
    expect(scopeMissingRequiredStatement({ dimensions: { pillar: ["identity"] }, statement: "" })).toBe(true);
    expect(scopeMissingRequiredStatement({ dimensions: { pillar: ["identity"] }, statement: "   " })).toBe(true);

    // Constrained WITH a real statement satisfies it.
    expect(
      scopeMissingRequiredStatement({
        dimensions: { pillar: ["identity"] },
        statement: "Identity controls only — the estate's identity posture for this audit.",
      }),
    ).toBe(false);
  });
});

describe("Security Plan filter footprint (#1565)", () => {
  it("records excluded counts per module and a total, even on the honest view", () => {
    const honest = applyScopeAndFootprint(modules, HONEST_SCOPE, "2026-08-31T00:00:00.000Z").footprint;
    expect(honest.excludedByModule).toEqual([
      { moduleKey: "policy", excludedCount: 0 },
      { moduleKey: "risk", excludedCount: 0 },
    ]);
    expect(honest.totalExcluded).toBe(0);
    expect(honest.computedAt).toBe("2026-08-31T00:00:00.000Z");

    const scoped = applyScopeAndFootprint(
      modules,
      { dimensions: { pillar: ["identity"] } },
      "2026-08-31T00:00:00.000Z",
    ).footprint;
    // policy: p-data excluded (1); risk: r-nist excluded (1); total 2.
    expect(scoped.excludedByModule).toEqual([
      { moduleKey: "policy", excludedCount: 1 },
      { moduleKey: "risk", excludedCount: 1 },
    ]);
    expect(scoped.totalExcluded).toBe(2);
    expect(scoped.isHonestView).toBe(false);
    // The footprint carries the scope that produced it, so a sealed slice is self-describing.
    expect(scoped.scope.dimensions.pillar).toEqual(["identity"]);
  });
});

describe("Security Plan signature scope statement (#1564)", () => {
  it("never leaves the footprint's scope.statement empty, even with no scope body at all", () => {
    // This is the exact shape POST .../versions produces when a caller seals with no
    // `scope` field — #1564's "Settled" section is that this must still be a bounded
    // statement, never an unqualified claim.
    const { footprint } = applyScopeAndFootprint(modules, HONEST_SCOPE, "2026-08-31T00:00:00.000Z");
    expect(footprint.scope.statement).toBeTruthy();
    expect(footprint.scope.statement.length).toBeGreaterThan(0);
  });

  it("synthesizes a bounded statement for the honest (unfiltered) view", () => {
    expect(synthesizeScopeStatement({ dimensions: {} }, true)).toBe(
      "Full assessed estate — no scope narrowing applied.",
    );
  });

  it("synthesizes a statement naming the applied dimensions for a scoped view", () => {
    const statement = synthesizeScopeStatement({ dimensions: { pillar: ["identity", "data"] } }, false);
    expect(statement).toContain("pillar: identity, data");
  });

  it("uses the caller-supplied statement verbatim (trimmed) when one is given", () => {
    expect(
      synthesizeScopeStatement({ dimensions: { pillar: ["identity"] }, statement: "  Identity controls only.  " }, false),
    ).toBe("Identity controls only.");
  });

  it("ignores a blank/whitespace-only caller statement and synthesizes instead", () => {
    expect(synthesizeScopeStatement({ dimensions: {}, statement: "   " }, true)).toBe(
      "Full assessed estate — no scope narrowing applied.",
    );
  });

  it("a scope change (different dimensions) produces a different statement, never an in-place edit", () => {
    const before = applyScopeAndFootprint(modules, { dimensions: { pillar: ["identity"] } }, "t").footprint;
    const after = applyScopeAndFootprint(modules, { dimensions: { pillar: ["data"] } }, "t").footprint;
    expect(before.scope.statement).not.toBe(after.scope.statement);
  });
});
