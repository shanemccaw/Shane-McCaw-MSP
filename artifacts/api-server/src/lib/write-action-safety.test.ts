/**
 * write-action-safety.test.ts
 *
 * Unit tests for the pure Simulator write-action safety helpers. No DB, no
 * mocks — the whole point of keeping these functions pure. Data shapes are the
 * REAL ones from 2026-07-20-launch-control-phase3-templates.sql
 * (successCriteria: {"statusCode": N}) and 2026-07-21-launch-control-rollback.sql.
 */

import { describe, it, expect } from "vitest";
import { evaluateSuccessCriteria, resolveDependsOnState } from "./write-action-safety";

describe("evaluateSuccessCriteria", () => {
  it("marks met when the returned status equals the declared statusCode", () => {
    // users.disable_enable_signin declares {"statusCode": 204}
    const ev = evaluateSuccessCriteria({ statusCode: 204 }, 204);
    expect(ev.defined).toBe(true);
    expect(ev.expectedStatus).toBe(204);
    expect(ev.actualStatus).toBe(204);
    expect(ev.met).toBe(true);
    expect(ev.note).toContain("matching");
  });

  it("marks NOT met when the returned status differs from the declared statusCode", () => {
    // auth.revoke_signin_sessions declares 200 but Graph returned 204
    const ev = evaluateSuccessCriteria({ statusCode: 200 }, 204);
    expect(ev.defined).toBe(true);
    expect(ev.expectedStatus).toBe(200);
    expect(ev.met).toBe(false);
    expect(ev.note).toContain("differs");
    // Honest: it must NOT claim to be the authority on write success.
    expect(ev.note).toContain("[200,201,204]");
  });

  it("leaves met undefined (never guesses) when no statusCode is declared", () => {
    expect(evaluateSuccessCriteria({}, 204).met).toBeUndefined();
    expect(evaluateSuccessCriteria({}, 204).defined).toBe(false);
    expect(evaluateSuccessCriteria(null, 200).defined).toBe(false);
    expect(evaluateSuccessCriteria(undefined, 200).defined).toBe(false);
    expect(evaluateSuccessCriteria({ note: "descriptive only" }, 200).defined).toBe(false);
  });

  it("ignores a non-numeric statusCode rather than coercing it", () => {
    const ev = evaluateSuccessCriteria({ statusCode: "204" as unknown as number }, 204);
    expect(ev.defined).toBe(false);
    expect(ev.met).toBeUndefined();
  });
});

describe("resolveDependsOnState", () => {
  it("reports no dependencies and no warning for the real current data (all depends_on = [])", () => {
    const st = resolveDependsOnState([], new Map(), new Set());
    expect(st.hasDependencies).toBe(false);
    expect(st.entries).toEqual([]);
    expect(st.possiblyUnsatisfied).toBe(false);
    expect(st.isolatedRunWarning).toBeNull();
  });

  it("treats null/undefined depends_on as no dependencies", () => {
    expect(resolveDependsOnState(null, new Map(), new Set()).hasDependencies).toBe(false);
    expect(resolveDependsOnState(undefined, new Map(), new Set()).hasDependencies).toBe(false);
  });

  it("raises a standalone-run warning naming the UNSATISFIED dependencies", () => {
    const known = new Map([
      ["groups.add_member", "Add Group Member"],
      ["licensing.assign_license", "Assign License"],
    ]);
    const succeeded = new Set(["groups.add_member"]); // only one has a prior success
    const st = resolveDependsOnState(["groups.add_member", "licensing.assign_license"], known, succeeded);

    expect(st.hasDependencies).toBe(true);
    expect(st.possiblyUnsatisfied).toBe(true);
    expect(st.entries).toEqual([
      { templateId: "groups.add_member", exists: true, label: "Add Group Member", hasRecentSuccess: true },
      { templateId: "licensing.assign_license", exists: true, label: "Assign License", hasRecentSuccess: false },
    ]);
    expect(st.isolatedRunWarning).toContain("licensing.assign_license");
    expect(st.isolatedRunWarning).not.toBeNull();
    // The satisfied one must NOT be listed as unmet.
    expect(st.isolatedRunWarning).toMatch(/No recorded successful run.*licensing\.assign_license/);
  });

  it("still warns (isolation) even when every dependency has a prior success", () => {
    const known = new Map([["groups.add_member", "Add Group Member"]]);
    const st = resolveDependsOnState(["groups.add_member"], known, new Set(["groups.add_member"]));
    expect(st.possiblyUnsatisfied).toBe(false);
    expect(st.isolatedRunWarning).not.toBeNull();
    expect(st.isolatedRunWarning).toContain("in isolation");
  });

  it("flags a dependency whose template does not exist", () => {
    const st = resolveDependsOnState(["ghost.template"], new Map(), new Set());
    expect(st.entries[0]).toEqual({ templateId: "ghost.template", exists: false, label: null, hasRecentSuccess: false });
    expect(st.possiblyUnsatisfied).toBe(true);
  });

  it("filters out empty/non-string dependency entries", () => {
    const st = resolveDependsOnState(["", "groups.add_member"] as string[], new Map([["groups.add_member", "Add"]]), new Set());
    expect(st.entries).toHaveLength(1);
    expect(st.entries[0]!.templateId).toBe("groups.add_member");
  });
});
