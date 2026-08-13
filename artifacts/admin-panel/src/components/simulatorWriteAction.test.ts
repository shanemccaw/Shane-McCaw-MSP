import { describe, it, expect } from "vitest";
import {
  variablePlaceholder,
  buildInitialVariables,
  readyToPreview,
  describeMethodConsequence,
  describeRollback,
} from "./simulatorWriteAction";

describe("buildInitialVariables", () => {
  it("initialises every required variable to an empty string — no destructive defaults", () => {
    // users.disable_enable_signin requires exactly these two.
    const vars = buildInitialVariables(["userId", "accountEnabled"]);
    expect(vars).toEqual({ userId: "", accountEnabled: "" });
    // Critically, accountEnabled is NOT pre-filled with a boolean that could drive a real write.
    expect(vars["accountEnabled"]).toBe("");
  });

  it("handles no required variables", () => {
    expect(buildInitialVariables([])).toEqual({});
  });
});

describe("variablePlaceholder", () => {
  it("gives a format hint (never a value) for known variables", () => {
    expect(variablePlaceholder("userId")).toMatch(/GUID|userPrincipalName/);
    expect(variablePlaceholder("membershipId")).toMatch(/NOT the user id/);
    expect(variablePlaceholder("accountEnabled")).toBe("true / false");
  });

  it("falls back to the variable name for unknown variables", () => {
    expect(variablePlaceholder("somethingNew")).toBe("somethingNew");
  });
});

describe("readyToPreview", () => {
  it("is false until every required variable is non-empty", () => {
    expect(readyToPreview(["userId", "accountEnabled"], { userId: "u1", accountEnabled: "" })).toBe(false);
    expect(readyToPreview(["userId", "accountEnabled"], { userId: "u1", accountEnabled: "false" })).toBe(true);
  });

  it("treats whitespace-only as empty", () => {
    expect(readyToPreview(["userId"], { userId: "   " })).toBe(false);
  });

  it("is true when there are no required variables", () => {
    expect(readyToPreview([], {})).toBe(true);
  });
});

describe("describeMethodConsequence", () => {
  it("describes each real write method", () => {
    expect(describeMethodConsequence("POST")).toContain("creates");
    expect(describeMethodConsequence("PATCH")).toContain("modifies");
    expect(describeMethodConsequence("PUT")).toContain("replaces");
    expect(describeMethodConsequence("DELETE")).toContain("removes");
  });
});

describe("describeRollback", () => {
  it("reports a reversible action with its real reverse template", () => {
    const r = describeRollback({ reversible: true, reverseTemplateId: "groups.remove_member", reverseTemplateLabel: "Remove Group Member" });
    expect(r.tone).toBe("ok");
    expect(r.text).toContain("Remove Group Member");
    expect(r.text).toContain("groups.remove_member");
  });

  it("warns clearly when there is NO rollback path", () => {
    const r = describeRollback({ reversible: false, reverseTemplateId: null, reverseTemplateLabel: null });
    expect(r.tone).toBe("warn");
    expect(r.text).toMatch(/No single-step rollback/);
  });

  it("does not claim a rollback when reversible is true but reverseTemplateId is missing", () => {
    const r = describeRollback({ reversible: true, reverseTemplateId: null, reverseTemplateLabel: null });
    expect(r.tone).toBe("warn");
  });
});
