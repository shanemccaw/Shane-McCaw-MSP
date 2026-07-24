// signalRuleForm.test.ts
//
// Regression tests for the "Shore Up Rule Creation UX" work, exercising the
// PURE rule-form layer (no DOM) the shared editor and the Simulator trace both
// use:
//   #1 validateRuleForm — the save-bug fix: per-field messages that name the
//      real missing field, so a new-signal draft the operator visibly chose is
//      never told to "select a Signal" it already selected.
//   #2 draftRuleForTracedKey — the universal per-property "Add rule" fallback
//      draft (used when no server suggestion exists), source_key correctly set.
//   #3 groupCreateBodyFromForm — the trace's inline group creation, which posts
//      to the SAME /api/admin/signal-rule-groups endpoint the rules page uses.
//
// Run with: pnpm --filter admin-panel run test (node env, src/**/*.test.ts)

import { describe, it, expect } from "vitest";
import {
  emptyRuleForm,
  validateRuleForm,
  draftRuleForTracedKey,
  groupCreateBodyFromForm,
  ruleFormToBody,
  type RuleForm,
} from "./signalRuleForm";

// ── #1: validateRuleForm — the save-bug fix ───────────────────────────────────

describe("validateRuleForm — precise, field-accurate messages (the save-bug fix)", () => {
  it("passes a complete rule against an existing signal (selecting a value + Save saves)", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      ruleType: "profile_key_gt",
      sourceKey: "staleGuestAccountCount",
      compareValue: "0",
    };
    expect(validateRuleForm(form, false)).toBeNull();
  });

  it("REGRESSION: a new-signal draft with a blank key no longer misfires as 'Signal … required'", () => {
    // The exact prior failure: choosing "➕ Create a new signal…" sets
    // createNewSignal and clears signalKey (the key now lives in a separate text
    // input). The operator has visibly selected that option and typed a
    // label/description, yet the old validator returned the generic
    // "Signal, rule type, and source key are required." — telling them to select
    // a Signal they had already chosen to create.
    const form: RuleForm = {
      ...emptyRuleForm(""),
      createNewSignal: true,
      newSignalLabel: "MFA enforcement gap",
      newSignalDescription: "Tenants with MFA not enforced",
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
    };
    const msg = validateRuleForm(form, false);
    expect(msg).not.toBeNull();
    // The old, misleading message must be gone…
    expect(msg).not.toBe("Signal, rule type, and source key are required.");
    // …replaced by one that names the actual field to fill (the new signal's key).
    expect(msg!.toLowerCase()).toContain("new signal");
    expect(msg!.toLowerCase()).toContain("key");
  });

  it("a complete new-signal draft (key + label + description) saves", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      createNewSignal: true,
      newSignalLabel: "MFA enforcement gap",
      newSignalDescription: "Tenants with MFA not enforced",
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
    };
    expect(validateRuleForm(form, false)).toBeNull();
  });

  it("a new-signal draft missing its label/description names those, not the Signal", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      createNewSignal: true,
      newSignalLabel: "",
      newSignalDescription: "",
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
    };
    const msg = validateRuleForm(form, false);
    expect(msg!.toLowerCase()).toContain("label");
    expect(msg!.toLowerCase()).toContain("description");
  });

  it("no signal chosen (existing-signal mode) gets a specific 'select the signal' message", () => {
    const form: RuleForm = {
      ...emptyRuleForm(""),
      ruleType: "profile_key_gt",
      sourceKey: "staleGuestAccountCount",
    };
    const msg = validateRuleForm(form, false);
    expect(msg).not.toBeNull();
    expect(msg!.toLowerCase()).toContain("signal");
    // Not the old catch-all.
    expect(msg).not.toBe("Signal, rule type, and source key are required.");
  });

  it("a missing source key names the rule type's own source-key label", () => {
    // threshold's source-key label is "Monitor key".
    const form: RuleForm = { ...emptyRuleForm("security:mfa-gap"), ruleType: "threshold", sourceKey: "" };
    const msg = validateRuleForm(form, false);
    expect(msg!.toLowerCase()).toContain("monitor key");
  });
});

// ── #2: draftRuleForTracedKey — universal per-property "Add rule" fallback ─────

describe("draftRuleForTracedKey — the fallback draft when no server suggestion exists", () => {
  it("sets source_key to the produced key and a readable starting rule type", () => {
    const draft = draftRuleForTracedKey({ key: "byDomain", origin: "mapping" }, "identity:users");
    expect(draft.sourceKey).toBe("byDomain");
    expect(draft.ruleType).toBe("profile_key_truthy");
    // Signal is left for the operator to pick or create — never guessed.
    expect(draft.signalKey).toBe("");
    // Not a group-creating draft by default.
    expect(draft.createNewGroup).toBe(false);
  });

  it("for the synthetic item-count key, drafts a threshold rule reading the CHECK key", () => {
    const draft = draftRuleForTracedKey(
      { key: "identity:mfa-registration__itemCount", origin: "itemCount" },
      "identity:mfa-registration",
    );
    expect(draft.ruleType).toBe("threshold");
    // threshold rules read the bare check key, not the synthetic __itemCount name.
    expect(draft.sourceKey).toBe("identity:mfa-registration");
  });

  it("the fallback draft only needs a signal to become saveable — the operator's 'only job'", () => {
    const draft = draftRuleForTracedKey({ key: "byDomain", origin: "mapping" }, "identity:users");
    // As-is it's missing a signal…
    expect(validateRuleForm(draft, false)).not.toBeNull();
    // …once a signal is chosen, it validates (source key already set for them).
    expect(validateRuleForm({ ...draft, signalKey: "governance:users" }, false)).toBeNull();
  });
});

// ── #3: groupCreateBodyFromForm — inline group creation reuses the group POST ──

describe("groupCreateBodyFromForm — inline OR/AND group creation from the trace", () => {
  it("builds the exact body the existing /signal-rule-groups endpoint expects", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      createNewGroup: true,
      newGroupLogic: "OR",
      newGroupLabel: "  MFA gap conditions  ",
    };
    expect(groupCreateBodyFromForm(form)).toEqual({
      signalKey: "security:mfa-gap",
      logic: "OR",
      label: "MFA gap conditions",
      sortOrder: 0,
    });
  });

  it("carries the chosen AND logic and nulls a blank label", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      createNewGroup: true,
      newGroupLogic: "AND",
      newGroupLabel: "   ",
    };
    const body = groupCreateBodyFromForm(form);
    expect(body.logic).toBe("AND");
    expect(body.label).toBeNull();
  });

  it("ruleFormToBody leaves groupId null when a new group is being created (caller overrides with the new id)", () => {
    // The rule body must NOT invent a group id; the save flow creates the group
    // first and overrides groupId with the returned id.
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
      createNewGroup: true,
      newGroupLogic: "OR",
    };
    expect(ruleFormToBody(form, false).groupId).toBeNull();
  });

  it("ruleFormToBody preserves an explicitly chosen existing group id", () => {
    const form: RuleForm = {
      ...emptyRuleForm("security:mfa-gap"),
      ruleType: "profile_key_falsy",
      sourceKey: "mfaEnforced",
      groupId: "42",
    };
    expect(ruleFormToBody(form, false).groupId).toBe(42);
  });
});

// ── emptyRuleForm carries the new fields (guards against a stale copy) ─────────

describe("emptyRuleForm — includes the new group-creation fields", () => {
  it("defaults createNewGroup off with OR logic and a blank label", () => {
    const f = emptyRuleForm("x");
    expect(f.createNewGroup).toBe(false);
    expect(f.newGroupLogic).toBe("OR");
    expect(f.newGroupLabel).toBe("");
  });
});
